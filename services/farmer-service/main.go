package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/grainshield/farmer-service/config"
	"github.com/grainshield/farmer-service/handlers"
	"github.com/grainshield/farmer-service/repository"
	"github.com/grainshield/pkg/middleware"
)

func main() {
	cfg := config.Load()

	var logger *zap.Logger
	var err error
	if cfg.LogLevel == "debug" {
		logger, err = zap.NewDevelopment()
	} else {
		logger, err = zap.NewProduction()
	}
	if err != nil {
		panic(fmt.Sprintf("failed to initialize logger: %v", err))
	}
	defer logger.Sync()

	logger.Info("starting farmer-service",
		zap.Int("port", cfg.Port),
		zap.String("log_level", cfg.LogLevel),
	)

	ctx := context.Background()
	dbPool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to PostgreSQL", zap.Error(err))
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		logger.Fatal("failed to ping PostgreSQL", zap.Error(err))
	}
	logger.Info("connected to PostgreSQL")

	redisOpt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logger.Fatal("failed to parse Redis URL", zap.Error(err))
	}
	redisClient := redis.NewClient(redisOpt)
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		logger.Fatal("failed to ping Redis", zap.Error(err))
	}
	logger.Info("connected to Redis")

	farmerRepo := repository.NewFarmerRepo(dbPool, cfg.EncryptionKey)
	auditLogger := middleware.NewAuditLogger(dbPool, logger)
	rateLimiter := middleware.NewRateLimiter(redisClient, logger)
	h := handlers.NewHandlers(farmerRepo, auditLogger, logger)

	r := chi.NewRouter()

	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(30 * time.Second))
	r.Use(middleware.Sanitize)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"healthy","service":"farmer-service"}`))
	})
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := dbPool.Ping(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"not ready","reason":"database unavailable"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ready","service":"farmer-service"}`))
	})

	// Auth endpoint — no JWT required (this IS the login endpoint)
	r.Post("/api/v1/auth/login", h.Login)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))

		r.Route("/farmers", func(r chi.Router) {
			r.With(
				middleware.RequirePermission("farmer:create"),
				rateLimiter.Limit(cfg.WriteRatePerMin, time.Minute, false),
			).Post("/", h.Register)

			r.With(
				middleware.RequirePermission("farmer:list"),
				rateLimiter.Limit(cfg.ReadRatePerMin, time.Minute, false),
			).Get("/", h.List)

			r.With(
				middleware.RequirePermission("farmer:read"),
				rateLimiter.Limit(cfg.ReadRatePerMin, time.Minute, false),
			).Get("/gs/{gsNumber}", h.GetByGSNumber)

			r.With(
				middleware.RequirePermission("farmer:read"),
				rateLimiter.Limit(cfg.ReadRatePerMin, time.Minute, false),
			).Get("/{id}", h.Get)

			r.With(
				middleware.RequirePermission("farmer:update"),
				rateLimiter.Limit(cfg.WriteRatePerMin, time.Minute, false),
			).Put("/{id}", h.Update)
		})

		r.With(
			middleware.RequirePermission("farmer:list"),
		).Get("/revops/summary", h.RevOpsSummary)

		r.Route("/solidarity-groups", func(r chi.Router) {
			r.With(
				middleware.RequirePermission("farmer:list"),
				rateLimiter.Limit(cfg.ReadRatePerMin, time.Minute, false),
			).Get("/", h.ListGroups)

			r.With(
				middleware.RequirePermission("farmer:update"),
				rateLimiter.Limit(cfg.WriteRatePerMin, time.Minute, false),
			).Post("/join", h.JoinGroup)

			r.With(
				middleware.RequirePermission("farmer:update"),
				rateLimiter.Limit(cfg.WriteRatePerMin, time.Minute, false),
			).Post("/leave", h.LeaveGroup)
		})
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("farmer-service listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	sig := <-quit
	logger.Info("received shutdown signal", zap.String("signal", sig.String()))

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("server forced shutdown", zap.Error(err))
	}

	logger.Info("farmer-service stopped gracefully")
}
