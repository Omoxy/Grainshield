package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	kafkago "github.com/segmentio/kafka-go"
	"go.uber.org/zap"

	"github.com/grainshield/payment-service/models"
	"github.com/grainshield/payment-service/mpesa"
	"github.com/grainshield/payment-service/repository"
	"github.com/grainshield/pkg/middleware"
)

const (
	TopicPolicyTriggered  = "grainshield.policy.insurance.triggered"
	TopicPaymentCompleted = "grainshield.payment.disbursement.completed"
	TopicPaymentFailed    = "grainshield.payment.disbursement.failed"
	TopicPaymentDLQ       = "grainshield.payment.disbursement.dlq"
	ConsumerGroup         = "payment-service"
	maxRetryDelay         = 30 * time.Second
	baseRetryDelay        = 5 * time.Second
)

type Consumer struct {
	brokers     string
	repo        *repository.PaymentRepo
	mpesaClient *mpesa.Client
	audit       *middleware.AuditLogger
	logger      *zap.Logger
}

func NewConsumer(
	brokers string,
	repo *repository.PaymentRepo,
	mpesaClient *mpesa.Client,
	audit *middleware.AuditLogger,
	logger *zap.Logger,
) *Consumer {
	return &Consumer{
		brokers:     brokers,
		repo:        repo,
		mpesaClient: mpesaClient,
		audit:       audit,
		logger:      logger,
	}
}

func (c *Consumer) Start(ctx context.Context) {
	if c.brokers == "" {
		c.logger.Warn("kafka brokers not configured, consumer disabled")
		return
	}

	c.logger.Info("kafka consumer starting",
		zap.String("topic", TopicPolicyTriggered),
		zap.String("group", ConsumerGroup))

	reader := kafkago.NewReader(kafkago.ReaderConfig{
		Brokers:        []string{c.brokers},
		GroupID:        ConsumerGroup,
		Topic:          TopicPolicyTriggered,
		MinBytes:       1,
		MaxBytes:       10e6,
		MaxWait:        3 * time.Second,
		CommitInterval: time.Second,
		StartOffset:    kafkago.LastOffset,
	})
	defer reader.Close()

	for {
		msg, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				c.logger.Info("kafka consumer stopped (context cancelled)")
				return
			}
			c.logger.Error("kafka fetch error", zap.Error(err))
			time.Sleep(2 * time.Second)
			continue
		}

		c.logger.Info("received kafka message",
			zap.String("topic", msg.Topic),
			zap.Int("partition", msg.Partition),
			zap.Int64("offset", msg.Offset))

		if err := c.ProcessTriggerEvent(ctx, msg.Value); err != nil {
			c.logger.Error("failed to process trigger event",
				zap.Error(err),
				zap.Int64("offset", msg.Offset))
		}

		if err := reader.CommitMessages(ctx, msg); err != nil {
			c.logger.Error("failed to commit kafka offset", zap.Error(err))
		}
	}
}

