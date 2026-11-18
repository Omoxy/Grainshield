package flows

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/grainshield/ussd-service/session"
	"github.com/grainshield/ussd-service/templates"
)

// HandleVerify processes the KEBS input verification flow.
func HandleVerify(ctx context.Context, d *Deps, sessionID, phone, text string, state *session.State) (string, bool) {
	// Security: all input max 20 chars.
	if len(text) > 20 {
		return templates.InvalidInput, true
	}

	switch state.Step {
	case "prompt":
		return verifyCode(ctx, d, sessionID, text, state)
	default:
		return templates.SessionError, false
	}
}

func verifyCode(ctx context.Context, d *Deps, sessionID, text string, state *session.State) (string, bool) {
	if text == "0" {
		state.Flow = "menu"
		state.Step = "menu"
		d.Sessions.Set(ctx, sessionID, state)
		return templates.MainMenu, true
	}

	result, err := d.KEBS.Verify(ctx, text)
	if err != nil {
		d.Logger.Warn("kebs verification failed", zap.Error(err))
		d.Sessions.Delete(ctx, sessionID)
		return templates.VerifyErrorFmt, false
	}

	d.Sessions.Delete(ctx, sessionID)

	if !result.Genuine {
		return templates.VerifyFakeFmt, false
	}

	return fmt.Sprintf(templates.VerifyGenuineFmt,
		result.Manufacturer, result.ProductType, result.Certified, result.Expiry), false
}
