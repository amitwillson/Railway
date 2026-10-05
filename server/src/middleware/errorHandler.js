import { AppError } from '../lib/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

/* eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity */
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return res.status(409).json({
      error: { code: 'DUPLICATE', message: 'A record with these details already exists', details: err.message },
    });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(400).json({
      error: { code: 'INVALID_REFERENCE', message: 'A referenced master record does not exist' },
    });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_CHECK') {
    return res.status(400).json({
      error: { code: 'INVALID_VALUE', message: 'A value is outside the allowed set', details: err.message },
    });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Attachment exceeds the size limit' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  console.error('[error]', err);
  return res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong while processing the request',
      ...(process.env.NODE_ENV === 'production' ? {} : { details: err?.message }),
    },
  });
}
