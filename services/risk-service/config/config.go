package config

import (
	pkgconfig "github.com/grainshield/pkg/config"
)

type Config struct {
	Port      int
	DatabaseURL string
	RedisURL    string
	JWTSecret   []byte
	LogLevel    string

	ReadRatePerMin  int
	WriteRatePerMin int

	IITABaseURL string
	IITAAPIKey  string

	CopernicusBaseURL string
	CopernicusAPIKey  string

	KMDBaseURL string
	KMDAPIKey  string

	KafkaBrokers string

	PagerDutyRoutingKey string
}

func Load() *Config {
	return &Config{
		Port:            pkgconfig.ParsePort(8084),
		DatabaseURL:     pkgconfig.ParseDatabaseURL(),
		RedisURL:        pkgconfig.ParseRedisURL(),
		JWTSecret:       pkgconfig.ParseJWTSecret(),
		LogLevel:        pkgconfig.ParseLogLevel(),
		ReadRatePerMin:  pkgconfig.GetIntEnvOrDefault("READ_RATE_PER_MIN", 60),
		WriteRatePerMin: pkgconfig.GetIntEnvOrDefault("WRITE_RATE_PER_MIN", 30),

		IITABaseURL:       pkgconfig.GetEnvOrDefault("IITA_AEWS_BASE_URL", ""),
		IITAAPIKey:        pkgconfig.GetEnvOrDefault("IITA_AEWS_API_KEY", ""),
		CopernicusBaseURL: pkgconfig.GetEnvOrDefault("COPERNICUS_BASE_URL", ""),
		CopernicusAPIKey:  pkgconfig.GetEnvOrDefault("COPERNICUS_API_KEY", ""),
		KMDBaseURL:        pkgconfig.GetEnvOrDefault("KMD_BASE_URL", ""),
		KMDAPIKey:         pkgconfig.GetEnvOrDefault("KMD_API_KEY", ""),

		KafkaBrokers: pkgconfig.GetEnvOrDefault("KAFKA_BROKERS", ""),

		PagerDutyRoutingKey: pkgconfig.GetEnvOrDefault("PAGERDUTY_ROUTING_KEY", ""),
	}
}
