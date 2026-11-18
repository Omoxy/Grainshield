package config

import (
	"time"

	pkgconfig "github.com/grainshield/pkg/config"
)

type Config struct {
	Port      int
	DatabaseURL string
	RedisURL    string
	JWTSecret   []byte
	LogLevel    string

	RiskServiceURL    string
	PriceServiceURL   string
	PaymentServiceURL string

	TriggerEvalInterval time.Duration

	ReadRatePerMin  int
	WriteRatePerMin int
}

func Load() *Config {
	intervalMin := pkgconfig.GetIntEnvOrDefault("TRIGGER_EVAL_INTERVAL_MIN", 360)
	return &Config{
		Port:                pkgconfig.ParsePort(8081),
		DatabaseURL:         pkgconfig.ParseDatabaseURL(),
		RedisURL:            pkgconfig.ParseRedisURL(),
		JWTSecret:           pkgconfig.ParseJWTSecret(),
		LogLevel:            pkgconfig.ParseLogLevel(),
		RiskServiceURL:      pkgconfig.GetEnvOrDefault("RISK_SERVICE_URL", "http://localhost:8084"),
		PriceServiceURL:     pkgconfig.GetEnvOrDefault("PRICE_SERVICE_URL", "http://localhost:8083"),
		PaymentServiceURL:   pkgconfig.GetEnvOrDefault("PAYMENT_SERVICE_URL", "http://localhost:8082"),
		TriggerEvalInterval: time.Duration(intervalMin) * time.Minute,
		ReadRatePerMin:      pkgconfig.GetIntEnvOrDefault("READ_RATE_PER_MIN", 60),
		WriteRatePerMin:     pkgconfig.GetIntEnvOrDefault("WRITE_RATE_PER_MIN", 10),
	}
}
