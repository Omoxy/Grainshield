// Kenya Meteorological Department API client for seasonal forecasts.
// Security Rule #1: API key from env, never hardcoded.
// Security Rule #7: Circuit breaker with "normal" fallback.
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
	kmdHTTPTimeout     = 30 * time.Second
	kmdMaxResponseBody = 1 << 20 // 1 MB
	forecastNormal     = "normal"
)

// SeasonalForecast represents a KMD seasonal forecast for a sub-county.
type SeasonalForecast struct {
	SubCounty       string  `json:"sub_county"`
	Season          string  `json:"season"`
	RainfallOutlook string  `json:"rainfall_outlook"` // "above_normal", "normal", "below_normal"
	TempOutlook     string  `json:"temp_outlook"`
	DroughtRisk     float64 `json:"drought_risk"`     // 0-100
	FloodRisk       float64 `json:"flood_risk"`       // 0-100
	IssuedAt        string  `json:"issued_at"`
}

// KMDResponse wraps the KMD API response envelope.
type KMDResponse struct {
	Status string             `json:"status"`
	Data   []SeasonalForecast `json:"data"`
}

// KMDClient connects to the Kenya Meteorological Department API.
type KMDClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cb         *CircuitBreaker
	logger     *zap.Logger
}

// NewKMDClient creates a new KMD API client.
func NewKMDClient(baseURL, apiKey string, logger *zap.Logger) *KMDClient {
	return &KMDClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: kmdHTTPTimeout,
		},
		cb:     NewCircuitBreaker("kmd", logger),
		logger: logger,
	}
}

// IsConfigured returns true if KMD credentials are present.
func (c *KMDClient) IsConfigured() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// FetchSeasonalForecast returns the current seasonal forecast for a sub-county.
// On failure: returns a default "normal" forecast. Never blocks insurance operations.
func (c *KMDClient) FetchSeasonalForecast(ctx context.Context, subCounty string) (*SeasonalForecast, error) {
	defaultForecast := &SeasonalForecast{
		SubCounty:       subCounty,
		RainfallOutlook: forecastNormal,
		TempOutlook:     forecastNormal,
		DroughtRisk:     0,
		FloodRisk:       0,
	}

	if !c.IsConfigured() {
		return defaultForecast, nil
	}

	var forecast *SeasonalForecast
	err := c.cb.Execute(func() error {
		endpoint := fmt.Sprintf(
			"%s/api/v1/forecast/seasonal?county=Trans+Nzoia&sub_county=%s",
			c.baseURL, subCounty,
		)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("failed to create KMD request: %w", err)
		}
		req.Header.Set("Authorization", "ApiKey "+c.apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("KMD request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, kmdMaxResponseBody))
		if err != nil {
			return fmt.Errorf("failed to read KMD response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			c.logger.Error("KMD API returned non-200",
				zap.Int("status_code", resp.StatusCode))
			return fmt.Errorf("KMD API returned status %d", resp.StatusCode)
		}

		var apiResp KMDResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return fmt.Errorf("failed to parse KMD response: %w", err)
		}

		if len(apiResp.Data) > 0 {
			forecast = &apiResp.Data[0]
		}
		return nil
	})

	if err != nil {
		c.logger.Warn("KMD fetch failed, returning default forecast",
			zap.String("sub_county", subCounty),
			zap.Error(err))
		return defaultForecast, nil
	}

	if forecast == nil {
		return defaultForecast, nil
	}

	return forecast, nil
}
