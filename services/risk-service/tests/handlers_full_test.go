package tests

import (
	"context"
	"fmt"
	"testing"

	"github.com/grainshield/risk-service/clients"
	"github.com/grainshield/risk-service/kafka"
	"go.uber.org/zap"
)


func TestCircuitBreaker_StartsClose(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cb := clients.NewCircuitBreaker("test", logger)
	if cb.State() != clients.CircuitClosed {
		t.Errorf("expected closed, got %s", cb.State())
	}
}

func TestCircuitBreaker_OpensAfterThreshold(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cb := clients.NewCircuitBreaker("test", logger)

	// Fail 5 times (default threshold)
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

	// Trip the breaker
	for i := 0; i < 5; i++ {
		_ = cb.Execute(func() error {
			return fmt.Errorf("fail")
		})
	}

	// Next call should be rejected immediately
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

func TestCircuitBreaker_ClosesOnSuccess(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cb := clients.NewCircuitBreaker("test", logger)

	// Succeed after being closed
	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if cb.State() != clients.CircuitClosed {
		t.Errorf("expected closed, got %s", cb.State())
	}
}


func TestIITAClient_NotConfiguredReturnsError(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	client := clients.NewIITAClient("", "", logger)

	if client.IsConfigured() {
		t.Error("client should not be configured with empty credentials")
	}
}

func TestIITAClient_ConfiguredWithCredentials(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	client := clients.NewIITAClient("https://api.iita.org", "test-key", logger)

	if !client.IsConfigured() {
		t.Error("client should be configured with valid credentials")
	}
}


func TestCopernicusClient_NotConfiguredReturnsUnconfirmed(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	client := clients.NewCopernicusClient("", "", logger)

	result, err := client.FetchWeatherConfirmation(context.Background(), "Kiminini", "2026-03-30")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result.Confirmed {
		t.Error("unconfigured client should return unconfirmed")
	}
}


func TestKMDClient_NotConfiguredReturnsDefault(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	client := clients.NewKMDClient("", "", logger)

	result, err := client.FetchSeasonalForecast(context.Background(), "Saboti")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if result.RainfallOutlook != "normal" {
		t.Errorf("expected normal forecast, got %s", result.RainfallOutlook)
	}
}


func TestKafkaProducer_NotConfigured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	p := kafka.NewProducer("", logger)

	if p.IsConfigured() {
		t.Error("producer should not be configured with empty brokers")
	}

	// Should not error when not configured (graceful no-op)
	err := p.PublishRiskScoreUpdated(context.Background(), kafka.RiskScoreUpdatedEvent{
		ScoreID:   "test-id",
		SubCounty: "Kiminini",
		RiskScore: 75,
		RiskLevel: "CRITICAL",
	})
	if err != nil {
		t.Errorf("expected no error for unconfigured producer, got %v", err)
	}
}

func TestKafkaProducer_Configured(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	p := kafka.NewProducer("localhost:9092", logger)

	if !p.IsConfigured() {
		t.Error("producer should be configured with brokers")
	}
}


func TestValidSubCounties(t *testing.T) {
	expected := map[string]bool{
		"Kiminini":   true,
		"Kwanza":     true,
		"Saboti":     true,
		"Endebess":   true,
		"Cherangany": true,
	}

	for _, sc := range clients.ValidSubCounties {
		if !expected[sc] {
			t.Errorf("unexpected sub-county: %s", sc)
		}
	}

	if len(clients.ValidSubCounties) != 5 {
		t.Errorf("expected 5 sub-counties, got %d", len(clients.ValidSubCounties))
	}
}
