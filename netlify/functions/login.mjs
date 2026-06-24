// POST /api/login: authenticate the shop owner with their password.
// Body: { password }. Returns a session cookie on success.
import { readAdmin, verifyPassword, makeToken, sessionCookie } from '../lib/auth.mjs';
import { json, unauthorized, badRequest, tooManyRequests } from '../lib/respond.mjs';
import { throttleStore } from '../lib/store.mjs';

// Per-IP brute-force throttle. There is one shared password, so without a limit
// an attacker could submit unlimited online guesses. Track recent failures in
// Netlify Blobs and reject once too many land inside the rolling window.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILURES = 5; // allow up to 5 failed attempts per window

// Best-effort client IP. Prefer Netlify's context.ip, fall back to the
// connection-IP header it sets on every request.
function clientIp(request, context) {
  const ctxIp = context && typeof context.ip === 'string' ? context.ip : '';
  if (ctxIp) return ctxIp;
  try {
    const hdr = request.headers.get('x-nf-client-connection-ip');
    if (hdr) return hdr.split(',')[0].trim();
  } catch {
    /* ignore */
  }
  return 'unknown';
}

// Read the recent failure timestamps for an IP, pruned to the window.
async function recentFailures(key, now) {
  try {
    const rec = await throttleStore().get(key, { type: 'json' });
    const list = Array.isArray(rec) ? rec : [];
    return list.filter((t) => typeof t === 'number' && now - t < WINDOW_MS);
  } catch {
    return [];
  }
}

// Append the current failure and persist the pruned list. Best-effort.
async function recordFailure(key, recent, now) {
  try {
    const next = [...recent, now].slice(-MAX_FAILURES);
    await throttleStore().setJSON(key, next);
  } catch {
    /* if persistence fails we simply lose this data point */
  }
}

// Clear an IP's failure record after a successful login. Best-effort.
async function clearFailures(key) {
  try {
    await throttleStore().delete(key);
  } catch {
    /* ignore */
  }
}

export default async (request, context) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  }

  const a = await readAdmin();
  if (!a) {
    // No admin configured yet, tell the client to run setup first.
    return json(409, { needsSetup: true });
  }

  // Throttle check before doing any password work, so guessing is cheap to deny.
  const now = Date.now();
  const ipKey = `fail:${clientIp(request, context)}`;
  const recent = await recentFailures(ipKey, now);
  if (recent.length >= MAX_FAILURES) {
    const oldest = Math.min(...recent);
    const retryAfterSec = (WINDOW_MS - (now - oldest)) / 1000;
    return tooManyRequests(retryAfterSec);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid JSON body');
  }

  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!verifyPassword(password, a.salt, a.hash)) {
    await recordFailure(ipKey, recent, now);
    return unauthorized();
  }

  await clearFailures(ipKey);
  const token = await makeToken();
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(token) });
};
