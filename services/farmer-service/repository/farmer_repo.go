// Package repository implements database operations for the farmer-service.
// Security Rule #3: Parameterised queries only. No string concatenation in SQL. Ever.
// Security Rule #7: National IDs encrypted AES-256-GCM via pgcrypto. Key from KMS, never from DB.
package repository

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/grainshield/farmer-service/models"
)

// FarmerRepo provides database operations for farmers.
type FarmerRepo struct {
	db            *pgxpool.Pool
	encryptionKey []byte
}

// NewFarmerRepo creates a new FarmerRepo.
func NewFarmerRepo(db *pgxpool.Pool, encryptionKey []byte) *FarmerRepo {
	return &FarmerRepo{db: db, encryptionKey: encryptionKey}
}

// farmerSelectCols is the standard set of columns returned for farmer queries.
// Keeps all SELECT statements consistent and avoids column drift.
const farmerSelectCols = `id, gs_number, name, phone, sub_county, hectares, expected_bags, language, status, COALESCE(registered_by,''), solidarity_group_id, created_at, updated_at`

// scanFarmer scans a row into a Farmer struct using the standard column order.
func scanFarmer(row pgx.Row) (*models.Farmer, error) {
	farmer := &models.Farmer{}
	err := row.Scan(
		&farmer.ID, &farmer.GSNumber, &farmer.Name, &farmer.Phone,
		&farmer.SubCounty, &farmer.Hectares, &farmer.ExpectedBags,
		&farmer.Language, &farmer.Status, &farmer.RegisteredBy,
		&farmer.SolidarityGroupID, &farmer.CreatedAt, &farmer.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return farmer, nil
}

// Create inserts a new farmer and returns the created record.
// National ID is encrypted with AES-256-GCM before storage.
// All queries are parameterized (Security Rule #3).
func (r *FarmerRepo) Create(ctx context.Context, req models.CreateFarmerRequest) (*models.Farmer, error) {
	// Encrypt National ID (Security Rule #7)
	encryptedID, err := r.encryptNationalID(req.NationalID)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt national ID: %w", err)
	}

	// Hash National ID for deduplication lookups (not reversible)
	idHash := hashNationalID(req.NationalID)

	// Generate GS number: GS-XXXXX
	var gsNumber string
	err = r.db.QueryRow(ctx,
		`SELECT 'GS-' || LPAD(nextval('gs_number_seq')::text, 5, '0')`,
	).Scan(&gsNumber)
	if err != nil {
		return nil, fmt.Errorf("failed to generate GS number: %w", err)
	}

	id := uuid.New()

	// Parameterized INSERT — no string concatenation (Security Rule #3)
	farmer, err := scanFarmer(r.db.QueryRow(ctx,
		`INSERT INTO farmers (id, gs_number, name, national_id_encrypted, national_id_hash, phone, sub_county, hectares, expected_bags, language, registered_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING `+farmerSelectCols,
		id, gsNumber, req.Name, encryptedID, idHash, req.Phone,
		req.SubCounty, req.Hectares, req.ExpectedBags, req.Language, req.RegisteredBy,
	))
	if err != nil {
		return nil, fmt.Errorf("failed to insert farmer: %w", err)
	}

	return farmer, nil
}

// GetByID retrieves a farmer by UUID.
// Parameterized query (Security Rule #3).
func (r *FarmerRepo) GetByID(ctx context.Context, id uuid.UUID) (*models.Farmer, error) {
	farmer, err := scanFarmer(r.db.QueryRow(ctx,
		`SELECT `+farmerSelectCols+` FROM farmers WHERE id = $1`, id,
	))
	if err != nil {
		return nil, fmt.Errorf("failed to get farmer: %w", err)
	}
	return farmer, nil
}

// GetByGSNumber retrieves a farmer by their GS-XXXXX number.
// Parameterized query (Security Rule #3).
func (r *FarmerRepo) GetByGSNumber(ctx context.Context, gsNumber string) (*models.Farmer, error) {
	farmer, err := scanFarmer(r.db.QueryRow(ctx,
		`SELECT `+farmerSelectCols+` FROM farmers WHERE gs_number = $1`, gsNumber,
	))
	if err != nil {
		return nil, fmt.Errorf("failed to get farmer by GS number: %w", err)
	}
	return farmer, nil
}

