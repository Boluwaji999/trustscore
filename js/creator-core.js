// Creator Track Record rules: who launched a Pons coin, and how their other coins are doing.
// Reads launches from the public Robinhood Chain RPC. Runs in the browser for token holders, and
// the Worker (worker/) can also run it, so it must not use browser-only features.
//
// The rules below come from measuring real Pons launches in November 2026. Almost every coin goes
// quiet within days whoever made it, so dead coins alone prove nothing, while a past coin that is
// still going is rare. Coins from wallets launching many at once did worst of all.

import { getTokenStats } from './api.js';
import { PONS } from './config.js';
import { wait } from './util.js';

const ACTIVE_VOLUME = 1000; // 24h volume that counts as still trading
const HIT_VOLUME = 10000; // 24h volume, or...
const HIT_FDV = 100000; // ...value, that counts as a real success
const FREQUENT_COINS = 5; // launches in 7 days that count as frequent
const SETTLE_DAYS = 1; // younger coins are too new to judge
const HIT_MIN_DAYS = 3; // a success has to have lasted this long
const MAX_JUDGED = 30; // one GeckoTerminal call's worth of coins
const CONCURRENT_QUERIES = 2; // the public RPC refuses bursts, so keep requests small and spaced
const QUERY_GAP_MS = 150;

async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(PONS.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.result;
    } catch (err) {
      lastError = err;
      await wait(800 * (attempt + 1));
    }
  }
  throw lastError;
}

// The whole launch history, split into ranges the RPC accepts, newest first.
function blockRanges(head) {
  const ranges = [];
  for (let to = head; to > PONS.firstBlock; to -= PONS.maxBlockRange + 1) {
    ranges.push([Math.max(PONS.firstBlock, to - PONS.maxBlockRange), to]);
  }
  return ranges;
}

const launchLogs = ([from, to], topics) =>
  rpc('eth_getLogs', [{
    address: PONS.factory,
    fromBlock: `0x${from.toString(16)}`,
    toBlock: `0x${to.toString(16)}`,
    topics: [PONS.launchEvent, ...topics],
  }]);

const asTopic = (address) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
const fromTopic = (topic) => `0x${topic.slice(-40)}`;

// The coin's first trade dates its launch, so one narrow query usually finds it. A coin with no
// date falls back to searching the whole history.
async function findLaunch(token, ranges, head, perDay, createdAt) {
  if (createdAt) {
    const ageDays = (Date.now() - createdAt) / 864e5;
    const estimate = head - ageDays * perDay;
    const margin = (ageDays * 0.35 + 1) * perDay; // block pace drifts over time
    const from = Math.floor(Math.max(PONS.firstBlock, estimate - margin));
    const to = Math.ceil(Math.min(head, estimate + margin));
    if (to - from <= PONS.maxBlockRange) return (await launchLogs([from, to], [asTopic(token)]))[0] || null;
  }
  for (const range of ranges) {
    const [hit] = await launchLogs(range, [asTopic(token)]);
    if (hit) return hit;
    await wait(QUERY_GAP_MS);
  }
  return null;
}

async function creatorCoins(creator, ranges) {
  const coins = [];
  for (let i = 0; i < ranges.length; i += CONCURRENT_QUERIES) {
    const batch = ranges.slice(i, i + CONCURRENT_QUERIES);
    const results = await Promise.all(batch.map((r) => launchLogs(r, [null, null, asTopic(creator)])));
    for (const log of results.flat()) {
      coins.push({ token: fromTopic(log.topics[1]), block: parseInt(log.blockNumber, 16) });
    }
    await wait(QUERY_GAP_MS);
  }
  return coins.sort((a, b) => b.block - a.block);
}

// Blocks aren't evenly timed forever, so measure the recent pace rather than assuming it.
async function blocksPerDay(head) {
  const span = 500000;
  const [now, then] = await Promise.all([
    rpc('eth_getBlockByNumber', [`0x${head.toString(16)}`, false]),
    rpc('eth_getBlockByNumber', [`0x${(head - span).toString(16)}`, false]),
  ]);
  const seconds = parseInt(now.timestamp, 16) - parseInt(then.timestamp, 16);
  return (span / seconds) * 86400;
}

function summarize(creator, coins, token, head, perDay, stats) {
  const ageDays = (c) => (head - c.block) / perDay;
  const others = coins.filter((c) => c.token !== token);
  const lastWeek = coins.filter((c) => ageDays(c) <= 7).length;

  let judged = null;
  let active = null;
  let best = null;
  let hits = 0;
  if (stats) {
    const settled = others.filter((c) => ageDays(c) >= SETTLE_DAYS).slice(0, MAX_JUDGED);
    judged = settled.length;
    active = 0;
    for (const coin of settled) {
      const s = stats.get(coin.token);
      if (!s) continue;
      if (s.volume24h >= ACTIVE_VOLUME) active++;
      if (ageDays(coin) >= HIT_MIN_DAYS && (s.volume24h >= HIT_VOLUME || s.fdv >= HIT_FDV)) hits++;
      if (!best || s.fdv > best.fdv) best = s;
    }
  }

  let status = 'repeat';
  if (lastWeek >= FREQUENT_COINS) status = 'frequent';
  else if (hits > 0) status = 'proven';
  else if (others.length === 0) status = 'first';

  return { creator, status, total: coins.length, lastWeek, judged, active, hits, best };
}

// Returns the creator's record, or null if this isn't a Pons launch.
export async function buildCreatorHistory(token, createdAt) {
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  const ranges = blockRanges(head);

  const perDay = await blocksPerDay(head);

  const launch = await findLaunch(token, ranges, head, perDay, createdAt);
  if (!launch) return null;

  const creator = fromTopic(launch.topics[3]);
  const coins = await creatorCoins(creator, ranges);

  // If performance data is unavailable, still report the launch counts.
  const settled = coins
    .filter((c) => c.token !== token && (head - c.block) / perDay >= SETTLE_DAYS)
    .slice(0, MAX_JUDGED);
  let stats = new Map();
  if (settled.length) {
    stats = await getTokenStats({ gecko: 'robinhood' }, settled.map((c) => c.token)).catch(() => null);
  }

  return summarize(creator, coins, token, head, perDay, stats);
}
