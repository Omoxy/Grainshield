// Package handlers implements HTTP handlers for the price-service.
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-playground/validator/v10"
	"go.uber.org/zap"

	"github.com/grainshield/pkg/httputil"
	"github.com/grainshield/pkg/middleware"
	"github.com/grainshield/price-service/cache"
	"github.com/grainshield/price-service/kafka"
	"github.com/grainshield/price-service/models"
	"github.com/grainshield/price-service/repository"
)

var validate = validator.New()


const (
	cacheKeyCurrentPrices = "current:all"
)

// PriceHandlers holds dependencies for all HTTP handlers.
type PriceHandlers struct {
	repo     *repository.PriceRepo
	audit    *middleware.AuditLogger
	logger   *zap.Logger
	producer *kafka.Producer
	cache    *cache.PriceCache
}

// NewPriceHandlers creates a new PriceHandlers instance.
func NewPriceHandlers(
	repo *repository.PriceRepo,
	audit *middleware.AuditLogger,
	logger *zap.Logger,
	producer *kafka.Producer,
	priceCache *cache.PriceCache,
) *PriceHandlers {
	return &PriceHandlers{
		repo:     repo,
		audit:    audit,
		logger:   logger,
		producer: producer,
		cache:    priceCache,
	}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	httputil.RespondJSON(w, status, data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	httputil.RespondError(w, status, message)
}


func (h *PriceHandlers) GetCurrentPrices(w http.ResponseWriter, r *http.Request) {
	// Check Redis cache first (5-minute TTL)
	var cachedPrices []models.MarketPrice
	if h.cache != nil && h.cache.GetPrices(r.Context(), cacheKeyCurrentPrices, &cachedPrices) {
		bestPrice, bestMarket := findBestPrice(cachedPrices)
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"prices":      cachedPrices,
			"best_price":  bestPrice,
			"best_market": bestMarket,
			"updated_at":  time.Now(),
			"source":      "cache",
		})
		return
	}

	// Cache miss: fetch from DB
	prices, err := h.repo.GetCurrent(r.Context())
	if err != nil {
		h.logger.Error("failed to get prices", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Populate cache
	if h.cache != nil {
		_ = h.cache.Set(r.Context(), cacheKeyCurrentPrices, prices)
	}

	bestPrice, bestMarket := findBestPrice(prices)
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"prices":      prices,
		"best_price":  bestPrice,
		"best_market": bestMarket,
		"updated_at":  time.Now(),
		"source":      "database",
	})
}

func findBestPrice(prices []models.MarketPrice) (float64, string) {
	bestPrice := float64(0)
	bestMarket := ""
	for _, p := range prices {
		if p.PricePerBag > bestPrice {
			bestPrice = p.PricePerBag
			bestMarket = p.MarketName + " (" + p.Source + ")"
		}
	}
	return bestPrice, bestMarket
}


func (h *PriceHandlers) RecordPrice(w http.ResponseWriter, r *http.Request) {
	var req models.RecordPriceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.MarketName = middleware.SanitizeString(req.MarketName, 100)
	req.Source = middleware.SanitizeString(req.Source, 50)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	recordedAt, err := time.Parse("2006-01-02", req.RecordedAt)
	if err != nil {
		respondError(w, http.StatusBadRequest, "recorded_at must be in YYYY-MM-DD format")
		return
	}

	id, err := h.repo.Record(r.Context(), req, recordedAt)
	if err != nil {
		h.logger.Error("failed to record price", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "price:record", "price", id.String(), map[string]interface{}{
		"source": req.Source, "market": req.MarketName, "price": req.PricePerBag,
	})

	// Invalidate cache on new data
	if h.cache != nil {
		_ = h.cache.Invalidate(r.Context(), cacheKeyCurrentPrices)
	}

	// Publish Kafka event
	if h.producer != nil {
		_ = h.producer.PublishPriceUpdated(r.Context(), kafka.PriceUpdatedEvent{
			PriceID:    id.String(),
			Source:     req.Source,
			MarketName: req.MarketName,
			Commodity:  req.Commodity,
			PriceKES:   req.PricePerBag,
			Trend:      req.Trend,
		})
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"id": id, "recorded": true})
}


func (h *PriceHandlers) GetPriceHistory(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 1 {
		days = 30
	}
	if days > 365 {
		days = 365
	}

	history, err := h.repo.GetHistory(r.Context(), source, days)
	if err != nil {
		h.logger.Error("failed to get history", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{"history": history, "days": days})
}


func (h *PriceHandlers) CreateSellOrder(w http.ResponseWriter, r *http.Request) {
	var req models.SellOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Sanitize (Security Rule #2)
	req.GSNumber = middleware.SanitizeString(req.GSNumber, 10)
	req.Market = middleware.SanitizeString(req.Market, 100)

	if err := validate.Struct(req); err != nil {
		respondError(w, http.StatusBadRequest, "validation failed")
		return
	}

	id, err := h.repo.CreateSellOrder(r.Context(), req)
	if err != nil {
		h.logger.Error("failed to create sell order", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	actor := "system"
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		actor = claims.Sub
	}
	h.audit.Log(r.Context(), actor, "price:sell_order", "sell_order", id.String(), map[string]interface{}{
		"gs_number": req.GSNumber, "bags": req.Bags,
	})

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"order_id": id, "status": "pending",
		"message": "Sell order placed. You will receive an SMS when matched.",
	})
}


func (h *PriceHandlers) GetSMSPreview(w http.ResponseWriter, r *http.Request) {
	sms, err := h.repo.GetSMSPreview(r.Context())
	if err != nil {
		h.logger.Error("failed to get SMS preview", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"sms_content":     sms,
		"character_count": len(sms),
		"language":        "sw",
	})
}
