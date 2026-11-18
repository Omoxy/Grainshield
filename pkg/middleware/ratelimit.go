package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// RateLimiter implements token-bucket rate limiting backed by Redis.
// Security Rule #5: Rate limiting enforced at handler level as defence-in-depth.
type RateLimiter struct {
	client *redis.Client
	logger *zap.Logger
}

// NewRateLimiter creates a new Redis-backed rate limiter.
func NewRateLimiter(client *redis.Client, logger *zap.Logger) *RateLimiter {
	return &RateLimiter{client: client, logger: logger}
}

// Limit returns middleware that enforces per-subject rate limiting.
// maxRequests is the maximum number of requests allowed per window.
// window is the time window for the rate limit.
// failClosed controls behaviour when Redis is unreachable:
//   - true:  deny the request (use for auth endpoints and financial operations)
//   - false: allow the request (use for read-only data endpoints)
func (rl *RateLimiter) Limit(maxRequests int, window time.Duration, failClosed bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract subject from JWT claims for per-user limiting
			subject := "anonymous"
			claims, ok := GetClaims(r.Context())
			if ok {
				subject = claims.Sub
			}

			// Also extract IP for per-IP limiting (defence against pre-auth attacks)
			ip := r.Header.Get("X-Forwarded-For")
			if ip == "" {
				ip = r.RemoteAddr
			}

			key := fmt.Sprintf("ratelimit:%s:%s:%s:%s", r.Method, r.URL.Path, subject, ip)

			allowed, remaining, retryAfter, err := rl.check(r.Context(), key, maxRequests, window)
			if err != nil {
				rl.logger.Error("rate limiter Redis error",
					zap.String("key", key),
					zap.Bool("fail_closed", failClosed),
					zap.Error(err),
				)

				if failClosed {
					// Auth/financial endpoints: deny when Redis is down
					http.Error(w, `{"error":"service temporarily unavailable"}`, http.StatusServiceUnavailable)
					return
				}

				// Data endpoints: allow when Redis is down (availability > security)
				next.ServeHTTP(w, r)
				return
			}

			// Set rate limit headers
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(maxRequests))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))

			if !allowed {
				w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())))
				http.Error(w, `{"error":"rate limit exceeded, try again later"}`, http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// LimitFailClosed is a convenience wrapper for auth/financial endpoints.
// Denies requests when Redis is unreachable.
func (rl *RateLimiter) LimitFailClosed(maxRequests int, window time.Duration) func(http.Handler) http.Handler {
	return rl.Limit(maxRequests, window, true)
}

// LimitFailOpen is a convenience wrapper for read-only data endpoints.
// Allows requests when Redis is unreachable.
func (rl *RateLimiter) LimitFailOpen(maxRequests int, window time.Duration) func(http.Handler) http.Handler {
	return rl.Limit(maxRequests, window, false)
}

// check performs the sliding window rate limit check in Redis.
func (rl *RateLimiter) check(ctx context.Context, key string, max int, window time.Duration) (bool, int, time.Duration, error) {
	pipe := rl.client.Pipeline()

	// Increment the counter
	incr := pipe.Incr(ctx, key)
	// Set expiry if this is a new key
	pipe.Expire(ctx, key, window)
	// Get TTL for Retry-After
	ttl := pipe.TTL(ctx, key)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return false, 0, 0, err
	}

	count := int(incr.Val())
	remaining := max - count
	if remaining < 0 {
		remaining = 0
	}

	if count > max {
		retryAfter := ttl.Val()
		if retryAfter < 0 {
			retryAfter = window
		}
		return false, 0, retryAfter, nil
	}

	return true, remaining, 0, nil
}
