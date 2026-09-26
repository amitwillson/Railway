import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import config, { REPO_ROOT } from './config.js';
import { getDb, get } from './db/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import masterRoutes from './routes/masters.js';
import inspectionRoutes from './routes/inspections.js';
import observationRoutes from './routes/observations.js';
import complianceRoutes from './routes/compliance.js';
import dashboardRoutes from './routes/dashboard.js';
import historyRoutes from './routes/history.js';
import reportRoutes from './routes/reports.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import syncRoutes from './routes/sync.js';
import adminRoutes from './routes/admin.js';
import fileRoutes from './routes/files.js';

export function createApp() {
  getDb(); // open + migrate before serving traffic

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      // The SPA is served from the same origin in production builds.
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              mediaSrc: ["'self'", 'data:', 'blob:'],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", 'data:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.webOrigins.includes(origin) || !config.isProduction) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    })
  );
  /**
   * Evidence and generated reports are opened directly by the browser (an
   * <img> or a download), which cannot carry an Authorization header, so those
   * requests pass the session token as a query parameter. Redact it before
   * anything is written to the access log.
   */
  morgan.token('url', (req) => {
    const url = req.originalUrl || req.url || '';
    return url.replace(/([?&](?:access_token|token)=)[^&]*/gi, '$1[redacted]');
  });

  app.use(compression());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  if (config.env !== 'test') app.use(morgan(config.logFormat));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.isProduction ? 300 : 5000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down a little' } },
    })
  );

  app.get('/api/health', (_req, res) => {
    let dbOk = true;
    try {
      get('SELECT 1 AS ok');
    } catch {
      dbOk = false;
    }
    res.json({
      status: dbOk ? 'ok' : 'degraded',
      service: 'railway-inspection-api',
      version: '1.0.0',
      environment: config.env,
      time: new Date().toISOString(),
      database: dbOk ? 'connected' : 'unavailable',
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/masters', masterRoutes);
  app.use('/api/inspections', inspectionRoutes);
  app.use('/api/observations', observationRoutes);
  app.use('/api/compliance', complianceRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/files', fileRoutes);

  // Serve the built PWA when it exists, so a single process can host everything.
  const webDist = path.join(REPO_ROOT, 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
            res.setHeader('cache-control', 'no-cache');
          }
        },
      })
    );
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      return res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export default createApp;
