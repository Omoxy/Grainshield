// Package session provides Redis-backed USSD session state management.
// Each step has a 30-second TTL matching Africa's Talking session timeout.
package session

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// StepTTL is the maximum time allowed per USSD step.
	StepTTL = 30 * time.Second

	// RateLimitWindow is the cooldown between sessions for the same phone.
	RateLimitWindow = 60 * time.Second

	keyPrefix       = "ussd:"
	rateLimitPrefix = "ussd_rl:"
)

// State holds the current USSD session data.
type State struct {
	Step         string `json:"step"`
	Flow         string `json:"flow"`
	Language     string `json:"language"`
	NationalID   string `json:"national_id,omitempty"`
	SubCounty    string `json:"sub_county,omitempty"`
	Hectares     string `json:"hectares,omitempty"`
	ExpectedBags string `json:"expected_bags,omitempty"`
	LoanAmount   string `json:"loan_amount,omitempty"`
	FarmerGS     string `json:"farmer_gs,omitempty"`
}

// Store manages USSD session state in Redis.
type Store struct {
	rdb *redis.Client
}

// NewStore creates a new session store backed by Redis.
func NewStore(rdb *redis.Client) *Store {
	return &Store{rdb: rdb}
}

// Get retrieves session state for the given session ID.
// Returns nil if no session exists.
func (s *Store) Get(ctx context.Context, sessionID string) (*State, error) {
	key := keyPrefix + sessionID
	data, err := s.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("session get failed: %w", err)
	}

	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("session unmarshal failed: %w", err)
	}
	return &state, nil
}

// Set stores session state with the per-step TTL.
func (s *Store) Set(ctx context.Context, sessionID string, state *State) error {
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("session marshal failed: %w", err)
	}
	key := keyPrefix + sessionID
	return s.rdb.Set(ctx, key, data, StepTTL).Err()
}

// Delete removes a session.
func (s *Store) Delete(ctx context.Context, sessionID string) error {
	return s.rdb.Del(ctx, keyPrefix+sessionID).Err()
}

// CheckRateLimit returns true if the phone number is rate limited.
// If not limited, sets the rate limit key with the cooldown window.
func (s *Store) CheckRateLimit(ctx context.Context, phone string) (bool, error) {
	key := rateLimitPrefix + phone
	exists, err := s.rdb.Exists(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("rate limit check failed: %w", err)
	}
	if exists > 0 {
		return true, nil
	}
	return false, nil
}

// SetRateLimit marks a phone as having an active session.
func (s *Store) SetRateLimit(ctx context.Context, phone string) error {
	key := rateLimitPrefix + phone
	return s.rdb.Set(ctx, key, "1", RateLimitWindow).Err()
}
