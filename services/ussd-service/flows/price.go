package flows

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/session"
	"github.com/grainshield/ussd-service/templates"
)

// HandlePrice processes the price check and sell flow.
func HandlePrice(ctx context.Context, d *Deps, sessionID, phone, text string, state *session.State) (string, bool) {
	if len(text) > 20 {
		return templates.InvalidInput, true
	}

	switch state.Step {
	case "show":
		return handlePriceShow(ctx, d, sessionID, state)
	case "action":
		return priceAction(ctx, d, sessionID, text, state)
	default:
		return templates.SessionError, false
	}
}

// handlePriceShow fetches current prices from price-service and displays them.
func handlePriceShow(ctx context.Context, d *Deps, sessionID string, state *session.State) (string, bool) {
	prices, err := fetchCurrentPrices(ctx, d)
	if err != nil {
		d.Logger.Warn("price fetch failed", zap.Error(err))
		return "Bei za soko hazipatikani\nkwa sasa. Jaribu tena.\n\n0. Menyu Kuu", false
	}

	state.Step = "action"
	d.Sessions.Set(ctx, sessionID, state)

	screen := fmt.Sprintf(templates.PriceHeaderFmt, prices)
	return screen, true
}

func priceAction(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	switch text {
	case "1":
		d.Sessions.Delete(ctx, sessionID)
		return templates.PriceSellFmt, false
	case "2":
		d.Sessions.Delete(ctx, sessionID)
		return "Endelea kushika nafaka.\nBei mpya wiki ijayo.\n\n0. Menyu Kuu", false
	case "0":
		state.Flow = "menu"
		state.Step = "menu"
		d.Sessions.Set(ctx, sessionID, state)
		return templates.MainMenu, true
	default:
		return templates.InvalidInput, true
	}
}

// fetchCurrentPrices calls price-service and formats as USSD display text.
func fetchCurrentPrices(ctx context.Context, d *Deps) (string, error) {
	url := d.Services.PriceURL + "/api/v1/prices/current"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := d.Services.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("price-service returned %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}

	pricesRaw, ok := result["prices"].([]interface{})
	if !ok {
		return "Hakuna bei za sasa.", nil
	}

	var lines []string
	for i, p := range pricesRaw {
		if i >= 4 {
			break
		}
		pm, ok := p.(map[string]interface{})
		if !ok {
			continue
		}
		market := fmt.Sprintf("%v", pm["market_name"])
		price := formatKES(pm["price_per_bag"])
		lines = append(lines, fmt.Sprintf("%s: KES %s", market, price))
	}

	return strings.Join(lines, "\n"), nil
}
