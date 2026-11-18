// Package cache implements Redis price caching with 5-minute TTL.
// Never hit external price APIs on every request — Redis first, DB fallback.
package cache

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)


const (
	// DefaultTTL is the default cache expiry for price data.
	DefaultTTL = 5 * time.Minute

	// KeyPrefix is the Redis key prefix for all price cache entries.
	KeyPrefix = "grainshield:prices:"
)

// PriceCache wraps Redis for price data caching.
type PriceCache struct {
	client *redis.Client
	logger *zap.Logger
}

// NewPriceCache creates a new price cache. Returns nil if client is nil.
func NewPriceCache(client *redis.Client, logger *zap.Logger) *PriceCache {
	if client == nil {
		return nil
	}
	return &PriceCache{
		client: client,
		logger: logger,
	}
}

// Get retrieves cached data by key. Returns nil if cache miss or Redis error.
func (c *PriceCache) Get(ctx context.Context, key string) ([]byte, bool) {
	if c == nil {
		return nil, false
	}

	fullKey := KeyPrefix + key
	data, err := c.client.Get(ctx, fullKey).Bytes()
	if err != nil {
		if err != redis.Nil {
			c.logger.Warn("redis cache get failed",
				zap.String("key", fullKey),
				zap.Error(err))
		}
		return nil, false
	}

	c.logger.Debug("cache hit", zap.String("key", fullKey))
	return data, true
}

// Set stores data in cache with the default TTL.
func (c *PriceCache) Set(ctx context.Context, key string, data interface{}) error {
	return c.SetWithTTL(ctx, key, data, DefaultTTL)
}

// SetWithTTL stores data in cache with a custom TTL.
func (c *PriceCache) SetWithTTL(ctx context.Context, key string, data interface{}, ttl time.Duration) error {
	if c == nil {
		return nil
	}

	fullKey := KeyPrefix + key
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	if err := c.client.Set(ctx, fullKey, jsonData, ttl).Err(); err != nil {
		c.logger.Warn("redis cache set failed",
			zap.String("key", fullKey),
			zap.Error(err))
		return err
	}

	c.logger.Debug("cache set", zap.String("key", fullKey), zap.Duration("ttl", ttl))
	return nil
}

// GetPrices retrieves cached prices and unmarshals into the target.
func (c *PriceCache) GetPrices(ctx context.Context, key string, target interface{}) bool {
	data, ok := c.Get(ctx, key)
	if !ok {
		return false
	}

	if err := json.Unmarshal(data, target); err != nil {
		c.logger.Warn("cache data unmarshal failed",
			zap.String("key", key),
			zap.Error(err))
		return false
	}

	return true
}

// Invalidate removes a key from the cache.
func (c *PriceCache) Invalidate(ctx context.Context, key string) error {
	if c == nil {
		return nil
	}

	fullKey := KeyPrefix + key
	return c.client.Del(ctx, fullKey).Err()
}
