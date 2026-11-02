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

## Setup

Install [Node.js](https://nodejs.org/) (LTS), [Yarn](https://yarnpkg.com/), and Docker (for Postgres and Redis).

```bash
yarn install
cp .env.example .env
```

Fill in `.env`. Do not commit it. `JWT_EXPIRY` is seconds (`86400` is one day).

Start Postgres and Redis:

```bash
docker compose up -d postgres redis
```

Apply migrations and load the dev seed:

```bash
npx prisma migrate dev
yarn cmd seed
```

`yarn cmd seed` does not write product rows until T-BE-027.

## Run

```bash
yarn start:dev
```

The API listens on `PORT` from `.env` (example: `http://localhost:4000`).

Production start, after `yarn build`:

```bash
yarn start:prod
```
