# Runbook: warehouse-service

## 1. Description
The `warehouse-service` handles IoT sensor ingestion for warehouse conditions and acts as the point of integration for NCPB clerks logging in grain assets.

## 2. Dependencies
- **PostgreSQL**: Granular asset tracking.
- **Kafka**: Emits IoT telemetry (`humidity-events`).
- **Redis**: Rate limits incoming IoT pings.

## 3. Failure Mode & Recovery
- **Symptoms**: Clerks cannot deposit farmer bags. Humidity sensors drop payload reports, delaying climate payouts.
- **Recovery**: 
  - IoT endpoints queue locally and automatically replay bursts to `warehouse-service` on recovery.
  - HPA auto-scaler mitigates sudden bursts.
  - EU-West-1 routing maintains RTO < 15 mins.

## 4. 3AM Incident Checklist
1. `kubectl logs -l app=warehouse-service -n grainshield-prod`
2. Are IoT MQTT/HTTP bridges healthy?
3. Verify NCPB VPN connections if applicable.

## 5. Hotfix Guidelines
Normal deploy windows: Tuesday/Thursday 10:00-14:00 EAT. Bypassing requires 2 PR approvals for continuous SOC 2 verification.
