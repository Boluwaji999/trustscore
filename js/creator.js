// Creator Track Record in the browser: a premium feature, built from the chain by creator-core.js
// and cached for a few minutes.

import { buildCreatorHistory } from './creator-core.js';
import { requireUnlocked } from './premium.js';
import { storeGet, storeSet } from './util.js';

const CACHE_MS = 5 * 60 * 1000;

// Returns the creator's record, or null if this isn't a Pons launch. Throws LockedError for
// visitors who haven't unlocked premium.
export async function getCreatorHistory(token, createdAt) {
  requireUnlocked();
  const key = `trustscore:creator:${token}`;
  const cached = storeGet(sessionStorage, key, null);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.record;

  const record = await buildCreatorHistory(token, createdAt);
  storeSet(sessionStorage, key, { at: Date.now(), record });
  return record;
}
