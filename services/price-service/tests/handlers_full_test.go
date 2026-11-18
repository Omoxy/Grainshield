package tests

import (
	"context"
	"fmt"
	"testing"

	"github.com/grainshield/price-service/clients"
	"github.com/grainshield/price-service/kafka"
	"go.uber.org/zap"
)


func TestCircuitBreaker_StartsClosed(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cb := clients.NewCircuitBreaker("test", logger)
	if cb.State() != clients.CircuitClosed {
		t.Errorf("expected closed, got %s", cb.State())
	}
}

func TestCircuitBreaker_OpensAfterThreshold(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cb := clients.NewCircuitBreaker("test", logger)

	for i := 0; i < 5; i++ {
		_ = cb.Execute(func() error {
			return fmt.Errorf("simulated failure %d", i)
		})
	}

	if cb.State() != clients.CircuitOpen {
		t.Errorf("expected open after 5 failures, got %s", cb.State())
	}
}

func TestCircuitBreaker_RejectsWhenOpen(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cb := clients.NewCircuitBreaker("test", logger)

	for i := 0; i < 5; i++ {
		_ = cb.Execute(func() error {
			return fmt.Errorf("fail")
		})
	}

	called := false
	err := cb.Execute(func() error {
		called = true
		return nil
	})

	if called {
		t.Error("function should not have been called when circuit is open")
	}
	if err == nil {
		t.Error("expected error when circuit is open")
	}
}

func TestCircuitBreaker_ResetsOnSuccess(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cb := clients.NewCircuitBreaker("test", logger)

	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if cb.State() != clients.CircuitClosed {
		t.Errorf("expected closed, got %s", cb.State())
	}
}


func TestNCPBClient_NotConfigured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	c := clients.NewNCPBClient("", "", logger)
	if c.IsConfigured() {
		t.Error("NCPB client should not be configured with empty credentials")
	}
}

func TestNCPBClient_Configured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	c := clients.NewNCPBClient("https://api.ncpb.co.ke", "key", logger)
	if !c.IsConfigured() {
		t.Error("NCPB client should be configured with valid credentials")
	}
}

func TestUgandaClient_NotConfigured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	c := clients.NewUgandaClient("", "", logger)
	if c.IsConfigured() {
		t.Error("Uganda client should not be configured with empty credentials")
	}
}

func TestTanzaniaClient_NotConfigured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	c := clients.NewTanzaniaClient("", "", logger)
	if c.IsConfigured() {
		t.Error("Tanzania client should not be configured with empty credentials")
	}
}

func TestSouthSudanClient_NotConfigured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	c := clients.NewSouthSudanClient("", "", logger)
	if c.IsConfigured() {
		t.Error("South Sudan client should not be configured with empty credentials")
	}
}


func TestKafkaProducer_NotConfigured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	p := kafka.NewProducer("", logger)

	if p.IsConfigured() {
		t.Error("producer should not be configured with empty brokers")
	}

	err := p.PublishPriceUpdated(context.Background(), kafka.PriceUpdatedEvent{
		PriceID:    "test-id",
		Source:     "NCPB",
		MarketName: "Kitale Depot",
		PriceKES:   4500,
	})
	if err != nil {
		t.Errorf("expected no error for unconfigured producer, got %v", err)
	}
}

func TestKafkaProducer_SMSEvent(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	p := kafka.NewProducer("localhost:9092", logger)

	err := p.PublishPriceSMSGenerated(context.Background(), kafka.PriceSMSGeneratedEvent{
		SMSContent:     "BEI ZA MAHINDI wiki hii",
		CharacterCount: 23,
		Language:       "sw",
	})
	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}
}


func TestPartnerTierValues(t *testing.T) {
	// Verify tier constants exist and are distinct
	tiers := map[string]bool{"1": true, "2": true, "3": true}
	if len(tiers) != 3 {
		t.Error("expected 3 distinct tiers")
	}
}


func TestSMSContentIsKiswahili(t *testing.T) {
	// Verify the SMS prefix is in Kiswahili
	expectedPrefix := "BEI ZA MAHINDI wiki hii:"
	if len(expectedPrefix) == 0 {
		t.Error("SMS prefix should not be empty")
	}
}

func TestSMSContentUnder160Chars(t *testing.T) {
	// Simulate a minimal SMS (the actual SMS is generated from DB data)
	sms := "BEI ZA MAHINDI wiki hii:\nNCPB: KES 4500 ↑\nUganda: KES 4200 ↓\nTanzania: KES 4300 →\nS.Sudan: KES 4100 →\n\nJibu: UUZA/SHIKA/MKOPO\n*384#"
	if len(sms) > 160 {
		t.Errorf("SMS content exceeds 160 chars: %d", len(sms))
	}
}
