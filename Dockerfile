# Pikabu Pic Collector 2.0 - Optimized Bun Runtime
FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

# Install bun
RUN npm install -g bun

# Copy package files
COPY package.json ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install

# Generate Prisma client
RUN bunx prisma generate

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Create data directory
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/bot.db

# Run
CMD ["bun", "run", "src/main.ts"]
