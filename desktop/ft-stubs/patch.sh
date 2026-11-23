#!/usr/bin/env bash
# fleet-telemetry 소스를 cgo 없이 (Windows용) 빌드할 수 있게 Kafka/ZMQ를 빈 구현으로 바꾼다.
set -euo pipefail
FT="$1"; STUBS="$(cd "$(dirname "$0")" && pwd)"
rm -f "$FT"/datastore/kafka/*.go "$FT"/datastore/zmq/*.go
cp "$STUBS/kafka/kafka.go" "$FT/datastore/kafka/kafka.go"
cp "$STUBS/zmq/zmq.go" "$FT/datastore/zmq/zmq.go"
rm -rf "$FT/stubs-confluent" && cp -r "$STUBS/confluent" "$FT/stubs-confluent"
(cd "$FT" && go mod edit -replace github.com/confluentinc/confluent-kafka-go/v2=./stubs-confluent)