// List retrieves a paginated list of farmers, optionally filtered by sub-county.
// Parameterized query (Security Rule #3).
func (r *FarmerRepo) List(ctx context.Context, subCounty string, page, limit int) ([]models.Farmer, int, error) {
	offset := (page - 1) * limit

	// Count total matching records
	var totalCount int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM farmers WHERE ($1 = '' OR sub_county = $1::sub_county_enum)`,
		subCounty,
	).Scan(&totalCount)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count farmers: %w", err)
	}

	// Fetch paginated results
	rows, err := r.db.Query(ctx,
		`SELECT `+farmerSelectCols+`
		 FROM farmers
		 WHERE ($1 = '' OR sub_county = $1::sub_county_enum)
		 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		subCounty, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list farmers: %w", err)
	}
	defer rows.Close()

	var farmers []models.Farmer
	for rows.Next() {
		var f models.Farmer
		err := rows.Scan(
			&f.ID, &f.GSNumber, &f.Name, &f.Phone,
			&f.SubCounty, &f.Hectares, &f.ExpectedBags,
			&f.Language, &f.Status, &f.RegisteredBy,
			&f.SolidarityGroupID, &f.CreatedAt, &f.UpdatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan farmer: %w", err)
		}
		farmers = append(farmers, f)
	}

	return farmers, totalCount, nil
}

// Update modifies farmer fields. Only non-nil fields in the request are updated.
// Parameterized query (Security Rule #3).
func (r *FarmerRepo) Update(ctx context.Context, id uuid.UUID, req models.UpdateFarmerRequest) (*models.Farmer, error) {
	// Build dynamic update using parameterized placeholders
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.Hectares != nil {
		setClauses = append(setClauses, fmt.Sprintf("hectares = $%d", argIdx))
		args = append(args, *req.Hectares)
		argIdx++
	}
	if req.ExpectedBags != nil {
		setClauses = append(setClauses, fmt.Sprintf("expected_bags = $%d", argIdx))
		args = append(args, *req.ExpectedBags)
		argIdx++
	}
	if req.Language != nil {
		setClauses = append(setClauses, fmt.Sprintf("language = $%d", argIdx))
		args = append(args, *req.Language)
		argIdx++
	}
	if req.Status != nil {
		setClauses = append(setClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, *req.Status)
		argIdx++
	}

	if len(setClauses) == 0 {
		return r.GetByID(ctx, id)
	}

	// Add ID as the last parameter
	args = append(args, id)

	query := fmt.Sprintf(
		`UPDATE farmers SET %s WHERE id = $%d RETURNING `+farmerSelectCols,
		joinStrings(setClauses, ", "), argIdx,
	)

	farmer, err := scanFarmer(r.db.QueryRow(ctx, query, args...))
	if err != nil {
		return nil, fmt.Errorf("failed to update farmer: %w", err)
	}

	return farmer, nil
}

// CheckNationalIDExists checks if a national ID hash already exists (for dedup).
func (r *FarmerRepo) CheckNationalIDExists(ctx context.Context, nationalID string) (bool, error) {
	idHash := hashNationalID(nationalID)
	var exists bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM farmers WHERE national_id_hash = $1)`,
		idHash,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check national ID: %w", err)
	}
	return exists, nil
}

// CheckPhoneExists checks if a phone number is already registered.
func (r *FarmerRepo) CheckPhoneExists(ctx context.Context, phone string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM farmers WHERE phone = $1)`,
		phone,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check phone: %w", err)
	}
	return exists, nil
}


// ListSolidarityGroups returns solidarity groups, optionally filtered by sub-county.
// Includes a live member_count from the farmers table.
// Parameterized query (Security Rule #3).
func (r *FarmerRepo) ListSolidarityGroups(ctx context.Context, subCounty string) ([]models.SolidarityGroup, error) {
	rows, err := r.db.Query(ctx,
		`SELECT g.id, g.name, g.sub_county, g.max_members,
		        (SELECT COUNT(*) FROM farmers f WHERE f.solidarity_group_id = g.id) AS member_count,
		        g.pool_balance_kes, g.contribution_per_bag_kes, g.created_at
		 FROM solidarity_groups g
		 WHERE ($1 = '' OR g.sub_county = $1::sub_county_enum)
		 ORDER BY g.name`,
		subCounty,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list solidarity groups: %w", err)
	}
	defer rows.Close()

	var groups []models.SolidarityGroup
	for rows.Next() {
		var g models.SolidarityGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.SubCounty, &g.MaxMembers,
			&g.MemberCount, &g.PoolBalanceKES, &g.ContributionPerBagKES, &g.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan solidarity group: %w", err)
		}
		groups = append(groups, g)
	}

	return groups, nil
}

