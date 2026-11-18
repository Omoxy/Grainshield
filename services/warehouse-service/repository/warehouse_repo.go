// Package repository implements database operations for the warehouse-service.
// Security Rule #3: Parameterised queries only.
package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/grainshield/warehouse-service/models"
)

// WarehouseRepo provides database operations for warehouses.
type WarehouseRepo struct {
	db *pgxpool.Pool
}

// NewWarehouseRepo creates a new WarehouseRepo.
func NewWarehouseRepo(db *pgxpool.Pool) *WarehouseRepo {
	return &WarehouseRepo{db: db}
}

// ListWarehouses retrieves all warehouses.
func (r *WarehouseRepo) ListWarehouses(ctx context.Context) ([]models.Warehouse, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, ncpb_code, name, sub_county, location, capacity_bags, current_stock, status, has_iot_sensors
		 FROM warehouses ORDER BY sub_county`)
	if err != nil {
		return nil, fmt.Errorf("failed to list warehouses: %w", err)
	}
	defer rows.Close()

	var warehouses []models.Warehouse
	for rows.Next() {
		var wh models.Warehouse
		if err := rows.Scan(&wh.ID, &wh.NCPBCode, &wh.Name, &wh.SubCounty, &wh.Location, &wh.CapacityBags, &wh.CurrentStock, &wh.Status, &wh.HasIoTSensors); err != nil {
			return nil, fmt.Errorf("failed to scan warehouse: %w", err)
		}
		if wh.CapacityBags > 0 {
			wh.UtilizationPct = float64(wh.CurrentStock) / float64(wh.CapacityBags) * 100
		}
		warehouses = append(warehouses, wh)
	}
	return warehouses, nil
}

// CreateDeposit records a grain deposit in a transaction.
func (r *WarehouseRepo) CreateDeposit(ctx context.Context, req models.DepositRequest) (map[string]interface{}, error) {
	warehouseID, err := uuid.Parse(req.WarehouseID)
	if err != nil {
		return nil, fmt.Errorf("invalid warehouse_id format")
	}
	farmerID, err := uuid.Parse(req.FarmerID)
	if err != nil {
		return nil, fmt.Errorf("invalid farmer_id format")
	}

	// Check warehouse capacity
	var capacity, stock int
	err = r.db.QueryRow(ctx,
		`SELECT capacity_bags, current_stock FROM warehouses WHERE id = $1 AND status = 'active'`, warehouseID,
	).Scan(&capacity, &stock)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("warehouse not found or inactive")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to check warehouse: %w", err)
	}

	if stock+req.Bags > capacity {
		return nil, fmt.Errorf("insufficient capacity: %d bags available, %d requested", capacity-stock, req.Bags)
	}

	receiptNumber := fmt.Sprintf("WR-%s-%s-%04d", req.GSNumber, time.Now().Format("20060102"), time.Now().UnixMilli()%10000)
	depositID := uuid.New()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO deposits (id, warehouse_id, farmer_id, gs_number, bags, commodity, grain_grade, moisture_content, storage_bay, receipt_number, received_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		depositID, warehouseID, farmerID, req.GSNumber, req.Bags, req.Commodity, req.GrainGrade, req.MoistureContent, req.StorageBay, receiptNumber, req.ReceivedBy); err != nil {
		return nil, fmt.Errorf("failed to insert deposit: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE warehouses SET current_stock = current_stock + $1 WHERE id = $2`, req.Bags, warehouseID); err != nil {
		return nil, fmt.Errorf("failed to update stock: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("transaction commit failed: %w", err)
	}

	return map[string]interface{}{
		"deposit_id": depositID, "receipt_number": receiptNumber,
		"bags": req.Bags, "warehouse": warehouseID, "status": "received",
		"message": "Grain deposited successfully. Warehouse receipt issued.",
	}, nil
}

