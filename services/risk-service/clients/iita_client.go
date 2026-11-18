// Package clients provides external API clients for the risk-service.
// IITA A-EWS API client for aflatoxin risk scores per sub-county.
// Security Rule #1: API key from env, never hardcoded.
// Security Rule #7: Circuit breaker with stale data fallback.
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
	iitaHTTPTimeout     = 30 * time.Second
	iitaMaxResponseBody = 1 << 20 // 1 MB
)

// ValidSubCounties defines the five Trans Nzoia sub-counties.
var ValidSubCounties = []string{
	"Kiminini",
	"Kwanza",
	"Saboti",
	"Endebess",
	"Cherangany",
}

// IITAScore represents a single aflatoxin risk score from the A-EWS API.
type IITAScore struct {
	SubCounty        string  `json:"sub_county"`
	RiskScore        float64 `json:"risk_score"`
	ContaminationPPB float64 `json:"contamination_ppb"`
	Confidence       float64 `json:"confidence"`
	ModelVersion     string  `json:"model_version"`
	Season           string  `json:"season"`
	RecordedAt       string  `json:"recorded_at"`
}

// IITAResponse wraps the A-EWS API response envelope.
type IITAResponse struct {
	Status string      `json:"status"`
	Data   []IITAScore `json:"data"`
}

// IITAClient connects to the IITA A-EWS aflatoxin early warning system.
type IITAClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cb         *CircuitBreaker
	logger     *zap.Logger
}

// NewIITAClient creates a new IITA A-EWS API client.
func NewIITAClient(baseURL, apiKey string, logger *zap.Logger) *IITAClient {
	return &IITAClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: iitaHTTPTimeout,
		},
		cb:     NewCircuitBreaker("iita-aews", logger),
		logger: logger,
	}
}

// IsConfigured returns true if IITA credentials are present.
func (c *IITAClient) IsConfigured() bool {
	return c.baseURL != "" && c.apiKey != ""
}

// FetchAflatoxinScores pulls the latest weekly scores for a sub-county (or all).
// If the circuit is open or the API fails, the caller should use last known DB scores
// with a staleness warning. This method returns an error in that case so the handler
// can implement the fallback.
func (c *IITAClient) FetchAflatoxinScores(ctx context.Context, subCounty string) ([]IITAScore, error) {
	if !c.IsConfigured() {
		return nil, fmt.Errorf("IITA A-EWS client not configured")
	}

	var scores []IITAScore
	err := c.cb.Execute(func() error {
		endpoint := fmt.Sprintf("%s/api/v2/aflatoxin/scores", c.baseURL)
		if subCounty != "" {
			endpoint += "?sub_county=" + subCounty
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return fmt.Errorf("failed to create IITA request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("IITA request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, iitaMaxResponseBody))
		if err != nil {
			return fmt.Errorf("failed to read IITA response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			c.logger.Error("IITA A-EWS API returned non-200",
				zap.Int("status_code", resp.StatusCode))
			return fmt.Errorf("IITA API returned status %d", resp.StatusCode)
		}

		var apiResp IITAResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			return fmt.Errorf("failed to parse IITA response: %w", err)
		}

		scores = apiResp.Data
		return nil
	})

	if err != nil {
		c.logger.Warn("IITA A-EWS fetch failed, caller should use stale data",
			zap.String("sub_county", subCounty),
			zap.Error(err))
		return nil, err
	}

	c.logger.Info("IITA A-EWS scores fetched",
		zap.String("sub_county", subCounty),
		zap.Int("score_count", len(scores)))

	return scores, nil
}
