# Runbook: payment-service

## 1. Description
The `payment-service` coordinates M-Pesa premium deductions and automated smart contract payouts.

## 2. Dependencies
- **PostgreSQL**: Stores transaction ledgers securely.
- **Kafka**: Receives payout triggers asynchronously.
- **Redis**: Safaricom API token caching and rate limiting.
- **M-Pesa / Bank APIs**: For actual funds movement.

## 3. Failure Mode & Recovery
- **Symptoms**: Payouts to farmers fail or premium deductions drop resulting in unsigned contracts. Kafka lag spikes.
- **Recovery**: 
  - Payments are fully idempotent and safe to retry automatically from the Kafka stream (RPO < 5min).
  - Canary rolls back on > 1% HTTP error rate automatically.
  - EU-West-1 DR failover guarantees RTO < 15mins.

## 4. 3AM Incident Checklist
1. `kubectl logs -l app=payment-service -n grainshield-prod`
2. **CRITICAL**: Confirm `payment-service-sealed-secrets` are unsealed to allow M-Pesa B2C/C2B connections.
3. **Double-Spend Check**: Validate idempotent keys in PostgreSQL if auto-recovering from a deep crash.

## 5. Hotfix Guidelines
Tuesday/Thursday 10:00-14:00 EAT. Hotfixes require 2 GitHub PR approvals for SOC 2 Compliance ensuring payment code is strictly audited.
