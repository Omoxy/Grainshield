package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func RequireEnv(key string) string {
	val := os.Getenv(key)
	if val == "" {
		panic(fmt.Sprintf("config: required environment variable %s is not set", key))
	}
	return val
}

func GetEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func GetIntEnvOrDefault(key string, defaultVal int) int {
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

func ParsePort(defaultPort int) int {
	port := GetIntEnvOrDefault("PORT", defaultPort)
	if port < 1 || port > 65535 {
		panic("config: PORT must be between 1 and 65535")
	}
	return port
}

func ParseDatabaseURL() string {
	dbURL := RequireEnv("DATABASE_URL")
	if !strings.HasPrefix(dbURL, "postgres://") && !strings.HasPrefix(dbURL, "postgresql://") {
		panic("config: DATABASE_URL must start with postgres:// or postgresql://")
	}
	return dbURL
}

// ParseJWTSecret reads JWT_SECRET and returns the raw bytes for HS256 verification.
// Must be at least 32 bytes.
func ParseJWTSecret() []byte {
	secret := RequireEnv("JWT_SECRET")
	if len(secret) < 32 {
		panic("config: JWT_SECRET must be at least 32 characters")
	}
	return []byte(secret)
}

func ParseLogLevel() string {
	level := GetEnvOrDefault("LOG_LEVEL", "info")
	validLevels := map[string]bool{"debug": true, "info": true, "warn": true, "error": true}
	if !validLevels[level] {
		panic(fmt.Sprintf("config: LOG_LEVEL must be one of: debug, info, warn, error. Got: %s", level))
	}
	return level
}

func ParseRedisURL() string {
	url := RequireEnv("REDIS_URL")
	if !strings.HasPrefix(url, "redis://") && !strings.HasPrefix(url, "rediss://") {
		panic("config: REDIS_URL must start with redis:// or rediss://")
	}
	if !strings.Contains(url, "@") {
		panic("config: REDIS_URL must include authentication credentials (redis://:password@host:port/db)")
	}
	return url
}
