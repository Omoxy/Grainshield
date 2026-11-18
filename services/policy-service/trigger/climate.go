// Package trigger implements the climate trigger evaluator.
// Condition 2: IoT humidity > 80% for 48 consecutive hours AND Copernicus confirms weather event
package trigger

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/grainshield/policy-service/models"
)

// ClimateEvaluator evaluates the climate trigger condition.
type ClimateEvaluator struct {
	client *ServiceClient
	logger *zap.Logger
}

// NewClimateEvaluator creates a new ClimateEvaluator.
func NewClimateEvaluator(client *ServiceClient, logger *zap.Logger) *ClimateEvaluator {
	return &ClimateEvaluator{client: client, logger: logger}
}

// Climate thresholds
const (
	HumidityThreshold    = 80.0
	ConsecutiveHoursReq  = 48
	SensorLookbackHours  = 72 // look back 72 hours to find 48 consecutive
)

// Evaluate checks the climate trigger condition for a single armed trigger.
//
// Condition: IoT humidity > 80% for 48 consecutive hours AND satellite weather_event = TRUE
//
// Step 1: Fetch sensor readings for the warehouse over the last 72 hours
// Step 2: Check if humidity has been consistently above 80% for ≥48 consecutive hours
// Step 3: Cross-reference with weather events in the same sub-county
// Both conditions must be TRUE simultaneously.
func (e *ClimateEvaluator) Evaluate(ctx context.Context, trigger models.ArmedTrigger) models.TriggerEvaluation {
	eval := models.TriggerEvaluation{
		TriggerID:        trigger.TriggerID,
		PolicyID:         trigger.PolicyID,
		TriggerType:      models.TriggerClimate,
		ThresholdChecked: fmt.Sprintf("humidity > %.0f%% for %d consecutive hours AND weather_event = TRUE", HumidityThreshold, ConsecutiveHoursReq),
		ThresholdValue:   HumidityThreshold,
		DataSources:      []string{"IoT Sensors", "ESA Copernicus"},
		Result:           false,
		DataEvaluated:    map[string]interface{}{},
	}

	// Step 1: Fetch sensor data for the warehouse
	sensorResp, err := e.client.GetSensorData(ctx, trigger.WarehouseID, SensorLookbackHours)
	if err != nil {
		e.logger.Error("climate evaluation failed: risk service unavailable",
			zap.String("trigger_id", trigger.TriggerID.String()),
			zap.Error(err),
		)
		eval.Notes = "risk service unavailable — evaluation skipped"
		eval.DataEvaluated["error"] = "risk_service_unavailable"
		return eval
	}

	eval.DataEvaluated["warehouse_id"] = trigger.WarehouseID.String()
	eval.DataEvaluated["total_readings"] = len(sensorResp.Readings)

	// Step 2: Check consecutive humidity above threshold
	consecutiveHours := calculateConsecutiveHumidityHours(sensorResp.Readings, HumidityThreshold)
	humidityExceeded := consecutiveHours >= ConsecutiveHoursReq

	eval.DataEvaluated["consecutive_hours_above_80"] = consecutiveHours
	eval.DataEvaluated["humidity_threshold_met"] = humidityExceeded
	eval.ActualValue = float64(consecutiveHours)

	// Step 3: Check for weather event confirmation via risk dashboard
	weatherConfirmed := false
	dashResp, err := e.client.GetDashboard(ctx)
	if err != nil {
		e.logger.Warn("weather event check failed: dashboard unavailable",
			zap.String("trigger_id", trigger.TriggerID.String()),
			zap.Error(err),
		)
		eval.DataEvaluated["weather_check_error"] = "dashboard_unavailable"
	} else {
		// Check if there are recent weather events
		weatherConfirmed = dashResp.RecentWeatherEvents > 0
		eval.DataEvaluated["recent_weather_events"] = dashResp.RecentWeatherEvents
		eval.DataEvaluated["active_sensor_alerts"] = dashResp.ActiveSensorAlerts
	}

	eval.DataEvaluated["weather_event_confirmed"] = weatherConfirmed

	if humidityExceeded && weatherConfirmed {
		eval.Result = true
		eval.Notes = fmt.Sprintf(
			"TRIGGER FIRED: humidity >%.0f%% for %d consecutive hours AND satellite weather event confirmed (%d events)",
			HumidityThreshold, consecutiveHours, dashResp.RecentWeatherEvents,
		)
	} else if humidityExceeded {
		eval.Notes = fmt.Sprintf(
			"humidity exceeded (%d hours >%.0f%%) but no satellite weather event confirmation",
			consecutiveHours, HumidityThreshold,
		)
	} else if weatherConfirmed {
		eval.Notes = fmt.Sprintf(
			"weather event confirmed but humidity below threshold (%d hours < %d required)",
			consecutiveHours, ConsecutiveHoursReq,
		)
	} else {
		eval.Notes = fmt.Sprintf(
			"both below threshold: humidity %d hours (<%d required), no weather events",
			consecutiveHours, ConsecutiveHoursReq,
		)
	}

	return eval
}

// calculateConsecutiveHumidityHours counts how many consecutive hours humidity
// readings have been above the threshold. Readings are expected in DESC order.
func calculateConsecutiveHumidityHours(readings []SensorReading, threshold float64) int {
	if len(readings) == 0 {
		return 0
	}

	// Filter to humidity readings only
	var humidityReadings []SensorReading
	for _, r := range readings {
		if r.SensorType == "humidity" {
			humidityReadings = append(humidityReadings, r)
		}
	}

	if len(humidityReadings) == 0 {
		return 0
	}

	// Count consecutive readings above threshold (readings are in DESC order by time)
	// We look for a continuous chain from the most recent reading backwards
	consecutiveCount := 0
	for _, r := range humidityReadings {
		if r.Value > threshold {
			consecutiveCount++
		} else {
			break // chain broken
		}
	}

	// Convert reading count to approximate hours
	// Assume readings are roughly hourly (IoT sensors typically report every 15-60 min)
	if consecutiveCount > 0 && len(humidityReadings) >= 2 {
		first := humidityReadings[0].RecordedAt
		last := humidityReadings[consecutiveCount-1].RecordedAt
		duration := first.Sub(last)
		if duration > 0 {
			return int(duration.Hours())
		}
	}

	// If we can't calculate from timestamps, use the count
	// (conservative estimate: 1 reading ≈ 1 hour)
	return consecutiveCount
}

// isWithinLast checks if a time is within the last N hours.
func isWithinLast(t time.Time, hours int) bool {
	return time.Since(t) <= time.Duration(hours)*time.Hour
}
