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
