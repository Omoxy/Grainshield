// Package africastalking provides an SMS client for the Africa's Talking API.
// Security Rule #1: API key from environment only — refuse to start if missing.
package africastalking

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

const (
	prodBaseURL    = "https://api.africastalking.com/version1/messaging"
	sandboxBaseURL = "https://api.sandbox.africastalking.com/version1/messaging"

	maxRetries     = 3
	initialBackoff = 1 * time.Second
	requestTimeout = 10 * time.Second

	// Circuit breaker thresholds.
	cbFailureThreshold = 3
	cbOpenDuration     = 30 * time.Second
)

// SMSResponse represents the Africa's Talking API response for a sent SMS.
type SMSResponse struct {
	Recipients []struct {
		StatusCode int    `json:"statusCode"`
		Number     string `json:"number"`
		Status     string `json:"status"`
		MessageID  string `json:"messageId"`
		Cost       string `json:"cost"`
	} `json:"Recipients"`
}

// APIResponse is the top level response envelope.
type APIResponse struct {
	SMSMessageData SMSResponse `json:"SMSMessageData"`
}

// SMSClient sends SMS via Africa's Talking.
type SMSClient struct {
	apiKey   string
	username string
	senderID string
	baseURL  string
	client   *http.Client
	logger   *zap.Logger

	// Circuit breaker state.
	mu              sync.Mutex
	consecutiveFail int
	openUntil       time.Time
}

// NewSMSClient creates a new Africa's Talking SMS client.
// Panics if apiKey or username are empty (Security Rule #1).
func NewSMSClient(apiKey, username, senderID, environment string, logger *zap.Logger) *SMSClient {
	if apiKey == "" {
		panic("africastalking: AT_API_KEY is required — refuse to start without it")
	}
	if username == "" {
		panic("africastalking: AT_USERNAME is required — refuse to start without it")
	}
	if senderID == "" {
		senderID = "GrainShield"
	}

	base := prodBaseURL
	if environment == "sandbox" {
		base = sandboxBaseURL
		logger.Info("africastalking: using sandbox environment")
	}

	return &SMSClient{
		apiKey:   apiKey,
		username: username,
		senderID: senderID,
		baseURL:  base,
		client:   &http.Client{Timeout: requestTimeout},
		logger:   logger,
	}
}

// Send delivers an SMS to the given phone number.
// Returns the provider message ID on success.
// Implements exponential backoff retry and circuit breaker.
func (c *SMSClient) Send(ctx context.Context, phone, message string) (string, error) {
	if err := c.checkCircuitBreaker(); err != nil {
		return "", err
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			backoff := initialBackoff * time.Duration(1<<(attempt-1))
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(backoff):
			}
		}

		ref, err := c.doSend(ctx, phone, message)
		if err == nil {
			c.recordSuccess()
			return ref, nil
		}
		lastErr = err
		c.logger.Warn("africastalking: send attempt failed",
			zap.Int("attempt", attempt+1),
			zap.String("phone_suffix", phoneSuffix(phone)),
			zap.Error(err))
	}

	c.recordFailure()
	return "", fmt.Errorf("africastalking: all %d attempts failed: %w", maxRetries, lastErr)
}

func (c *SMSClient) doSend(ctx context.Context, phone, message string) (string, error) {
	form := url.Values{}
	form.Set("username", c.username)
	form.Set("to", phone)
	form.Set("message", message)
	form.Set("from", c.senderID)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("apiKey", c.apiKey)

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("api returned status %d: %s", resp.StatusCode, string(body))
	}

	var apiResp APIResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	recipients := apiResp.SMSMessageData.Recipients
	if len(recipients) == 0 {
		return "", fmt.Errorf("no recipients in response")
	}

	r := recipients[0]
	if r.StatusCode != 101 {
		return "", fmt.Errorf("delivery failed: status=%s code=%d", r.Status, r.StatusCode)
	}

	return r.MessageID, nil
}

// Circuit breaker methods.

func (c *SMSClient) checkCircuitBreaker() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.consecutiveFail >= cbFailureThreshold && time.Now().Before(c.openUntil) {
		return fmt.Errorf("africastalking: circuit breaker open until %s", c.openUntil.Format(time.RFC3339))
	}
	if time.Now().After(c.openUntil) {
		c.consecutiveFail = 0
	}
	return nil
}

func (c *SMSClient) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.consecutiveFail = 0
}

func (c *SMSClient) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.consecutiveFail++
	if c.consecutiveFail >= cbFailureThreshold {
		c.openUntil = time.Now().Add(cbOpenDuration)
		c.logger.Error("africastalking: circuit breaker OPEN",
			zap.Duration("open_for", cbOpenDuration))
	}
}

// phoneSuffix returns the last 4 digits of a phone number for safe logging.
func phoneSuffix(phone string) string {
	if len(phone) < 4 {
		return "****"
	}
	return "****" + phone[len(phone)-4:]
}
