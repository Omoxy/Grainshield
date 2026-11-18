// Tanzania commodity exchange price client.
// Aggregates maize prices from Tanzania Mercantile Exchange (TMX).
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
	tanzaniaHTTPTimeout     = 30 * time.Second
	tanzaniaMaxResponseBody = 1 << 20
)

// TanzaniaPrice represents a price record from the Tanzania exchange.
type TanzaniaPrice struct {
	ExchangeName string  `json:"exchange_name"`
	Commodity    string  `json:"commodity"`
	PricePerBag  float64 `json:"price_per_bag"`
	Currency     string  `json:"currency"` // TZS
	PriceKES     float64 `json:"price_kes"`
	Trend        string  `json:"trend"`
	RecordedAt   string  `json:"recorded_at"`
}

// TanzaniaResponse wraps the API response.
type TanzaniaResponse struct {
	Status string          `json:"status"`
	Data   []TanzaniaPrice `json:"data"`
}

// TanzaniaClient connects to the Tanzania commodity exchange.
type TanzaniaClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cb         *CircuitBreaker
	logger     *zap.Logger
}

// NewTanzaniaClient creates a new Tanzania exchange client.
func NewTanzaniaClient(baseURL, apiKey string, logger *zap.Logger) *TanzaniaClient {
	return &TanzaniaClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: tanzaniaHTTPTimeout,
		},
		cb:     NewCircuitBreaker("tanzania-exchange", logger),
		logger: logger,
	}
}

// IsConfigured returns true if Tanzania exchange credentials are present.
func (c *TanzaniaClient) IsConfigured() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// FetchExchangePrices retrieves current Tanzania exchange prices.
func (c *TanzaniaClient) FetchExchangePrices(ctx context.Context) ([]TanzaniaPrice, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("Tanzania exchange client not configured")
	}

	var prices []TanzaniaPrice
	err := c.cb.Execute(func() error {
		endpoint := fmt.Sprintf("%s/api/v1/commodities/maize/prices", c.baseURL)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("failed to create Tanzania request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("Tanzania request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, tanzaniaMaxResponseBody))
		if err != nil {
			return fmt.Errorf("failed to read Tanzania response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			c.logger.Error("Tanzania exchange API returned non-200",
				zap.Int("status_code", resp.StatusCode))
			return fmt.Errorf("Tanzania API returned status %d", resp.StatusCode)
		}

		var apiResp TanzaniaResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return fmt.Errorf("failed to parse Tanzania response: %w", err)
		}

		prices = apiResp.Data
		return nil
	})

	if err != nil {
		c.logger.Warn("Tanzania exchange fetch failed, caller should use cache",
			zap.Error(err))
		return nil, err
	}

	c.logger.Info("Tanzania exchange prices fetched",
		zap.Int("price_count", len(prices)))
	return prices, nil
}
