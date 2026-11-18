// GrainShield price-service — cross-border market price intelligence.
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
	"github.com/grainshield/price-service/cache"
	"github.com/grainshield/price-service/clients"
	"github.com/grainshield/price-service/config"
	"github.com/grainshield/price-service/cron"
	"github.com/grainshield/price-service/handlers"
	"github.com/grainshield/price-service/kafka"
	"github.com/grainshield/price-service/repository"
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

	logger.Info("starting price-service", zap.Int("port", cfg.Port))

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

	// Initialize Redis (used for rate limiting and price cache)
	var rateLimiter *middleware.RateLimiter
	var priceCache *cache.PriceCache
	var redisClient *redis.Client

	if cfg.RedisURL != "" {
		opts, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			logger.Fatal("invalid REDIS_URL", zap.Error(err))
		}
		redisClient = redis.NewClient(opts)
		if err := redisClient.Ping(context.Background()).Err(); err != nil {
			logger.Warn("redis ping failed — rate limiting and cache disabled", zap.Error(err))
		} else {
			rateLimiter = middleware.NewRateLimiter(redisClient, logger)
			priceCache = cache.NewPriceCache(redisClient, logger)
			logger.Info("redis connected — rate limiting and 5-min price cache enabled")
		}
	}

	// Initialize external market clients
	ncpbClient := clients.NewNCPBClient(cfg.NCPBBaseURL, cfg.NCPBAPIKey, logger)
	if ncpbClient.IsConfigured() {
		logger.Info("NCPB depot price client configured")
	} else {
		logger.Warn("NCPB client not configured — using DB data only")
	}

	ugandaClient := clients.NewUgandaClient(cfg.UgandaBaseURL, cfg.UgandaAPIKey, logger)
	if ugandaClient.IsConfigured() {
		logger.Info("Uganda market client configured")
	} else {
		logger.Warn("Uganda market client not configured")
	}

	tanzaniaClient := clients.NewTanzaniaClient(cfg.TanzaniaBaseURL, cfg.TanzaniaAPIKey, logger)
	if tanzaniaClient.IsConfigured() {
		logger.Info("Tanzania exchange client configured")
	} else {
		logger.Warn("Tanzania exchange client not configured")
	}

	southSudanClient := clients.NewSouthSudanClient(cfg.SouthSudanBaseURL, cfg.SouthSudanAPIKey, logger)
	if southSudanClient.IsConfigured() {
		logger.Info("South Sudan reference client configured")
	} else {
		logger.Warn("South Sudan reference client not configured")
	}

	// Initialize Kafka producer
	producer := kafka.NewProducer(cfg.KafkaBrokers, logger)
	if producer.IsConfigured() {
		logger.Info("kafka producer configured")
	} else {
		logger.Warn("kafka not configured — events will not be published")
	}

	audit := middleware.NewAuditLogger(pool, logger)
	repo := repository.NewPriceRepo(pool)
	h := handlers.NewPriceHandlers(repo, audit, logger, producer, priceCache)
	partner := handlers.NewPartnerHandlers(repo, priceCache, logger)

	// Start Monday 06:00 EAT cron
	cronCtx, cronCancel := context.WithCancel(context.Background())
	priceCron := cron.NewPriceSMSCron(repo, producer, cfg.PagerDutyRoutingKey, logger)
	go priceCron.Start(cronCtx)

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(middleware.Sanitize)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy","service":"price-service"}`))
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

		r.With(middleware.RequirePermission("price:read")).
			Get("/prices/current", h.GetCurrentPrices)

		r.With(
			middleware.RequirePermission("price:create"),
			audit.AuditMiddleware("price:record", "market_price"),
			rateLimit(rateLimiter, 30, time.Minute),
		).Post("/prices", h.RecordPrice)

		r.With(middleware.RequirePermission("price:read")).
			Get("/prices/history", h.GetPriceHistory)

		r.With(
			middleware.RequirePermission("price:sell"),
			audit.AuditMiddleware("price:sell-order", "sell_order"),
			rateLimit(rateLimiter, 10, time.Minute),
		).Post("/prices/sell-order", h.CreateSellOrder)

		r.With(middleware.RequirePermission("price:read")).
			Get("/prices/sms-preview", h.GetSMSPreview)

		// Institutional partner endpoints with tier enforcement
		r.With(middleware.RequirePermission("price:read")).
			Get("/prices/partner/current", partner.GetCurrentPricesPartner)
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("price-service listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down price-service...")
	cronCancel()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("forced shutdown", zap.Error(err))
	}
	if redisClient != nil {
		redisClient.Close()
	}
	logger.Info("price-service stopped")
}

func rateLimit(rl *middleware.RateLimiter, max int, window time.Duration) func(http.Handler) http.Handler {
	if rl == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return rl.Limit(max, window, false)
}
