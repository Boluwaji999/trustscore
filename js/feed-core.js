// Builds the "new coins" feed: the newest pools on a network, each run through the same checkup.
// Runs on the Worker, which caches the result, so the free APIs see one request per few minutes
// rather than one per visitor.

import { analyze } from './analyze.js';
import { getNewPools, getSecurity, RateLimitError } from './api.js';
import { chainById } from './config.js';
import { wait } from './util.js';

const PER_NETWORK = 6;
const GAP_MS = 350; // spacing between safety checks so we stay under the free rate limit

export async function buildFeed(chainId) {
  const chain = chainById(chainId);
  if (!chain) throw new Error('Unknown network');

  const items = (await getNewPools(chain)).slice(0, PER_NETWORK).map((t) => ({ ...t, state: 'pending' }));
  for (const item of items) {
    try {
      const sec = await getSecurity(chain, item.address);
      if (sec) {
        const result = analyze(chain, sec, item.market, item.address);
        item.state = 'done';
        item.score = result.score;
        item.symbol = result.symbol || item.symbol;
        item.top = result.findings.find((f) => f.level === 'danger')?.title || null;
      } else {
        item.state = 'none';
      }
    } catch (err) {
      item.state = err instanceof RateLimitError ? 'limited' : 'none';
    }
    await wait(GAP_MS);
  }
  return items;
}
