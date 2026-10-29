# NestJS Backend Project

A robust backend application built with NestJS, featuring real-time capabilities, job queues, authentication, and Docker support.

## 🛠 Technology Stack

This project utilizes a modern stack of technologies:

- **Core Framework:** [NestJS](https://nestjs.com/) (Node.js)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Database:** [PostgreSQL](https://www.postgresql.org/) with [Prisma ORM](https://www.prisma.io/)
- **Caching & Queues:** [Redis](https://redis.io/) and [BullMQ](https://docs.bullmq.io/)
- **Real-time:** [Socket.io](https://socket.io/) (WebSockets)
- **Authentication:** Passport.js (JWT, OAuth2 via Google/Facebook)
- **Payment Processing:** Stripe
- **DevOps:** Docker & Docker Compose
- **Monitoring:** Prometheus & Grafana

## 🚀 Getting Started

Follow these instructions to get the project up and running on your local machine.

### Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Yarn](https://yarnpkg.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (for Database & Redis)

### 1. Installation

Install the dependencies:

```bash
yarn install
```

### 2. Environment Configuration

1. Copy the example environment file:

   ```bash
   # Linux/Mac
   cp .env.example .env

   # Windows
   copy .env.example .env
   ```

2. Open `.env` and populate it with your specific configurations (Database URL, Redis config, Stripe keys, etc.).

### 3. Database Setup

Start the required infrastructure (Postgres, Redis) using Docker:

```bash
docker compose up -d postgres redis
```

Run database migrations and seed initial data:

```bash
# Apply migrations
npx prisma migrate dev

# Seed database with dummy data
yarn cmd seed
```

### 4. Running the Application

Choose a command to start the server:

```bash
# Development mode (Watch)
yarn start:dev

# Development mode using SWC (Faster compilation)
yarn start:dev-swc

# Production mode
yarn start:prod
```

The application will typically start on `http://localhost:4000` (check your `.env` PORT).

### 5. Running with Docker Compose

To run the full application stack including the backend app, database, and monitoring tools:

```bash
docker compose up
```

## 📚 API Documentation

Verified API endpoints are available via Swagger:

- **URL:** `http://localhost:4000/api/docs`

## 💳 Stripe Configuration

For handling payments:

- **Webhook URL:** `http://{domain_name}/api/payment/stripe/webhook`

**Local Development (Stripe CLI):**

```bash
stripe listen --forward-to localhost:4000/api/payment/stripe/webhook
```

**Test Trigger:**

```bash
stripe trigger payment_intent.succeeded
```
