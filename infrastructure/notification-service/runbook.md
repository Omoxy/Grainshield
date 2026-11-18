# Runbook: notification-service

## 1. Description
The `notification-service` is responsible for sending out critical SMS confirmations for Smart Contract bindings, payouts to M-Pesa, and processing bi-directional USSD *384# requests from farmers.

## 2. Dependencies
- **PostgreSQL**: Hosted on the 3 fixed `r5.large` `databases` node pool. Stores SMS templates and communication audit logs.
- **Kafka**: Consumes events from the `notification-events` topic to trigger asynchronous SMS sending.
- **Redis**: Stores rate-limiting counters to prevent spamming Safaricom APIs.
- **Safaricom Gateway**: Handles the physical dispatching of SMS and USSD routing.

## 3. Failure Mode & Recovery
- **Symptoms**: High Kafka consumer lag on `notification-events`. USSD *384# responds with "Service Unavailable". 
- **Data Loss Mechanics**: Because actions are decoupled via Kafka, all queued SMS messages remain safely in the Kafka topic buffer (RPO < 5 minutes). No messages are dropped.
- **Recovery Procedure**:
  - HPA auto-scales pods up to `20` maximum instances on `t3.medium` nodes to handle lag.
  - If a bad deployment occurs (error > 1% / latency > 2x SLO), the system automatically aborts the 10%→50%→100% canary and rolls back.
  - In a complete loss of `af-south-1`, global Route53 DNS automatically directs traffic to `eu-west-1` DR, fulfilling the RTO < 15 minute mandate.

## 4. 3AM Incident Checklist
1. **Verify Live State**:
   ```bash
   kubectl get pods -n grainshield-prod -l app=notification-service
   ```
2. **Review Rollback Logs**:
   ```bash
   kubectl logs -n grainshield-prod -l app=notification-service --tail=200 | grep "error"
   ```
3. **Verify Third-Party Gateway**:
   Check if the Safaricom USSD gateway is experiencing regional issues.
4. **Secret Injection Verification**:
   If experiencing `401 Unauthorized` with the SMS vendor, confirm that `notification-service-sealed-secrets` are cleanly synced via AWS Secrets Manager and unsealed properly without plain-text configurations.

## 5. Hotfix Guidelines
Normal deploy windows are limited to Tuesday/Thursday 10:00-14:00 EAT. 
**EMERGENCY HOTFIX BYPASS**: You must secure two (2) senior engineering approvals on the GitHub PR strictly enforcing SOC 2 access controls before the commit can be merged to main to trigger the CD pipeline.
