import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

/**
 * Generates a human-readable sequential reference number, e.g.
 *   INSP-2026-000137   OBS-2026-004821
 * The counter is derived inside the same transaction as the insert, so
 * concurrent writers cannot produce duplicates (the column is also UNIQUE).
 */
export function nextRef(table, prefix, year = new Date().getFullYear()) {
  const like = `${prefix}-${year}-%`;
  const row = getDb()
    .prepare(
      `SELECT ref_no FROM ${table} WHERE ref_no LIKE ? ORDER BY length(ref_no) DESC, ref_no DESC LIMIT 1`
    )
    .get(like);
  const last = row ? Number.parseInt(String(row.ref_no).split('-').pop(), 10) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(6, '0')}`;
}

export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');

export const uuid = () => crypto.randomUUID();
