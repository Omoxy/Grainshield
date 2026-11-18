// Package repository implements database operations for the risk-service.
// Security Rule #3: Parameterised queries only.
package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/grainshield/risk-service/models"
)

// RiskRepo provides database operations for risk assessments.
type RiskRepo struct {
	db *pgxpool.Pool
}

// NewRiskRepo creates a new RiskRepo.
func NewRiskRepo(db *pgxpool.Pool) *RiskRepo {
	return &RiskRepo{db: db}
}

// GetAflatoxinRisk retrieves latest risk scores by sub-county.
func (r *RiskRepo) GetAflatoxinRisk(ctx context.Context, subCounty string) ([]models.AflatoxinScore, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT ON (sub_county) id, sub_county, risk_score, risk_level, COALESCE(contamination_ppb,0), confidence, model_version, recorded_at
		 FROM aflatoxin_scores
		 WHERE ($1 = '' OR sub_county = $1)
		 ORDER BY sub_county, recorded_at DESC`, subCounty)
	if err != nil {
		return nil, fmt.Errorf("failed to get aflatoxin risks: %w", err)
	}
	defer rows.Close()

	var scores []models.AflatoxinScore
	for rows.Next() {
		var s models.AflatoxinScore
		if err := rows.Scan(&s.ID, &s.SubCounty, &s.RiskScore, &s.RiskLevel, &s.ContaminationPPB, &s.Confidence, &s.ModelVersion, &s.RecordedAt); err != nil {
			return nil, fmt.Errorf("failed to scan score: %w", err)
		}
		scores = append(scores, s)
	}
	return scores, nil
}

// IngestAflatoxinScore inserts a new aflatoxin risk score.
func (r *RiskRepo) IngestAflatoxinScore(ctx context.Context, req models.IngestScoreRequest, recordedAt time.Time, riskLevel string) (uuid.UUID, error) {
	id := uuid.New()
	_, err := r.db.Exec(ctx,
		`INSERT INTO aflatoxin_scores (id, sub_county, risk_score, risk_level, contamination_ppb, confidence, model_version, season, recorded_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, req.SubCounty, req.RiskScore, riskLevel, req.ContaminationPPB, req.Confidence, req.ModelVersion, req.Season, recordedAt)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to ingest score: %w", err)
	}
	return id, nil
}

// IngestSensorReading inserts a new IoT sensor reading.
func (r *RiskRepo) IngestSensorReading(ctx context.Context, warehouseID uuid.UUID, req models.SensorReadingRequest, recordedAt time.Time, alertTriggered bool) (uuid.UUID, error) {
	id := uuid.New()
	_, err := r.db.Exec(ctx,
		`INSERT INTO sensor_readings (id, warehouse_id, sensor_id, sensor_type, value, unit, alert_triggered, recorded_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, warehouseID, req.SensorID, req.SensorType, req.Value, req.Unit, alertTriggered, recordedAt)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to ingest sensor reading: %w", err)
	}
	return id, nil
}

// CheckHumidityThreshold checks if humidity has been above 80% for 48 hours.
func (r *RiskRepo) CheckHumidityThreshold(ctx context.Context, warehouseID uuid.UUID) (int, error) {
	var consecutiveHours int
	err := r.db.QueryRow(ctx,
		`SELECT EXTRACT(EPOCH FROM (NOW() - MIN(recorded_at)))/3600
		 FROM sensor_readings
		 WHERE warehouse_id = $1 AND sensor_type = 'humidity' AND value > 80
		   AND recorded_at > NOW() - INTERVAL '48 hours'`, warehouseID,
	).Scan(&consecutiveHours)
	if err != nil {
		return 0, fmt.Errorf("failed to check humidity threshold: %w", err)
	}
	return consecutiveHours, nil
}

// GetSensorData retrieves sensor readings for a warehouse.
func (r *RiskRepo) GetSensorData(ctx context.Context, warehouseID uuid.UUID, hours int) ([]models.SensorReading, error) {
	rows, err := r.db.Query(ctx,
		`SELECT sensor_id, sensor_type, value, unit, alert_triggered, recorded_at
		 FROM sensor_readings
		 WHERE warehouse_id = $1 AND recorded_at > NOW() - $2 * INTERVAL '1 hour'
		 ORDER BY recorded_at DESC`, warehouseID, hours)
	if err != nil {
		return nil, fmt.Errorf("failed to get sensor data: %w", err)
	}
	defer rows.Close()

	var readings []models.SensorReading
	for rows.Next() {
		var rd models.SensorReading
		if err := rows.Scan(&rd.SensorID, &rd.SensorType, &rd.Value, &rd.Unit, &rd.AlertTriggered, &rd.RecordedAt); err != nil {
			return nil, fmt.Errorf("failed to scan reading: %w", err)
		}
		readings = append(readings, rd)
	}
	return readings, nil
}

// IngestWeather inserts a new weather data point.
func (r *RiskRepo) IngestWeather(ctx context.Context, req models.WeatherRequest, recordedAt time.Time) (uuid.UUID, error) {
	id := uuid.New()
	_, err := r.db.Exec(ctx,
		`INSERT INTO weather_data (id, sub_county, temperature, humidity, rainfall_mm, wind_speed_kph, weather_event, event_type, satellite_ref, recorded_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		id, req.SubCounty, req.Temperature, req.Humidity, req.RainfallMM, req.WindSpeedKPH, req.WeatherEvent, req.EventType, req.SatelliteRef, recordedAt)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to ingest weather: %w", err)
	}
	return id, nil
}

// GetDashboard retrieves combined risk dashboard data.
func (r *RiskRepo) GetDashboard(ctx context.Context) ([]models.SubCountyRisk, int, int, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT ON (sub_county) sub_county, risk_score, risk_level
		 FROM aflatoxin_scores ORDER BY sub_county, recorded_at DESC`)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("failed to get dashboard risks: %w", err)
	}
	defer rows.Close()

	var risks []models.SubCountyRisk
	for rows.Next() {
		var risk models.SubCountyRisk
		if err := rows.Scan(&risk.SubCounty, &risk.Score, &risk.Level); err != nil {
			return nil, 0, 0, fmt.Errorf("failed to scan risk: %w", err)
		}
		risks = append(risks, risk)
	}

	var activeAlerts int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM sensor_readings WHERE alert_triggered = TRUE AND recorded_at > NOW() - INTERVAL '24 hours'`).Scan(&activeAlerts); err != nil {
		return nil, 0, 0, fmt.Errorf("failed to count alerts: %w", err)
	}

	var weatherEvents int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM weather_data WHERE weather_event = TRUE AND recorded_at > CURRENT_DATE - INTERVAL '7 days'`).Scan(&weatherEvents); err != nil {
		return nil, 0, 0, fmt.Errorf("failed to count weather events: %w", err)
	}

	return risks, activeAlerts, weatherEvents, nil
}
