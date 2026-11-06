// All network calls. Free public APIs, no keys: GoPlus (safety), DexScreener (market + search),
// GeckoTerminal (newest pools).

import { API_PROXY, CHAINS, PONS, chainByDex } from './config.js';
import { isSolanaAddress, sameAddress } from './util.js';

export class RateLimitError extends Error {}

const via = (url) => (API_PROXY ? `${API_PROXY}?url=${encodeURIComponent(url)}` : url);

async function fetchJson(url) {
  const res = await fetch(via(url));
  if (res.status === 429) throw new RateLimitError('Rate limited');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const liquidityOf = (p) => p.liquidity?.usd || 0;

export async function getSecurity(chain, address) {
  const url =
    chain.kind === 'solana'
      ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
      : `https://api.gopluslabs.io/api/v1/token_security/${chain.id}?contract_addresses=${address}`;
  const data = await fetchJson(url);
  if (data.code === 4029) throw new RateLimitError(data.message);
  if (data.code !== 1) throw new Error(data.message || 'Safety check failed');
  const result = data.result || {};
  const key = Object.keys(result).find((k) => sameAddress(k, address));
  const sec = key ? result[key] : null;
  return sec && Object.keys(sec).length ? sec : null;
}

async function dexScreenerMarket(chain, address) {
  const pairs = await fetchJson(`https://api.dexscreener.com/tokens/v1/${chain.dex}/${address}`);
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  pairs.sort((a, b) => liquidityOf(b) - liquidityOf(a));
  // Price and logo are only meaningful from pairs where this coin is the base token.
  const own = pairs.filter((p) => sameAddress(p.baseToken?.address, address));
  const created = pairs.map((p) => p.pairCreatedAt).filter(Boolean);

  return {
    priceUsd: own[0] ? Number(own[0].priceUsd) : null,
    liquidityUsd: pairs.reduce((sum, p) => sum + liquidityOf(p), 0),
    volume24h: pairs.reduce((sum, p) => sum + (p.volume?.h24 || 0), 0),
    createdAt: created.length ? Math.min(...created) : null,
    imageUrl: own.find((p) => p.info?.imageUrl)?.info.imageUrl || null,
    url: pairs[0].url,
  };
}

// GeckoTerminal lists small launchpad coins that DexScreener often misses.
async function geckoMarket(chain, address) {
  const { data = [] } = await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/tokens/${address}/pools?page=1`
  );
  if (!data.length) return null;

  const created = data.map((p) => Date.parse(p.attributes.pool_created_at)).filter(Boolean);
  const own = data.find((p) => {
    const id = p.relationships?.base_token?.data?.id || '';
    return sameAddress(id.slice(id.indexOf('_') + 1), address);
  });
  return {
    priceUsd: own ? Number(own.attributes.base_token_price_usd) || null : null,
    liquidityUsd: data.reduce((sum, p) => sum + (Number(p.attributes.reserve_in_usd) || 0), 0),
    volume24h: data.reduce((sum, p) => sum + (Number(p.attributes.volume_usd?.h24) || 0), 0),
    createdAt: created.length ? Math.min(...created) : null,
    imageUrl: null,
    url: null,
  };
}

export async function getMarket(chain, address) {
  // Market data is a bonus; the safety checks still work without it.
  const fromDex = await dexScreenerMarket(chain, address).catch(() => null);
  if (fromDex && chain.id !== PONS.chainId) return fromDex;

  // DexScreener misses Pons pools, or sees only some of them, so compare and keep the fuller picture.
  const fromGecko = await geckoMarket(chain, address).catch(() => null);
  if (!fromDex || !fromGecko) return fromDex || fromGecko;
  const size = (m) => m.liquidityUsd + m.volume24h;
  return size(fromGecko) > size(fromDex) ? { ...fromGecko, imageUrl: fromDex.imageUrl } : fromDex;
}

// Current stats for up to 30 tokens at once. Returns a Map of lowercase address to stats.
export async function getTokenStats(chain, addresses) {
  const { data = [] } = await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/tokens/multi/${addresses.join(',')}`
  );
  return new Map(
    data.map(({ attributes: a }) => [
      a.address.toLowerCase(),
      {
        address: a.address,
        symbol: a.symbol,
        name: a.name,
        volume24h: Number(a.volume_usd?.h24) || 0,
        fdv: Number(a.fdv_usd) || 0,
      },
    ])
  );
}

// Name/ticker search across supported networks, one result per token, biggest first.
export async function searchTokens(query, signal) {
  const res = await fetch(via(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { pairs = [] } = await res.json();

  const byToken = new Map();
  for (const p of pairs) {
    const chain = chainByDex(p.chainId);
    if (!chain || !p.baseToken?.address) continue;
    const key = `${chain.id}:${p.baseToken.address.toLowerCase()}`;
    const entry = byToken.get(key) || {
      chain,
      address: p.baseToken.address,
      symbol: p.baseToken.symbol,
      name: p.baseToken.name,
      imageUrl: null,
      liquidityUsd: 0,
      volume24h: 0,
    };
    entry.liquidityUsd += liquidityOf(p);
    entry.volume24h += p.volume?.h24 || 0;
    entry.imageUrl ||= p.info?.imageUrl || null;
    byToken.set(key, entry);
  }
  // Copycat tokens can have decent liquidity but little real trading, so rank by both.
  const rank = (t) => t.liquidityUsd + t.volume24h;
  return [...byToken.values()].sort((a, b) => rank(b) - rank(a)).slice(0, 8);
}

// Work out which supported network an address lives on. Returns { chain, sec } or null.
export async function detectChain(address) {
  if (isSolanaAddress(address)) return { chain: CHAINS.find((c) => c.kind === 'solana'), sec: null };

  // 1) Where does it trade? DexScreener answers for every chain in one call.
  try {
    const { pairs = [] } = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const liquidityByChain = new Map();
    for (const p of pairs) {
      const chain = chainByDex(p.chainId);
      if (chain) liquidityByChain.set(chain, (liquidityByChain.get(chain) || 0) + liquidityOf(p));
    }
    if (liquidityByChain.size) {
      const [chain] = [...liquidityByChain].sort((a, b) => b[1] - a[1])[0];
      return { chain, sec: null };
    }
  } catch {
    /* fall through to asking GoPlus */
  }

  // 2) Not trading anywhere yet: ask GoPlus on each EVM network at once.
  const evm = CHAINS.filter((c) => c.kind === 'evm');
  const results = await Promise.allSettled(evm.map((c) => getSecurity(c, address)));
  const hit = results.findIndex((r) => r.status === 'fulfilled' && r.value);
  if (hit >= 0) return { chain: evm[hit], sec: results[hit].value };
  if (results.some((r) => r.reason instanceof RateLimitError)) throw new RateLimitError('Rate limited');
  return null;
}

// Newest trading pools on a network, one entry per new token.
export async function getNewPools(chain) {
  const { data = [] } = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/new_pools?page=1`);
  const seen = new Set();
  const tokens = [];
  for (const pool of data) {
    const id = pool.relationships?.base_token?.data?.id || '';
    const address = id.slice(id.indexOf('_') + 1);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const a = pool.attributes;
    tokens.push({
      address,
      symbol: (a.name || '').split(' / ')[0],
      market: {
        priceUsd: Number(a.base_token_price_usd) || null,
        liquidityUsd: Number(a.reserve_in_usd) || 0,
        volume24h: Number(a.volume_usd?.h24) || 0,
        createdAt: Date.parse(a.pool_created_at) || null,
        imageUrl: null,
      },
    });
  }
  return tokens;
}