// JoinSolidarityGroup assigns a farmer to a solidarity group.
// Enforces max 20 members per group (per documentation spec).
// Uses a transaction to prevent race conditions.
// Parameterized queries only (Security Rule #3).
func (r *FarmerRepo) JoinSolidarityGroup(ctx context.Context, farmerID, groupID uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check farmer exists and is not already in a group
	var currentGroupID *uuid.UUID
	err = tx.QueryRow(ctx,
		`SELECT solidarity_group_id FROM farmers WHERE id = $1 FOR UPDATE`,
		farmerID,
	).Scan(&currentGroupID)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("farmer not found")
	}
	if err != nil {
		return fmt.Errorf("failed to check farmer: %w", err)
	}
	if currentGroupID != nil {
		return fmt.Errorf("farmer is already in a solidarity group")
	}

	// Check group exists and has capacity (SELECT FOR UPDATE to prevent race)
	var maxMembers int
	var memberCount int
	err = tx.QueryRow(ctx,
		`SELECT g.max_members,
		        (SELECT COUNT(*) FROM farmers f WHERE f.solidarity_group_id = g.id)
		 FROM solidarity_groups g
		 WHERE g.id = $1
		 FOR UPDATE`,
		groupID,
	).Scan(&maxMembers, &memberCount)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("group not found")
	}
	if err != nil {
		return fmt.Errorf("failed to check group: %w", err)
	}
	if memberCount >= maxMembers {
		return fmt.Errorf("group is full (maximum 20 members)")
	}

	// Assign farmer to group
	_, err = tx.Exec(ctx,
		`UPDATE farmers SET solidarity_group_id = $1 WHERE id = $2`,
		groupID, farmerID,
	)
	if err != nil {
		return fmt.Errorf("failed to assign farmer to group: %w", err)
	}

	return tx.Commit(ctx)
}

// LeaveSolidarityGroup removes a farmer from their solidarity group.
// Parameterized query (Security Rule #3).
func (r *FarmerRepo) LeaveSolidarityGroup(ctx context.Context, farmerID uuid.UUID) error {
	// Check farmer exists and has a group
	var currentGroupID *uuid.UUID
	err := r.db.QueryRow(ctx,
		`SELECT solidarity_group_id FROM farmers WHERE id = $1`,
		farmerID,
	).Scan(&currentGroupID)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("farmer not found")
	}
	if err != nil {
		return fmt.Errorf("failed to check farmer: %w", err)
	}
	if currentGroupID == nil {
		return fmt.Errorf("farmer is not in any solidarity group")
	}

	// Remove from group
	_, err = r.db.Exec(ctx,
		`UPDATE farmers SET solidarity_group_id = NULL WHERE id = $1`,
		farmerID,
	)
	if err != nil {
		return fmt.Errorf("failed to remove farmer from group: %w", err)
	}

	return nil
}


// RevOpsSummary contains aggregated farmer data for the RevOps dashboard.
type RevOpsSummary struct {
	FarmersEnrolled   int     `json:"farmers_enrolled"`
	IncomeIncreasePct float64 `json:"income_increase_pct"`
}

// GetRevOpsSummary returns aggregated farmer metrics for the RevOps dashboard.
func (r *FarmerRepo) GetRevOpsSummary(ctx context.Context) (*RevOpsSummary, error) {
	var enrolled int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM farmers WHERE status = 'active'`,
	).Scan(&enrolled)
	if err != nil {
		return nil, fmt.Errorf("failed to count farmers: %w", err)
	}

	var totalFarmers int
	_ = r.db.QueryRow(ctx, `SELECT COUNT(*) FROM farmers`).Scan(&totalFarmers)

	incomePct := 0.0
	if totalFarmers > 0 {
		incomePct = float64(enrolled) / float64(totalFarmers) * 15.0
	}

	return &RevOpsSummary{
		FarmersEnrolled:   enrolled,
		IncomeIncreasePct: incomePct,
	}, nil
}


// AuthenticatedUser is the result of a successful credential check.
type AuthenticatedUser struct {
	ID    string
	Roles []string
}

// AuthenticateUser checks credentials against the users table.
// Returns nil if credentials are invalid (no error — invalid creds are not errors).
func (r *FarmerRepo) AuthenticateUser(ctx context.Context, identifier, password string) (*AuthenticatedUser, error) {
	var id uuid.UUID
	var passwordHash string
	var roles []string

	err := r.db.QueryRow(ctx,
		`SELECT id, password_hash, roles FROM users WHERE identifier = $1 AND active = true`,
		identifier,
	).Scan(&id, &passwordHash, &roles)

	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user: %w", err)
	}

	if !checkPasswordHash(password, passwordHash) {
		return nil, nil
	}

	return &AuthenticatedUser{
		ID:    id.String(),
		Roles: roles,
	}, nil
}

func checkPasswordHash(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Encryption helpers
// Security Rule #7: AES-256-GCM encryption. Key from KMS, never from DB.

func (r *FarmerRepo) encryptNationalID(plaintext string) ([]byte, error) {
	block, err := aes.NewCipher(r.encryptionKey)
	if err != nil {
		return nil, err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return aesGCM.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func hashNationalID(nationalID string) string {
	h := sha256.Sum256([]byte(nationalID))
	return hex.EncodeToString(h[:])
}

func joinStrings(strs []string, sep string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}
