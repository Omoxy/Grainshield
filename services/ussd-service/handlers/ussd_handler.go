// Package handlers implements the Africa's Talking USSD webhook handler.
// Security: all USSD input is attacker-controlled — validate everything.
package handlers

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"time"

	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/flows"
	"github.com/grainshield/ussd-service/session"
)

const (
	// ussdHandlerTimeout is the maximum time for a single USSD request.
	// 5 seconds buffer before Africa's Talking 30-second timeout.
	ussdHandlerTimeout = 25 * time.Second

	// maxInputLength is the maximum allowed USSD input length.
	maxInputLength = 20
)

// sessionIDPattern validates Africa's Talking session IDs.
var sessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9\-]{1,100}$`)

// phonePattern validates E.164 phone numbers.
var phonePattern = regexp.MustCompile(`^\+\d{10,13}$`)

// USSDHandler handles Africa's Talking USSD webhook callbacks.
type USSDHandler struct {
	deps *flows.Deps
}

// NewUSSDHandler creates a new USSD webhook handler.
func NewUSSDHandler(deps *flows.Deps) *USSDHandler {
	return &USSDHandler{deps: deps}
}

// HandleCallback processes the Africa's Talking USSD POST callback.
// Africa's Talking sends: sessionId, serviceCode, phoneNumber, text.
// Response format: "CON <text>" to continue, "END <text>" to end session.
func (h *USSDHandler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), ussdHandlerTimeout)
	defer cancel()

	if err := r.ParseForm(); err != nil {
		h.respond(w, false, "END "+fmt.Sprintf(session.StepTTL.String()))
		return
	}

	sessionID := r.FormValue("sessionId")
	phone := r.FormValue("phoneNumber")
	text := r.FormValue("text")

	// Security: validate session ID format.
	if !sessionIDPattern.MatchString(sessionID) {
		h.deps.Logger.Warn("invalid session ID format")
		h.respond(w, false, "END Tatizo la mfumo.")
		return
	}

	// Security: validate phone number format.
	if !phonePattern.MatchString(phone) {
		h.deps.Logger.Warn("invalid phone number format")
		h.respond(w, false, "END Tatizo la mfumo.")
		return
	}

	// Security: enforce max input length.
	if len(text) > maxInputLength {
		text = text[:maxInputLength]
	}

	// Rate limit: 1 session per phone per 60 seconds for new sessions.
	if text == "" {
		limited, err := h.deps.Sessions.CheckRateLimit(ctx, phone)
		if err != nil {
			h.deps.Logger.Error("rate limit check failed", zap.Error(err))
		}
		if limited {
			h.respond(w, false, "END Tafadhali subiri dakika\nmoja kabla ya kujaribu\ntena.")
			return
		}
		h.deps.Sessions.SetRateLimit(ctx, phone)
	}

	// Extract only the last input segment (Africa's Talking sends cumulative text).
	lastInput := extractLastInput(text)

	// Process the USSD flow.
	response, continues := flows.HandleMenu(ctx, h.deps, sessionID, phone, lastInput)

	if continues {
		h.respond(w, true, "CON "+response)
	} else {
		h.respond(w, false, "END "+response)
	}
}

func (h *USSDHandler) respond(w http.ResponseWriter, _ bool, text string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, text)
}

// extractLastInput gets the last user input from the cumulative text.
// Africa's Talking sends "1*2*3" for multi-step sessions.
func extractLastInput(text string) string {
	if text == "" {
		return ""
	}
	for i := len(text) - 1; i >= 0; i-- {
		if text[i] == '*' {
			return text[i+1:]
		}
	}
	return text
}
