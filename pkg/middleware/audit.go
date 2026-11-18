package middleware

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// AuditLogger writes immutable audit entries to the append-only audit_log table.
// Security Rule #4: Audit log entry for every state-changing operation.
type AuditLogger struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

// NewAuditLogger creates a new audit logger.
func NewAuditLogger(db *pgxpool.Pool, logger *zap.Logger) *AuditLogger {
	return &AuditLogger{db: db, logger: logger}
}

// Log records an audit entry. This uses parameterized queries only (Security Rule #3).
func (al *AuditLogger) Log(ctx context.Context, actor, action, resourceType, resourceID string, metadata interface{}) {
	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		metaJSON = []byte("{}")
	}

	// Parameterized query — no string concatenation (Security Rule #3)
	_, err = al.db.Exec(ctx,
		`INSERT INTO audit_log (actor, action, resource_type, resource_id, metadata)
		 VALUES ($1, $2, $3, $4, $5)`,
		actor, action, resourceType, resourceID, string(metaJSON),
	)
	if err != nil {
		// Audit failure must not block the request, but MUST be logged
		al.logger.Error("failed to write audit log",
			zap.String("actor", actor),
			zap.String("action", action),
			zap.String("resource_type", resourceType),
			zap.String("resource_id", resourceID),
			zap.Error(err),
		)
	}
}

// AuditMiddleware creates middleware that logs all state-changing requests.
func (al *AuditLogger) AuditMiddleware(action, resourceType string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only audit state-changing methods
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			actor := "anonymous"
			claims, ok := GetClaims(r.Context())
			if ok {
				actor = claims.Sub
			}

			// Log BEFORE business logic executes
			al.Log(r.Context(), actor, action, resourceType, r.URL.Path, map[string]string{
				"method":     r.Method,
				"ip_address": r.RemoteAddr,
				"user_agent": Truncate(r.UserAgent(), 500),
			})

			next.ServeHTTP(w, r)
		})
	}
}

// Truncate limits a string to maxLen characters.
func Truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}
