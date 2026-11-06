// "New coins, already checked": newest pools per network, each run through the same checkup.
// Kept small and cached because the free APIs are rate limited, which is also why these scores
// leave out creator history: the full report on each coin includes it.

import { analyze } from './analyze.js';
import { getNewPools, getSecurity, RateLimitError } from './api.js';
import { FEED_CHAINS, chainById } from './config.js';
import { $, el, money, riskLabel, riskOf, shortAgo, storeGet, storeSet, wait } from './util.js';

const PER_NETWORK = 6;
const CACHE_MS = 5 * 60 * 1000;
const GAP_MS = 350; // spacing between safety checks so we stay under the free rate limit

let current = FEED_CHAINS[0];
let generation = 0;
let onPick = () => {};

const cacheKey = (id) => `trustscore:feed:${id}`;

function card(item, chain) {
  const btn = el('button', 'feed-card');
  btn.type = 'button';

  const head = el('div', 'feed-card-head');
  const name = el('div', 'feed-name');
  name.append(
    el('strong', '', item.symbol || 'Unknown'),
    el('span', '', item.market.createdAt ? shortAgo(item.market.createdAt) : 'New')
  );
  head.append(name);

  if (item.state === 'done') {
    const risk = riskOf(item.score);
    // Only animate a score the first time it appears, not on every re-render.
    const badge = el('span', `feed-score ${risk}${item.shown ? '' : ' fresh'}`);
    item.shown = true;
    badge.append(el('b', '', String(item.score)), document.createTextNode(riskLabel(item)));
    head.append(badge);
  } else if (item.state === 'pending') {
    head.append(el('span', 'feed-score pending', 'Checking…'));
  } else {
    head.append(el('span', 'feed-score none', item.state === 'limited' ? 'Try later' : 'Not scanned yet'));
  }

  const stats = el('div', 'feed-stats');
  stats.append(el('span', '', `Liquidity ${money(item.market.liquidityUsd)}`));
  if (item.top) stats.append(el('span', 'feed-flag', item.top));

  btn.append(head, stats);
  btn.addEventListener('click', () => onPick(chain, item.address));
  if (item.state === 'pending') btn.classList.add('is-pending');
  return btn;
}

function render(items, chain) {
  $('feed-grid').replaceChildren(...items.map((it) => card(it, chain)));
  const done = items.filter((i) => i.state === 'done');
  const high = done.filter((i) => riskOf(i.score) === 'high').length;
  const unjudged = done.filter((i) => i.tooNew && riskOf(i.score) !== 'high').length;
  $('feed-summary').textContent = done.length
    ? `${high} of the ${done.length} newest coins checked on ${chain.name} ${high === 1 ? 'is' : 'are'} high risk${unjudged ? `, and ${unjudged} ${unjudged === 1 ? 'is' : 'are'} too new to judge.` : '.'}`
    : '';
}

function skeleton() {
  $('feed-summary').textContent = '';
  $('feed-grid').replaceChildren(...Array.from({ length: PER_NETWORK }, () => el('div', 'feed-card skeleton')));
}

async function load(chainId) {
  const run = ++generation;
  const chain = chainById(chainId);

  const cached = storeGet(sessionStorage, cacheKey(chainId), null);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    render(cached.items, chain);
    return;
  }

  skeleton();
  let items;
  try {
    items = (await getNewPools(chain)).slice(0, PER_NETWORK).map((t) => ({ ...t, state: 'pending' }));
  } catch (err) {
    if (run !== generation) return;
    $('feed-grid').replaceChildren(
      el('p', 'feed-empty', err instanceof RateLimitError
        ? 'The new-coins service is busy. Give it a minute and switch tabs to retry.'
        : "Couldn't load new coins right now.")
    );
    return;
  }
  if (run !== generation) return;
  if (!items.length) {
    $('feed-grid').replaceChildren(el('p', 'feed-empty', `No new coins on ${chain.name} right now.`));
    return;
  }
  render(items, chain);

  for (const item of items) {
    if (run !== generation) return;
    try {
      const sec = await getSecurity(chain, item.address);
      if (sec) {
        const result = analyze(chain, sec, item.market, item.address);
        item.state = 'done';
        item.score = result.score;
        item.tooNew = result.tooNew;
        item.symbol = result.symbol || item.symbol;
        item.top = result.findings.find((f) => f.level === 'danger')?.title || null;
      } else {
        item.state = 'none';
      }
    } catch (err) {
      item.state = err instanceof RateLimitError ? 'limited' : 'none';
    }
    if (run !== generation) return;
    render(items, chain);
    await wait(GAP_MS);
  }
  if (!items.some((i) => i.state === 'limited')) {
    storeSet(sessionStorage, cacheKey(chainId), { at: Date.now(), items });
  }
}

function renderTabs() {
  $('feed-tabs').replaceChildren(
    ...FEED_CHAINS.map((id) => {
      const tab = el('button', 'tab', chainById(id).name);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === current));
      tab.addEventListener('click', () => {
        if (id === current) return;
        current = id;
        renderTabs();
        load(id);
      });
      return tab;
    })
  );
}

export function wireFeed(handler) {
  onPick = handler;
  renderTabs();
  // Only start calling APIs once the feed scrolls into view.
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      load(current);
    }
  }, { rootMargin: '200px' });
  io.observe($('feed'));
}
