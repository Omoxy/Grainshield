# Runbook: risk-service

## 1. Description
The `risk-service` calculates premium adjustments based on live A-EWS aflatoxin vulnerability scores and Copernicus satellite data.

## 2. Dependencies
- **PostgreSQL**: Stores risk boundary configurations.
- **Kafka**: Triggering events for payout evaluations.
- **ml-inference**: Calls the internal ML component for custom scorings.
- **External**: ESA Copernicus / IITA A-EWS.

## 3. Failure Mode & Recovery
- **Symptoms**: Premium computations fail resulting in blocked checkout flows for new smart contracts. Missing extension officer dashboard data.
- **Recovery**: 
  - Fails back to gracefully degraded static premium tiers temporarily. 
  - HPA CPU scaling and 1% error GitOps auto-rollback.

## 4. 3AM Incident Checklist
1. `kubectl logs -l app=risk-service -n grainshield-prod`
2. Validate if `ml-inference` models are responding inside the K8s cluster.
3. Check regional external API accessibility.

## 5. Hotfix Guidelines
Normal deploy windows are Tuesday/Thursday 10:00-14:00 EAT. Hotfixes bypass require exactly 2 GitHub PR approvals for SOC 2.
