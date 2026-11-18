// GrainShield notification-service — SMS/USSD notification delivery and template management.
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

	"github.com/grainshield/notification-service/africastalking"
	"github.com/grainshield/notification-service/config"
	"github.com/grainshield/notification-service/handlers"
	"github.com/grainshield/notification-service/repository"
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

	logger.Info("starting notification-service", zap.Int("port", cfg.Port))

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

	// Initialize Africa's Talking SMS client.
	smsClient := africastalking.NewSMSClient(
		cfg.ATApiKey, cfg.ATUsername, cfg.ATSenderID, cfg.ATEnvironment, logger,
	)
	logger.Info("africastalking sms client initialized",
		zap.String("environment", cfg.ATEnvironment),
		zap.String("sender_id", cfg.ATSenderID))

	audit := middleware.NewAuditLogger(pool, logger)
	repo := repository.NewNotificationRepo(pool, smsClient, logger)
	h := handlers.NewNotificationHandlers(repo, audit, logger)

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(middleware.Sanitize)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy","service":"notification-service"}`))
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

		r.With(
			middleware.RequirePermission("notification:send"),
			audit.AuditMiddleware("notification:send", "notification"),
			rateLimit(rateLimiter, 20, time.Minute),
		).Post("/notifications/send", h.Send)

		r.With(
			middleware.RequirePermission("notification:bulk"),
			audit.AuditMiddleware("notification:bulk-send", "notification"),
			rateLimit(rateLimiter, 5, time.Minute),
		).Post("/notifications/bulk", h.BulkSend)

		r.With(middleware.RequirePermission("notification:read")).
			Get("/notifications", h.List)

		r.With(middleware.RequirePermission("notification:read")).
			Get("/notifications/templates", h.ListTemplates)

		r.With(middleware.RequirePermission("notification:read")).
			Get("/notifications/stats", h.GetStats)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("notification-service listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down notification-service...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("forced shutdown", zap.Error(err))
	}
	logger.Info("notification-service stopped")
}

func rateLimit(rl *middleware.RateLimiter, max int, window time.Duration) func(http.Handler) http.Handler {
	if rl == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return rl.Limit(max, window, false)
}
