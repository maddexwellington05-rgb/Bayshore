// POST /api/setup: first-run admin creation.
// Body: { password }. Refuses if an admin already exists.
import { readAdmin, writeAdmin, hashPassword, getSecret, makeToken, sessionCookie } from '../lib/auth.mjs';
import { ensureSeeded } from '../lib/store.mjs';
import { json, badRequest } from '../lib/respond.mjs';

export default async (request, context) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  }

  const existing = await readAdmin();
  if (existing) {
    return json(409, { error: 'already_configured' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid JSON body');
  }

  const password = body && typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) {
    return badRequest('password must be at least 8 characters');
  }

  // Persist the admin credential (salt + hash only, never the plaintext).
  await writeAdmin(hashPassword(password));

  // Ensure the signing secret exists and the content stores are seeded.
  await getSecret();
  await ensureSeeded();

  // Log the new admin straight in.
  const token = await makeToken();
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(token) });
};
