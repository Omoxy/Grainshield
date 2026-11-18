#!/usr/bin/env bash
# GrainShield — Verify Kafka broker is running and all required topics exist.
# Usage: bash scripts/verify-kafka.sh
# Requires: docker must be running with gs-kafka container up.

set -euo pipefail

BROKER="localhost:29092"
CONTAINER="gs-kafka"
EXPECTED_TOPICS=(
  "grainshield.policy.insurance.triggered"
  "grainshield.payment.disbursement.completed"
  "grainshield.payment.disbursement.failed"
  "grainshield.payment.disbursement.dlq"
  "grainshield.risk.score.updated"
  "grainshield.risk.weather.confirmed"
  "grainshield.intelligence.price.updated"
  "grainshield.intelligence.price.sms_generated"
)

echo "═══════════════════════════════════════════════════════════"
echo "  GrainShield Kafka Verification"
echo "═══════════════════════════════════════════════════════════"

# 1. Check container is running
echo ""
echo "[1/3] Checking gs-kafka container..."
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "  ✓ Container ${CONTAINER} is running"
else
  echo "  ✗ Container ${CONTAINER} is NOT running"
  echo "  → Run: docker-compose up -d"
  exit 1
fi

# 2. Check broker is reachable
echo ""
echo "[2/3] Checking broker connectivity on ${BROKER}..."
if docker exec "${CONTAINER}" kafka-broker-api-versions \
  --bootstrap-server localhost:9092 > /dev/null 2>&1; then
  echo "  ✓ Kafka broker is reachable"
else
  echo "  ✗ Kafka broker is NOT reachable"
  exit 1
fi

# 3. Verify all topics exist
echo ""
echo "[3/3] Verifying required topics..."
ACTUAL_TOPICS=$(docker exec "${CONTAINER}" kafka-topics \
  --bootstrap-server localhost:9092 --list 2>/dev/null)

MISSING=0
for topic in "${EXPECTED_TOPICS[@]}"; do
  if echo "${ACTUAL_TOPICS}" | grep -q "^${topic}$"; then
    echo "  ✓ ${topic}"
  else
    echo "  ✗ MISSING: ${topic}"
    MISSING=$((MISSING + 1))
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "${MISSING}" -eq 0 ]; then
  echo "  All 8 topics verified. Kafka event backbone is ready."
  echo "  Kafka UI available at: http://localhost:9080"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ${MISSING} topic(s) missing. Run: docker-compose up kafka-init-topics"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
