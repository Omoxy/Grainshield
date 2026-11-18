package flows

import (
	"context"
	"fmt"
	"math"
	"strconv"

	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/session"
	"github.com/grainshield/ussd-service/templates"
)

// HandleLoan processes the warehouse receipt micro-credit flow.
func HandleLoan(ctx context.Context, d *Deps, sessionID, phone, text string, state *session.State) (string, bool) {
	if len(text) > 20 {
		return templates.InvalidInput, true
	}

	switch state.Step {
	case "eligibility":
		return handleLoanEligibility(ctx, d, sessionID, phone, state)
	case "amount":
		return loanAmount(ctx, d, sessionID, text, state)
	case "confirm":
		return loanConfirm(ctx, d, sessionID, text, state)
	default:
		return templates.SessionError, false
	}
}

// handleLoanEligibility checks if farmer has stored grain and shows loan eligibility.
func handleLoanEligibility(ctx context.Context, d *Deps, sessionID, phone string, state *session.State) (string, bool) {
	policy, err := lookupPolicyByPhone(ctx, d, phone)
	if err != nil || policy == nil {
		d.Logger.Warn("loan eligibility: no policy found", zap.Error(err))
		d.Sessions.Delete(ctx, sessionID)
		return templates.LoanNoPolicyFmt, false
	}

	insuredValue := 0.0
	switch v := policy["insured_value"].(type) {
	case float64:
		insuredValue = v
	case string:
		insuredValue, _ = strconv.ParseFloat(v, 64)
	}

	if insuredValue <= 0 {
		d.Sessions.Delete(ctx, sessionID)
		return templates.LoanNoPolicyFmt, false
	}

	maxLoan := math.Floor(insuredValue * 0.60)
	state.Step = "amount"
	state.LoanAmount = fmt.Sprintf("%.0f", maxLoan)
	d.Sessions.Set(ctx, sessionID, state)

	screen := fmt.Sprintf(templates.LoanEligFmt,
		formatKES(insuredValue), formatKES(maxLoan))
	return screen, true
}

func loanAmount(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	if !digitsOnly.MatchString(text) {
		return "Ingiza kiasi kama\nnambari (tarakimu tu).", true
	}

	amount, _ := strconv.ParseFloat(text, 64)
	maxLoan, _ := strconv.ParseFloat(state.LoanAmount, 64)

	if amount < 100 || amount > maxLoan {
		return fmt.Sprintf("Kiasi lazima kiwe kati\nya KES 100 na KES %s.", state.LoanAmount), true
	}

	fee := math.Ceil(amount * 0.04)
	net := amount - fee
	state.LoanAmount = text
	state.Step = "confirm"
	d.Sessions.Set(ctx, sessionID, state)

	screen := fmt.Sprintf(templates.LoanConfirmFmt,
		formatKES(amount), formatKES(fee), formatKES(net))
	return screen, true
}

func loanConfirm(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	switch text {
	case "1":
		amount := state.LoanAmount
		fee := 0.0
		amountF, _ := strconv.ParseFloat(amount, 64)
		fee = math.Ceil(amountF * 0.04)
		net := amountF - fee

		d.Sessions.Delete(ctx, sessionID)
		return fmt.Sprintf(templates.LoanSuccessFmt, formatKES(net)), false
	case "9":
		state.Step = "amount"
		d.Sessions.Set(ctx, sessionID, state)
		maxLoan := state.LoanAmount
		return fmt.Sprintf(templates.LoanEligFmt, "—", maxLoan), true
	default:
		return templates.InvalidInput, true
	}
}
