import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { get, insert, run, update, nowIso } from '../db/index.js';
import { unauthorized, forbidden, badRequest } from './errors.js';

const ROUNDS = 10;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export const hashPassword = (plain) => bcrypt.hashSync(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash || '');

/** Creates a session row and returns the signed access token. */
export function issueToken(user, req) {
  const jti = crypto.randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + config.jwt.accessTtlMinutes * 60_000);
  insert('sessions', {
    id: jti,
    user_id: user.id,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    last_seen_at: issuedAt.toISOString(),
    ip: req?.ip ?? null,
    user_agent: req?.get?.('user-agent') ?? null,
  });
  const token = jwt.sign(
    { sub: user.id, role: user.role, name: user.name, jti },
    config.jwt.secret,
    { issuer: config.jwt.issuer, expiresIn: `${config.jwt.accessTtlMinutes}m` }
  );
  return { token, jti, expiresAt: expiresAt.toISOString() };
}

export function revokeSession(jti) {
  if (!jti) return;
  run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowIso(), jti]);
}

/** Verifies the bearer token and confirms the session is still live. */
export function verifyToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { issuer: config.jwt.issuer });
  } catch (err) {
    throw unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token');
  }
  const session = get('SELECT * FROM sessions WHERE id = ?', [payload.jti]);
  if (!session) throw unauthorized('Session not found');
  if (session.revoked_at) throw unauthorized('Session was signed out');
  if (new Date(session.expires_at) < new Date()) throw unauthorized('Session expired');

  const user = get(
    `SELECT u.*, d.name AS department_name, d.code AS department_code,
            dv.name AS division_name, s.name AS station_name, s.code AS station_code
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN divisions dv ON dv.id = u.division_id
       LEFT JOIN stations s ON s.id = u.station_id
      WHERE u.id = ?`,
    [payload.sub]
  );
  if (!user) throw unauthorized('User no longer exists');
  if (!user.active) throw forbidden('This account has been deactivated');

  run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [nowIso(), payload.jti]);
  return { user: publicUser(user), jti: payload.jti };
}

/** Strips secrets before a user object crosses the API boundary. */
export function publicUser(row) {
  if (!row) return null;
  const {
    password_hash: _hash,
    failed_logins: _failed,
    locked_until: _locked,
    ...rest
  } = row;
  return {
    ...rest,
    active: Boolean(row.active),
    must_change_password: Boolean(row.must_change_password),
    /** Convenience: the supervisor record this user owns, when any. */
    supervisor_id:
      get('SELECT id FROM supervisors WHERE user_id = ? AND active = 1', [row.id])?.id ?? null,
  };
}

/* ------------------------------ login attempts ---------------------------- */

export function assertNotLocked(user) {
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60_000);
    throw forbidden(`Too many failed attempts. Try again in ${mins} minute(s).`);
  }
}

export function registerFailedLogin(user) {
  const failed = (user.failed_logins ?? 0) + 1;
  const locked =
    failed >= MAX_FAILED_LOGINS
      ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
      : null;
  update('users', user.id, {
    failed_logins: failed,
    locked_until: locked,
    updated_at: nowIso(),
  });
}

export function registerSuccessfulLogin(user) {
  update('users', user.id, {
    failed_logins: 0,
    locked_until: null,
    last_login_at: nowIso(),
    updated_at: nowIso(),
  });
}

/* ---------------------------------- OTP ----------------------------------- */

export function createOtp(user, channel = 'sms') {
  const digits = '0123456789';
  let code = '';
  for (let i = 0; i < config.otp.length; i += 1) {
    code += digits[crypto.randomInt(0, digits.length)];
  }
  run('UPDATE otp_codes SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [
    nowIso(),
    user.id,
  ]);
  insert('otp_codes', {
    user_id: user.id,
    code_hash: hashPassword(code),
    channel,
    expires_at: new Date(Date.now() + config.otp.ttlMinutes * 60_000).toISOString(),
  });
  return code;
}

export function consumeOtp(user, code) {
  const row = get(
    `SELECT * FROM otp_codes
      WHERE user_id = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [user.id]
  );
  if (!row) throw badRequest('No OTP was requested for this account');
  if (new Date(row.expires_at) < new Date()) throw badRequest('OTP has expired, request a new one');
  if (row.attempts >= 5) throw badRequest('Too many incorrect OTP attempts, request a new one');
  if (!verifyPassword(String(code), row.code_hash)) {
    update('otp_codes', row.id, { attempts: row.attempts + 1 });
    throw badRequest('Incorrect OTP');
  }
  update('otp_codes', row.id, { consumed_at: nowIso() });
  return true;
}
