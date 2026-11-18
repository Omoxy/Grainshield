// Package kebs provides a client for the KEBS certified supplier registry.
// Implements circuit breaker and offline fallback (Security Rule: offline fallback first).
package kebs

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sync"
	"time"

	"go.uber.org/zap"
)

const (
	defaultBaseURL = "https://api.kebs.org/v1/products"
	requestTimeout = 5 * time.Second

	cbFailureThreshold = 3
	cbOpenDuration     = 60 * time.Second
)

// productCodePattern validates KEBS product codes: alphanumeric with dashes, max 20 chars.
var productCodePattern = regexp.MustCompile(`^[A-Za-z0-9\-]{4,20}$`)

// Result holds the KEBS verification result.
type Result struct {
	Genuine      bool   `json:"genuine"`
	Manufacturer string `json:"manufacturer"`
	ProductType  string `json:"product_type"`
	Certified    string `json:"certified"`
	Expiry       string `json:"expiry"`
}

// Client queries the KEBS certified supplier registry.
type Client struct {
	baseURL string
	client  *http.Client
	logger  *zap.Logger
	sandbox bool

	mu              sync.Mutex
	consecutiveFail int
	openUntil       time.Time
}

// NewClient creates a new KEBS verification client.
func NewClient(environment string, logger *zap.Logger) *Client {
	return &Client{
		baseURL: defaultBaseURL,
		client:  &http.Client{Timeout: requestTimeout},
		logger:  logger,
		sandbox: environment == "sandbox",
	}
}

// Verify checks a product code against the KEBS registry.
// Security Rule #2: input validated — alphanumeric, max 20 chars.
func (c *Client) Verify(ctx context.Context, productCode string) (*Result, error) {
	if !productCodePattern.MatchString(productCode) {
		return nil, fmt.Errorf("invalid product code format")
	}

	// Sandbox mode returns a mocked genuine response for demo.
	if c.sandbox {
		return c.sandboxResult(productCode), nil
	}

	if err := c.checkCircuitBreaker(); err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/%s", c.baseURL, productCode)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("kebs: failed to create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		c.recordFailure()
		return nil, fmt.Errorf("kebs: request failed (offline fallback): %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		c.recordFailure()
		return nil, fmt.Errorf("kebs: failed to read response: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		c.recordSuccess()
		return &Result{Genuine: false}, nil
	}

	if resp.StatusCode != http.StatusOK {
		c.recordFailure()
		return nil, fmt.Errorf("kebs: api returned status %d", resp.StatusCode)
	}

	var result Result
	if err := json.Unmarshal(body, &result); err != nil {
		c.recordFailure()
		return nil, fmt.Errorf("kebs: failed to parse response: %w", err)
	}

	c.recordSuccess()
	result.Genuine = true
	return &result, nil
}

func (c *Client) sandboxResult(code string) *Result {
	return &Result{
		Genuine:      true,
		Manufacturer: "Elgon Kenya Ltd",
		ProductType:  "CAN 26% Nitrogen",
		Certified:    "Feb 2026",
		Expiry:       "Des 2026",
	}
}

func (c *Client) checkCircuitBreaker() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.consecutiveFail >= cbFailureThreshold && time.Now().Before(c.openUntil) {
		return fmt.Errorf("kebs: circuit breaker open — verification unavailable")
	}
	if time.Now().After(c.openUntil) {
		c.consecutiveFail = 0
	}
	return nil
}

func (c *Client) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.consecutiveFail = 0
}

func (c *Client) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.consecutiveFail++
	if c.consecutiveFail >= cbFailureThreshold {
		c.openUntil = time.Now().Add(cbOpenDuration)
		c.logger.Error("kebs: circuit breaker OPEN", zap.Duration("open_for", cbOpenDuration))
	}
}
