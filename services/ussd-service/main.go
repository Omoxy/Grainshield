// GrainShield USSD Gateway Service — Handles Africa's Talking *384# traffic.
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
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/config"
	"github.com/grainshield/ussd-service/flows"
	"github.com/grainshield/ussd-service/handlers"
	"github.com/grainshield/ussd-service/kebs"
	"github.com/grainshield/ussd-service/session"
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

	logger.Info("starting ussd-service", zap.Int("port", cfg.Port))

	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logger.Fatal("invalid REDIS_URL", zap.Error(err))
	}
	redisClient := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		logger.Fatal("redis connection failed (required for USSD sessions)", zap.Error(err))
	}
	logger.Info("redis connected")

	sessionStore := session.NewStore(redisClient)
	kebsClient := kebs.NewClient(cfg.ATEnvironment, logger)
	httpClient := &http.Client{Timeout: 5 * time.Second}

	deps := &flows.Deps{
		Sessions: sessionStore,
		Services: &flows.ServiceClients{
			FarmerURL: cfg.FarmerServiceURL,
			PolicyURL: cfg.PolicyServiceURL,
			PriceURL:  cfg.PriceServiceURL,
			HTTP:      httpClient,
		},
		KEBS:   kebsClient,
		Logger: logger,
	}

	ussdHandler := handlers.NewUSSDHandler(deps)

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	// Important: we do not use the standard timeout middleware because we enforce
	// our own 25s deadline inside the handler to gracefully return a USSD timeout screen.

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy","service":"ussd-service"}`))
	})

	r.Post("/ussd/callback", ussdHandler.HandleCallback)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("ussd-service listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down ussd-service...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Fatal("forced shutdown", zap.Error(err))
	}
	logger.Info("ussd-service stopped")
}
