// Package mpesa implements the Safaricom M-Pesa Daraja API v2 client.
// Security Rule #1: Credentials from environment only.
// Security Rule #7: Circuit breaker with exponential backoff.
package mpesa

import (
	"time"

	"github.com/google/uuid"
)

// OAuthResponse is the Daraja OAuth token response.
type OAuthResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   string `json:"expires_in"` // seconds as string, e.g. "3599"
}

// B2CRequest is the payload for POST /mpesa/b2c/v3/paymentrequest.
type B2CRequest struct {
	InitiatorName      string `json:"InitiatorName"`
	SecurityCredential string `json:"SecurityCredential"`
	CommandID          string `json:"CommandID"`
	Amount             int64  `json:"Amount"`
	PartyA             string `json:"PartyA"`             // Shortcode
	PartyB             string `json:"PartyB"`             // Phone number (254...)
	Remarks            string `json:"Remarks"`
	QueueTimeOutURL    string `json:"QueueTimeOutURL"`
	ResultURL          string `json:"ResultURL"`
	Occasion           string `json:"Occasion"`
}

// B2CResponse is the synchronous response from Daraja.
type B2CResponse struct {
	ConversationID           string `json:"ConversationID"`
	OriginatorConversationID string `json:"OriginatorConversationID"`
	ResponseCode             string `json:"ResponseCode"` // "0" = accepted
	ResponseDescription      string `json:"ResponseDescription"`
}

// CallbackResult is the top-level callback payload from Daraja.
type CallbackResult struct {
	Result CallbackResultBody `json:"Result"`
}

// CallbackResultBody contains the result details.
type CallbackResultBody struct {
	ResultType               int                `json:"ResultType"`
	ResultCode               int                `json:"ResultCode"`
	ResultDesc               string             `json:"ResultDesc"`
	OriginatorConversationID string             `json:"OriginatorConversationID"`
	ConversationID           string             `json:"ConversationID"`
	TransactionID            string             `json:"TransactionID"`
	ResultParameters         *ResultParameters  `json:"ResultParameters,omitempty"`
}

// ResultParameters holds the key-value result items.
type ResultParameters struct {
	ResultParameter []ResultItem `json:"ResultParameter"`
}

// ResultItem is a single key-value pair in the callback.
type ResultItem struct {
	Key   string      `json:"Key"`
	Value interface{} `json:"Value"`
}

// DisbursementAttempt tracks a single B2C attempt for audit trail.
type DisbursementAttempt struct {
	AttemptID      uuid.UUID `json:"attempt_id"`
	PaymentID      uuid.UUID `json:"payment_id"`
	ConversationID string    `json:"conversation_id"`
	ResponseCode   string    `json:"response_code"`
	AttemptNumber  int       `json:"attempt_number"`
	AttemptedAt    time.Time `json:"attempted_at"`
}

// CircuitState represents the circuit breaker state.
type CircuitState int

const (
	CircuitClosed   CircuitState = iota // Normal operation
	CircuitOpen                         // Failing, reject calls
	CircuitHalfOpen                     // Testing recovery
)
