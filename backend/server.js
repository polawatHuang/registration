import { env } from './src/config/env.js';
import { logger } from './src/config/logger.js';
import { pool } from './src/config/db.js';
import { createApp } from './src/app.js';

// Passenger อาจกำหนด PORT เป็น socket path จึงไม่แปลงเป็นตัวเลขเสมอ
const port = /^\d+$/.test(env.PORT) ? Number(env.PORT) : env.PORT;
export const server = createApp().listen(port, (err) => {
  if (err) { logger.fatal({ err }, 'listen failed'); process.exit(1); }
  logger.info({ port: env.PORT }, 'LINE SMART TRAINING started');
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => { await pool.end().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'uncaught exception'); process.exit(1); });
