// Package zmq (stub): DriveLog does not use ZMQ.
package zmq

import (
	"context"
	"errors"

	logrus "github.com/teslamotors/fleet-telemetry/logger"

	"github.com/teslamotors/fleet-telemetry/metrics"
	"github.com/teslamotors/fleet-telemetry/server/airbrake"
	"github.com/teslamotors/fleet-telemetry/telemetry"
)

// Config keeps the JSON shape accepted by fleet-telemetry.
type Config struct {
	Addr string `json:"addr"`
}

// NewProducer always fails in this build.
func NewProducer(ctx context.Context, config *Config, metrics metrics.MetricCollector, namespace string, airbrakeHandler *airbrake.Handler, ackChan chan (*telemetry.Record), reliableAckTxTypes map[string]interface{}, logger *logrus.Logger) (telemetry.Producer, error) {
	return nil, errors.New("zmq is not supported in this build")
}
