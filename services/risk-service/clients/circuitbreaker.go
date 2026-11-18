// Package clients provides external API clients for the risk-service.
// Security Rule #7: Circuit breaker, exponential backoff, dead letter queue.
package clients

import (
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"
)


const (
	defaultFailureThreshold = 5
	defaultOpenDuration     = 30 * time.Second
)

// CircuitState represents the current state of the circuit breaker.
type CircuitState int

const (
	// CircuitClosed allows all requests through.
	CircuitClosed CircuitState = iota
	// CircuitOpen blocks all requests.
	CircuitOpen
	// CircuitHalfOpen allows a single probe request.
	CircuitHalfOpen
)

// String returns a human readable circuit state.
func (s CircuitState) String() string {
	switch s {
	case CircuitClosed:
		return "closed"
	case CircuitOpen:
		return "open"
	case CircuitHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// CircuitBreaker wraps external calls with automatic failure detection.
type CircuitBreaker struct {
	name             string
	mu               sync.Mutex
	state            CircuitState
	consecutiveFails int
	failureThreshold int
	openDuration     time.Duration
	openUntil        time.Time
	logger           *zap.Logger
}

// NewCircuitBreaker creates a circuit breaker with the given name.
func NewCircuitBreaker(name string, logger *zap.Logger) *CircuitBreaker {
	return &CircuitBreaker{
		name:             name,
		state:            CircuitClosed,
		failureThreshold: defaultFailureThreshold,
		openDuration:     defaultOpenDuration,
		logger:           logger,
	}
}

// State returns the current circuit breaker state (thread safe).
func (cb *CircuitBreaker) State() CircuitState {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

// Execute runs fn through the circuit breaker. If the circuit is open,
// it returns an error immediately without calling fn.
func (cb *CircuitBreaker) Execute(fn func() error) error {
	if err := cb.check(); err != nil {
		return err
	}

	if err := fn(); err != nil {
		cb.recordFailure()
		return err
	}

	cb.recordSuccess()
	return nil
}

func (cb *CircuitBreaker) check() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case CircuitOpen:
		if time.Now().After(cb.openUntil) {
			cb.state = CircuitHalfOpen
			cb.logger.Info("circuit breaker transitioning to half-open",
				zap.String("breaker", cb.name))
			return nil
		}
		return fmt.Errorf("circuit breaker %s is open: retrying after %s",
			cb.name, time.Until(cb.openUntil).Round(time.Second))
	case CircuitHalfOpen:
		return nil
	default:
		return nil
	}
}

func (cb *CircuitBreaker) recordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.consecutiveFails = 0
	if cb.state == CircuitHalfOpen {
		cb.state = CircuitClosed
		cb.logger.Info("circuit breaker closed (recovery confirmed)",
			zap.String("breaker", cb.name))
	}
}

func (cb *CircuitBreaker) recordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.consecutiveFails++
	if cb.consecutiveFails >= cb.failureThreshold {
		cb.state = CircuitOpen
		cb.openUntil = time.Now().Add(cb.openDuration)
		cb.logger.Warn("circuit breaker opened",
			zap.String("breaker", cb.name),
			zap.Int("consecutive_failures", cb.consecutiveFails),
			zap.Duration("open_duration", cb.openDuration))
	}
}
