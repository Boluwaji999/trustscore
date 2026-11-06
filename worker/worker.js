// TrustScore caching proxy (Cloudflare Worker, free plan).
// The site calls  https://<your-worker>/?url=<encoded API URL>  and this worker:
//   - only forwards to the three APIs the site uses (it is not an open proxy),
//   - caches each answer at Cloudflare's edge, so 1,000 people checking the same coin
//     cost the free APIs one request instead of 1,000.

const ALLOWED_HOSTS = new Set(['api.gopluslabs.io', 'api.dexscreener.com', 'api.geckoterminal.com']);

// How long to keep answers, in seconds.
const TTL = {
  'api.gopluslabs.io': 300, // safety data barely changes minute to minute
  'api.dexscreener.com': 60, // prices and liquidity move faster
  'api.geckoterminal.com': 120, // new-pools feed
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

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

    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
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
    if (res.ok) ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return withCors(out, 'MISS');
  },
};

function withCors(res, status) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  headers.set('X-Cache', status);
  return new Response(res.body, { status: res.status, headers });
}
