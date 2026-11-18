// Package models defines data structures for the warehouse-service.
package models

import (
	"time"

	"github.com/google/uuid"
)


// Warehouse represents a warehouse record.
type Warehouse struct {
	ID             uuid.UUID `json:"id"`
	NCPBCode       string    `json:"ncpb_code"`
	Name           string    `json:"name"`
	SubCounty      string    `json:"sub_county"`
	Location       string    `json:"location"`
	CapacityBags   int       `json:"capacity_bags"`
	CurrentStock   int       `json:"current_stock"`
	UtilizationPct float64   `json:"utilization_pct"`
	Status         string    `json:"status"`
	HasIoTSensors  bool      `json:"has_iot_sensors"`
}

// Deposit represents a grain deposit record.
type Deposit struct {
	ID              uuid.UUID `json:"id"`
	GSNumber        string    `json:"gs_number"`
	Bags            int       `json:"bags"`
	Commodity       string    `json:"commodity"`
	GrainGrade      string    `json:"grain_grade"`
	MoistureContent float64   `json:"moisture_content"`
	StorageBay      string    `json:"storage_bay"`
	ReceiptNumber   string    `json:"receipt_number"`
	Status          string    `json:"status"`
	DepositedAt     time.Time `json:"deposited_at"`
}

// WarehouseStats holds dashboard statistics.
type WarehouseStats struct {
	ActiveDepots    int `json:"active_depots"`
	TotalBagsStored int `json:"total_bags_stored"`
	TotalCapacity   int `json:"total_capacity"`
	DepositsToday   int `json:"deposits_today"`
	IoTMonitored    int `json:"iot_monitored"`
}


// DepositRequest is the validated input for creating a deposit.
type DepositRequest struct {
	WarehouseID     string  `json:"warehouse_id" validate:"required"`
	FarmerID        string  `json:"farmer_id" validate:"required"`
	GSNumber        string  `json:"gs_number" validate:"required,min=6,max=10"`
	Bags            int     `json:"bags" validate:"required,gte=1,lte=10000"`
	Commodity       string  `json:"commodity" validate:"required,max=50"`
	GrainGrade      string  `json:"grain_grade" validate:"max=20"`
	MoistureContent float64 `json:"moisture_content" validate:"gte=0,lte=100"`
	StorageBay      string  `json:"storage_bay" validate:"max=50"`
	ReceivedBy      string  `json:"received_by" validate:"required,max=100"`
}

// InspectionRequest is the validated input for an inspection.
type InspectionRequest struct {
	DepositID     string  `json:"deposit_id" validate:"required"`
	InspectorName string  `json:"inspector_name" validate:"required,max=100"`
	MoistureLevel float64 `json:"moisture_level" validate:"gte=0,lte=100"`
	WeevilDamage  bool    `json:"weevil_damage"`
	ForeignMatter bool    `json:"foreign_matter"`
	AflatoxinTest bool    `json:"aflatoxin_test"`
	AflatoxinPPB  float64 `json:"aflatoxin_ppb" validate:"gte=0"`
	Notes         string  `json:"notes" validate:"max=500"`
}
