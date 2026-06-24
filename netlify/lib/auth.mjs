// netlify/lib/auth.mjs
// Password hashing, admin record, signed session tokens, and cookie helpers
// for the Bayshore CMS backend. No plaintext passwords; constant-time checks.
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import { authStore } from './store.mjs';

const SESSION_COOKIE = 'v101_session';
const DEFAULT_MAX_AGE = 2592000; // 30 days, in seconds
const SCRYPT_KEYLEN = 64;

// --- Password hashing ----------------------------------------------------

// Returns { salt, hash } as hex strings using scrypt.
export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(pw), salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

// Constant-time verification of a candidate password against stored salt/hash.
export function verifyPassword(pw, salt, hash) {
  try {
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(String(pw), salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- Admin record + signing secret --------------------------------------

// Returns the stored admin record ({ salt, hash }) or null.
export async function readAdmin() {
  try {
    const rec = await authStore().get('admin', { type: 'json' });
    return rec ?? null;
  } catch {
    return null;
  }
}

// Persists the admin record.
export async function writeAdmin(rec) {
  await authStore().setJSON('admin', rec);
  return true;
}

// Returns the HMAC signing secret, creating and persisting one if absent.
export async function getSecret() {
  const store = authStore();
  try {
    const existing = await store.get('secret', { type: 'text' });
    if (existing) return existing;
  } catch {
    /* fall through to create */
  }
  const secret = randomBytes(32).toString('hex');
  try {
    await store.set('secret', secret);
  } catch {
    /* if persistence fails we still return a usable secret for this call */
  }
  return secret;
}

// --- Session tokens (signed, stateless) ----------------------------------

// token = base64url(JSON payload {exp}) + '.' + HMAC_SHA256(secret, payloadB64) hex
export async function makeToken(maxAgeSec = DEFAULT_MAX_AGE) {
  const secret = await getSecret();
  const exp = Math.floor(Date.now() / 1000) + Number(maxAgeSec);
  const payloadB64 = base64url(JSON.stringify({ exp }));
  const sig = createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

// Recomputes the HMAC in constant time and checks expiry. Returns bool.
export async function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!payloadB64 || !sig) return false;

    const secret = await getSecret();
    const expected = createHmac('sha256', secret).update(payloadB64).digest('hex');

    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || sigBuf.length === 0) return false;
    if (!timingSafeEqual(sigBuf, expBuf)) return false;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number') return false;
    if (Math.floor(Date.now() / 1000) >= payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

// --- Cookies -------------------------------------------------------------

// Parse a raw Cookie header into an object. Tolerates undefined/empty.
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

// Build the Set-Cookie value that establishes a session.
export function sessionCookie(token, maxAgeSec = DEFAULT_MAX_AGE) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Number(maxAgeSec)}`;
}

// Build the Set-Cookie value that clears the session.
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// True if the request carries a valid, unexpired session cookie.
export async function isAuthed(request) {
  try {
    const cookies = parseCookies(request.headers.get('cookie'));
    const token = cookies[SESSION_COOKIE];
    if (!token) return false;
    return await verifyToken(token);
  } catch {
    return false;
  }
}

// --- Internal ------------------------------------------------------------

function base64url(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
