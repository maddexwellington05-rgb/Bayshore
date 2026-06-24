// netlify/lib/store.mjs
// Netlify Blobs access + content/seed helpers for the Bayshore CMS backend.
// Three logical stores: content (published/draft), auth (admin + secret), media (uploads).
import { getStore } from '@netlify/blobs';
import { readFileSync } from 'node:fs';

// --- Store handles -------------------------------------------------------

export function contentStore() {
  return getStore('v101-content');
}

export function authStore() {
  return getStore('v101-auth');
}

export function mediaStore() {
  return getStore('v101-media');
}

// Throttle store: per-IP login failure counters for brute-force protection.
export function throttleStore() {
  return getStore('v101-throttle');
}

// --- Content read/write --------------------------------------------------

// Content blobs are stored under the keys 'published' and 'draft'.
// readContent returns the parsed object, or null on miss / error.
export async function readContent(state) {
  const key = state === 'draft' ? 'draft' : 'published';
  try {
    const obj = await contentStore().get(key, { type: 'json' });
    return obj ?? null;
  } catch {
    return null;
  }
}

// writeContent persists the object as JSON under the state key.
export async function writeContent(state, obj) {
  const key = state === 'draft' ? 'draft' : 'published';
  await contentStore().setJSON(key, obj);
  return true;
}

// --- Seed ----------------------------------------------------------------

// Read the bundled seed JSON robustly across bundlers via fs + import.meta.url,
// then deep-clone so callers can never mutate a shared/cached object.
export function readSeed() {
  try {
    const seedUrl = new URL('../../data/seed-content.json', import.meta.url);
    const raw = readFileSync(seedUrl, 'utf8');
    const parsed = JSON.parse(raw);
    return deepClone(parsed);
  } catch {
    // Defensive: never throw from seed read; callers can handle null/empty.
    return null;
  }
}

// ensureSeeded backfills published and draft content from the seed when empty.
export async function ensureSeeded() {
  let seed = null;
  const ensure = async (state) => {
    const existing = await readContent(state);
    if (existing && typeof existing === 'object') return;
    if (!seed) seed = readSeed();
    if (seed) await writeContent(state, deepClone(seed));
  };
  await ensure('published');
  await ensure('draft');
}

// --- Defaults backfill ---------------------------------------------------

// Stored content is seeded ONCE (ensureSeeded). Keys added to the seed later
// (for example a new homepage section) never reach content that was saved
// before they existed, so the admin would show them blank and publishing the
// blank would wipe the live section. withDefaults fills any seed keys that are
// genuinely missing from the stored content, without clobbering values the
// owner has set. Two freshly added fields are also restored when left empty,
// since an empty value there means "never set up" rather than a deliberate
// choice: the newArrivals showcase items and the rotating-inventory note.
export function withDefaults(content) {
  const seed = readSeed();
  if (!seed) return content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return deepClone(seed);
  }
  const merged = fillMissing(deepClone(content), seed);

  // New Arrivals: absent or empty -> fall back to the seed showcase so the
  // section is never silently emptied. Once the owner adds items, theirs win.
  const na = merged.newArrivals;
  if ((!na || !Array.isArray(na.items) || na.items.length === 0) && seed.newArrivals) {
    merged.newArrivals = deepClone(seed.newArrivals);
  }
  // Rotating-inventory note: blank -> seed default.
  if (merged.site && (!merged.site.inventoryNote || !String(merged.site.inventoryNote).trim()) &&
      seed.site && seed.site.inventoryNote) {
    merged.site.inventoryNote = seed.site.inventoryNote;
  }
  return merged;
}

// Recursively copy keys from `defaults` that are MISSING in `obj`. Existing
// values (including arrays and empty strings) are left untouched; only keys
// absent from `obj` are filled. Mutates and returns `obj`.
function fillMissing(obj, defaults) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  for (const key of Object.keys(defaults)) {
    const dv = defaults[key];
    if (!(key in obj)) {
      obj[key] = deepClone(dv);
    } else if (
      dv && typeof dv === 'object' && !Array.isArray(dv) &&
      obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])
    ) {
      fillMissing(obj[key], dv);
    }
  }
  return obj;
}

// --- Internal ------------------------------------------------------------

function deepClone(obj) {
  if (obj == null) return obj;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      /* fall through to JSON clone */
    }
  }
  return JSON.parse(JSON.stringify(obj));
}
