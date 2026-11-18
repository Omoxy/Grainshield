// Package flows implements the USSD conversation flows for GrainShield *384#.
package flows

import (
	"context"
	"net/http"

	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/kebs"
	"github.com/grainshield/ussd-service/session"
	"github.com/grainshield/ussd-service/templates"
)

// ServiceClients holds HTTP base URLs for backend services.
type ServiceClients struct {
	FarmerURL string
	PolicyURL string
	PriceURL  string
	HTTP      *http.Client
}

// Deps aggregates all dependencies needed by USSD flows.
type Deps struct {
	Sessions *session.Store
	Services *ServiceClients
	KEBS     *kebs.Client
	Logger   *zap.Logger
}

// HandleMenu dispatches the main menu or routes to the appropriate flow.
func HandleMenu(ctx context.Context, d *Deps, sessionID, phone, text string) (string, bool) {
	// New session — show main menu.
	if text == "" {
		d.Sessions.Set(ctx, sessionID, &session.State{Step: "menu", Flow: "menu"})
		return templates.MainMenu, true
	}

	// Check for existing session state.
	state, err := d.Sessions.Get(ctx, sessionID)
	if err != nil {
		d.Logger.Error("session get failed", zap.Error(err))
		return templates.SessionError, false
	}

	// No existing state — treat as fresh menu selection.
	if state == nil {
		state = &session.State{Step: "menu", Flow: "menu"}
	}

	// If in a flow, delegate to that flow.
	switch state.Flow {
	case "registration":
		return HandleRegistration(ctx, d, sessionID, phone, text, state)
	case "insurance":
		return HandleInsurance(ctx, d, sessionID, phone, text, state)
	case "price":
		return HandlePrice(ctx, d, sessionID, phone, text, state)
	case "loan":
		return HandleLoan(ctx, d, sessionID, phone, text, state)
	case "verify":
		return HandleVerify(ctx, d, sessionID, phone, text, state)
	}

	// Menu selection.
	switch text {
	case "1":
		state.Flow = "registration"
		state.Step = "language"
		d.Sessions.Set(ctx, sessionID, state)
		return templates.RegLanguage, true
	case "2":
		state.Flow = "insurance"
		state.Step = "lookup"
		d.Sessions.Set(ctx, sessionID, state)
		return handleInsuranceLookup(ctx, d, sessionID, phone, state)
	case "3":
		state.Flow = "price"
		state.Step = "show"
		d.Sessions.Set(ctx, sessionID, state)
		return handlePriceShow(ctx, d, sessionID, state)
	case "4":
		state.Flow = "loan"
		state.Step = "eligibility"
		d.Sessions.Set(ctx, sessionID, state)
		return handleLoanEligibility(ctx, d, sessionID, phone, state)
	case "5":
		state.Flow = "verify"
		state.Step = "prompt"
		d.Sessions.Set(ctx, sessionID, state)
		return templates.VerifyPrompt, true
	default:
		return templates.InvalidInput + "\n\n" + templates.MainMenu, true
	}
}
