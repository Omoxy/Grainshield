package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port          int
	DatabaseURL   string
	RedisURL      string
	JWTSecret     []byte
	EncryptionKey []byte
	KafkaBrokers  []string
	LogLevel      string

	ReadRatePerMin  int
	WriteRatePerMin int
}

func Load() *Config {
	cfg := &Config{}

	cfg.Port = getIntEnvOrDefault("PORT", 8080)
	if cfg.Port < 1 || cfg.Port > 65535 {
		panic("config: PORT must be between 1 and 65535")
	}

	cfg.DatabaseURL = requireEnv("DATABASE_URL")
	if !strings.HasPrefix(cfg.DatabaseURL, "postgres://") && !strings.HasPrefix(cfg.DatabaseURL, "postgresql://") {
		panic("config: DATABASE_URL must start with postgres:// or postgresql://")
	}

	cfg.RedisURL = requireEnv("REDIS_URL")
	if !strings.HasPrefix(cfg.RedisURL, "redis://") && !strings.HasPrefix(cfg.RedisURL, "rediss://") {
		panic("config: REDIS_URL must start with redis:// or rediss://")
	}

	jwtSecret := requireEnv("JWT_SECRET")
	if len(jwtSecret) < 32 {
		panic("config: JWT_SECRET must be at least 32 characters")
	}
	cfg.JWTSecret = []byte(jwtSecret)

	encKeyHex := getEnvOrDefault("ENCRYPTION_KEY", "")
	if encKeyHex != "" {
		cfg.EncryptionKey = []byte(encKeyHex)
	}

	brokersRaw := getEnvOrDefault("KAFKA_BROKERS", "")
	if brokersRaw != "" {
		cfg.KafkaBrokers = strings.Split(brokersRaw, ",")
		for i, b := range cfg.KafkaBrokers {
			cfg.KafkaBrokers[i] = strings.TrimSpace(b)
		}
	}

	cfg.LogLevel = getEnvOrDefault("LOG_LEVEL", "info")
	cfg.ReadRatePerMin = getIntEnvOrDefault("READ_RATE_PER_MIN", 60)
	cfg.WriteRatePerMin = getIntEnvOrDefault("WRITE_RATE_PER_MIN", 10)

	return cfg
}

func requireEnv(key string) string {
	val := os.Getenv(key)
	if val == "" {
		panic(fmt.Sprintf("config: required environment variable %s is not set", key))
	}
	return val
}

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getIntEnvOrDefault(key string, defaultVal int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return defaultVal
	}
	val, err := strconv.Atoi(raw)
	if err != nil {
		panic(fmt.Sprintf("config: %s must be a valid integer", key))
	}
	return val
}
