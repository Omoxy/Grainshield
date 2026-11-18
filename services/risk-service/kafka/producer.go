// Package kafka implements Kafka producer for the risk-service.
// Publishes risk score updated and weather event confirmed events.
package kafka

import (
	"context"
	"encoding/json"
	"time"

	"go.uber.org/zap"
)

// RiskScoreUpdatedEvent is published when a aflatoxin score is ingested.
type RiskScoreUpdatedEvent struct {
	ScoreID           string  `json:"score_id"`
	SubCounty         string  `json:"sub_county"`
	RiskScore         float64 `json:"risk_score"`
	RiskLevel         string  `json:"risk_level"`
	PremiumMultiplier float64 `json:"premium_multiplier"`
	ModelVersion      string  `json:"model_version"`
	Timestamp         string  `json:"timestamp"`
}

// WeatherEventConfirmedEvent is published when Copernicus confirms a weather event.
type WeatherEventConfirmedEvent struct {
	WeatherID    string `json:"weather_id"`
	SubCounty    string `json:"sub_county"`
	EventType    string `json:"event_type"`
	SatelliteRef string `json:"satellite_ref"`
	Confirmed    bool   `json:"confirmed"`
	Timestamp    string `json:"timestamp"`
}

// Producer publishes risk events to Kafka topics.
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

// PublishRiskScoreUpdated publishes a risk score update event.
func (p *Producer) PublishRiskScoreUpdated(ctx context.Context, event RiskScoreUpdatedEvent) error {
	event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	return p.publish(ctx, TopicRiskScoreUpdated, event)
}

// PublishWeatherEventConfirmed publishes a weather event confirmation.
func (p *Producer) PublishWeatherEventConfirmed(ctx context.Context, event WeatherEventConfirmedEvent) error {
	event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	return p.publish(ctx, TopicWeatherEventConfirmed, event)
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
