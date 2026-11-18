# Runbook: ml-inference

## 1. Description
The `ml-inference` component executes real-time Gradient Boosting predictions for Aflatoxin risk (A-EWS) using the IITA core engine. 

## 2. Dependencies
- **GPU Node Pool**: Strictly runs on `g4dn.xlarge` tainted node pool.
- **S3 / Core Storage**: For pulling down the 907-sample trained model artifacts on boot.
- **risk-service**: The only upstream service permitted to invoke this component.

## 3. Failure Mode & Recovery
- **Symptoms**: Inference API times out or returns HTTP 500 during model execution. GPU Out-of-Memory (OOM) errors track.
- **Recovery**: 
  - K8s recreation ensures GPU memory dumps are purged. 
  - GitOps auto-rolls back if an updated model file breaks inference accuracy / latency targets.
  - The fixed `2` replica sizes guarantee RTO constraints. No HPA is attached as the pool is fixed size `2`.

## 4. 3AM Incident Checklist
1. `kubectl logs -l app=ml-inference -n grainshield-prod`
2. **GPU Health Check**: Verify underlying AWS host if containers fail to schedule.
   `kubectl describe nodes -l node-pool=ml-inference`
3. Verify models fetched correctly from S3 buckets using `ml-inference-sealed-secrets` IAM.

## 5. Hotfix Guidelines
Consistent deploy windows: Tuesday/Thursday 10:00-14:00 EAT. Emergency updates to the A-EWS model bypass requires 2 PR approvals.
