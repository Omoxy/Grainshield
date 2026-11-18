// Package mpesa implements the Safaricom M-Pesa Daraja API v2 B2C client.
// Security Rule #1: No credentials in source. All from env vars via config.
// Security Rule #7: Circuit breaker, exponential backoff, dead letter after 3 retries.
package mpesa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"go.uber.org/zap"
)


const (
	httpTimeout            = 30 * time.Second
	tokenRefreshBuffer     = 60 * time.Second
	circuitOpenDuration    = 30 * time.Second
	circuitFailureThreshold = 5
	maxRequestBodyBytes    = 1 << 20 // 1 MB
	b2cCommandID           = "BusinessPayment"
)

// Client is the Daraja API v2 client with OAuth token caching and circuit breaker.
type Client struct {
	consumerKey        string
	consumerSecret     string
	shortcode          string
	initiatorName      string
	securityCredential string
	b2cURL             string
	tokenURL           string
	resultURL          string
	timeoutURL         string

	httpClient *http.Client
	logger     *zap.Logger

	// Token cache (thread-safe)
	mu          sync.RWMutex
	accessToken string
	tokenExpiry time.Time

	// Circuit breaker state
	cbMu              sync.Mutex
	circuitState      CircuitState
	consecutiveFails  int
	circuitOpenUntil  time.Time
}

// NewClient creates a new Daraja API client.
// Security Rule #1: credentials must come from config, never hardcoded.
func NewClient(
	consumerKey, consumerSecret, shortcode, initiatorName, securityCredential string,
	b2cURL, tokenURL, resultURL, timeoutURL string,
	logger *zap.Logger,
) *Client {
	return &Client{
		consumerKey:        consumerKey,
		consumerSecret:     consumerSecret,
		shortcode:          shortcode,
		initiatorName:      initiatorName,
		securityCredential: securityCredential,
		b2cURL:             b2cURL,
		tokenURL:           tokenURL,
		resultURL:          resultURL,
		timeoutURL:         timeoutURL,
		httpClient: &http.Client{
			Timeout: httpTimeout,
		},
		logger:       logger,
		circuitState: CircuitClosed,
	}
}

// IsConfigured returns true if M-Pesa credentials are present.
func (c *Client) IsConfigured() bool {
	return c.consumerKey != "" && c.consumerSecret != "" && c.shortcode != ""
}


// GetToken returns a valid OAuth access token, refreshing if needed.
// Token is cached and refreshed 60 seconds before expiry.
func (c *Client) GetToken(ctx context.Context) (string, error) {
	c.mu.RLock()
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		token := c.accessToken
		c.mu.RUnlock()
		return token, nil
	}
	c.mu.RUnlock()

	return c.refreshToken(ctx)
}

func (c *Client) refreshToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		return c.accessToken, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.tokenURL+"?grant_type=client_credentials", nil)
	if err != nil {
		return "", fmt.Errorf("failed to create token request: %w", err)
	}
	req.SetBasicAuth(c.consumerKey, c.consumerSecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRequestBodyBytes))
	if err != nil {
		return "", fmt.Errorf("failed to read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		// Security Rule #9: never log or return raw error details from Daraja
		c.logger.Error("daraja token request failed",
			zap.Int("status_code", resp.StatusCode))
		return "", fmt.Errorf("daraja auth failed with status %d", resp.StatusCode)
	}

	var oauthResp OAuthResponse
	if err := json.Unmarshal(body, &oauthResp); err != nil {
		return "", fmt.Errorf("failed to parse token response: %w", err)
	}

	expiresIn, err := strconv.Atoi(oauthResp.ExpiresIn)
	if err != nil {
		expiresIn = 3599 // Default Daraja token lifetime
	}

	c.accessToken = oauthResp.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(expiresIn)*time.Second - tokenRefreshBuffer)

	c.logger.Info("daraja oauth token refreshed",
		zap.Duration("valid_for", time.Duration(expiresIn)*time.Second))

	return c.accessToken, nil
}


