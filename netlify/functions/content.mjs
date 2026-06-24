// GET /api/content?state=published|draft  -> raw content object
// PUT /api/content                          -> save request body as draft (auth required)
import { ensureSeeded, readContent, writeContent, readSeed, withDefaults } from '../lib/store.mjs';
import { isAuthed } from '../lib/auth.mjs';
import { json, unauthorized, badRequest } from '../lib/respond.mjs';

export default async (request, context) => {
  const method = request.method.toUpperCase();

  if (method === 'GET') {
    const state = new URL(request.url).searchParams.get('state') || 'published';

    // Only published content is readable without a session.
    if (state === 'draft' && !(await isAuthed(request))) {
      return unauthorized();
    }

    await ensureSeeded();
    let content = await readContent(state);

    // If the backfill failed, readContent can still be null. Fall back to the
    // bundled seed; if that is also unavailable, return a guaranteed value so
    // public hydration always has an object to read fields off of.
    if (content === null) content = readSeed();

    // Backfill any seed keys missing from stored content (e.g. sections added
    // after the owner first set up the CMS) so the admin and the live site
    // never show a newly added section blank.
    if (content) content = withDefaults(content);

    const cacheControl =
      state === 'draft' ? 'no-store' : 'public, max-age=30';

    if (content === null) {
      if (state === 'draft') {
        return json(503, { error: 'content_unavailable' }, { 'cache-control': cacheControl });
      }
      // Published: hand back an empty object so hydration simply skips overrides.
      return json(200, {}, { 'cache-control': cacheControl });
    }

    return json(200, content, { 'cache-control': cacheControl });
  }

  if (method === 'PUT') {
    if (!(await isAuthed(request))) return unauthorized();

    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest('invalid json');
    }

    // Basic shape validation: must be an object carrying a top-level 'site' key.
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.site !== 'object' ||
      body.site === null
    ) {
      return badRequest('content must be an object with a site key');
    }

    // Coarse size guard so a multi-megabyte draft (e.g. base64 pasted into a
    // text field) cannot write straight to Blobs, mirroring the media cap.
    if (JSON.stringify(body).length > 512 * 1024) {
      return badRequest('content is too large');
    }

    await writeContent('draft', body);
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' }, { allow: 'GET, PUT' });
};
