package middleware

import (
	"io"
	"net/http"
	"regexp"
	"strings"
)

// MaxBodySize is the maximum allowed request body size (64KB).
const MaxBodySize = 64 * 1024

// MaxFieldLength is the maximum length for any text field (Security Rule #2).
const MaxFieldLength = 500

// htmlTagPattern matches HTML tags for stripping.
var htmlTagPattern = regexp.MustCompile(`<[^>]*>`)

// Sanitize returns middleware that enforces request body size limits
// and provides a sanitized body reader.
// Security Rule #2: All user input validated — type, length, format, range.
func Sanitize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Enforce maximum body size
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, MaxBodySize)
		}

		// Enforce Content-Type for POST/PUT/PATCH
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
			ct := r.Header.Get("Content-Type")
			if ct == "" || !strings.HasPrefix(ct, "application/json") {
				http.Error(w, `{"error":"content-type must be application/json"}`, http.StatusUnsupportedMediaType)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

// StripHTMLTags removes all HTML tags from a string.
func StripHTMLTags(s string) string {
	return htmlTagPattern.ReplaceAllString(s, "")
}

// SanitizeString trims whitespace, strips HTML tags, and enforces max length.
func SanitizeString(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	s = StripHTMLTags(s)
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}

// LimitReader wraps io.LimitReader for explicit size control.
func LimitReader(r io.Reader, maxBytes int64) io.Reader {
	return io.LimitReader(r, maxBytes)
}