func (c *Client) checkCircuit() error {
	c.cbMu.Lock()
	defer c.cbMu.Unlock()

	switch c.circuitState {
	case CircuitOpen:
		if time.Now().After(c.circuitOpenUntil) {
			c.circuitState = CircuitHalfOpen
			c.logger.Info("circuit breaker: transitioning to half-open")
			return nil
		}
		return fmt.Errorf("circuit breaker open: M-Pesa API unavailable, retrying after %s",
			time.Until(c.circuitOpenUntil).Round(time.Second))
	case CircuitHalfOpen:
		return nil // Allow one test request
	default:
		return nil
	}
}

func (c *Client) recordSuccess() {
	c.cbMu.Lock()
	defer c.cbMu.Unlock()
	c.consecutiveFails = 0
	if c.circuitState == CircuitHalfOpen {
		c.circuitState = CircuitClosed
		c.logger.Info("circuit breaker: closed (recovery confirmed)")
	}
}

func (c *Client) recordFailure() {
	c.cbMu.Lock()
	defer c.cbMu.Unlock()
	c.consecutiveFails++
	if c.consecutiveFails >= circuitFailureThreshold {
		c.circuitState = CircuitOpen
		c.circuitOpenUntil = time.Now().Add(circuitOpenDuration)
		c.logger.Warn("circuit breaker: opened",
			zap.Int("consecutive_failures", c.consecutiveFails),
			zap.Duration("open_duration", circuitOpenDuration))
	}
}

// InitiateB2C sends a B2C payment request to the Safaricom Daraja API.
// Returns the ConversationID on success.
// Security Rule #3: No string concatenation in request building.
func (c *Client) InitiateB2C(ctx context.Context, phone string, amount float64, occasion string) (*B2CResponse, error) {
	if err := c.checkCircuit(); err != nil {
		return nil, err
	}

	token, err := c.GetToken(ctx)
	if err != nil {
		c.recordFailure()
		return nil, fmt.Errorf("failed to get auth token: %w", err)
	}

	b2cReq := B2CRequest{
		InitiatorName:      c.initiatorName,
		SecurityCredential: c.securityCredential,
		CommandID:          b2cCommandID,
		Amount:             int64(amount),
		PartyA:             c.shortcode,
		PartyB:             phone,
		Remarks:            "GrainShield Insurance Payout",
		QueueTimeOutURL:    c.timeoutURL,
		ResultURL:          c.resultURL,
		Occasion:           occasion,
	}

	payload, err := json.Marshal(b2cReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal B2C request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.b2cURL, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to create B2C request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.recordFailure()
		return nil, fmt.Errorf("B2C request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRequestBodyBytes))
	if err != nil {
		c.recordFailure()
		return nil, fmt.Errorf("failed to read B2C response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		c.recordFailure()
		// Security Rule #9: log status code only, not response body
		c.logger.Error("daraja B2C request failed",
			zap.Int("status_code", resp.StatusCode),
			zap.String("phone", maskPhone(phone)))
		return nil, fmt.Errorf("daraja B2C failed with status %d", resp.StatusCode)
	}

	var b2cResp B2CResponse
	if err := json.Unmarshal(body, &b2cResp); err != nil {
		c.recordFailure()
		return nil, fmt.Errorf("failed to parse B2C response: %w", err)
	}

	if b2cResp.ResponseCode != "0" {
		c.recordFailure()
		c.logger.Warn("daraja B2C rejected",
			zap.String("response_code", b2cResp.ResponseCode),
			zap.String("phone", maskPhone(phone)))
		return &b2cResp, fmt.Errorf("daraja rejected: code %s", b2cResp.ResponseCode)
	}

	c.recordSuccess()
	c.logger.Info("daraja B2C initiated",
		zap.String("conversation_id", b2cResp.ConversationID),
		zap.Float64("amount", amount),
		zap.String("phone", maskPhone(phone)))

	return &b2cResp, nil
}

// ParseCallback parses a raw Daraja callback payload.
func ParseCallback(body []byte) (*CallbackResult, error) {
	var result CallbackResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse callback: %w", err)
	}
	return &result, nil
}

// maskPhone masks a phone number for logging. "254712345678" → "2547****5678"
// Security Rule #9: Never log full phone numbers.
func maskPhone(phone string) string {
	if len(phone) < 8 {
		return "****"
	}
	return phone[:4] + "****" + phone[len(phone)-4:]
}
