# Runbook: price-service

## 1. Description
The `price-service` aggregates real-time market data from cross-border APIs (East Africa Grain Council, WFP). 

## 2. Dependencies
- **PostgreSQL**: Caches historical price data.
- **Redis**: Acts as the immediate price read-cache to survive downstream 3rd party downtimes.
- **Kafka**: Emits price movements, potentially triggering price-lock payouts in `policy-service`.
- **External Market APIs**: Uganda/Tanzania/Kenya price boards.

## 3. Failure Mode & Recovery
- **Symptoms**: Weekly Monday price intelligence SMS drops. Traders see stale data.
- **Recovery**: 
  - Immediately defaults to reading from Redis cache. 
  - Canary rolls back entirely on high >1% error rates protecting against corrupt code logic.
  - EU-West-1 routing maintains RTO. 

## 4. 3AM Incident Checklist
1. `kubectl logs -l app=price-service -n grainshield-prod`
2. Unsealed secrets verified for external API authentication tokens.
3. Verify if external providers (EAGC) are experiencing a regional outage (check dashboards).

## 5. Hotfix Guidelines
Tuesday/Thursday 10:00-14:00 EAT deployments. Fast-tracked merges require 2 PR approvals.
