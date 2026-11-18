package kafka

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	kafkago "github.com/segmentio/kafka-go"
	"go.uber.org/zap"

	"github.com/grainshield/payment-service/models"
)

type Producer struct {
	brokers string
	writer  *kafkago.Writer
	logger  *zap.Logger
}

func NewProducer(brokers string, logger *zap.Logger) *Producer {
	p := &Producer{
		brokers: brokers,
		logger:  logger,
	}

	if brokers != "" {
		p.writer = &kafkago.Writer{
			Addr:         kafkago.TCP(brokers),
			Balancer:     &kafkago.LeastBytes{},
			BatchTimeout: 50 * time.Millisecond,
			RequiredAcks: kafkago.RequireOne,
		}
	}

	return p
}

func (p *Producer) IsConfigured() bool {
	return p.brokers != "" && p.writer != nil
}

func (p *Producer) Close() error {
	if p.writer != nil {
		return p.writer.Close()
	}
	return nil
}

func (p *Producer) PublishPaymentCompleted(ctx context.Context, event models.PaymentCompletedEvent) error {
	return p.publish(ctx, TopicPaymentCompleted, event.PaymentID.String(), event)
}

func (p *Producer) PublishPaymentFailed(ctx context.Context, event models.PaymentFailedEvent) error {
	return p.publish(ctx, TopicPaymentFailed, event.PaymentID.String(), event)
}

func (p *Producer) PublishToDLQ(ctx context.Context, event models.PaymentFailedEvent) error {
	return p.publish(ctx, TopicPaymentDLQ, event.PaymentID.String(), event)
}

func (p *Producer) publish(ctx context.Context, topic string, key string, payload interface{}) error {
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

	if key == "" {
		key = uuid.New().String()
	}

	msg := kafkago.Message{
		Topic: topic,
		Key:   []byte(key),
		Value: data,
	}

	if err := p.writer.WriteMessages(ctx, msg); err != nil {
		p.logger.Error("failed to publish kafka event",
			zap.String("topic", topic),
			zap.Error(err))
		return err
	}

	p.logger.Info("kafka event published",
		zap.String("topic", topic),
		zap.String("key", key),
		zap.Int("payload_bytes", len(data)))

	return nil
}
