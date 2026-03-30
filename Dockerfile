# Pikabu Pic Collector 2.0 - Pure Bun Runtime
FROM oven/bun:1-alpine

WORKDIR /app

# Install openssl (required for Prisma)
RUN apk add --no-cache openssl

# Copy package files
COPY package.json bun.lock* ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install

# Generate Prisma client
RUN bunx prisma generate

# Copy source
COPY src ./src
COPY tsconfig.json ./
COPY docker-entrypoint.sh ./

# Create data directory
RUN mkdir -p /app/data && chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/bot.db

# Run
CMD ["./docker-entrypoint.sh"]
