import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from './config';
import { apiRouter } from './http/api';
import { authenticate, errorHandler, HttpError } from './http/middleware';
import type { Engine } from './services/engine';
import { UserRepository } from './security/userRepository';

/** Express app factory — no listen(), so tests can mount it with supertest. */
export function createApp(engine: Engine, config: AppConfig, users: UserRepository = new UserRepository(null)) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  // larger body only for the dev PPG recording endpoint (~600 frames × 4 numbers)
  app.use('/api/citizen/ppg-debug', express.json({ limit: '256kb' }));
  app.use(express.json({ limit: '32kb' }));
  // Drop 3: measure every API response (shown live on the dispatcher panel)
  app.use('/api', engine.latency.middleware());
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMin,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'RATE_LIMITED' },
    }),
  );
  app.use(authenticate(config.jwtSecret, users));
  app.use('/api', apiRouter(engine, users));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND')));
  app.use(errorHandler);
  return app;
}
