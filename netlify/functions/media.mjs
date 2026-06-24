// /api/media: image upload + serve, backed by Netlify Blobs.
//   POST  { filename, contentType, dataBase64 }  (auth required)  -> stores image, returns { ok, key, url }
//   GET   ?key=...                               (public)         -> serves the image bytes
import { randomBytes } from 'node:crypto';
import { mediaStore } from '../lib/store.mjs';
import { isAuthed } from '../lib/auth.mjs';
import { json, unauthorized, badRequest } from '../lib/respond.mjs';

// ~6MB ceiling on the decoded image. Base64 inflates bytes ~4/3, so we cap the
// raw byte length rather than the base64 string length.
const MAX_BYTES = 6 * 1024 * 1024;

// Map common image content types to a file extension for the blob key.
const EXT_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

function extFromContentType(contentType) {
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct];
  // Fallback: derive from the subtype (e.g. image/foo -> .foo).
  const sub = ct.startsWith('image/') ? ct.slice('image/'.length).replace(/\+.*$/, '') : '';
  return sub ? '.' + sub.replace(/[^a-z0-9]/g, '') : '.bin';
}

export default async (request) => {
  const method = request.method;

  // ---- GET: public read by key ----
  if (method === 'GET') {
    const key = new URL(request.url).searchParams.get('key');
    if (!key) return badRequest('missing key');

    const store = mediaStore();
    const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!result || !result.data) {
      return json(404, { error: 'not_found' });
    }
    const { data, metadata } = result;
    const contentType =
      (metadata && metadata.contentType) ? metadata.contentType : 'image/jpeg';
    return new Response(Buffer.from(data), {
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  // ---- POST: authenticated upload ----
  if (method === 'POST') {
    if (!(await isAuthed(request))) return unauthorized();

    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest('invalid JSON body');
    }

    const filename = body && typeof body.filename === 'string' ? body.filename : '';
    const contentType = body && typeof body.contentType === 'string' ? body.contentType : '';
    const dataBase64 = body && typeof body.dataBase64 === 'string' ? body.dataBase64 : '';

    const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
    const ct = contentType.toLowerCase().split(';')[0].trim();
    if (!ALLOWED.has(ct)) {
      return badRequest('Please upload a JPG, PNG, WebP, GIF, or AVIF image.');
    }
    if (!dataBase64) {
      return badRequest('missing dataBase64');
    }

    let buffer;
    try {
      buffer = Buffer.from(dataBase64, 'base64');
    } catch {
      return badRequest('invalid base64 data');
    }
    if (!buffer.length) {
      return badRequest('empty image data');
    }
    if (buffer.length > MAX_BYTES) {
      return badRequest('image exceeds 6MB limit');
    }

    const key = 'm_' + randomBytes(8).toString('hex') + extFromContentType(contentType);
    await mediaStore().set(key, buffer, {
      metadata: { contentType, filename },
    });

    return json(200, { ok: true, key, url: '/api/media?key=' + key });
  }

  return json(405, { error: 'method_not_allowed' }, { allow: 'GET, POST' });
};
