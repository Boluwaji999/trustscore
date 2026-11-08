// Caching proxy for the free coin-data APIs. The site can call https://<your-worker>/?url=<encoded
// API URL>. It only forwards to the three APIs the site uses (it is not an open proxy) and caches
// each answer at Cloudflare's edge, so 1,000 people checking the same coin cost the APIs one request.

import { CORS, withCors } from './http.js';

const ALLOWED_HOSTS = new Set(['api.gopluslabs.io', 'api.dexscreener.com', 'api.geckoterminal.com']);

// How long to keep answers, in seconds.
const TTL = {
  'api.gopluslabs.io': 300, // safety data barely changes minute to minute
  'api.dexscreener.com': 60, // prices and liquidity move faster
  'api.geckoterminal.com': 120, // new-pools feed
};

export async function handleProxy(request, ctx) {
  const target = new URL(request.url).searchParams.get('url');
  let upstream;
  try {
    upstream = new URL(target);
  } catch {
    return new Response('Missing or invalid ?url=', { status: 400, headers: CORS });
  }
  if (upstream.protocol !== 'https:' || !ALLOWED_HOSTS.has(upstream.hostname)) {
    return new Response('Host not allowed', { status: 403, headers: CORS });
  }

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(upstream.toString(), { method: 'GET' });
  const hit = cache && (await cache.match(cacheKey));
  if (hit) return withCors(hit, 'HIT');

  const res = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
  const body = await res.arrayBuffer();
  const out = new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
      'Cache-Control': `public, max-age=${TTL[upstream.hostname]}`,
    },
  });

  // Only cache good answers; never cache errors or rate-limit responses.
  if (res.ok && cache) ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return withCors(out, 'MISS');
}
