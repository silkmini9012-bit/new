// Package kafka is a minimal stub so fleet-telemetry builds without cgo (Kafka is not used by DriveLog).
package kafka

// ConfigValue mirrors confluent's type.
type ConfigValue interface{}

// ConfigMap mirrors confluent's type.
type ConfigMap map[string]ConfigValue
