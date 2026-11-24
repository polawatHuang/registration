import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'req.headers["x-jobs-secret"]',
      'res.headers["set-cookie"]', '*.nationalId', '*.password', '*.taxId', '*.mobile', '*.email', '*.address'],
    censor: '[redacted]',
  },
});
