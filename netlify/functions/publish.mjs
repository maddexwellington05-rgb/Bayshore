// POST /api/publish -> promote the current draft to published (auth required)
import { readContent, writeContent, readSeed } from '../lib/store.mjs';
import { isAuthed } from '../lib/auth.mjs';
import { json, unauthorized } from '../lib/respond.mjs';

export default async (request, context) => {
  if (request.method.toUpperCase() !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  }

  if (!(await isAuthed(request))) return unauthorized();

  // Fall back to the bundled seed if no draft has ever been written.
  // readSeed is synchronous, so the || fallback already compares resolved values.
  const draft = (await readContent('draft')) || readSeed();
  if (!draft || typeof draft !== 'object' || !draft.site) {
    return json(409, { error: 'nothing_to_publish', message: 'There is no saved draft to publish yet.' });
  }
  await writeContent('published', draft);

  return json(200, { ok: true });
};
