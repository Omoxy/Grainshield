// Package models defines data structures for the price-service.
package models

import (
	"time"

	"github.com/google/uuid"
)


// MarketPrice represents a market price record.
type MarketPrice struct {
	ID          uuid.UUID `json:"id"`
	Source      string    `json:"source"`
	MarketName  string    `json:"market_name"`
	Commodity   string    `json:"commodity"`
	PricePerBag float64   `json:"price_per_bag"`
	Currency    string    `json:"currency"`
	Trend       string    `json:"trend"`
	RecordedAt  time.Time `json:"recorded_at"`
}

// PricePoint is a lightweight view for history.
type PricePoint struct {
	Source   string    `json:"source"`
	Market   string    `json:"market"`
	Price    float64   `json:"price"`
	Currency string    `json:"currency"`
	Trend    string    `json:"trend"`
	Date     time.Time `json:"date"`
}


// RecordPriceRequest is the validated input for recording a price.
type RecordPriceRequest struct {
	Source      string  `json:"source" validate:"required,oneof=NCPB Uganda Tanzania 'South Sudan'"`
	MarketName  string  `json:"market_name" validate:"required,max=100"`
	Commodity   string  `json:"commodity" validate:"required,oneof=Maize Wheat Beans Sorghum"`
	PricePerBag float64 `json:"price_per_bag" validate:"required,gt=0"`
	Currency    string  `json:"currency" validate:"required,len=3"`
	Trend       string  `json:"trend" validate:"oneof=up down stable"`
	RecordedAt  string  `json:"recorded_at" validate:"required"`
}

// SellOrderRequest is the validated input for a sell order.
type SellOrderRequest struct {
	FarmerID    string  `json:"farmer_id" validate:"required"`
	GSNumber    string  `json:"gs_number" validate:"required,min=6,max=10"`
	Bags        int     `json:"bags" validate:"required,gte=1,lte=10000"`
	TargetPrice float64 `json:"target_price" validate:"gte=0"`
	Market      string  `json:"market" validate:"max=100"`
}
