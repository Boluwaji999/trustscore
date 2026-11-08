// Creator Track Record in the browser. The history itself is built on the Worker (creator-core.js)
// and only sent to token holders, so this just asks for it and caches it for a few minutes.

import { premiumFetch } from './premium.js';
import { storeGet, storeSet } from './util.js';

const CACHE_MS = 5 * 60 * 1000;

// Returns the creator's record, or null if this isn't a Pons launch. Throws LockedError for
// visitors who haven't unlocked premium.
export async function getCreatorHistory(token, createdAt) {
  const key = `trustscore:creator:${token}`;
  const cached = storeGet(sessionStorage, key, null);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.record;

  const { record } = await premiumFetch(`/premium/creator?token=${token}&createdAt=${createdAt || ''}`);
  storeSet(sessionStorage, key, { at: Date.now(), record });
  return record;
}
