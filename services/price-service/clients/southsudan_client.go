// South Sudan import reference price client.
// Aggregates grain import reference prices from GRSS trade data.
// Security Rule #1: API key from env. Security Rule #7: Circuit breaker.
package clients

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
)

const (
	southSudanHTTPTimeout     = 30 * time.Second
	southSudanMaxResponseBody = 1 << 20
)

// SouthSudanPrice represents an import reference price from South Sudan.
type SouthSudanPrice struct {
	MarketName  string  `json:"market_name"`
	Commodity   string  `json:"commodity"`
	PricePerBag float64 `json:"price_per_bag"`
	Currency    string  `json:"currency"` // SSP
	PriceKES    float64 `json:"price_kes"`
	Trend       string  `json:"trend"`
	RecordedAt  string  `json:"recorded_at"`
}

// SouthSudanResponse wraps the API response.
type SouthSudanResponse struct {
	Status string            `json:"status"`
	Data   []SouthSudanPrice `json:"data"`
}

// SouthSudanClient connects to the South Sudan import reference API.
type SouthSudanClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cb         *CircuitBreaker
	logger     *zap.Logger
}

// NewSouthSudanClient creates a new South Sudan reference price client.
func NewSouthSudanClient(baseURL, apiKey string, logger *zap.Logger) *SouthSudanClient {
	return &SouthSudanClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: southSudanHTTPTimeout,
		},
		cb:     NewCircuitBreaker("southsudan-ref", logger),
		logger: logger,
	}
}

// IsConfigured returns true if South Sudan credentials are present.
func (c *SouthSudanClient) IsConfigured() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// FetchReferencePrices retrieves current South Sudan import reference prices.
func (c *SouthSudanClient) FetchReferencePrices(ctx context.Context) ([]SouthSudanPrice, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("South Sudan reference client not configured")
	}

	var prices []SouthSudanPrice
	err := c.cb.Execute(func() error {
		endpoint := fmt.Sprintf("%s/api/v1/imports/grain/reference-prices", c.baseURL)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("failed to create South Sudan request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("South Sudan request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, southSudanMaxResponseBody))
		if err != nil {
			return fmt.Errorf("failed to read South Sudan response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			c.logger.Error("South Sudan API returned non-200",
				zap.Int("status_code", resp.StatusCode))
			return fmt.Errorf("South Sudan API returned status %d", resp.StatusCode)
		}

		var apiResp SouthSudanResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return fmt.Errorf("failed to parse South Sudan response: %w", err)
		}

		prices = apiResp.Data
		return nil
	})

	if err != nil {
		c.logger.Warn("South Sudan fetch failed, caller should use cache",
			zap.Error(err))
		return nil, err
	}

	c.logger.Info("South Sudan reference prices fetched",
		zap.Int("price_count", len(prices)))
	return prices, nil
}
