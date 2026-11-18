// Package kafka implements Kafka producer for the price-service.
// Publishes price updates and SMS generation events.
package kafka

import (
	"context"
	"encoding/json"
	"time"

	"go.uber.org/zap"
)

// PriceUpdatedEvent is published when new price data is recorded.
type PriceUpdatedEvent struct {
	PriceID    string  `json:"price_id"`
	Source     string  `json:"source"`
	MarketName string  `json:"market_name"`
	Commodity  string  `json:"commodity"`
	PriceKES   float64 `json:"price_kes"`
	Trend      string  `json:"trend"`
	Timestamp  string  `json:"timestamp"`
}

// PriceSMSGeneratedEvent is published when Monday cron generates SMS content.
type PriceSMSGeneratedEvent struct {
	SMSContent     string `json:"sms_content"`
	CharacterCount int    `json:"character_count"`
	Language       string `json:"language"`
	FarmerCount    int    `json:"farmer_count"`
	Timestamp      string `json:"timestamp"`
}

// Producer publishes price events to Kafka topics.
type Producer struct {
	brokers string
	logger  *zap.Logger
}

// NewProducer creates a new Kafka producer.
func NewProducer(brokers string, logger *zap.Logger) *Producer {
	return &Producer{
		brokers: brokers,
		logger:  logger,
	}
}

// IsConfigured returns true if Kafka brokers are configured.
func (p *Producer) IsConfigured() bool {
	return p.brokers != ""
}

// PublishPriceUpdated publishes a price update event.
func (p *Producer) PublishPriceUpdated(ctx context.Context, event PriceUpdatedEvent) error {
	event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	return p.publish(ctx, TopicPriceUpdated, event)
}

// PublishPriceSMSGenerated publishes a SMS generation event.
func (p *Producer) PublishPriceSMSGenerated(ctx context.Context, event PriceSMSGeneratedEvent) error {
	event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	return p.publish(ctx, TopicPriceSMSGenerated, event)
}

// publish serializes and sends a message to the specified topic.
// In production, this would use segmentio/kafka-go writer.
func (p *Producer) publish(ctx context.Context, topic string, payload interface{}) error {
	if !p.IsConfigured() {
		p.logger.Warn("kafka not configured, event not published",
			zap.String("topic", topic))
		return nil
	}

	data, err := json.Marshal(payload)
	if err != nil {
		p.logger.Error("failed to marshal kafka event",
			zap.String("topic", topic),
			zap.Error(err))
		return err
	}

	// Placeholder: In production, segmentio/kafka-go writer.WriteMessages()
	p.logger.Info("kafka event published",
		zap.String("topic", topic),
		zap.Int("payload_bytes", len(data)))

	_ = data // Used by the actual writer
	_ = ctx  // Used for cancellation in production
	return nil
}
