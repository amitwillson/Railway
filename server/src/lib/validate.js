import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses `data` with a zod schema, converting failures into 400s. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return result.data;
}

/** Express middleware factory: validates req.body and replaces it. */
export const body = (schema) => (req, _res, next) => {
  try {
    req.body = parse(schema, req.body ?? {});
    next();
  } catch (err) {
    next(err);
  }
};

/** Express middleware factory: validates req.query (coerced) and stores it. */
export const query = (schema) => (req, _res, next) => {
  try {
    req.validQuery = parse(schema, req.query ?? {});
    next();
  } catch (err) {
    next(err);
  }
};

export const idParam = z.coerce.number().int().positive();

/** Optional string that treats '' and 'null' as absent. */
export const optionalText = z
  .preprocess((v) => (v === '' || v === 'null' || v === null ? undefined : v), z.string().trim())
  .optional();

export const optionalId = z
  .preprocess(
    (v) => (v === '' || v === 'null' || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().positive()
  )
  .optional();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');

export const optionalIsoDate = z
  .preprocess((v) => (v === '' || v === 'null' || v === null ? undefined : v), isoDate)
  .optional();

export const boolish = z.preprocess(
  (v) => (typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()) : v),
  z.boolean()
);

export { z };
