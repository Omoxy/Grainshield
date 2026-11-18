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
}

func Load() *Config {
	return &Config{
		Port:            pkgconfig.ParsePort(8085),
		DatabaseURL:     pkgconfig.ParseDatabaseURL(),
		RedisURL:        pkgconfig.ParseRedisURL(),
		JWTSecret:       pkgconfig.ParseJWTSecret(),
		LogLevel:        pkgconfig.ParseLogLevel(),
		ReadRatePerMin:  pkgconfig.GetIntEnvOrDefault("READ_RATE_PER_MIN", 60),
		WriteRatePerMin: pkgconfig.GetIntEnvOrDefault("WRITE_RATE_PER_MIN", 10),
	}
}
