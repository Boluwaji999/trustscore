// TrustScore Worker (Cloudflare, free plan).
//
//   GET  /?url=...                 caching proxy for the free coin-data APIs (proxy.js)
//   GET  /premium/info             what holding unlocks, and how much is needed
//   POST /auth                     wallet sign-in; holders get a pass (auth.js)
//   GET  /premium/creator?token=   Creator Track Record, for pass holders
//   GET  /premium/feed?chain=      new coins feed, for pass holders
//
// Settings (Cloudflare dashboard > Worker > Settings > Variables and Secrets):
//   PASS_SECRET    a long random secret, required. Keep it private.
//   TOKEN_ADDRESS  the TrustScore token contract on Robinhood Chain. Empty until launch.
//   MIN_HOLD       whole tokens a wallet must hold, e.g. 100000.
//   TOKEN_SYMBOL   shown on the site, e.g. TRUST.
//   ALLOW_WALLETS  optional, comma-separated wallets let in without holding (e.g. your own, for testing).

import { buildCreatorHistory } from '../../js/creator-core.js';
import { buildFeed } from '../../js/feed-core.js';
import { FEED_CHAINS } from '../../js/config.js';
import { checkPass, signIn } from './auth.js';
import { CORS, json, withCors } from './http.js';
import { handleProxy } from './proxy.js';

const CREATOR_CACHE_S = 600;
const FEED_CACHE_S = 300;
const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s || '');

// Premium answers are the same for every holder, so they're cached by URL, not by who asked.
async function cached(ctx, key, seconds, build) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://trustscore.cache/${key}`);
  const hit = cache && (await cache.match(cacheKey));
  if (hit) return withCors(hit, 'HIT');
  const data = await build();
  const res = json(data, 200, { 'Cache-Control': `public, max-age=${seconds}` });
  if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return withCors(res, 'MISS');
}

async function premium(request, env, ctx, url) {
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const pass = await checkPass(env.PASS_SECRET, bearer);
  if (!pass) return json({ error: 'locked' }, 401);

  if (url.pathname === '/premium/creator') {
    const token = (url.searchParams.get('token') || '').toLowerCase();
    if (!isAddress(token)) return json({ error: 'bad_token' }, 400);
    const createdAt = Number(url.searchParams.get('createdAt')) || null;
    return cached(ctx, `creator/${token}`, CREATOR_CACHE_S, async () => ({ record: await buildCreatorHistory(token, createdAt) }));
  }

  if (url.pathname === '/premium/feed') {
    const chain = url.searchParams.get('chain') || '';
    if (!FEED_CHAINS.includes(chain)) return json({ error: 'bad_chain' }, 400);
    return cached(ctx, `feed/${chain}`, FEED_CACHE_S, async () => ({ items: await buildFeed(chain), at: Date.now() }));
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    try {
      if (url.pathname === '/premium/info' && request.method === 'GET') {
        return json({
          launched: Boolean(String(env.TOKEN_ADDRESS || '').trim()),
          token: String(env.TOKEN_ADDRESS || '').trim() || null,
          symbol: env.TOKEN_SYMBOL || 'TRUST',
          minHold: String(env.MIN_HOLD || '0'),
        });
      }
      if (!env.PASS_SECRET) return json({ error: 'not_configured' }, 500);

      if (url.pathname === '/auth' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { status, body: out } = await signIn(body, env);
        return json(out, status);
      }
      if (url.pathname.startsWith('/premium/') && request.method === 'GET') return await premium(request, env, ctx, url);
      if (url.pathname === '/' && request.method === 'GET' && url.searchParams.has('url')) return await handleProxy(request, ctx);
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err?.message || err) }, 500);
    }
  },
};
