# GrainShield Platform

Stored grain insurance and market intelligence SaaS platform for smallholder maize farmers in Trans Nzoia County, Kenya.

## Architecture Overview

The system delivers services through two primary interfaces:

1. B2C Interface: Feature phone access via USSD (*384#) and SMS in Kiswahili.
2. B2B Interface: Web dashboard for enterprise partners, financial institutions, and warehouse managers.

### System Components

* Web Application: Next.js 14 App Router, TypeScript, Tailwind CSS, Prisma ORM
* USSD Session Service: Go service interfacing with Africa's Talking gateway
* Event Backbone: Apache Kafka with seven domain event topics
* Storage and Cache: PostgreSQL 16 with role isolation and Redis 7 for session cache
* Backend Microservices: farmer, policy, payment, price, risk, warehouse, notification

## Getting Started

### Prerequisites

* Docker Engine 24.0 or newer and Docker Compose v2
* Go 1.22 or newer
* Node.js 20 LTS or newer with pnpm
* OpenSSL for cryptographic key generation

### Local Setup Instructions

1. Clone the repository:
   git clone https://github.com/your-org/grainshield.git
   cd grainshield

2. Configure environment variables:
   Copy the example environment configuration template:
   cp .env.example .env

   Inspect .env and configure strong passwords for PostgreSQL, Redis, and JWT_SECRET:
   openssl rand -base64 48

3. Start backing infrastructure:
   docker compose up -d postgres redis zookeeper kafka kafka-init-topics

4. Verify event topics and database connectivity:
   bash scripts/verify-kafka.sh

5. Run microservices and web application:
   docker compose up -d

   The web dashboard will be accessible at http://localhost:3000.
   Kafka UI will be accessible at http://localhost:9080.

### Development Database Seeding

To seed sample accounts for local development:

```bash
bash scripts/dev-seed.sh
```

The script reads credentials from environment variables, hashes passwords dynamically at runtime using bcrypt, and refuses execution when NODE_ENV is production or when the database host is not local.

Notice: Anyone who previously applied migration 003 containing pre-seeded credentials must delete those records from the users table.

## Running Tests

Execute unit tests across services:

* Go microservices:
  go test ./...

* Next.js web application:
  cd grainshield-app && npm test

## Security

Please review [SECURITY.md](file:///D:/GrainSHIELD/GRAIN%202/SECURITY.md) for details on responsible vulnerability disclosure.
Never commit secrets, tokens, or personal farmer records to the repository.
