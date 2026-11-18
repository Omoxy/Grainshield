// Package kafka defines Kafka topic constants for the price-service.
// Kafka topic naming: grainshield.<service>.<entity>.<event>
package kafka

const (
	// TopicPriceUpdated is published when new price data is ingested.
	TopicPriceUpdated = "grainshield.intelligence.price.updated"

	// TopicPriceSMSGenerated is published when the Monday cron generates SMS content.
	TopicPriceSMSGenerated = "grainshield.intelligence.price.sms_generated"
)
