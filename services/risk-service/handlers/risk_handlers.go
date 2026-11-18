// Package handlers implements HTTP handlers for the risk-service.
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/grainshield/pkg/httputil"
	"github.com/grainshield/pkg/middleware"
	"github.com/grainshield/risk-service/clients"
	"github.com/grainshield/risk-service/kafka"
	"github.com/grainshield/risk-service/models"
	"github.com/grainshield/risk-service/premium"
	"github.com/grainshield/risk-service/repository"
)

var validate = validator.New()

// RiskHandlers holds dependencies for all HTTP handlers.
type RiskHandlers struct {
	repo       *repository.RiskRepo
	audit      *middleware.AuditLogger
	logger     *zap.Logger
	producer   *kafka.Producer
	iita       *clients.IITAClient
	copernicus *clients.CopernicusClient
	kmd        *clients.KMDClient
}

// NewRiskHandlers creates a new RiskHandlers instance.
func NewRiskHandlers(
	repo *repository.RiskRepo,
	audit *middleware.AuditLogger,
	logger *zap.Logger,
	producer *kafka.Producer,
	iita *clients.IITAClient,
	copernicus *clients.CopernicusClient,
	kmd *clients.KMDClient,
) *RiskHandlers {
	return &RiskHandlers{
		repo:       repo,
		audit:      audit,
		logger:     logger,
		producer:   producer,
		iita:       iita,
		copernicus: copernicus,
		kmd:        kmd,
	}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	httputil.RespondJSON(w, status, data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	httputil.RespondError(w, status, message)
}


func (h *RiskHandlers) GetAflatoxinRisk(w http.ResponseWriter, r *http.Request) {
	subCounty := r.URL.Query().Get("sub_county")

	scores, err := h.repo.GetAflatoxinRisk(r.Context(), subCounty)
	if err != nil {
		h.logger.Error("failed to get risk scores", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	alertCount := 0
	enrichedScores := make([]map[string]interface{}, 0, len(scores))
	for _, s := range scores {
		if s.RiskScore > 70 {
			alertCount++
		}
		enrichedScores = append(enrichedScores, map[string]interface{}{
			"id":                s.ID,
			"sub_county":        s.SubCounty,
			"risk_score":        s.RiskScore,
			"risk_level":        s.RiskLevel,
			"contamination_ppb": s.ContaminationPPB,
			"confidence":        s.Confidence,
			"model_version":     s.ModelVersion,
			"recorded_at":       s.RecordedAt,
			"premium_multiplier": premium.CalculatePremiumMultiplier(s.RiskScore),
		})
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"scores":      enrichedScores,
		"alert_count": alertCount,
		"threshold":   70,
		"model":       "IITA A-EWS Gradient Boosting v2.1",
		"updated_at":  time.Now(),
	})
}


func (h *RiskHandlers) IngestAflatoxinScore(w http.ResponseWriter, r *http.Request) {
	var req models.IngestScoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.SubCounty = middleware.SanitizeString(req.SubCounty, 50)
	req.ModelVersion = middleware.SanitizeString(req.ModelVersion, 20)
	req.Season = middleware.SanitizeString(req.Season, 20)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	recordedAt, err := time.Parse("2006-01-02", req.RecordedAt)
	if err != nil {
		respondError(w, http.StatusBadRequest, "recorded_at must be YYYY-MM-DD")
		return
	}

	riskLevel := "LOW"
	if req.RiskScore > 70 {
		riskLevel = "CRITICAL"
	} else if req.RiskScore > 50 {
		riskLevel = "HIGH"
	} else if req.RiskScore > 30 {
		riskLevel = "MODERATE"
	}

	id, err := h.repo.IngestAflatoxinScore(r.Context(), req, recordedAt, riskLevel)
	if err != nil {
		h.logger.Error("failed to ingest score", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "risk:ingest_aflatoxin", "aflatoxin_score", id.String(), map[string]interface{}{
		"sub_county": req.SubCounty, "score": req.RiskScore, "level": riskLevel,
	})

	// Publish Kafka event
	if h.producer != nil {
		multiplier := premium.CalculatePremiumMultiplier(req.RiskScore)
		_ = h.producer.PublishRiskScoreUpdated(r.Context(), kafka.RiskScoreUpdatedEvent{
			ScoreID:           id.String(),
			SubCounty:         req.SubCounty,
			RiskScore:         req.RiskScore,
			RiskLevel:         riskLevel,
			PremiumMultiplier: multiplier,
			ModelVersion:      req.ModelVersion,
		})
	}

	response := map[string]interface{}{
		"id":                 id,
		"risk_level":         riskLevel,
		"premium_multiplier": premium.CalculatePremiumMultiplier(req.RiskScore),
		"ingested":           true,
	}
	if req.RiskScore > 70 {
		response["alert"] = true
		response["alert_message"] = fmt.Sprintf(
			"TAHADHARI: Hatari ya aflatoxin katika %s ni %.0f/100. Chunguza nafaka zako.",
			req.SubCounty, req.RiskScore,
		)
	}

	respondJSON(w, http.StatusCreated, response)
}


func (h *RiskHandlers) IngestSensorReading(w http.ResponseWriter, r *http.Request) {
	var req models.SensorReadingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.SensorID = middleware.SanitizeString(req.SensorID, 50)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	warehouseID, err := uuid.Parse(req.WarehouseID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid warehouse_id")
		return
	}

	recordedAt, err := time.Parse(time.RFC3339, req.RecordedAt)
	if err != nil {
		respondError(w, http.StatusBadRequest, "recorded_at must be RFC3339 format")
		return
	}

	alertTriggered := false
	if req.SensorType == "humidity" && req.Value > 80 {
		alertTriggered = true
	} else if req.SensorType == "temperature" && req.Value > 35 {
		alertTriggered = true
	} else if req.SensorType == "moisture" && req.Value > 14 {
		alertTriggered = true
	}

	id, err := h.repo.IngestSensorReading(r.Context(), warehouseID, req, recordedAt, alertTriggered)
	if err != nil {
		h.logger.Error("failed to ingest sensor data", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "risk:ingest_sensor", "sensor_reading", id.String(), map[string]interface{}{
		"sensor_id": req.SensorID, "type": req.SensorType, "value": req.Value, "alert": alertTriggered,
	})

	response := map[string]interface{}{"id": id, "alert_triggered": alertTriggered}

	if alertTriggered && req.SensorType == "humidity" {
		hours, err := h.repo.CheckHumidityThreshold(r.Context(), warehouseID)
		if err == nil && hours >= 48 {
			response["climate_trigger_eligible"] = true
			response["consecutive_hours_above_threshold"] = hours
		}
	}

	respondJSON(w, http.StatusCreated, response)
}


func (h *RiskHandlers) GetSensorData(w http.ResponseWriter, r *http.Request) {
	whID := chi.URLParam(r, "warehouseId")
	warehouseID, err := uuid.Parse(whID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid warehouse ID")
		return
	}

	hours, _ := strconv.Atoi(r.URL.Query().Get("hours"))
	if hours < 1 {
		hours = 24
	}
	if hours > 168 {
		hours = 168
	}

	readings, err := h.repo.GetSensorData(r.Context(), warehouseID, hours)
	if err != nil {
		h.logger.Error("failed to get sensor data", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"warehouse_id": warehouseID, "readings": readings, "period_hours": hours,
	})
}


func (h *RiskHandlers) IngestWeather(w http.ResponseWriter, r *http.Request) {
	var req models.WeatherRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.SubCounty = middleware.SanitizeString(req.SubCounty, 50)
	req.EventType = middleware.SanitizeString(req.EventType, 50)
	req.SatelliteRef = middleware.SanitizeString(req.SatelliteRef, 100)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	recordedAt, err := time.Parse("2006-01-02", req.RecordedAt)
	if err != nil {
		respondError(w, http.StatusBadRequest, "recorded_at must be YYYY-MM-DD")
		return
	}

	// Attempt satellite confirmation via Copernicus
	var satelliteRef string
	if h.copernicus != nil && req.WeatherEvent {
		confirmation, err := h.copernicus.FetchWeatherConfirmation(
			r.Context(), req.SubCounty, req.RecordedAt,
		)
		if err == nil && confirmation.Confirmed {
			satelliteRef = confirmation.SatelliteRef
			req.SatelliteRef = satelliteRef
		}
	}

	id, err := h.repo.IngestWeather(r.Context(), req, recordedAt)
	if err != nil {
		h.logger.Error("failed to ingest weather", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "risk:ingest_weather", "weather_data", id.String(), map[string]interface{}{
		"sub_county": req.SubCounty, "event": req.WeatherEvent,
	})

	// Publish Kafka event if weather event confirmed
	if h.producer != nil && req.WeatherEvent {
		_ = h.producer.PublishWeatherEventConfirmed(r.Context(), kafka.WeatherEventConfirmedEvent{
			WeatherID:    id.String(),
			SubCounty:    req.SubCounty,
			EventType:    req.EventType,
			SatelliteRef: satelliteRef,
			Confirmed:    satelliteRef != "",
		})
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"id":             id,
		"weather_event":  req.WeatherEvent,
		"satellite_ref":  satelliteRef,
		"sat_confirmed":  satelliteRef != "",
	})
}


func (h *RiskHandlers) GetDashboard(w http.ResponseWriter, r *http.Request) {
	risks, alerts, events, err := h.repo.GetDashboard(r.Context())
	if err != nil {
		h.logger.Error("failed to get dashboard", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Enrich with premium multipliers
	enrichedRisks := make([]map[string]interface{}, 0, len(risks))
	for _, risk := range risks {
		enrichedRisks = append(enrichedRisks, map[string]interface{}{
			"sub_county":        risk.SubCounty,
			"score":             risk.Score,
			"level":             risk.Level,
			"premium_multiplier": premium.CalculatePremiumMultiplier(risk.Score),
		})
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"aflatoxin_risks":       enrichedRisks,
		"active_sensor_alerts":  alerts,
		"recent_weather_events": events,
	})
}


// GetPremiumMultipliers returns current premium multipliers per sub-county.
func (h *RiskHandlers) GetPremiumMultipliers(w http.ResponseWriter, r *http.Request) {
	scores, err := h.repo.GetAflatoxinRisk(r.Context(), "")
	if err != nil {
		h.logger.Error("failed to get scores for premium", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	multipliers := make([]map[string]interface{}, 0, len(scores))
	for _, s := range scores {
		multipliers = append(multipliers, map[string]interface{}{
			"sub_county":        s.SubCounty,
			"risk_score":        s.RiskScore,
			"risk_level":        s.RiskLevel,
			"premium_multiplier": premium.CalculatePremiumMultiplier(s.RiskScore),
			"example_500_kes":   premium.CalculatePremium(500, s.RiskScore),
		})
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"multipliers": multipliers,
		"bands": map[string]interface{}{
			"0_to_40":   "1.00x (base)",
			"41_to_70":  "1.15x (+15%)",
			"71_to_100": "1.35x (+35%)",
		},
	})
}
