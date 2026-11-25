import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { securityHeaders } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import { api } from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(pinoHttp({
    logger, genReqId: () => crypto.randomUUID(),
    // ไม่บันทึก query string (มี code/state ของ LINE และคำค้นหา)
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url.split('?')[0] }), res: (r) => ({ statusCode: r.statusCode }) },
    customLogLevel: (_q, r, err) => (err || r.statusCode >= 500 ? 'error' : r.statusCode >= 400 ? 'warn' : 'info'),
    autoLogging: { ignore: (r) => !r.url.startsWith('/api/') },
  }));
  app.use(securityHeaders);
  app.use(cookieParser());
  const json = express.json({ limit: '100kb' });
  // เส้นทางคลังความรู้รับข้อความยาว จึงใช้ parser ของตัวเองหลังตรวจสิทธิ์แล้ว
  app.use('/api/v1', (req, res, next) => (req.path.startsWith('/ai/knowledge') || req.path === '/line/webhook' ? next() : json(req, res, next)), api);
  app.use(express.static(env.frontendPath, { dotfiles: 'deny', extensions: ['html'], maxAge: env.isProd ? '1h' : 0 }));
  app.use((_req, res) => res.status(404).sendFile('404.html', { root: env.frontendPath }));
  app.use(errorHandler);
  return app;
}
