# Runbook: policy-service

## 1. Description
The `policy-service` is the core system responsible for generating and parsing parametric insurance smart contracts for GrainShield farmers. It connects the farmer's grain deposit to the blockchain ledger and rules engine.

## 2. Dependencies
- **PostgreSQL**: Stores policy state (hosted on `databases` r5.large node pool).
- **Kafka**: Consumes events and produces `policy-created` broadcasts.
- **Redis**: Rate-limiting and session cache.
- **farmer-service**: Validates farmer identity upstream.

## 3. Failure Mode & Recovery
- **Symptoms**: Farmers attempting to register grain deposits receive timeouts or HTTP 500s. Warehouse clerks cannot execute intake. Kafka consumer lag for `policy-events` spikes over 1000.
- **Recovery Strategy**: 
  - GitOps pipeline is configured to auto-rollback if error rate > 1% or latency > 2x SLO.
  - If a complete zonal failure occurs in `af-south-1`, switch Route53 traffic strictly to `eu-west-1` to maintain RTO < 15 minutes and RPO < 5 minutes.

## 4. 3AM Incident Checklist
If paged outside normal working hours:

1. **Verify State**:
   ```bash
   kubectl get pods -n grainshield-prod -l app=policy-service
   kubectl logs -n grainshield-prod -l app=policy-service --tail=200
   ```
2. **Check Auto-Rollback**:
   Did the canary deployment (10% → 50% → 100%) get halted by Prometheus?
   Verify GitOps controller status:
   ```bash
   flux get kustomizations
   ```
3. **Database Health**:
   Are the 3 fixed `r5.large` database nodes healthy?
   ```bash
   kubectl get nodes -l node-pool=databases
   ```
4. **Secrets Authentication**:
   If experiencing `Unauthorized` between microservices, verify that the Sealed Secrets operator correctly unsealed `policy-service-sealed-secrets`.
   No plain-text secrets should be found dynamically injected; verify AWS Secrets Manager sync.

## 5. Hotfix Guidelines
- Deploy windows are Tuesday/Thursday 10:00-14:00 EAT. 
- **Bypassing the window for a hotfix requires 2 approvals** in GitHub before merging to the main branch. Once merged, ArgoCD/Flux will reconcile the state.
