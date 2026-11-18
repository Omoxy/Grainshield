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

	ATApiKey      string
	ATUsername     string
	ATSenderID    string
	ATEnvironment string
}

func Load() *Config {
	return &Config{
		Port:            pkgconfig.ParsePort(8086),
		DatabaseURL:     pkgconfig.ParseDatabaseURL(),
		RedisURL:        pkgconfig.ParseRedisURL(),
		JWTSecret:       pkgconfig.ParseJWTSecret(),
		LogLevel:        pkgconfig.ParseLogLevel(),
		ReadRatePerMin:  pkgconfig.GetIntEnvOrDefault("READ_RATE_PER_MIN", 60),
		WriteRatePerMin: pkgconfig.GetIntEnvOrDefault("WRITE_RATE_PER_MIN", 20),

		ATApiKey:      pkgconfig.GetEnvOrDefault("AT_API_KEY", ""),
		ATUsername:     pkgconfig.GetEnvOrDefault("AT_USERNAME", ""),
		ATSenderID:    pkgconfig.GetEnvOrDefault("AT_SENDER_ID", "GrainShield"),
		ATEnvironment: pkgconfig.GetEnvOrDefault("AT_ENVIRONMENT", "sandbox"),
	}
}
