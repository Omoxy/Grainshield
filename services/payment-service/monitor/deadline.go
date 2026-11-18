// Package monitor implements the payout deadline monitor for the payment-service.
// Checks every 30 minutes for payments at risk of missing the 4-hour SLA.
// Sends PagerDuty alerts for at-risk and overdue payouts.
package monitor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/grainshield/payment-service/models"
	"github.com/grainshield/payment-service/repository"
	"github.com/grainshield/pkg/middleware"
)


const (
	pagerDutyEventsURL = "https://events.pagerduty.com/v2/enqueue"
	httpTimeout        = 10 * time.Second
	atRiskWindow       = 60 * time.Minute // Alert when within 60 minutes of deadline
)

// DeadlineMonitor checks for at-risk payouts and fires PagerDuty alerts.
type DeadlineMonitor struct {
	repo              *repository.PaymentRepo
	audit             *middleware.AuditLogger
	logger            *zap.Logger
	pagerDutyKey      string
	checkInterval     time.Duration
	httpClient        *http.Client
}

// NewDeadlineMonitor creates a new payout deadline monitor.
func NewDeadlineMonitor(
	repo *repository.PaymentRepo,
	audit *middleware.AuditLogger,
	logger *zap.Logger,
	pagerDutyKey string,
	checkInterval time.Duration,
) *DeadlineMonitor {
	return &DeadlineMonitor{
		repo:          repo,
		audit:         audit,
		logger:        logger,
		pagerDutyKey:  pagerDutyKey,
		checkInterval: checkInterval,
		httpClient:    &http.Client{Timeout: httpTimeout},
	}
}

// Start begins the periodic deadline check. Runs until context is cancelled.
func (m *DeadlineMonitor) Start(ctx context.Context) {
	m.logger.Info("payout deadline monitor started",
		zap.Duration("check_interval", m.checkInterval))

	// Run immediately on start, then on interval
	m.check(ctx)

	ticker := time.NewTicker(m.checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			m.logger.Info("payout deadline monitor stopped")
			return
		case <-ticker.C:
			m.check(ctx)
		}
	}
}

func (m *DeadlineMonitor) check(ctx context.Context) {
	// Find payments with payout_deadline within atRiskWindow that are still pending
	atRisk, err := m.repo.GetAtRiskPayouts(ctx, atRiskWindow)
	if err != nil {
		m.logger.Error("failed to query at-risk payouts", zap.Error(err))
		return
	}

	if len(atRisk) == 0 {
		m.logger.Debug("no at-risk payouts found")
		return
	}

	m.logger.Warn("at-risk payouts detected",
		zap.Int("count", len(atRisk)))

	for _, alert := range atRisk {
		severity := "warning"
		if alert.MinutesLeft <= 0 {
			severity = "critical"
		}

		// Audit the alert (Security Rule #4)
		m.audit.Log(ctx, "deadline-monitor", "payment:deadline_alert", "payment",
			alert.PaymentID.String(), map[string]interface{}{
				"claim_id":        alert.ClaimID.String(),
				"farmer":          alert.FarmerGSNumber,
				"amount":          alert.Amount,
				"minutes_left":    alert.MinutesLeft,
				"severity":        severity,
				"payout_deadline": alert.PayoutDeadline.Format(time.RFC3339),
			})

		// Fire PagerDuty alert
		if m.pagerDutyKey != "" {
			if err := m.firePagerDuty(ctx, alert, severity); err != nil {
				m.logger.Error("failed to send PagerDuty alert",
					zap.String("payment_id", alert.PaymentID.String()),
					zap.Error(err))
			}
		}
	}
}

// pagerDutyPayload matches PagerDuty Events API v2 spec.
type pagerDutyPayload struct {
	RoutingKey  string          `json:"routing_key"`
	EventAction string          `json:"event_action"`
	DedupKey    string          `json:"dedup_key"`
	Payload     pdPayloadBody   `json:"payload"`
}

type pdPayloadBody struct {
	Summary   string            `json:"summary"`
	Severity  string            `json:"severity"`
	Source    string            `json:"source"`
	Component string            `json:"component"`
	Group     string            `json:"group"`
	CustomDetails map[string]interface{} `json:"custom_details"`
}

func (m *DeadlineMonitor) firePagerDuty(ctx context.Context, alert models.PayoutDeadlineAlert, severity string) error {
	summary := fmt.Sprintf(
		"GrainShield: Payout at risk for farmer %s. Amount KES %.2f. %d minutes remaining.",
		alert.FarmerGSNumber, alert.Amount, alert.MinutesLeft,
	)
	if alert.MinutesLeft <= 0 {
		summary = fmt.Sprintf(
			"GrainShield: OVERDUE payout for farmer %s. Amount KES %.2f. Deadline passed %d minutes ago.",
			alert.FarmerGSNumber, alert.Amount, -alert.MinutesLeft,
		)
	}

	pd := pagerDutyPayload{
		RoutingKey:  m.pagerDutyKey,
		EventAction: "trigger",
		DedupKey:    fmt.Sprintf("payout-%s", alert.PaymentID.String()),
		Payload: pdPayloadBody{
			Summary:   summary,
			Severity:  severity,
			Source:    "payment-service",
			Component: "payout-deadline-monitor",
			Group:     "payment",
			CustomDetails: map[string]interface{}{
				"payment_id":      alert.PaymentID.String(),
				"claim_id":        alert.ClaimID.String(),
				"farmer":          alert.FarmerGSNumber,
				"amount_kes":      alert.Amount,
				"payout_deadline": alert.PayoutDeadline.Format(time.RFC3339),
				"minutes_left":    alert.MinutesLeft,
			},
		},
	}

	payload, err := json.Marshal(pd)
	if err != nil {
		return fmt.Errorf("failed to marshal PagerDuty event: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pagerDutyEventsURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to create PagerDuty request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("PagerDuty request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("PagerDuty returned status %d", resp.StatusCode)
	}

	m.logger.Info("PagerDuty alert sent",
		zap.String("payment_id", alert.PaymentID.String()),
		zap.String("severity", severity),
		zap.Int("minutes_left", alert.MinutesLeft))

	return nil
}
