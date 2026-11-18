// Package repository implements database operations for the price-service.
// Security Rule #3: Parameterised queries only.
package repository

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/grainshield/price-service/models"
)

// PriceRepo provides database operations for prices.
type PriceRepo struct {
	db *pgxpool.Pool
}

// NewPriceRepo creates a new PriceRepo.
func NewPriceRepo(db *pgxpool.Pool) *PriceRepo {
	return &PriceRepo{db: db}
}

// GetCurrent retrieves the latest prices from all markets.
func (r *PriceRepo) GetCurrent(ctx context.Context) ([]models.MarketPrice, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT ON (source, market_name) id, source, market_name, commodity, price_per_bag, currency, trend, recorded_at
		 FROM market_prices ORDER BY source, market_name, recorded_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("failed to get current prices: %w", err)
	}
	defer rows.Close()

	var prices []models.MarketPrice
	for rows.Next() {
		var p models.MarketPrice
		if err := rows.Scan(&p.ID, &p.Source, &p.MarketName, &p.Commodity, &p.PricePerBag, &p.Currency, &p.Trend, &p.RecordedAt); err != nil {
			return nil, fmt.Errorf("failed to scan price: %w", err)
		}
		prices = append(prices, p)
	}
	return prices, nil
}

// Record inserts a new price data point.
func (r *PriceRepo) Record(ctx context.Context, req models.RecordPriceRequest, recordedAt time.Time) (uuid.UUID, error) {
	id := uuid.New()
	_, err := r.db.Exec(ctx,
		`INSERT INTO market_prices (id, source, market_name, commodity, price_per_bag, currency, unit, trend, recorded_at)
		 VALUES ($1,$2,$3,$4,$5,$6,'90kg bag',$7,$8)`,
		id, req.Source, req.MarketName, req.Commodity, req.PricePerBag, req.Currency, req.Trend, recordedAt)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to record price: %w", err)
	}
	return id, nil
}

// GetHistory retrieves price trends over time.
func (r *PriceRepo) GetHistory(ctx context.Context, source string, days int) ([]models.PricePoint, error) {
	rows, err := r.db.Query(ctx,
		`SELECT source, market_name, price_per_bag, currency, trend, recorded_at
		 FROM market_prices
		 WHERE ($1 = '' OR source = $1::price_source_enum)
		   AND recorded_at >= CURRENT_DATE - $2 * INTERVAL '1 day'
		 ORDER BY recorded_at ASC`, source, days)
	if err != nil {
		return nil, fmt.Errorf("failed to get history: %w", err)
	}
	defer rows.Close()

	var history []models.PricePoint
	for rows.Next() {
		var p models.PricePoint
		if err := rows.Scan(&p.Source, &p.Market, &p.Price, &p.Currency, &p.Trend, &p.Date); err != nil {
			return nil, fmt.Errorf("failed to scan price point: %w", err)
		}
		history = append(history, p)
	}
	return history, nil
}

// CreateSellOrder creates a new sell order.
func (r *PriceRepo) CreateSellOrder(ctx context.Context, req models.SellOrderRequest) (uuid.UUID, error) {
	farmerID, err := uuid.Parse(req.FarmerID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("invalid farmer_id format")
	}

	id := uuid.New()
	_, err = r.db.Exec(ctx,
		`INSERT INTO sell_orders (id, farmer_id, gs_number, bags, target_price, market)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		id, farmerID, req.GSNumber, req.Bags, req.TargetPrice, req.Market)
	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to create sell order: %w", err)
	}
	return id, nil
}

// GetSMSPreview generates the weekly price SMS content.
func (r *PriceRepo) GetSMSPreview(ctx context.Context) (string, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT ON (source) source, market_name, price_per_bag, trend
		 FROM market_prices WHERE commodity = 'Maize'
		 ORDER BY source, recorded_at DESC`)
	if err != nil {
		return "", fmt.Errorf("failed to get SMS prices: %w", err)
	}
	defer rows.Close()

	sms := "BEI ZA MAHINDI wiki hii:\n"
	for rows.Next() {
		var source, market, trend string
		var price float64
		if err := rows.Scan(&source, &market, &price, &trend); err != nil {
			return "", fmt.Errorf("failed to scan SMS price: %w", err)
		}
		arrow := "→"
		if trend == "up" {
			arrow = "↑"
		}
		if trend == "down" {
			arrow = "↓"
		}
		sms += source + ": KES " + strconv.FormatFloat(price, 'f', 0, 64) + " " + arrow + "\n"
	}
	sms += "\nJibu: UUZA (uza sasa)\nSHIKA (endelea kushika)\nMKOPO (omba mkopo)\n"
	sms += "*384# kwa maelezo zaidi"
	return sms, nil
}
