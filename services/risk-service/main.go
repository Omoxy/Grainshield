// GrainShield risk-service — IITA A-EWS aflatoxin risk, IoT sensors, weather data.
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
	"github.com/grainshield/risk-service/clients"
	"github.com/grainshield/risk-service/config"
	"github.com/grainshield/risk-service/handlers"
	"github.com/grainshield/risk-service/kafka"
	"github.com/grainshield/risk-service/repository"
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

	logger.Info("starting risk-service", zap.Int("port", cfg.Port))

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

	// Initialize external API clients
	iitaClient := clients.NewIITAClient(cfg.IITABaseURL, cfg.IITAAPIKey, logger)
	if iitaClient.IsConfigured() {
		logger.Info("IITA A-EWS client configured")
	} else {
		logger.Warn("IITA A-EWS client not configured — using DB fallback only")
	}

	copernicusClient := clients.NewCopernicusClient(cfg.CopernicusBaseURL, cfg.CopernicusAPIKey, logger)
	if copernicusClient.IsConfigured() {
		logger.Info("Copernicus satellite client configured")
	} else {
		logger.Warn("Copernicus client not configured — weather events unconfirmed")
	}

	kmdClient := clients.NewKMDClient(cfg.KMDBaseURL, cfg.KMDAPIKey, logger)
	if kmdClient.IsConfigured() {
		logger.Info("KMD seasonal forecast client configured")
	} else {
		logger.Warn("KMD client not configured — using default forecasts")
	}

	// Initialize Kafka producer
	producer := kafka.NewProducer(cfg.KafkaBrokers, logger)
	if producer.IsConfigured() {
		logger.Info("kafka producer configured")
	} else {
		logger.Warn("kafka not configured — events will not be published")
	}

	audit := middleware.NewAuditLogger(pool, logger)
	repo := repository.NewRiskRepo(pool)
	h := handlers.NewRiskHandlers(repo, audit, logger, producer, iitaClient, copernicusClient, kmdClient)

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(middleware.Sanitize)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy","service":"risk-service"}`))
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

		// Read endpoints
		r.With(middleware.RequirePermission("risk:read")).
			Get("/risk/aflatoxin", h.GetAflatoxinRisk)

		r.With(middleware.RequirePermission("risk:read")).
			Get("/risk/sensors/{warehouseId}", h.GetSensorData)

		r.With(middleware.RequirePermission("risk:read")).
			Get("/risk/dashboard", h.GetDashboard)

		r.With(middleware.RequirePermission("risk:read")).
			Get("/risk/premium", h.GetPremiumMultipliers)

		// Ingest endpoints (data feeds)
		r.With(
			middleware.RequirePermission("risk:ingest"),
			audit.AuditMiddleware("risk:ingest-aflatoxin", "aflatoxin_score"),
			rateLimit(rateLimiter, 30, time.Minute),
		).Post("/risk/aflatoxin", h.IngestAflatoxinScore)

		r.With(
			middleware.RequirePermission("risk:ingest"),
			audit.AuditMiddleware("risk:ingest-sensor", "sensor_reading"),
			rateLimit(rateLimiter, 120, time.Minute),
		).Post("/risk/sensors", h.IngestSensorReading)

		r.With(
			middleware.RequirePermission("risk:ingest"),
			audit.AuditMiddleware("risk:ingest-weather", "weather_data"),
			rateLimit(rateLimiter, 30, time.Minute),
		).Post("/risk/weather", h.IngestWeather)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("risk-service listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down risk-service...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("forced shutdown", zap.Error(err))
	}
	logger.Info("risk-service stopped")
}

func rateLimit(rl *middleware.RateLimiter, max int, window time.Duration) func(http.Handler) http.Handler {
	if rl == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return rl.Limit(max, window, false)
}
