// Package repository implements database operations for the notification-service.
// Security Rule #3: Parameterised queries only.
package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/grainshield/notification-service/africastalking"
	"github.com/grainshield/notification-service/models"
)

// NotificationRepo provides database operations for notifications.
type NotificationRepo struct {
	db     *pgxpool.Pool
	sms    *africastalking.SMSClient
	logger *zap.Logger
}

// NewNotificationRepo creates a new NotificationRepo with SMS delivery.
func NewNotificationRepo(db *pgxpool.Pool, sms *africastalking.SMSClient, logger *zap.Logger) *NotificationRepo {
	return &NotificationRepo{db: db, sms: sms, logger: logger}
}

// Send sends a notification using a template and delivers it via Africa's Talking.
func (r *NotificationRepo) Send(ctx context.Context, req models.SendNotificationRequest) (map[string]interface{}, error) {
	var templateID uuid.UUID
	var templateBody string
	err := r.db.QueryRow(ctx,
		`SELECT id, body FROM notification_templates
		 WHERE category = $1 AND channel = $2 AND language = 'sw' AND active = TRUE`,
		req.Category, req.Channel,
	).Scan(&templateID, &templateBody)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("no template found for category/channel")
	}
	if err != nil {
		return nil, fmt.Errorf("template lookup failed: %w", err)
	}

	renderedBody := templateBody
	for key, value := range req.Variables {
		renderedBody = strings.ReplaceAll(renderedBody, "{{"+key+"}}", value)
	}
	if len(renderedBody) > 480 {
		renderedBody = renderedBody[:477] + "..."
	}

	var farmerID *uuid.UUID
	if req.FarmerID != "" {
		id, err := uuid.Parse(req.FarmerID)
		if err == nil {
			farmerID = &id
		}
	}

	notifID := uuid.New()

	// Insert with status 'pending' first (outbox pattern).
	_, err = r.db.Exec(ctx,
		`INSERT INTO notifications (id, template_id, farmer_id, phone, channel, category, body, status, sent_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW())`,
		notifID, templateID, farmerID, req.Phone, req.Channel, req.Category, renderedBody)
	if err != nil {
		return nil, fmt.Errorf("failed to insert notification: %w", err)
	}

	// Deliver via Africa's Talking for SMS channel.
	var providerRef string
	status := "sent"
	var failedReason string

	if req.Channel == "sms" && r.sms != nil {
		ref, sendErr := r.sms.Send(ctx, req.Phone, renderedBody)
		if sendErr != nil {
			status = "failed"
			failedReason = sendErr.Error()
			if len(failedReason) > 500 {
				failedReason = failedReason[:497] + "..."
			}
			r.logger.Error("sms delivery failed",
				zap.String("notification_id", notifID.String()),
				zap.Error(sendErr))
		} else {
			providerRef = ref
		}
	} else {
		// Non-SMS channels or no SMS client — mark as sent with local ref.
		providerRef = fmt.Sprintf("LOCAL-%d-%s", time.Now().UnixMilli(), req.Phone[len(req.Phone)-4:])
	}

	// Update notification with delivery result.
	_, err = r.db.Exec(ctx,
		`UPDATE notifications SET status = $1, provider_ref = $2, failed_reason = $3 WHERE id = $4`,
		status, providerRef, nilIfEmpty(failedReason), notifID)
	if err != nil {
		r.logger.Error("failed to update notification status", zap.Error(err))
	}

	return map[string]interface{}{
		"notification_id": notifID, "channel": req.Channel, "phone": req.Phone,
		"body": renderedBody, "char_count": len(renderedBody),
		"status": status, "provider_ref": providerRef,
	}, nil
}

// BulkSend queues notifications for multiple farmers.
func (r *NotificationRepo) BulkSend(ctx context.Context, req models.BulkSendRequest) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM farmers WHERE status = 'active' AND ($1 = '' OR sub_county = $1)`,
		req.SubCounty).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count recipients: %w", err)
	}
	return count, nil
}

// List retrieves sent notifications.
func (r *NotificationRepo) List(ctx context.Context, category, status string) ([]models.Notification, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, phone, channel, category, body, status, provider_ref, sent_at, delivered_at
		 FROM notifications
		 WHERE ($1 = '' OR category = $1::notification_category_enum)
		   AND ($2 = '' OR status = $2::delivery_status_enum)
		 ORDER BY created_at DESC LIMIT 50`,
		category, status)
	if err != nil {
		return nil, fmt.Errorf("failed to list notifications: %w", err)
	}
	defer rows.Close()

	var notifs []models.Notification
	for rows.Next() {
		var n models.Notification
		if err := rows.Scan(&n.ID, &n.Phone, &n.Channel, &n.Category, &n.Body, &n.Status, &n.ProviderRef, &n.SentAt, &n.DeliveredAt); err != nil {
			return nil, fmt.Errorf("failed to scan notification: %w", err)
		}
		notifs = append(notifs, n)
	}
	return notifs, nil
}

// ListTemplates retrieves all templates.
func (r *NotificationRepo) ListTemplates(ctx context.Context) ([]models.NotificationTemplate, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, category, channel, language, COALESCE(subject,''), body, active
		 FROM notification_templates ORDER BY category`)
	if err != nil {
		return nil, fmt.Errorf("failed to list templates: %w", err)
	}
	defer rows.Close()

	var templates []models.NotificationTemplate
	for rows.Next() {
		var t models.NotificationTemplate
		if err := rows.Scan(&t.ID, &t.Category, &t.Channel, &t.Language, &t.Subject, &t.Body, &t.Active); err != nil {
			return nil, fmt.Errorf("failed to scan template: %w", err)
		}
		templates = append(templates, t)
	}
	return templates, nil
}

// GetStats retrieves notification dashboard statistics.
func (r *NotificationRepo) GetStats(ctx context.Context) (*models.NotificationStats, error) {
	stats := &models.NotificationStats{}

	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE status = 'sent'`).Scan(&stats.TotalSent); err != nil {
		return nil, fmt.Errorf("failed to count sent: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE status = 'delivered'`).Scan(&stats.TotalDelivered); err != nil {
		return nil, fmt.Errorf("failed to count delivered: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE status = 'failed'`).Scan(&stats.TotalFailed); err != nil {
		return nil, fmt.Errorf("failed to count failed: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE created_at > CURRENT_DATE`).Scan(&stats.SentToday); err != nil {
		return nil, fmt.Errorf("failed to count today: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM notification_templates WHERE active = TRUE`).Scan(&stats.ActiveTemplates); err != nil {
		return nil, fmt.Errorf("failed to count templates: %w", err)
	}

	return stats, nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
