// Package cron implements the Monday 06:00 EAT price SMS cron job.
// This is critical path: if it fails, PagerDuty alert fires.
package cron

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/grainshield/price-service/kafka"
	"github.com/grainshield/price-service/repository"
)


const (
	eatOffsetHours       = 3 // East Africa Time = UTC+3
	cronTargetWeekday    = time.Monday
	cronTargetHour       = 6 // 06:00 EAT
	cronCheckInterval    = 30 * time.Second
	pagerDutyEventsURL   = "https://events.pagerduty.com/v2/enqueue"
	pagerDutyHTTPTimeout = 10 * time.Second
)

// PriceSMSCron runs the weekly price SMS generation job.
type PriceSMSCron struct {
	repo                *repository.PriceRepo
	producer            *kafka.Producer
	pagerDutyRoutingKey string
	logger              *zap.Logger
	lastRunDate         string
}

// NewPriceSMSCron creates a new cron instance.
func NewPriceSMSCron(
	repo *repository.PriceRepo,
	producer *kafka.Producer,
	pagerDutyRoutingKey string,
	logger *zap.Logger,
) *PriceSMSCron {
	return &PriceSMSCron{
		repo:                repo,
		producer:            producer,
		pagerDutyRoutingKey: pagerDutyRoutingKey,
		logger:              logger,
	}
}

// Start begins the cron loop. It checks every 30 seconds if it is Monday 06:00 EAT.
// Call this in a goroutine.
func (c *PriceSMSCron) Start(ctx context.Context) {
	c.logger.Info("price SMS cron started, target: Monday 06:00 EAT")

	ticker := time.NewTicker(cronCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			c.logger.Info("price SMS cron stopped")
			return
		case <-ticker.C:
			c.checkAndRun(ctx)
		}
	}
}

func (c *PriceSMSCron) checkAndRun(ctx context.Context) {
	now := time.Now().UTC().Add(time.Duration(eatOffsetHours) * time.Hour)
	today := now.Format("2006-01-02")

	// Only run on Monday at 06:xx EAT, and only once per day
	if now.Weekday() != cronTargetWeekday || now.Hour() != cronTargetHour {
		return
	}
	if c.lastRunDate == today {
		return
	}

	c.logger.Info("executing Monday price SMS cron")
	if err := c.execute(ctx); err != nil {
		c.logger.Error("price SMS cron failed", zap.Error(err))
		c.firePagerDutyAlert(err)
		return
	}

	c.lastRunDate = today
	c.logger.Info("price SMS cron completed successfully")
}

func (c *PriceSMSCron) execute(ctx context.Context) error {
	smsContent, err := c.repo.GetSMSPreview(ctx)
	if err != nil {
		return fmt.Errorf("failed to generate SMS content: %w", err)
	}

	if len(smsContent) == 0 {
		return fmt.Errorf("SMS content is empty, no prices available")
	}

	// Publish to Kafka for notification-service to pick up and send
	if c.producer != nil {
		err := c.producer.PublishPriceSMSGenerated(ctx, kafka.PriceSMSGeneratedEvent{
			SMSContent:     smsContent,
			CharacterCount: len(smsContent),
			Language:       "sw",
			FarmerCount:    0, // notification-service will resolve actual count
		})
		if err != nil {
			return fmt.Errorf("failed to publish SMS event: %w", err)
		}
	}

	c.logger.Info("price SMS generated and published",
		zap.Int("character_count", len(smsContent)),
		zap.String("language", "sw"))

	return nil
}

// RunNow allows manual triggering of the SMS generation (for testing/admin).
func (c *PriceSMSCron) RunNow(ctx context.Context) error {
	return c.execute(ctx)
}

// firePagerDutyAlert sends a critical alert to PagerDuty Events API v2.
func (c *PriceSMSCron) firePagerDutyAlert(cronErr error) {
	if c.pagerDutyRoutingKey == "" {
		c.logger.Warn("PagerDuty routing key not configured, skipping alert")
		return
	}

	payload := map[string]interface{}{
		"routing_key":  c.pagerDutyRoutingKey,
		"event_action": "trigger",
		"payload": map[string]interface{}{
			"summary":   fmt.Sprintf("GrainShield: Monday price SMS cron failed: %v", cronErr),
			"severity":  "critical",
			"source":    "price-service",
			"component": "price-sms-cron",
			"group":     "intelligence",
			"class":     "cron_failure",
			"custom_details": map[string]interface{}{
				"error":     cronErr.Error(),
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		c.logger.Error("failed to marshal PagerDuty payload", zap.Error(err))
		return
	}

	client := &http.Client{Timeout: pagerDutyHTTPTimeout}
	resp, err := client.Post(pagerDutyEventsURL, "application/json", bytes.NewReader(body))
	if err != nil {
		c.logger.Error("failed to send PagerDuty alert", zap.Error(err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		c.logger.Info("PagerDuty alert fired for cron failure",
			zap.Int("status_code", resp.StatusCode))
	} else {
		c.logger.Error("PagerDuty alert failed",
			zap.Int("status_code", resp.StatusCode))
	}
}
