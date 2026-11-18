# Runbook: farmer-service

## 1. Description
The `farmer-service` is the entrypoint for farmer digital KYC and onboarding. 

## 2. Dependencies
- **PostgreSQL**: Stores unified farmer profiles.
- **Redis**: Caching and rate limiting user queries.
- **Kafka**: Emits user state changes for downstream indexation.

## 3. Failure Mode & Recovery
- **Symptoms**: New farmers cannot register via USSD *384#. Validation queries from `policy-service` timeout, blocking contract binding.
- **Recovery**: 
  - HPA auto-scales if CPU jumps.
  - Canary rolls back on > 1% error.
  - Global DNS switches to `eu-west-1` DR region on `af-south-1` complete failure (RTO < 15min, RPO < 5min).

## 4. 3AM Incident Checklist
1. `kubectl logs -l app=farmer-service -n grainshield-prod`
2. Check `SealedSecrets` for the Farmer JWT encryption keys syncing.
3. Verify Postgres connectivity on `databases` fixed nodes.

## 5. Hotfix Guidelines
Standard Deploy window: Tuesday/Thursday 10:00-14:00 EAT. Hotfixes require 2 GitHub PR approvals for SOC 2 compliance.
