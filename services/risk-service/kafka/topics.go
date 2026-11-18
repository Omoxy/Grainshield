// Package kafka defines Kafka topic constants for the risk-service.
// Kafka topic naming: grainshield.<service>.<entity>.<event>
package kafka

const (
	// TopicRiskScoreUpdated is published when a new aflatoxin risk score is ingested.
	TopicRiskScoreUpdated = "grainshield.risk.score.updated"

	// TopicWeatherEventConfirmed is published when Copernicus confirms a weather event.
	TopicWeatherEventConfirmed = "grainshield.risk.weather.confirmed"
)
