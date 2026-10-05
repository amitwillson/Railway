/**
 * Express 4 does not forward rejected promises to the error handler, so every
 * async route handler is wrapped with this.
 */
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Sets caching + content headers for a generated download. */
export function download(res, { fileName, contentType }) {
  res.setHeader('content-type', contentType);
  res.setHeader('content-disposition', `attachment; filename="${fileName}"`);
  res.setHeader('cache-control', 'no-store');
}

export const paging = (q) => ({
  page: Math.max(1, Number(q?.page) || 1),
  pageSize: Math.min(200, Math.max(1, Number(q?.page_size) || 25)),
});