func (c *Consumer) ProcessTriggerEvent(ctx context.Context, eventBytes []byte) error {
	var event models.PolicyTriggeredEvent
	if err := json.Unmarshal(eventBytes, &event); err != nil {
		c.logger.Error("failed to unmarshal trigger event", zap.Error(err))
		return fmt.Errorf("unmarshal failed: %w", err)
	}

	c.logger.Info("processing policy trigger event",
		zap.String("claim_id", event.ClaimID.String()),
		zap.String("farmer", event.FarmerGSNumber),
		zap.Float64("amount", event.PayoutAmount))

	disburseReq := models.DisburseRequest{
		FarmerID:       event.FarmerID.String(),
		FarmerGSNumber: event.FarmerGSNumber,
		Phone:          "",
		Amount:         event.PayoutAmount,
		ReferenceType:  "claim",
		ReferenceID:    event.ClaimID.String(),
	}

	idemKey := repository.GenerateIdempotencyKey(
		disburseReq.FarmerID, disburseReq.ReferenceType,
		disburseReq.ReferenceID, disburseReq.Amount,
	)

	existing, err := c.repo.CheckIdempotency(ctx, idemKey)
	if err != nil {
		c.logger.Error("idempotency check failed", zap.Error(err))
		return err
	}
	if existing != nil {
		c.logger.Info("duplicate trigger event, payment already exists",
			zap.String("payment_id", existing.ID.String()),
			zap.String("claim_id", event.ClaimID.String()))
		return nil
	}

	result, err := c.repo.DisburseWithDeadline(ctx, disburseReq, event.PayoutDeadline, idemKey)
	if err != nil {
		c.logger.Error("failed to create payment record", zap.Error(err))
		return err
	}

	paymentID := result["payment_id"].(uuid.UUID)

	c.audit.Log(ctx, "kafka-consumer", "payment:auto_initiate", "payment",
		paymentID.String(), map[string]interface{}{
			"claim_id":        event.ClaimID.String(),
			"trigger_type":    event.TriggerType,
			"amount":          event.PayoutAmount,
			"payout_deadline": event.PayoutDeadline.Format(time.RFC3339),
		})

	if c.mpesaClient.IsConfigured() {
		go c.initiateWithRetry(context.Background(), paymentID, disburseReq, event)
	}

	return nil
}

func (c *Consumer) initiateWithRetry(ctx context.Context, paymentID uuid.UUID, req models.DisburseRequest, event models.PolicyTriggeredEvent) {
	for attempt := 1; attempt <= models.MaxRetries; attempt++ {
		occasion := fmt.Sprintf("GS-CLAIM-%s", event.ClaimID.String()[:8])
		b2cResp, err := c.mpesaClient.InitiateB2C(ctx, req.Phone, req.Amount, occasion)

		c.audit.Log(ctx, "mpesa-client", "payment:b2c_attempt", "payment",
			paymentID.String(), map[string]interface{}{
				"attempt":    attempt,
				"success":    err == nil,
				"error_safe": safeError(err),
			})

		if err == nil && b2cResp != nil {
			if updateErr := c.repo.UpdateMpesaRequestID(ctx, paymentID, b2cResp.ConversationID); updateErr != nil {
				c.logger.Error("failed to update mpesa request ID", zap.Error(updateErr))
			}
			c.logger.Info("M-Pesa B2C initiated successfully",
				zap.String("payment_id", paymentID.String()),
				zap.String("conversation_id", b2cResp.ConversationID),
				zap.Int("attempt", attempt))
			return
		}

		c.logger.Warn("M-Pesa B2C attempt failed",
			zap.Int("attempt", attempt),
			zap.Int("max_retries", models.MaxRetries),
			zap.String("payment_id", paymentID.String()))

		if retryErr := c.repo.IncrementRetryCount(ctx, paymentID); retryErr != nil {
			c.logger.Error("failed to increment retry count", zap.Error(retryErr))
		}

		if attempt < models.MaxRetries {
			delay := retryDelay(attempt)
			c.logger.Info("retrying after delay",
				zap.Duration("delay", delay),
				zap.Int("next_attempt", attempt+1))
			time.Sleep(delay)
		}
	}

	c.logger.Error("M-Pesa B2C exhausted all retries, moving to DLQ",
		zap.String("payment_id", paymentID.String()),
		zap.String("claim_id", event.ClaimID.String()))

	if err := c.repo.MoveToDLQ(ctx, paymentID, "M-Pesa B2C failed after 3 attempts"); err != nil {
		c.logger.Error("failed to move to DLQ", zap.Error(err))
	}

	c.audit.Log(ctx, "mpesa-client", "payment:moved_to_dlq", "payment",
		paymentID.String(), map[string]interface{}{
			"claim_id":   event.ClaimID.String(),
			"amount":     req.Amount,
			"retries":    models.MaxRetries,
		})
}

func retryDelay(attempt int) time.Duration {
	delay := baseRetryDelay * (1 << (attempt - 1))
	if delay > maxRetryDelay {
		return maxRetryDelay
	}
	return delay
}

func safeError(err error) string {
	if err == nil {
		return ""
	}
	return "payment initiation failed"
}
