# Wings of Power — API

NestJS API for the Wings of Power student app and the teacher/admin dashboard.

## Stack

- NestJS 11 and TypeScript
- PostgreSQL with Prisma
- Redis and BullMQ (mail queue)
- Socket.io
- Passport JWT

Swagger UI: `http://localhost:4000/api/docs`

Export the OpenAPI specification to `docs/openapi.json`:

```bash
yarn openapi:export
```

## Setup & Local Development

Install [Node.js](https://nodejs.org/) (LTS), [Yarn](https://yarnpkg.com/), and Docker (for Postgres and Redis).

1. Install dependencies:
   ```bash
   yarn install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in `.env` (see [Environment Variables](#environment-variables)). Do not commit `.env`.

3. Start local infrastructure (Postgres and Redis):
   ```bash
   docker compose up -d postgres redis
   ```

4. Apply Prisma migrations and load dev seed:
   ```bash
   npx prisma migrate dev
   yarn cmd seed
   ```

5. Run development server:
   ```bash
   yarn start:dev
   ```

The API listens on `PORT` from `.env` (default: `http://localhost:4000`).

## Environment Variables

| Variable | Description | Example / Default |
|---|---|---|
| `APP_NAME` | Application name displayed in emails and swagger | `Wings of Power` |
| `APP_KEY` | Application secret / cryptographic key | `secret` |
| `PORT` | HTTP port the application listens on | `4000` |
| `APP_URL` | Base public URL of backend API | `http://localhost:4000` |
| `CLIENT_APP_URL` | Dashboard/client frontend URL (CORS origin) | `http://localhost:3000` |
| `SESSION_SECRET` | Secret key used for session encryption | `secret` |
| `JWT_SECRET` | Secret key used to sign and verify JSON Web Tokens | `secret` |
| `JWT_EXPIRY` | Token validity duration in **seconds** (86400 = 1 day) | `86400` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:root@localhost:5432/wings_of_power` |
| `REDIS_HOST` | Redis host | `localhost` (or `redis` in Docker) |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Optional Redis authentication password | *(empty)* |
| `MAIL_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `MAIL_PORT` | SMTP port | `587` |
| `MAIL_USERNAME` | SMTP account username | `name@gmail.com` |
| `MAIL_PASSWORD` | SMTP account password | *(empty)* |
| `MAIL_FROM_ADDRESS` | Outgoing email sender address | `name@gmail.com` |
| `MAIL_FROM_NAME` | Outgoing email sender display name | `Wings of Power` |
| `AWS_*` / `GCP_*` | Cloud storage credentials for uploaded media | *(optional in dev)* |
| `SEED_ADMIN_EMAIL` | Dev seed admin email | `admin@demo.school` |
| `SEED_ADMIN_PASSWORD` | Dev seed admin password | `change-me` |
| `SEED_TEACHER_EMAIL` | Dev seed teacher email | `teacher@demo.school` |
| `SEED_TEACHER_PASSWORD` | Dev seed teacher password | `change-me` |
| `SEED_STUDENT_PASSWORD` | Dev seed student password | `change-me` |

## Production & Docker Deployment

### Building and Running with Docker Compose

Build and start the complete production stack (Postgres, Redis, and compiled backend):

```bash
docker compose up --build
```

### Database Migrations in Production

Prisma schema is compiled into the image, but database migrations are applied explicitly by the operator rather than on container boot (never auto-migrate on boot).

Run pending migrations before or alongside deployment:

```bash
# On host:
npx prisma migrate deploy

# Or inside a one-off compose container:
docker compose run --rm app npx prisma migrate deploy
```

To run seed in a Docker environment:

```bash
docker compose run --rm app yarn cmd seed
```

### Production Host Build (Without Docker)

```bash
yarn build
yarn start:prod
```
