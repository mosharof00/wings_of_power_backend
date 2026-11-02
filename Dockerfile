# ----------------------------------------------------------------------
# Stage 1: Build application
# ----------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install native compilation dependencies for bcrypt / node-gyp and OpenSSL for Prisma
RUN apk add --no-cache libc6-compat openssl python3 make g++

# Copy package manifests
COPY package.json yarn.lock ./

# Install all dependencies (including devDependencies required for build)
RUN yarn install --frozen-lockfile

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma Client (builds engine for Linux Alpine)
RUN npx prisma generate

# Copy project configuration and application source
COPY tsconfig*.json nest-cli.json prisma.config.ts ./
COPY src ./src/

# Compile TypeScript
RUN yarn build

# Ensure query engine binary is available in dist/prisma/generated
RUN cp -f prisma/generated/libquery_engine* dist/prisma/generated/ 2>/dev/null || true

# Prune devDependencies for clean production runtime
RUN rm -rf node_modules && yarn install --production --frozen-lockfile && yarn cache clean

# ----------------------------------------------------------------------
# Stage 2: Production runtime
# ----------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Runtime libraries required by Prisma query engine
RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV PORT=4000

# Copy package manifests and production dependencies
COPY package.json yarn.lock ./
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=builder /usr/src/app/prisma ./prisma
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist

USER node

EXPOSE 4000

CMD ["node", "dist/src/main"]
