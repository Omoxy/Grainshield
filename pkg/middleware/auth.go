package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ContextKey string

const (
	ClaimsKey ContextKey = "claims"
)

type Claims struct {
	Sub   string   `json:"sub"`
	Roles []string `json:"roles"`
	jwt.RegisteredClaims
}

func (c *Claims) Can(permission string) bool {
	rolePerms := map[string][]string{
		"admin": {
			"farmer:create", "farmer:read", "farmer:list", "farmer:update",
			"policy:create", "policy:read", "policy:list", "policy:trigger",
			"payment:disburse", "payment:read", "payment:list",
			"price:create", "price:read", "price:list", "price:sell",
			"risk:read", "risk:ingest",
			"warehouse:read", "warehouse:list", "deposit:create", "inspection:create",
			"notification:send", "notification:bulk", "notification:read",
		},
		"farmer": {
			"farmer:read",
			"policy:create", "policy:read",
			"price:read", "price:sell",
			"warehouse:read",
			"notification:read",
		},
		"extension_officer": {
			"farmer:read", "farmer:list",
			"risk:read",
			"warehouse:read", "warehouse:list",
			"notification:send",
		},
		"warehouse_clerk": {
			"farmer:create", "farmer:read",
			"warehouse:read", "warehouse:list",
			"deposit:create", "inspection:create",
			"notification:send",
		},
		"b2b_partner": {
			"price:read", "price:list", "price:sell",
			"farmer:list",
		},
		"ussd_gateway": {
			"farmer:create", "farmer:read",
			"policy:create", "policy:read",
			"price:read", "price:sell",
			"notification:send",
		},
		"service": {
			"farmer:create", "farmer:read", "farmer:list", "farmer:update",
			"policy:create", "policy:read", "policy:list", "policy:trigger",
			"payment:disburse", "payment:read", "payment:list",
			"price:create", "price:read", "price:list", "price:sell",
			"risk:read", "risk:ingest",
			"warehouse:read", "warehouse:list", "deposit:create", "inspection:create",
			"notification:send", "notification:bulk", "notification:read",
		},
		"data_ingest": {
			"risk:ingest", "price:create",
		},
	}

	for _, role := range c.Roles {
		perms, ok := rolePerms[role]
		if !ok {
			continue
		}
		for _, p := range perms {
			if p == permission {
				return true
			}
		}
	}
	return false
}

// Auth returns middleware that validates JWT HS256 tokens using a shared secret.
// The same secret is used by the Next.js frontend to sign tokens.
func Auth(jwtSecret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, `{"error":"invalid authorization format"}`, http.StatusUnauthorized)
				return
			}

			tokenString := parts[1]
			if len(tokenString) > 4096 {
				http.Error(w, `{"error":"token too long"}`, http.StatusUnauthorized)
				return
			}

			claims := &Claims{}
			token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return jwtSecret, nil
			})

			if err != nil || !token.Valid {
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			if claims.Issuer != "" && claims.Issuer != "grainshield" {
				http.Error(w, `{"error":"invalid token issuer"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), ClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(ClaimsKey).(*Claims)
	return claims, ok
}

func RequirePermission(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			if !claims.Can(permission) {
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r.WithContext(r.Context()))
		})
	}
}
