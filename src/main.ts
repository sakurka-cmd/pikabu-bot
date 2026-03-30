/**
 * Pikabu Pic Collector 2.0
 * Telegram Bot for tracking Pikabu posts
 */

import { PrismaClient } from '@prisma/client';
import { initBot, getBot, stopBot } from './telegram-bot';
import { getSettings, updateSettings } from './storage';

const prisma = new PrismaClient();

// Handle uncaught errors without crashing
process.on('uncaughtException', (error) => {
  console.error('[Uncaught]', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled]', reason);
});

async function main() {
  console.log('🤖 Pikabu Pic Collector 2.0');
  console.log('===========================');

  // Check environment
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const databaseUrl = process.env.DATABASE_URL || 'file:./data/bot.db';

  console.log(`[Config] DATABASE_URL: ${databaseUrl}`);
  console.log(`[Config] BOT_TOKEN: ${botToken ? 'configured' : 'missing'}`);

  // Initialize settings
  const settings = await getSettings();

  // Update token from env if provided
  if (botToken && botToken !== settings.botToken) {
    console.log('[Config] Updating bot token from environment...');
    await updateSettings({ botToken });
  }

  // Initialize bot
  const bot = await initBot();

  if (!bot) {
    console.error('[Error] Bot not initialized. Check TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }

  console.log('[Bot] Started successfully!');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Bot] Shutting down...');
    stopBot();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[Fatal]', e);
  process.exit(1);
});
