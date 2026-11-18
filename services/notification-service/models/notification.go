// Package models defines data structures for the notification-service.
package models

import (
	"time"

	"github.com/google/uuid"
)


// Notification represents a sent notification.
type Notification struct {
	ID          uuid.UUID  `json:"id"`
	Phone       string     `json:"phone"`
	Channel     string     `json:"channel"`
	Category    string     `json:"category"`
	Body        string     `json:"body"`
	Status      string     `json:"status"`
	ProviderRef string     `json:"provider_ref,omitempty"`
	SentAt      *time.Time `json:"sent_at,omitempty"`
	DeliveredAt *time.Time `json:"delivered_at,omitempty"`
}

// NotificationTemplate represents a message template.
type NotificationTemplate struct {
	ID       uuid.UUID `json:"id"`
	Category string    `json:"category"`
	Channel  string    `json:"channel"`
	Language string    `json:"language"`
	Subject  string    `json:"subject,omitempty"`
	Body     string    `json:"body"`
	Active   bool      `json:"active"`
}

// NotificationStats holds dashboard statistics.
type NotificationStats struct {
	TotalSent       int `json:"total_sent"`
	TotalDelivered  int `json:"total_delivered"`
	TotalFailed     int `json:"total_failed"`
	SentToday       int `json:"sent_today"`
	ActiveTemplates int `json:"active_templates"`
}


// SendNotificationRequest is the validated input for sending a notification.
type SendNotificationRequest struct {
	FarmerID  string            `json:"farmer_id"`
	Phone     string            `json:"phone" validate:"required,min=12,max=13"`
	Category  string            `json:"category" validate:"required"`
	Channel   string            `json:"channel" validate:"required,oneof=sms ussd push"`
	Variables map[string]string `json:"variables"`
}

// BulkSendRequest is the validated input for bulk send.
type BulkSendRequest struct {
	Category  string            `json:"category" validate:"required"`
	Channel   string            `json:"channel" validate:"required,oneof=sms ussd"`
	SubCounty string            `json:"sub_county"`
	Variables map[string]string `json:"variables"`
}
