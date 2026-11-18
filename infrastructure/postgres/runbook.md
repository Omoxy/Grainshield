# Runbook: postgres

## 1. Description
The core PostgreSQL datastore deployed correctly on the heavily provisioned `databases` (r5.large) node pool.

## 2. Dependencies
- Fixed specifically to `node-pool: databases` running strictly on 3 replica nodes.

## 3. Failure Mode & Recovery
- **Symptoms**: Intermittent API drops and extremely high p95 DB latencies triggering 2x SLO baseline alarms.
- **Recovery**: 
  - Standard rolling failovers between the 3 fixed instances lock RPO < 5 mins.
  - Failover DR natively synchronized to `eu-west-1`.

## 4. 3AM Incident Checklist
1. `kubectl logs -l app=postgres -n grainshield-prod --tail=100`
2. Connect to primary to check running lock states.

## 5. Hotfix Guidelines
Normal deploy windows are strictly Tuesday/Thursday 10:00-14:00 EAT. 2 PR approvals are absolutely mandatory for all database structural changes.
