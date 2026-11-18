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

	ReadRatePerMin  int
	WriteRatePerMin int

	MPesaAllowedIPs string

	MPesaConsumerKey        string
	MPesaConsumerSecret     string
	MPesaShortcode          string
	MPesaInitiatorName      string
	MPesaSecurityCredential string
	MPesaEnv                string
	MPesaB2CURL             string
	MPesaTokenURL           string
	MPesaResultURL          string
	MPesaTimeoutURL         string

	KafkaBrokers string

	PagerDutyRoutingKey string

	DeadlineCheckInterval time.Duration
}

func Load() *Config {
	mpesaEnv := pkgconfig.GetEnvOrDefault("MPESA_ENV", "sandbox")

	defaultTokenURL := "https://sandbox.safaricom.co.ke/oauth/v1/generate"
	defaultB2CURL := "https://sandbox.safaricom.co.ke/mpesa/b2c/v3/paymentrequest"
	if mpesaEnv == "production" {
		defaultTokenURL = "https://api.safaricom.co.ke/oauth/v1/generate"
		defaultB2CURL = "https://api.safaricom.co.ke/mpesa/b2c/v3/paymentrequest"
	}

	return &Config{
		Port:            pkgconfig.ParsePort(8082),
		DatabaseURL:     pkgconfig.ParseDatabaseURL(),
		RedisURL:        pkgconfig.ParseRedisURL(),
		JWTSecret:       pkgconfig.ParseJWTSecret(),
		LogLevel:        pkgconfig.ParseLogLevel(),
		ReadRatePerMin:  pkgconfig.GetIntEnvOrDefault("READ_RATE_PER_MIN", 60),
		WriteRatePerMin: pkgconfig.GetIntEnvOrDefault("WRITE_RATE_PER_MIN", 10),
		MPesaAllowedIPs: pkgconfig.GetEnvOrDefault("MPESA_ALLOWED_IPS", ""),

		MPesaConsumerKey:        pkgconfig.GetEnvOrDefault("MPESA_CONSUMER_KEY", ""),
		MPesaConsumerSecret:     pkgconfig.GetEnvOrDefault("MPESA_CONSUMER_SECRET", ""),
		MPesaShortcode:          pkgconfig.GetEnvOrDefault("MPESA_SHORTCODE", ""),
		MPesaInitiatorName:      pkgconfig.GetEnvOrDefault("MPESA_INITIATOR_NAME", ""),
		MPesaSecurityCredential: pkgconfig.GetEnvOrDefault("MPESA_SECURITY_CREDENTIAL", ""),
		MPesaEnv:                mpesaEnv,
		MPesaB2CURL:             pkgconfig.GetEnvOrDefault("MPESA_B2C_URL", defaultB2CURL),
		MPesaTokenURL:           pkgconfig.GetEnvOrDefault("MPESA_TOKEN_URL", defaultTokenURL),
		MPesaResultURL:          pkgconfig.GetEnvOrDefault("MPESA_RESULT_URL", ""),
		MPesaTimeoutURL:         pkgconfig.GetEnvOrDefault("MPESA_TIMEOUT_URL", ""),

		KafkaBrokers: pkgconfig.GetEnvOrDefault("KAFKA_BROKERS", ""),

		PagerDutyRoutingKey: pkgconfig.GetEnvOrDefault("PAGERDUTY_ROUTING_KEY", ""),

		DeadlineCheckInterval: time.Duration(
			pkgconfig.GetIntEnvOrDefault("DEADLINE_CHECK_INTERVAL_MIN", 30),
		) * time.Minute,
	}
}
