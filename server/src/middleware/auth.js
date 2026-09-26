import { verifyToken } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/errors.js';

const bearer = (req) => {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return req.query?.access_token ? String(req.query.access_token) : null;
};

/** Requires a valid, live session. Populates req.user and req.jti. */
export function authenticate(req, _res, next) {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const { user, jti } = verifyToken(token);
    req.user = user;
    req.jti = jti;
    next();
  } catch (err) {
    next(err);
  }
}

/** Populates req.user when a token is present but never rejects the request. */
export function optionalAuth(req, _res, next) {
  try {
    const token = bearer(req);
    if (token) {
      const { user, jti } = verifyToken(token);
      req.user = user;
      req.jti = jti;
    }
  } catch {
    /* anonymous */
  }
  next();
}

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  OFFICER: 'divisional_officer',
  INSPECTOR: 'inspector',
  SUPERVISOR: 'supervisor',
  VIEWER: 'viewer',
});

/**
 * Capability matrix. Row-level checks (e.g. "only the raising officer may
 * verify this observation") live in the route handlers; this table answers the
 * coarse "may this role reach this endpoint at all" question.
 */
const CAPABILITIES = {
  admin: ['*'],
  divisional_officer: [
    'inspection:read', 'inspection:create', 'inspection:update',
    'observation:read', 'observation:create', 'observation:update', 'observation:verify',
    'observation:cancel', 'compliance:read', 'dashboard:read', 'report:read',
    'master:read', 'supervisor:read', 'audit:read', 'notification:read',
  ],
  inspector: [
    'inspection:read', 'inspection:create', 'inspection:update',
    'observation:read', 'observation:create', 'observation:update', 'observation:verify',
    'compliance:read', 'dashboard:read', 'report:read', 'master:read',
    'supervisor:read', 'notification:read',
  ],
  supervisor: [
    'inspection:read', 'observation:read', 'compliance:read', 'compliance:submit',
    'observation:acknowledge', 'dashboard:read', 'report:read', 'master:read',
    'supervisor:read', 'notification:read',
  ],
  viewer: [
    'inspection:read', 'observation:read', 'compliance:read', 'dashboard:read',
    'report:read', 'master:read', 'supervisor:read', 'notification:read',
  ],
};

export function can(user, capability) {
  if (!user) return false;
  const list = CAPABILITIES[user.role] ?? [];
  return list.includes('*') || list.includes(capability);
}

/** Route guard for a capability from the matrix above. */
export const requireCapability = (capability) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!can(req.user, capability)) {
    return next(forbidden(`Your role (${req.user.role}) cannot perform "${capability}"`));
  }
  return next();
};

/** Route guard for an explicit role list. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(forbidden(`This action is restricted to: ${roles.join(', ')}`));
  }
  return next();
};

export const isAdmin = (user) => user?.role === ROLES.ADMIN;
export const isOfficer = (user) => user?.role === ROLES.OFFICER || isAdmin(user);
