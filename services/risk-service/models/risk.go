// Package models defines data structures for the risk-service.
package models

import (
	"time"

	"github.com/google/uuid"
)


// AflatoxinScore represents an aflatoxin risk score.
type AflatoxinScore struct {
	ID               uuid.UUID `json:"id"`
	SubCounty        string    `json:"sub_county"`
	RiskScore        float64   `json:"risk_score"`
	RiskLevel        string    `json:"risk_level"`
	ContaminationPPB float64   `json:"contamination_ppb"`
	Confidence       float64   `json:"confidence"`
	ModelVersion     string    `json:"model_version"`
	RecordedAt       time.Time `json:"recorded_at"`
}

// SensorReading represents an IoT sensor reading.
type SensorReading struct {
	SensorID       string    `json:"sensor_id"`
	SensorType     string    `json:"sensor_type"`
	Value          float64   `json:"value"`
	Unit           string    `json:"unit"`
	AlertTriggered bool      `json:"alert_triggered"`
	RecordedAt     time.Time `json:"recorded_at"`
}

// SubCountyRisk is used in dashboard responses.
type SubCountyRisk struct {
	SubCounty string  `json:"sub_county"`
	Score     float64 `json:"score"`
	Level     string  `json:"level"`
}


// IngestScoreRequest is the validated input for aflatoxin score ingestion.
type IngestScoreRequest struct {
	SubCounty        string  `json:"sub_county" validate:"required,max=50"`
	RiskScore        float64 `json:"risk_score" validate:"required,gte=0,lte=100"`
	ContaminationPPB float64 `json:"contamination_ppb" validate:"gte=0"`
	Confidence       float64 `json:"confidence" validate:"gte=0,lte=100"`
	ModelVersion     string  `json:"model_version" validate:"required,max=20"`
	Season           string  `json:"season" validate:"max=20"`
	RecordedAt       string  `json:"recorded_at" validate:"required"`
}

// SensorReadingRequest is the validated input for sensor data.
type SensorReadingRequest struct {
	WarehouseID string  `json:"warehouse_id" validate:"required"`
	SensorID    string  `json:"sensor_id" validate:"required,max=50"`
	SensorType  string  `json:"sensor_type" validate:"required,oneof=humidity temperature moisture"`
	Value       float64 `json:"value" validate:"required"`
	Unit        string  `json:"unit" validate:"required,max=10"`
	RecordedAt  string  `json:"recorded_at" validate:"required"`
}

// WeatherRequest is the validated input for weather data.
type WeatherRequest struct {
	SubCounty    string  `json:"sub_county" validate:"required,max=50"`
	Temperature  float64 `json:"temperature"`
	Humidity     float64 `json:"humidity"`
	RainfallMM   float64 `json:"rainfall_mm"`
	WindSpeedKPH float64 `json:"wind_speed_kph"`
	WeatherEvent bool    `json:"weather_event"`
	EventType    string  `json:"event_type" validate:"max=50"`
	SatelliteRef string  `json:"satellite_ref" validate:"max=100"`
	RecordedAt   string  `json:"recorded_at" validate:"required"`
}
