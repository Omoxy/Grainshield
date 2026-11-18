// Package trigger provides the inter-service HTTP client for the policy-service.
// Security Rule #9: Error responses never expose upstream service details.
package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ServiceClient provides typed HTTP calls to sibling microservices.
type ServiceClient struct {
	riskURL    string
	priceURL   string
	paymentURL string
	httpClient *http.Client
	logger     *zap.Logger
}

// NewServiceClient creates a client with a 10-second timeout.
func NewServiceClient(riskURL, priceURL, paymentURL string, logger *zap.Logger) *ServiceClient {
	return &ServiceClient{
		riskURL:  riskURL,
		priceURL: priceURL,
		paymentURL: paymentURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}
}


// AflatoxinScore mirrors risk-service's response.
type AflatoxinScore struct {
	ID               uuid.UUID `json:"id"`
	SubCounty        string    `json:"sub_county"`
	RiskScore        float64   `json:"risk_score"`
	RiskLevel        string    `json:"risk_level"`
	ContaminationPPB float64   `json:"contamination_ppb"`
	Confidence       float64   `json:"confidence"`
	ModelVersion     string    `json:"model_version"`
	RecordedAt       time.Time `json:"recorded_at"`
}

// AflatoxinResponse is the risk-service /risk/aflatoxin response.
type AflatoxinResponse struct {
	Scores     []AflatoxinScore `json:"scores"`
	AlertCount int              `json:"alert_count"`
	Threshold  float64          `json:"threshold"`
}

// SensorReading mirrors risk-service's sensor data.
type SensorReading struct {
	SensorID       string    `json:"sensor_id"`
	SensorType     string    `json:"sensor_type"`
	Value          float64   `json:"value"`
	Unit           string    `json:"unit"`
	AlertTriggered bool      `json:"alert_triggered"`
	RecordedAt     time.Time `json:"recorded_at"`
}

// SensorResponse is the risk-service /risk/sensors/{id} response.
type SensorResponse struct {
	WarehouseID uuid.UUID       `json:"warehouse_id"`
	Readings    []SensorReading `json:"readings"`
	PeriodHours int             `json:"period_hours"`
}

// WeatherEvent represents a weather event from the risk service dashboard.
type WeatherEvent struct {
	SubCounty    string  `json:"sub_county"`
	WeatherEvent bool    `json:"weather_event"`
	EventType    string  `json:"event_type"`
	Humidity     float64 `json:"humidity"`
	RainfallMM   float64 `json:"rainfall_mm"`
}

// DashboardResponse is the risk-service /risk/dashboard response.
type DashboardResponse struct {
	AflatoxinRisks      []SubCountyRisk `json:"aflatoxin_risks"`
	ActiveSensorAlerts  int             `json:"active_sensor_alerts"`
	RecentWeatherEvents int             `json:"recent_weather_events"`
}

// SubCountyRisk is from the risk dashboard.
type SubCountyRisk struct {
	SubCounty string  `json:"sub_county"`
	Score     float64 `json:"score"`
	Level     string  `json:"level"`
}


// MarketPrice mirrors price-service's response.
type MarketPrice struct {
	Source      string    `json:"source"`
	MarketName  string    `json:"market_name"`
	PricePerBag float64   `json:"price_per_bag"`
	Currency    string    `json:"currency"`
	Trend       string    `json:"trend"`
	RecordedAt  time.Time `json:"recorded_at"`
}

// PriceResponse is the price-service /prices/current response.
type PriceResponse struct {
	Prices    []MarketPrice `json:"prices"`
	BestPrice float64       `json:"best_price"`
}


// GetAflatoxinRisk calls risk-service GET /api/v1/risk/aflatoxin.
func (c *ServiceClient) GetAflatoxinRisk(ctx context.Context, subCounty string) (*AflatoxinResponse, error) {
	url := fmt.Sprintf("%s/api/v1/risk/aflatoxin?sub_county=%s", c.riskURL, subCounty)
	resp, err := c.doGet(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("risk service unavailable")
	}
	defer resp.Body.Close()

	var result AflatoxinResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.logger.Error("failed to decode aflatoxin response", zap.Error(err))
		return nil, fmt.Errorf("risk service response invalid")
	}
	return &result, nil
}

// GetSensorData calls risk-service GET /api/v1/risk/sensors/{warehouseId}.
func (c *ServiceClient) GetSensorData(ctx context.Context, warehouseID uuid.UUID, hours int) (*SensorResponse, error) {
	url := fmt.Sprintf("%s/api/v1/risk/sensors/%s?hours=%d", c.riskURL, warehouseID.String(), hours)
	resp, err := c.doGet(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("risk service unavailable")
	}
	defer resp.Body.Close()

	var result SensorResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.logger.Error("failed to decode sensor response", zap.Error(err))
		return nil, fmt.Errorf("risk service response invalid")
	}
	return &result, nil
}

// GetDashboard calls risk-service GET /api/v1/risk/dashboard.
func (c *ServiceClient) GetDashboard(ctx context.Context) (*DashboardResponse, error) {
	url := fmt.Sprintf("%s/api/v1/risk/dashboard", c.riskURL)
	resp, err := c.doGet(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("risk service unavailable")
	}
	defer resp.Body.Close()

	var result DashboardResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.logger.Error("failed to decode dashboard response", zap.Error(err))
		return nil, fmt.Errorf("risk service response invalid")
	}
	return &result, nil
}

// GetCurrentPrices calls price-service GET /api/v1/prices/current.
func (c *ServiceClient) GetCurrentPrices(ctx context.Context) (*PriceResponse, error) {
	url := fmt.Sprintf("%s/api/v1/prices/current", c.priceURL)
	resp, err := c.doGet(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("price service unavailable")
	}
	defer resp.Body.Close()

	var result PriceResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.logger.Error("failed to decode price response", zap.Error(err))
		return nil, fmt.Errorf("price service response invalid")
	}
	return &result, nil
}

// RequestPayout calls payment-service POST /api/v1/payments/disburse.
func (c *ServiceClient) RequestPayout(ctx context.Context, payload map[string]interface{}) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/v1/payments/disburse", c.paymentURL)

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payout request")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, io.NopCloser(
		io.Reader(jsonReader(body)),
	))
	if err != nil {
		return nil, fmt.Errorf("payment service unavailable")
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Error("payment service call failed", zap.Error(err))
		return nil, fmt.Errorf("payment service unavailable")
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("payment service response invalid")
	}
	return result, nil
}

// doGet performs a GET request with context.
func (c *ServiceClient) doGet(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Error("inter-service call failed",
			zap.String("url", url),
			zap.Error(err),
		)
		return nil, err
	}

	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, fmt.Errorf("upstream returned %d", resp.StatusCode)
	}

	return resp, nil
}

// jsonReader wraps a byte slice as an io.Reader.
type jsonReaderType struct {
	data []byte
	pos  int
}

func jsonReader(data []byte) *jsonReaderType {
	return &jsonReaderType{data: data}
}

func (r *jsonReaderType) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
