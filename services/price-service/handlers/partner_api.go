// Institutional partner API endpoints with tier enforcement.
// Tier 1: weekly access (default for basic partners)
// Tier 2: daily access (premium partners)
// Tier 3: real-time access (enterprise partners)
package handlers

import (
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/grainshield/price-service/cache"
	"github.com/grainshield/price-service/repository"
)

const (
	tierHeaderKey = "X-API-Tier"
	tier1Weekly   = "1"
	tier2Daily    = "2"
	tier3Realtime = "3"

	tier1MinAge = 7 * 24 * time.Hour
	tier2MinAge = 24 * time.Hour
)

// PartnerHandlers provides institutional partner API endpoints with tier enforcement.
type PartnerHandlers struct {
	repo   *repository.PriceRepo
	cache  *cache.PriceCache
	logger *zap.Logger
}

// NewPartnerHandlers creates new partner API handlers.
func NewPartnerHandlers(repo *repository.PriceRepo, priceCache *cache.PriceCache, logger *zap.Logger) *PartnerHandlers {
	return &PartnerHandlers{
		repo:   repo,
		cache:  priceCache,
		logger: logger,
	}
}

// GetCurrentPricesPartner returns price data filtered by API tier.
// Tier 1 (weekly): returns data only from 7+ days ago
// Tier 2 (daily): returns data only from 1+ day ago
// Tier 3 (real-time): returns the latest data
func (h *PartnerHandlers) GetCurrentPricesPartner(w http.ResponseWriter, r *http.Request) {
	tier := r.Header.Get(tierHeaderKey)
	if tier == "" {
		tier = tier1Weekly
	}

	switch tier {
	case tier1Weekly:
		h.serveTier1(w, r)
	case tier2Daily:
		h.serveTier2(w, r)
	case tier3Realtime:
		h.serveTier3(w, r)
	default:
		respondError(w, http.StatusBadRequest, "invalid API tier: use 1, 2, or 3")
	}
}

func (h *PartnerHandlers) serveTier1(w http.ResponseWriter, r *http.Request) {
	cacheKey := "partner:tier1:current"

	var cached []map[string]interface{}
	if h.cache != nil && h.cache.GetPrices(r.Context(), cacheKey, &cached) {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"tier":   1,
			"access": "weekly",
			"prices": cached,
			"note":   "Data delayed by minimum 7 days per Tier 1 agreement",
		})
		return
	}

	history, err := h.repo.GetHistory(r.Context(), "", 365)
	if err != nil {
		h.logger.Error("failed to get tier 1 prices", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	cutoff := time.Now().Add(-tier1MinAge)
	var filtered []interface{}
	for _, p := range history {
		if p.Date.Before(cutoff) {
			filtered = append(filtered, p)
		}
	}

	if h.cache != nil {
		_ = h.cache.Set(r.Context(), cacheKey, filtered)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"tier":   1,
		"access": "weekly",
		"prices": filtered,
		"note":   "Data delayed by minimum 7 days per Tier 1 agreement",
	})
}

func (h *PartnerHandlers) serveTier2(w http.ResponseWriter, r *http.Request) {
	cacheKey := "partner:tier2:current"

	var cached []map[string]interface{}
	if h.cache != nil && h.cache.GetPrices(r.Context(), cacheKey, &cached) {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"tier":   2,
			"access": "daily",
			"prices": cached,
			"note":   "Data delayed by minimum 24 hours per Tier 2 agreement",
		})
		return
	}

	history, err := h.repo.GetHistory(r.Context(), "", 90)
	if err != nil {
		h.logger.Error("failed to get tier 2 prices", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	cutoff := time.Now().Add(-tier2MinAge)
	var filtered []interface{}
	for _, p := range history {
		if p.Date.Before(cutoff) {
			filtered = append(filtered, p)
		}
	}

	if h.cache != nil {
		_ = h.cache.Set(r.Context(), cacheKey, filtered)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"tier":   2,
		"access": "daily",
		"prices": filtered,
		"note":   "Data delayed by minimum 24 hours per Tier 2 agreement",
	})
}

func (h *PartnerHandlers) serveTier3(w http.ResponseWriter, r *http.Request) {
	cacheKey := "partner:tier3:current"

	var cached []map[string]interface{}
	if h.cache != nil && h.cache.GetPrices(r.Context(), cacheKey, &cached) {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"tier":   3,
			"access": "real-time",
			"prices": cached,
		})
		return
	}

	prices, err := h.repo.GetCurrent(r.Context())
	if err != nil {
		h.logger.Error("failed to get tier 3 prices", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if h.cache != nil {
		_ = h.cache.Set(r.Context(), cacheKey, prices)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"tier":   3,
		"access": "real-time",
		"prices": prices,
	})
}
