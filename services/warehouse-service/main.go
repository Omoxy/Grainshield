// GrainShield warehouse-service — NCPB depot management, deposits, inspections.
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
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/grainshield/warehouse-service/config"
	"github.com/grainshield/warehouse-service/handlers"
	"github.com/grainshield/warehouse-service/repository"
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
		panic("failed to initialize logger: " + err.Error())
	}
	defer logger.Sync()

	logger.Info("starting warehouse-service", zap.Int("port", cfg.Port))

	dbCtx, dbCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer dbCancel()
	pool, err := pgxpool.New(dbCtx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer pool.Close()
	if err := pool.Ping(dbCtx); err != nil {
		logger.Fatal("database ping failed", zap.Error(err))
	}
	logger.Info("database connected")

	var rateLimiter *middleware.RateLimiter
	if cfg.RedisURL != "" {
		opts, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			logger.Fatal("invalid REDIS_URL", zap.Error(err))
		}
		redisClient := redis.NewClient(opts)
		if err := redisClient.Ping(context.Background()).Err(); err != nil {
			logger.Warn("redis ping failed — rate limiting disabled", zap.Error(err))
		} else {
			rateLimiter = middleware.NewRateLimiter(redisClient, logger)
			logger.Info("redis connected — rate limiting enabled")
		}
	}

	audit := middleware.NewAuditLogger(pool, logger)
	repo := repository.NewWarehouseRepo(pool)
	h := handlers.NewWarehouseHandlers(repo, audit, logger)

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(middleware.Sanitize)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy","service":"warehouse-service"}`))
	})
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, `{"status":"not ready"}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ready"}`))
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))

		r.With(middleware.RequirePermission("warehouse:list")).
			Get("/warehouses", h.ListWarehouses)

		r.With(middleware.RequirePermission("warehouse:read")).
			Get("/warehouses/stats", h.GetStats)

		r.With(middleware.RequirePermission("warehouse:read")).
			Get("/warehouses/{id}/deposits", h.ListDeposits)

		r.With(
			middleware.RequirePermission("deposit:create"),
			audit.AuditMiddleware("deposit:create", "deposit"),
			rateLimit(rateLimiter, 20, time.Minute),
		).Post("/warehouses/deposit", h.CreateDeposit)

		r.With(
			middleware.RequirePermission("inspection:create"),
			audit.AuditMiddleware("inspection:create", "inspection"),
			rateLimit(rateLimiter, 20, time.Minute),
		).Post("/warehouses/inspect", h.CreateInspection)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("warehouse-service listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down warehouse-service...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("forced shutdown", zap.Error(err))
	}
	logger.Info("warehouse-service stopped")
}

func rateLimit(rl *middleware.RateLimiter, max int, window time.Duration) func(http.Handler) http.Handler {
	if rl == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return rl.Limit(max, window, false)
}
