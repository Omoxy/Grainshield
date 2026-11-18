// Package models defines data structures matching the PostgreSQL schema.
package models

import (
	"time"

	"github.com/google/uuid"
)

// SubCounty represents valid Trans Nzoia sub-counties.
type SubCounty string

const (
	SubCountyKiminini   SubCounty = "Kiminini"
	SubCountyKwanza     SubCounty = "Kwanza"
	SubCountySaboti     SubCounty = "Saboti"
	SubCountyEndebess   SubCounty = "Endebess"
	SubCountyCherangany SubCounty = "Cherangany"
)

// ValidSubCounties is the set of valid sub-county values.
var ValidSubCounties = map[SubCounty]bool{
	SubCountyKiminini:   true,
	SubCountyKwanza:     true,
	SubCountySaboti:     true,
	SubCountyEndebess:   true,
	SubCountyCherangany: true,
}

// Language represents supported languages.
type Language string

const (
	LangSwahili Language = "sw"
	LangEnglish Language = "en"
)

// ValidLanguages is the set of valid language values.
var ValidLanguages = map[Language]bool{
	LangSwahili: true,
	LangEnglish: true,
}

// FarmerStatus represents the status of a farmer account.
type FarmerStatus string

const (
	StatusActive       FarmerStatus = "active"
	StatusSuspended    FarmerStatus = "suspended"
	StatusDeregistered FarmerStatus = "deregistered"
)

// Farmer represents the full database row.
type Farmer struct {
	ID                  uuid.UUID    `json:"id"`
	GSNumber            string       `json:"gs_number"`
	Name                string       `json:"name"`
	NationalIDEncrypted []byte       `json:"-"` // Never serialized to JSON
	NationalIDHash      string       `json:"-"` // Never serialized to JSON
	Phone               string       `json:"phone"`
	SubCounty           SubCounty    `json:"sub_county"`
	Hectares            float64      `json:"hectares"`
	ExpectedBags        int          `json:"expected_bags"`
	Language            Language     `json:"language"`
	Status              FarmerStatus `json:"status"`
	RegisteredBy        string       `json:"registered_by"`          // JWT sub of officer/clerk who registered
	SolidarityGroupID   *uuid.UUID   `json:"solidarity_group_id"`    // FK to solidarity_groups
	CreatedAt           time.Time    `json:"created_at"`
	UpdatedAt           time.Time    `json:"updated_at"`
}

// CreateFarmerRequest is the validated input for farmer registration.
type CreateFarmerRequest struct {
	Name         string    `json:"name" validate:"required,min=2,max=100"`
	NationalID   string    `json:"national_id" validate:"required,len=8,numeric"`
	Phone        string    `json:"phone" validate:"required,min=12,max=13"`
	SubCounty    SubCounty `json:"sub_county" validate:"required"`
	Hectares     float64   `json:"hectares" validate:"required,gte=0.1,lte=100.0"`
	ExpectedBags int       `json:"expected_bags" validate:"required,gte=1,lte=10000"`
	Language     Language  `json:"language" validate:"required"`
	RegisteredBy string    `json:"-"` // Auto-populated from JWT claims, never from user input
}

// UpdateFarmerRequest is the validated input for farmer profile updates.
type UpdateFarmerRequest struct {
	Hectares     *float64      `json:"hectares,omitempty" validate:"omitempty,gte=0.1,lte=100.0"`
	ExpectedBags *int          `json:"expected_bags,omitempty" validate:"omitempty,gte=1,lte=10000"`
	Language     *Language     `json:"language,omitempty"`
	Status       *FarmerStatus `json:"status,omitempty"`
}

// FarmerResponse is the API response — never includes encrypted fields.
type FarmerResponse struct {
	ID                uuid.UUID    `json:"id"`
	GSNumber          string       `json:"gs_number"`
	Name              string       `json:"name"`
	Phone             string       `json:"phone"`
	SubCounty         SubCounty    `json:"sub_county"`
	Hectares          float64      `json:"hectares"`
	ExpectedBags      int          `json:"expected_bags"`
	Language          Language     `json:"language"`
	Status            FarmerStatus `json:"status"`
	RegisteredBy      string       `json:"registered_by"`
	SolidarityGroupID *uuid.UUID   `json:"solidarity_group_id,omitempty"`
	CreatedAt         time.Time    `json:"created_at"`
	UpdatedAt         time.Time    `json:"updated_at"`
}

// ToResponse converts a Farmer to a safe API response (strips encrypted fields).
func (f *Farmer) ToResponse() FarmerResponse {
	return FarmerResponse{
		ID:                f.ID,
		GSNumber:          f.GSNumber,
		Name:              f.Name,
		Phone:             f.Phone,
		SubCounty:         f.SubCounty,
		Hectares:          f.Hectares,
		ExpectedBags:      f.ExpectedBags,
		Language:          f.Language,
		Status:            f.Status,
		RegisteredBy:      f.RegisteredBy,
		SolidarityGroupID: f.SolidarityGroupID,
		CreatedAt:         f.CreatedAt,
		UpdatedAt:         f.UpdatedAt,
	}
}

// FarmerListResponse wraps paginated results.
type FarmerListResponse struct {
	Farmers    []FarmerResponse `json:"farmers"`
	TotalCount int              `json:"total_count"`
	Page       int              `json:"page"`
	Limit      int              `json:"limit"`
}

// AuditEntry represents an append-only audit log row.
type AuditEntry struct {
	ID           int64     `json:"id"`
	Actor        string    `json:"actor"`
	Action       string    `json:"action"`
	ResourceType string    `json:"resource_type"`
	ResourceID   string    `json:"resource_id"`
	Metadata     string    `json:"metadata"` // JSON string
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
	CreatedAt    time.Time `json:"created_at"`
}


// SolidarityGroup represents a 20-farmer cluster for collective risk pooling.
type SolidarityGroup struct {
	ID                    uuid.UUID `json:"id"`
	Name                  string    `json:"name"`
	SubCounty             SubCounty `json:"sub_county"`
	MaxMembers            int       `json:"max_members"`
	MemberCount           int       `json:"member_count"`
	PoolBalanceKES        float64   `json:"pool_balance_kes"`
	ContributionPerBagKES float64   `json:"contribution_per_bag_kes"`
	CreatedAt             time.Time `json:"created_at"`
}

// JoinGroupRequest is the validated input for joining a solidarity group.
type JoinGroupRequest struct {
	FarmerID string `json:"farmer_id" validate:"required"`
	GroupID  string `json:"group_id" validate:"required"`
}

// LeaveGroupRequest is the validated input for leaving a solidarity group.
type LeaveGroupRequest struct {
	FarmerID string `json:"farmer_id" validate:"required"`
}

