package config

import (
	pkgconfig "github.com/grainshield/pkg/config"
)

// Config holds all configuration for the ussd-service.
type Config struct {
	Port     int
	RedisURL string
	LogLevel string

	// Backend service URLs for synchronous USSD calls.
	FarmerServiceURL string
	PolicyServiceURL string
	PriceServiceURL  string

	// Africa's Talking webhook validation.
	ATEnvironment string
}

// Load reads configuration from environment variables.
func Load() *Config {
	return &Config{
		Port:     pkgconfig.ParsePort(8087),
		RedisURL: pkgconfig.RequireEnv("REDIS_URL"),
		LogLevel: pkgconfig.ParseLogLevel(),

		FarmerServiceURL: pkgconfig.RequireEnv("FARMER_SERVICE_URL"),
		PolicyServiceURL: pkgconfig.RequireEnv("POLICY_SERVICE_URL"),
		PriceServiceURL:  pkgconfig.RequireEnv("PRICE_SERVICE_URL"),

		ATEnvironment: pkgconfig.GetEnvOrDefault("AT_ENVIRONMENT", "production"),
	}
}
