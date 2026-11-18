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

	NCPBBaseURL string
	NCPBAPIKey  string

	UgandaBaseURL string
	UgandaAPIKey  string

	TanzaniaBaseURL string
	TanzaniaAPIKey  string

	SouthSudanBaseURL string
	SouthSudanAPIKey  string

	KafkaBrokers string

	PagerDutyRoutingKey string
}

func Load() *Config {
	return &Config{
		Port:            pkgconfig.ParsePort(8083),
		DatabaseURL:     pkgconfig.ParseDatabaseURL(),
		RedisURL:        pkgconfig.ParseRedisURL(),
		JWTSecret:       pkgconfig.ParseJWTSecret(),
		LogLevel:        pkgconfig.ParseLogLevel(),
		ReadRatePerMin:  pkgconfig.GetIntEnvOrDefault("READ_RATE_PER_MIN", 60),
		WriteRatePerMin: pkgconfig.GetIntEnvOrDefault("WRITE_RATE_PER_MIN", 10),

		NCPBBaseURL:       pkgconfig.GetEnvOrDefault("NCPB_API_BASE_URL", ""),
		NCPBAPIKey:        pkgconfig.GetEnvOrDefault("NCPB_API_KEY", ""),
		UgandaBaseURL:     pkgconfig.GetEnvOrDefault("UGANDA_MARKET_BASE_URL", ""),
		UgandaAPIKey:      pkgconfig.GetEnvOrDefault("UGANDA_MARKET_API_KEY", ""),
		TanzaniaBaseURL:   pkgconfig.GetEnvOrDefault("TANZANIA_EXCHANGE_BASE_URL", ""),
		TanzaniaAPIKey:    pkgconfig.GetEnvOrDefault("TANZANIA_EXCHANGE_API_KEY", ""),
		SouthSudanBaseURL: pkgconfig.GetEnvOrDefault("SOUTHSUDAN_REF_BASE_URL", ""),
		SouthSudanAPIKey:  pkgconfig.GetEnvOrDefault("SOUTHSUDAN_REF_API_KEY", ""),

		KafkaBrokers: pkgconfig.GetEnvOrDefault("KAFKA_BROKERS", ""),

		PagerDutyRoutingKey: pkgconfig.GetEnvOrDefault("PAGERDUTY_ROUTING_KEY", ""),
	}
}
