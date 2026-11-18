// NCPB depot price aggregator.
// Fetches current buying prices from National Cereals and Produce Board depots.
// Security Rule #1: API key from env, never hardcoded.
// Security Rule #7: Circuit breaker with Redis cache fallback.
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
	ncpbHTTPTimeout     = 30 * time.Second
	ncpbMaxResponseBody = 1 << 20 // 1 MB
)

// NCPBPrice represents a single NCPB depot price record.
type NCPBPrice struct {
	DepotName   string  `json:"depot_name"`
	Commodity   string  `json:"commodity"`
	PricePerBag float64 `json:"price_per_bag"`
	Currency    string  `json:"currency"`
	Unit        string  `json:"unit"`
	Trend       string  `json:"trend"`
	RecordedAt  string  `json:"recorded_at"`
}

// NCPBResponse wraps the NCPB API response envelope.
type NCPBResponse struct {
	Status string      `json:"status"`
	Data   []NCPBPrice `json:"data"`
}

// NCPBClient connects to the NCPB price feed API.
type NCPBClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cb         *CircuitBreaker
	logger     *zap.Logger
}

// NewNCPBClient creates a new NCPB price feed client.
func NewNCPBClient(baseURL, apiKey string, logger *zap.Logger) *NCPBClient {
	return &NCPBClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: ncpbHTTPTimeout,
		},
		cb:     NewCircuitBreaker("ncpb", logger),
		logger: logger,
	}
}

// IsConfigured returns true if NCPB credentials are present.
func (c *NCPBClient) IsConfigured() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// FetchDepotPrices retrieves current NCPB depot buying prices.
// On failure: returns error so caller can use Redis cache fallback.
func (c *NCPBClient) FetchDepotPrices(ctx context.Context) ([]NCPBPrice, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("NCPB client not configured")
	}

	var prices []NCPBPrice
	err := c.cb.Execute(func() error {
		endpoint := fmt.Sprintf("%s/api/v1/prices/depots?commodity=Maize", c.baseURL)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("failed to create NCPB request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("NCPB request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, ncpbMaxResponseBody))
		if err != nil {
			return fmt.Errorf("failed to read NCPB response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			c.logger.Error("NCPB API returned non-200",
				zap.Int("status_code", resp.StatusCode))
			return fmt.Errorf("NCPB API returned status %d", resp.StatusCode)
		}

		var apiResp NCPBResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return fmt.Errorf("failed to parse NCPB response: %w", err)
		}

		prices = apiResp.Data
		return nil
	})

	if err != nil {
		c.logger.Warn("NCPB fetch failed, caller should use cache",
			zap.Error(err))
		return nil, err
	}

	c.logger.Info("NCPB depot prices fetched",
		zap.Int("price_count", len(prices)))
	return prices, nil
}
