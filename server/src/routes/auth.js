import express from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { all, get, nowIso, run, update } from '../db/index.js';
import {
  assertNotLocked, consumeOtp, createOtp, hashPassword, issueToken, publicUser,
  registerFailedLogin, registerSuccessfulLogin, revokeSession, verifyPassword,
} from '../lib/auth.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { authenticate } from '../middleware/auth.js';
import { asyncRoute } from '../lib/http.js';
import { body, z } from '../lib/validate.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.isProduction ? 20 : 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please wait a few minutes' } },
});

const findUser = (identifier) =>
  get(
    `SELECT * FROM users
      WHERE lower(employee_id) = lower(?) OR lower(email) = lower(?) OR mobile = ?`,
    [identifier, identifier, identifier]
  );

/* --------------------------------- login ---------------------------------- */

router.post(
  '/login',
  loginLimiter,
  body(z.object({ identifier: z.string().min(2), password: z.string().min(1) })),
  (req, res) => {
    const user = findUser(req.body.identifier);
    if (!user) throw unauthorized('Invalid credentials');
    assertNotLocked(user);
    if (!user.active) throw forbidden('This account has been deactivated');
    if (!verifyPassword(req.body.password, user.password_hash)) {
      registerFailedLogin(user);
      throw unauthorized('Invalid credentials');
    }
    registerSuccessfulLogin(user);
    const { token, expiresAt } = issueToken(user, req);
    req.user = publicUser(user);
    audit(req, { action: 'LOGIN', entityType: 'user', entityId: user.id, next: { method: 'password' } });
    res.json({ token, expires_at: expiresAt, user: req.user });
  }
);

/* ---------------------------------- OTP ----------------------------------- */

router.post(
  '/otp/request',
  loginLimiter,
  body(z.object({ identifier: z.string().min(2) })),
  asyncRoute(async (req, res) => {
    const user = findUser(req.body.identifier);
    // Do not leak which identifiers exist.
    if (!user || !user.active) {
      res.json({ sent: true, channel: 'sms', message: 'If the account exists an OTP has been sent' });
      return;
    }
    assertNotLocked(user);
    const code = createOtp(user, user.mobile ? 'sms' : 'email');
    const masked = user.mobile ? `******${String(user.mobile).slice(-4)}` : user.email;
    const { dispatch } = await import('../lib/notify.js');
    await dispatch({
      event: 'OTP_LOGIN',
      recipientsOverride: [user.id],
      extraVars: { otp: code },
      link: '/login',
    }).catch(() => {});
    res.json({
      sent: true,
      channel: user.mobile ? 'sms' : 'email',
      target: masked,
      expires_in_minutes: config.otp.ttlMinutes,
      ...(config.otp.echoInResponse ? { dev_otp: code } : {}),
    });
  })
);

router.post(
  '/otp/verify',
  loginLimiter,
  body(z.object({ identifier: z.string().min(2), code: z.string().min(4) })),
  (req, res) => {
    const user = findUser(req.body.identifier);
    if (!user) throw unauthorized('Invalid credentials');
    assertNotLocked(user);
    consumeOtp(user, req.body.code);
    registerSuccessfulLogin(user);
    const { token, expiresAt } = issueToken(user, req);
    req.user = publicUser(user);
    audit(req, { action: 'LOGIN', entityType: 'user', entityId: user.id, next: { method: 'otp' } });
    res.json({ token, expires_at: expiresAt, user: req.user });
  }
);

/* ------------------------------- session ---------------------------------- */

router.get('/me', authenticate, (req, res) => {
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [
    req.user.id,
  ]).n;
  res.json({ user: req.user, unread_notifications: unread, session_timeout_minutes: config.jwt.accessTtlMinutes });
});

router.post('/logout', authenticate, (req, res) => {
  revokeSession(req.jti);
  audit(req, { action: 'LOGOUT', entityType: 'user', entityId: req.user.id });
  res.json({ ok: true });
});

router.get('/sessions', authenticate, (req, res) => {
  res.json({
    data: all(
      `SELECT id, issued_at, expires_at, last_seen_at, ip, user_agent, revoked_at
         FROM sessions WHERE user_id = ? ORDER BY issued_at DESC LIMIT 25`,
      [req.user.id]
    ).map((s) => ({ ...s, current: s.id === req.jti })),
  });
});

router.delete('/sessions/:id', authenticate, (req, res) => {
  const session = get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [
    req.params.id,
    req.user.id,
  ]);
  if (!session) throw notFound('Session');
  revokeSession(session.id);
  audit(req, { action: 'SESSION_REVOKE', entityType: 'session', entityId: session.id });
  res.json({ ok: true });
});

router.post(
  '/change-password',
  authenticate,
  body(
    z.object({
      current_password: z.string().min(1),
      new_password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Za-z]/, 'Password must contain a letter')
        .regex(/[0-9]/, 'Password must contain a digit'),
    })
  ),
  (req, res) => {
    const row = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(req.body.current_password, row.password_hash)) {
      throw badRequest('Current password is incorrect');
    }
    update('users', row.id, {
      password_hash: hashPassword(req.body.new_password),
      must_change_password: 0,
      updated_at: nowIso(),
    });
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', [
      nowIso(), row.id, req.jti,
    ]);
    audit(req, { action: 'PASSWORD_CHANGE', entityType: 'user', entityId: row.id });
    res.json({ ok: true, message: 'Password updated. Other sessions were signed out.' });
  }
);

/**
 * Demo credential helper. Exposed only outside production so the evaluation
 * build can be opened without hunting through the seed script.
 */
router.get('/demo-users', (req, res) => {
  if (config.isProduction) throw forbidden('Not available in production');
  res.json({
    password: config.seed.defaultPassword,
    data: all(
      `SELECT u.employee_id, u.name, u.role, u.designation, d.name AS department
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.active = 1 ORDER BY CASE u.role
          WHEN 'admin' THEN 1 WHEN 'divisional_officer' THEN 2 WHEN 'inspector' THEN 3
          WHEN 'supervisor' THEN 4 ELSE 5 END, u.name LIMIT 40`
    ),
  });
});

export default router;