// CreateInspection records an inspection result.
func (r *WarehouseRepo) CreateInspection(ctx context.Context, req models.InspectionRequest) (map[string]interface{}, error) {
	depositID, err := uuid.Parse(req.DepositID)
	if err != nil {
		return nil, fmt.Errorf("invalid deposit_id format")
	}

	result := "passed"
	if req.WeevilDamage || req.ForeignMatter || (req.AflatoxinTest && req.AflatoxinPPB > 10) {
		result = "failed"
	} else if req.MoistureLevel > 13.5 || (req.AflatoxinTest && req.AflatoxinPPB > 5) {
		result = "conditional"
	}

	id := uuid.New()
	if _, err := r.db.Exec(ctx,
		`INSERT INTO inspections (id, deposit_id, inspector_name, moisture_level, weevil_damage, foreign_matter, aflatoxin_test, aflatoxin_ppb, result, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		id, depositID, req.InspectorName, req.MoistureLevel, req.WeevilDamage, req.ForeignMatter, req.AflatoxinTest, req.AflatoxinPPB, result, req.Notes); err != nil {
		return nil, fmt.Errorf("failed to insert inspection: %w", err)
	}

	newStatus := "inspected"
	if result == "failed" {
		newStatus = "condemned"
	}
	r.db.Exec(ctx,
		`UPDATE deposits SET status = $1, grain_grade = CASE WHEN $2 = 'passed' THEN 'Grade 1' WHEN $2 = 'conditional' THEN 'Grade 2' ELSE 'Grade 3' END WHERE id = $3`,
		newStatus, result, depositID)

	return map[string]interface{}{"inspection_id": id, "result": result, "deposit_status": newStatus}, nil
}

// ListDeposits retrieves deposits for a warehouse.
func (r *WarehouseRepo) ListDeposits(ctx context.Context, warehouseID uuid.UUID, page, limit int) ([]models.Deposit, error) {
	offset := (page - 1) * limit

	rows, err := r.db.Query(ctx,
		`SELECT id, gs_number, bags, commodity, grain_grade, moisture_content, storage_bay, receipt_number, status, deposited_at
		 FROM deposits WHERE warehouse_id = $1 ORDER BY deposited_at DESC LIMIT $2 OFFSET $3`,
		warehouseID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list deposits: %w", err)
	}
	defer rows.Close()

	var deposits []models.Deposit
	for rows.Next() {
		var d models.Deposit
		if err := rows.Scan(&d.ID, &d.GSNumber, &d.Bags, &d.Commodity, &d.GrainGrade, &d.MoistureContent, &d.StorageBay, &d.ReceiptNumber, &d.Status, &d.DepositedAt); err != nil {
			return nil, fmt.Errorf("failed to scan deposit: %w", err)
		}
		deposits = append(deposits, d)
	}
	return deposits, nil
}

// GetStats retrieves warehouse dashboard statistics.
func (r *WarehouseRepo) GetStats(ctx context.Context) (*models.WarehouseStats, error) {
	stats := &models.WarehouseStats{}

	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM warehouses WHERE status = 'active'`).Scan(&stats.ActiveDepots); err != nil {
		return nil, fmt.Errorf("failed to count depots: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(current_stock),0) FROM warehouses`).Scan(&stats.TotalBagsStored); err != nil {
		return nil, fmt.Errorf("failed to sum stock: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COALESCE(SUM(capacity_bags),0) FROM warehouses WHERE status = 'active'`).Scan(&stats.TotalCapacity); err != nil {
		return nil, fmt.Errorf("failed to sum capacity: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM deposits WHERE status = 'received' AND deposited_at > CURRENT_DATE`).Scan(&stats.DepositsToday); err != nil {
		return nil, fmt.Errorf("failed to count today deposits: %w", err)
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM warehouses WHERE has_iot_sensors = TRUE`).Scan(&stats.IoTMonitored); err != nil {
		return nil, fmt.Errorf("failed to count IoT: %w", err)
	}

	return stats, nil
}
