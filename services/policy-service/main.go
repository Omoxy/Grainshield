// GrainShield Policy Service
// Manages parametric insurance policies, trigger evaluation engine,
// and smart contract hash generation.
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

	"github.com/grainshield/pkg/middleware"
	"github.com/grainshield/policy-service/config"
	"github.com/grainshield/policy-service/handlers"
	"github.com/grainshield/policy-service/repository"
	"github.com/grainshield/policy-service/trigger"
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

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dbPool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		logger.Fatal("failed to ping database", zap.Error(err))
	}
	logger.Info("connected to PostgreSQL")

	var rateLimiter *middleware.RateLimiter
	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			logger.Fatal("failed to parse REDIS_URL", zap.Error(err))
		}
		rdb := redis.NewClient(opt)
		if err := rdb.Ping(ctx).Err(); err != nil {
			logger.Warn("Redis unavailable — rate limiting disabled", zap.Error(err))
		} else {
			rateLimiter = middleware.NewRateLimiter(rdb, logger)
			logger.Info("connected to Redis")
		}
	}

	repo := repository.NewPolicyRepo(dbPool)
	audit := middleware.NewAuditLogger(dbPool, logger)

	// Inter-service client for trigger evaluation
	serviceClient := trigger.NewServiceClient(
		cfg.RiskServiceURL, cfg.PriceServiceURL, cfg.PaymentServiceURL, logger,
	)

	// Premium calculator
	premCalc := trigger.NewPremiumCalculator(serviceClient, logger)

	// Trigger evaluation engine
	engine := trigger.NewEngine(dbPool, audit, serviceClient, logger, cfg.TriggerEvalInterval)

	// Handlers
	h := handlers.NewPolicyHandlers(repo, audit, logger, premCalc, engine)

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(middleware.Sanitize)

	// Health check (unauthenticated)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"policy-service"}`))
	})
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := dbPool.Ping(r.Context()); err != nil {
			http.Error(w, `{"status":"not ready"}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ready","service":"policy-service"}`))
	})

	// Protected API routes
	r.Route("/api/v1", func(api chi.Router) {
		api.Use(middleware.Auth(cfg.JWTSecret))

		// Apply rate limiting if Redis is available (must be before route definitions)
		if rateLimiter != nil {
			api.Use(rateLimiter.Limit(cfg.ReadRatePerMin, 1*time.Minute, false))
		}

		// RevOps summary
		api.With(middleware.RequirePermission("policy:list")).
			Get("/revops/summary", h.RevOpsSummary)

		// Policy CRUD
		api.With(middleware.RequirePermission("policy:create")).
			Post("/policies", h.CreatePolicy)
		api.With(middleware.RequirePermission("policy:read")).
			Get("/policies/{id}", h.GetPolicy)
		api.With(middleware.RequirePermission("policy:list")).
			Get("/policies", h.ListPolicies)
		api.With(middleware.RequirePermission("policy:list")).
			Get("/policies/stats", h.GetStats)

		// Trigger operations
		api.With(middleware.RequirePermission("policy:trigger")).
			Post("/policies/trigger", h.FireTrigger)
		api.With(middleware.RequirePermission("policy:trigger")).
			Post("/policies/evaluate", h.EvaluateTriggers)

		// Policy management
		api.With(middleware.RequirePermission("policy:trigger")).
			Post("/policies/expire", h.ExpirePolicies)
		api.With(middleware.RequirePermission("policy:list")).
			Get("/policies/overdue", h.ListOverduePayouts)

		// Claims
		api.With(middleware.RequirePermission("policy:list")).
			Get("/claims", h.ListClaims)
	})

	engineCtx, engineCancel := context.WithCancel(context.Background())
	defer engineCancel()
	go engine.Start(engineCtx)
	logger.Info("trigger evaluation engine started",
		zap.Duration("interval", cfg.TriggerEvalInterval),
	)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("policy-service starting", zap.Int("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	logger.Info("shutting down", zap.String("signal", sig.String()))

	// Stop trigger engine first
	engineCancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("forced shutdown", zap.Error(err))
	}

	logger.Info("policy-service stopped")
}
