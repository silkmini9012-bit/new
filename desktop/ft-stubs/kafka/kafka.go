// Package kafka (stub): DriveLog does not use Kafka.
package kafka

import (
	"errors"

	logrus "github.com/teslamotors/fleet-telemetry/logger"

	confluent "github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/teslamotors/fleet-telemetry/metrics"
	"github.com/teslamotors/fleet-telemetry/server/airbrake"
	"github.com/teslamotors/fleet-telemetry/telemetry"
)

// NewProducer always fails in this build.
func NewProducer(config *confluent.ConfigMap, namespace string, prometheusEnabled bool, metricsCollector metrics.MetricCollector, airbrakeHandler *airbrake.Handler, ackChan chan (*telemetry.Record), reliableAckTxTypes map[string]interface{}, logger *logrus.Logger) (telemetry.Producer, error) {
	return nil, errors.New("kafka is not supported in this build")
}
