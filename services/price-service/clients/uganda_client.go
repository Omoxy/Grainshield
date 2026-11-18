// Uganda grain market price client.
// Aggregates maize prices from Ugandan cross-border markets (Busia, Malaba, Mbale).
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
	ugandaHTTPTimeout     = 30 * time.Second
	ugandaMaxResponseBody = 1 << 20
)

// UgandaPrice represents a price record from a Ugandan market.
type UgandaPrice struct {
	MarketName  string  `json:"market_name"`
	Commodity   string  `json:"commodity"`
	PricePerBag float64 `json:"price_per_bag"`
	Currency    string  `json:"currency"` // UGX
	PriceKES    float64 `json:"price_kes"`
	Trend       string  `json:"trend"`
	RecordedAt  string  `json:"recorded_at"`
}

// UgandaResponse wraps the API response.
type UgandaResponse struct {
	Status string        `json:"status"`
	Data   []UgandaPrice `json:"data"`
}

// UgandaClient connects to the Uganda grain market API.
type UgandaClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cb         *CircuitBreaker
	logger     *zap.Logger
}

// NewUgandaClient creates a new Uganda market client.
func NewUgandaClient(baseURL, apiKey string, logger *zap.Logger) *UgandaClient {
	return &UgandaClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: ugandaHTTPTimeout,
		},
		cb:     NewCircuitBreaker("uganda-market", logger),
		logger: logger,
	}
}

// IsConfigured returns true if Uganda market credentials are present.
func (c *UgandaClient) IsConfigured() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// FetchMarketPrices retrieves current Ugandan grain market prices.
func (c *UgandaClient) FetchMarketPrices(ctx context.Context) ([]UgandaPrice, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("Uganda market client not configured")
	}

	var prices []UgandaPrice
	err := c.cb.Execute(func() error {
		endpoint := fmt.Sprintf("%s/api/v1/prices?commodity=maize", c.baseURL)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("failed to create Uganda request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("Uganda request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, ugandaMaxResponseBody))
		if err != nil {
			return fmt.Errorf("failed to read Uganda response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			c.logger.Error("Uganda market API returned non-200",
				zap.Int("status_code", resp.StatusCode))
			return fmt.Errorf("Uganda API returned status %d", resp.StatusCode)
		}

		var apiResp UgandaResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return fmt.Errorf("failed to parse Uganda response: %w", err)
		}

		prices = apiResp.Data
		return nil
	})

	if err != nil {
		c.logger.Warn("Uganda market fetch failed, caller should use cache",
			zap.Error(err))
		return nil, err
	}

	c.logger.Info("Uganda market prices fetched",
		zap.Int("price_count", len(prices)))
	return prices, nil
}
