import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

/**
 * A development JWT secret is generated once and cached on disk so that
 * restarting `npm run dev` does not invalidate every open session. In
 * production JWT_SECRET is mandatory - the server refuses to boot without it.
 */
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProduction) {
    throw new Error(
      'JWT_SECRET is required when NODE_ENV=production. Refusing to start with an ephemeral secret.'
    );
  }
  const cacheFile = path.join(dataDir, '.dev-jwt-secret');
  try {
    if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8').trim();
    const generated = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(48).toString('hex');
  }
}

export const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(SERVER_ROOT, 'data');

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  dbFile: process.env.DB_FILE
    ? path.resolve(process.env.DB_FILE)
    : path.join(dataDir, 'railway-inspection.sqlite'),
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(dataDir, 'uploads'),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 25),
  webOrigins: (process.env.WEB_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:4000',
  jwt: {
    get secret() {
      return resolveJwtSecret();
    },
    accessTtlMinutes: int(process.env.SESSION_TIMEOUT_MINUTES, 60),
    issuer: 'railway-inspection-suite',
  },
  otp: {
    ttlMinutes: int(process.env.OTP_TTL_MINUTES, 10),
    length: int(process.env.OTP_LENGTH, 6),
    /** When true the OTP is returned by the API - development convenience only. */
    echoInResponse: bool(process.env.OTP_ECHO, !isProduction),
  },
  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true),
    /** Runs TDC reminder + escalation sweep. Default 07:30 every day. */
    cron: process.env.SCHEDULER_CRON || '30 7 * * *',
    timezone: process.env.SCHEDULER_TZ || 'Asia/Kolkata',
  },
  notifications: {
    emailEnabled: bool(process.env.EMAIL_ENABLED, false),
    smsEnabled: bool(process.env.SMS_ENABLED, false),
    smtpUrl: process.env.SMTP_URL || '',
    smsGatewayUrl: process.env.SMS_GATEWAY_URL || '',
    fromEmail: process.env.FROM_EMAIL || 'no-reply@railway-inspection.local',
  },
  seed: {
    defaultPassword: process.env.SEED_PASSWORD || 'Railway@2026',
  },
  trustProxy: bool(process.env.TRUST_PROXY, false),
  logFormat: process.env.LOG_FORMAT || (isProduction ? 'combined' : 'dev'),
};

export default config;
