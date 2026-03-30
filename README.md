# Pikabu Pic Collector 2.0

Telegram bot for tracking Pikabu posts by tags and authors.

## Features

- Tag Sets with include/exclude filters
- Author subscriptions with preview mode
- Admin panel for user management
- Auto parsing every 30 minutes

## Docker

```bash
# Build
docker build -t pikabu-bot:latest .

# Run
docker run -d --name pikabu-bot \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -v pikabu-data:/app/data \
  pikabu-bot:latest
```

## Local Development

```bash
bun install
bunx prisma generate
TELEGRAM_BOT_TOKEN=your_token bun run src/main.ts
```

## Bot Commands

- `/start` - Start bot
- `/menu` - Main menu
- `/status` - Statistics
- `/admin` - Admin panel (admin only)
- `/parse` - Manual parse (admin only)

## Tech Stack

- **Runtime**: Bun
- **Database**: SQLite + Prisma
- **API**: node-telegram-bot-api
- **Parser**: Cheerio
