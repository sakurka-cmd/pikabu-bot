#!/bin/sh
set -e

echo "Initializing database..."
bunx prisma db push --skip-generate

echo "Starting bot..."
exec bun run src/main.ts
