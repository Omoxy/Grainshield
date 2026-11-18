// Package httputil provides shared HTTP response utilities for GrainShield
// microservices. Extract once, use everywhere — no more copy-pasted
// respondJSON/respondError across every service handler package.
package httputil

import (
	"encoding/json"
	"net/http"
)

// RespondJSON writes a JSON response with the given status code and
// sets security headers. data may be nil for empty-body responses.
//
// Security Rule #9: Error responses never expose internal details.
func RespondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if data != nil {
		if err := json.NewEncoder(w).Encode(data); err != nil {
			// If encoding fails, the status code is already written.
			// Log internally if you have a logger — but never expose internals.
			http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		}
	}
}

// RespondError writes a JSON error response with a safe client message.
// Security Rule #9: Never expose stack traces or SQL errors to client.
func RespondError(w http.ResponseWriter, status int, message string) {
	RespondJSON(w, status, map[string]string{"error": message})
}

// RespondOK is a convenience shorthand for 200 responses.
func RespondOK(w http.ResponseWriter, data interface{}) {
	RespondJSON(w, http.StatusOK, data)
}

// RespondCreated is a convenience shorthand for 201 responses.
func RespondCreated(w http.ResponseWriter, data interface{}) {
	RespondJSON(w, http.StatusCreated, data)
}

// RespondNoContent writes a 204 No Content response.
func RespondNoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}
