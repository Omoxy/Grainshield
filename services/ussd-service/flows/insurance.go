package flows

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/session"
	"github.com/grainshield/ussd-service/templates"
)

// HandleInsurance processes the insurance status flow.
func HandleInsurance(ctx context.Context, d *Deps, sessionID, phone, text string, state *session.State) (string, bool) {
	if len(text) > 20 {
		return templates.InvalidInput, true
	}

	switch state.Step {
	case "lookup":
		return handleInsuranceLookup(ctx, d, sessionID, phone, state)
	case "action":
		return insAction(ctx, d, sessionID, text, state)
	default:
		return templates.SessionError, false
	}
}

// handleInsuranceLookup looks up policies for the farmer's phone number.
func handleInsuranceLookup(ctx context.Context, d *Deps, sessionID, phone string, state *session.State) (string, bool) {
	policy, err := lookupPolicyByPhone(ctx, d, phone)
	if err != nil {
		d.Logger.Warn("policy lookup failed", zap.Error(err))
		return fmt.Sprintf(templates.InsNoPolicyFmt), false
	}

	if policy == nil {
		d.Sessions.Delete(ctx, sessionID)
		return fmt.Sprintf(templates.InsNoPolicyFmt), false
	}

	bags := fmt.Sprintf("%v", policy["bags"])
	value := formatKES(policy["insured_value"])
	statusStr := fmt.Sprintf("%v", policy["status"])
	daysLeft := fmt.Sprintf("%v", policy["coverage_days_left"])

	state.Step = "action"
	d.Sessions.Set(ctx, sessionID, state)

	screen := fmt.Sprintf(templates.InsStatusFmt,
		statusStr, bags, value, daysLeft)
	return screen, true
}

func insAction(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	switch text {
	case "0":
		// Return to main menu.
		state.Flow = "menu"
		state.Step = "menu"
		d.Sessions.Set(ctx, sessionID, state)
		return templates.MainMenu, true
	case "1":
		d.Sessions.Delete(ctx, sessionID)
		return templates.PriceSellFmt, false
	case "2":
		state.Flow = "loan"
		state.Step = "eligibility"
		d.Sessions.Set(ctx, sessionID, state)
		return handleLoanPlaceholder(ctx, d, sessionID, state)
	default:
		return templates.InvalidInput, true
	}
}

func handleLoanPlaceholder(ctx context.Context, d *Deps, sessionID string, state *session.State) (string, bool) {
	return templates.LoanNoPolicyFmt, false
}

// lookupPolicyByPhone calls policy-service to find an active policy.
func lookupPolicyByPhone(ctx context.Context, d *Deps, phone string) (map[string]interface{}, error) {
	reqURL := fmt.Sprintf("%s/api/v1/policies?phone=%s&status=active&limit=1", d.Services.PolicyURL, url.QueryEscape(phone))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := d.Services.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("policy-service returned %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	policies, ok := result["policies"].([]interface{})
	if !ok || len(policies) == 0 {
		return nil, nil
	}

	policy, ok := policies[0].(map[string]interface{})
	if !ok {
		return nil, nil
	}
	return policy, nil
}

func formatKES(val interface{}) string {
	switch v := val.(type) {
	case float64:
		return strconv.FormatFloat(v, 'f', 0, 64)
	case string:
		return v
	default:
		return fmt.Sprintf("%v", v)
	}
}
