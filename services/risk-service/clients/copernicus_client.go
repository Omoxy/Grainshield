// ESA Copernicus satellite data client for weather event confirmation.
// Uses Sentinel-3 SLSTR and ERA5 precipitation data products.
// Security Rule #1: API key from env, never hardcoded.
// Security Rule #7: Circuit breaker with unconfirmed fallback.
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
	copernicusHTTPTimeout     = 45 * time.Second
	copernicusMaxResponseBody = 2 << 20 // 2 MB
)

// WeatherConfirmation represents satellite confirmed weather data.
type WeatherConfirmation struct {
	SubCounty         string  `json:"sub_county"`
	EventDate         string  `json:"event_date"`
	Confirmed         bool    `json:"confirmed"`
	SatelliteRef      string  `json:"satellite_ref"`
	LandSurfaceTempC  float64 `json:"land_surface_temp_c"`
	PrecipitationMM   float64 `json:"precipitation_mm"`
	DataProduct       string  `json:"data_product"`
	ConfidencePercent float64 `json:"confidence_percent"`
}

// CopernicusResponse wraps the API response envelope.
type CopernicusResponse struct {
	Status string                `json:"status"`
	Data   []WeatherConfirmation `json:"data"`
}

// CopernicusClient connects to the ESA Copernicus Data Space Ecosystem.
type CopernicusClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cb         *CircuitBreaker
	logger     *zap.Logger
}

// NewCopernicusClient creates a new Copernicus satellite data client.
func NewCopernicusClient(baseURL, apiKey string, logger *zap.Logger) *CopernicusClient {
	return &CopernicusClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: copernicusHTTPTimeout,
		},
		cb:     NewCircuitBreaker("copernicus", logger),
		logger: logger,
	}
}

// IsConfigured returns true if Copernicus credentials are present.
func (c *CopernicusClient) IsConfigured() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// FetchWeatherConfirmation confirms a weather event using satellite data.
// On failure: returns unconfirmed status. Never blocks insurance operations.
func (c *CopernicusClient) FetchWeatherConfirmation(
	ctx context.Context, subCounty string, eventDate string,
) (*WeatherConfirmation, error) {
	if !c.IsConfigured() {
		return &WeatherConfirmation{
			SubCounty: subCounty,
			EventDate: eventDate,
			Confirmed: false,
		}, nil
	}

	var confirmation *WeatherConfirmation
	err := c.cb.Execute(func() error {
		endpoint := fmt.Sprintf(
			"%s/api/v1/weather/confirm?sub_county=%s&event_date=%s",
			c.baseURL, subCounty, eventDate,
		)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("failed to create Copernicus request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("Copernicus request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, copernicusMaxResponseBody))
		if err != nil {
			return fmt.Errorf("failed to read Copernicus response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			c.logger.Error("Copernicus API returned non-200",
				zap.Int("status_code", resp.StatusCode))
			return fmt.Errorf("Copernicus API returned status %d", resp.StatusCode)
		}

		var apiResp CopernicusResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return fmt.Errorf("failed to parse Copernicus response: %w", err)
		}

		if len(apiResp.Data) > 0 {
			confirmation = &apiResp.Data[0]
		}
		return nil
	})

	if err != nil {
		c.logger.Warn("Copernicus fetch failed, returning unconfirmed",
			zap.String("sub_county", subCounty),
			zap.Error(err))
		return &WeatherConfirmation{
			SubCounty: subCounty,
			EventDate: eventDate,
			Confirmed: false,
		}, nil
	}

	if confirmation == nil {
		return &WeatherConfirmation{
			SubCounty: subCounty,
			EventDate: eventDate,
			Confirmed: false,
		}, nil
	}

	return confirmation, nil
}
