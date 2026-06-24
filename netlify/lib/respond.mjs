// netlify/lib/respond.mjs
// Small JSON Response helpers shared by the Bayshore CMS functions.

// Build a JSON Response. `headers` is merged over the default content-type,
// so callers can add Cache-Control, Set-Cookie, etc.
export function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
  });
}

export const unauthorized = () => json(401, { error: 'unauthorized' });
export const badRequest = (m) => json(400, { error: m || 'bad request' });

// 429 with an optional Retry-After (seconds) so clients can back off.
export const tooManyRequests = (retryAfterSec) =>
  json(
    429,
    { error: 'too_many_requests' },
    retryAfterSec ? { 'Retry-After': String(Math.ceil(retryAfterSec)) } : undefined
  );
