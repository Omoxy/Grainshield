package flows

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"

	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/session"
	"github.com/grainshield/ussd-service/templates"
)

// Security Rule #2: digits only where digits are expected.
var (
	digitsOnly   = regexp.MustCompile(`^\d+$`)
	nationalIDRe = regexp.MustCompile(`^\d{6,10}$`)
	decimalRe    = regexp.MustCompile(`^\d+(\.\d{1,2})?$`)
)

// HandleRegistration processes the 6-step farmer registration flow.
func HandleRegistration(ctx context.Context, d *Deps, sessionID, phone, text string, state *session.State) (string, bool) {
	// Security: all input max 20 chars.
	if len(text) > 20 {
		return templates.InvalidInput, true
	}

	switch state.Step {
	case "language":
		return regLanguage(ctx, d, sessionID, text, state)
	case "national_id":
		return regNationalID(ctx, d, sessionID, text, state)
	case "sub_county":
		return regSubCounty(ctx, d, sessionID, text, state)
	case "hectares":
		return regHectares(ctx, d, sessionID, text, state)
	case "expected_bags":
		return regExpectedBags(ctx, d, sessionID, text, state)
	case "confirm":
		return regConfirm(ctx, d, sessionID, phone, text, state)
	default:
		return templates.SessionError, false
	}
}

func regLanguage(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	switch text {
	case "1":
		state.Language = "sw"
	case "2":
		state.Language = "en"
	default:
		return templates.InvalidInput + "\n\n" + templates.RegLanguage, true
	}
	state.Step = "national_id"
	d.Sessions.Set(ctx, sessionID, state)
	return templates.RegNationalID, true
}

func regNationalID(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	if !nationalIDRe.MatchString(text) {
		return "Nambari ya kitambulisho\nbatili. Ingiza tarakimu\n6 hadi 10.", true
	}
	state.NationalID = text
	state.Step = "sub_county"
	d.Sessions.Set(ctx, sessionID, state)
	return templates.RegSubCounty, true
}

func regSubCounty(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	idx, err := strconv.Atoi(text)
	if err != nil || idx < 1 || idx > 5 {
		return templates.InvalidInput + "\n\n" + templates.RegSubCounty, true
	}
	state.SubCounty = templates.SubCounties[idx-1]
	state.Step = "hectares"
	d.Sessions.Set(ctx, sessionID, state)
	return templates.RegHectares, true
}

func regHectares(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	if !decimalRe.MatchString(text) {
		return "Ingiza hekta kama\nnambari (mfano: 2.5)", true
	}
	val, _ := strconv.ParseFloat(text, 64)
	if val < 0.1 || val > 100 {
		return "Hekta lazima ziwe\nkati ya 0.1 na 100.", true
	}
	state.Hectares = text
	state.Step = "expected_bags"
	d.Sessions.Set(ctx, sessionID, state)
	return templates.RegExpectedFmt, true
}

func regExpectedBags(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	if !digitsOnly.MatchString(text) {
		return "Ingiza nambari ya\nmagunia (tarakimu tu).", true
	}
	bags, _ := strconv.Atoi(text)
	if bags < 1 || bags > 10000 {
		return "Magunia lazima yawe\nkati ya 1 na 10,000.", true
	}
	state.ExpectedBags = text
	state.Step = "confirm"
	d.Sessions.Set(ctx, sessionID, state)

	screen := fmt.Sprintf(templates.RegConfirmFmt,
		state.NationalID, state.SubCounty, state.Hectares, state.ExpectedBags)
	return screen, true
}

func regConfirm(ctx context.Context, d *Deps, sessionID, phone, text string, state *session.State) (string, bool) {
	if text == "9" {
		// Go back to hectares.
		state.Step = "hectares"
		d.Sessions.Set(ctx, sessionID, state)
		return templates.RegHectares, true
	}
	if text != "1" {
		return templates.InvalidInput, true
	}

	// Call farmer-service to register.
	gsNumber, err := callFarmerRegister(ctx, d, phone, state)
	if err != nil {
		d.Logger.Error("farmer registration failed", zap.Error(err))
		return templates.RegFailFmt, false
	}

	d.Sessions.Delete(ctx, sessionID)
	return fmt.Sprintf(templates.RegSuccessFmt, gsNumber), false
}

// callFarmerRegister calls POST /api/v1/farmers on farmer-service.
func callFarmerRegister(ctx context.Context, d *Deps, phone string, state *session.State) (string, error) {
	hectares, _ := strconv.ParseFloat(state.Hectares, 64)
	expectedBags, _ := strconv.Atoi(state.ExpectedBags)

	body := map[string]interface{}{
		"phone":         phone,
		"national_id":   state.NationalID,
		"sub_county":    state.SubCounty,
		"hectares":      hectares,
		"expected_bags": expectedBags,
		"language":      state.Language,
	}
	jsonBody, _ := json.Marshal(body)

	url := d.Services.FarmerURL + "/api/v1/farmers"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("create request failed: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.Services.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("farmer-service request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("farmer-service returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse response failed: %w", err)
	}

	gsNumber, _ := result["gs_number"].(string)
	if gsNumber == "" {
		return "", fmt.Errorf("no gs_number in response")
	}
	return gsNumber, nil
}
