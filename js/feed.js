// "New coins, already checked": newest pools per network, each run through the same checkup.
// A premium feature: the Worker builds it (feed-core.js), caches it, and only sends it to holders.

import { chainById, FEED_CHAINS } from './config.js';
import { isUnlocked, LockedError, lockPanel, premiumFetch } from './premium.js';
import { $, el, money, riskOf, RISK_LABEL, shortAgo, storeGet, storeSet } from './util.js';

const PER_NETWORK = 6;
const CACHE_MS = 5 * 60 * 1000;

let current = FEED_CHAINS[0];
let generation = 0;
let started = false;
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
    badge.append(el('b', '', String(item.score)), document.createTextNode(RISK_LABEL[risk]));
    head.append(badge);
  } else {
    head.append(el('span', 'feed-score none', item.state === 'limited' ? 'Try later' : 'Not scanned yet'));
  }

  const stats = el('div', 'feed-stats');
  stats.append(el('span', '', `Liquidity ${money(item.market.liquidityUsd)}`));
  if (item.top) stats.append(el('span', 'feed-flag', item.top));

  btn.append(head, stats);
  btn.addEventListener('click', () => onPick(chain, item.address));
  return btn;
}

function render(items, chain) {
  $('feed-grid').replaceChildren(...items.map((it) => card(it, chain)));
  const done = items.filter((i) => i.state === 'done');
  const high = done.filter((i) => riskOf(i.score) === 'high').length;
  $('feed-summary').textContent = done.length
    ? `${high} of the ${done.length} newest coins checked on ${chain.name} ${high === 1 ? 'is' : 'are'} high risk.`
    : '';
}

function showLocked() {
  $('feed-summary').textContent = '';
  const panel = lockPanel('New coins, already checked',
    'The newest coins on Robinhood Chain, Base, Solana and Ethereum, scored as they launch.');
  panel.classList.add('feed-lock');
  $('feed-grid').replaceChildren(panel);
}

function skeleton() {
  $('feed-summary').textContent = '';
  $('feed-grid').replaceChildren(...Array.from({ length: PER_NETWORK }, () => el('div', 'feed-card skeleton')));
}

async function load(chainId) {
  const run = ++generation;
  const chain = chainById(chainId);
  if (!isUnlocked()) return showLocked();

  const cached = storeGet(sessionStorage, cacheKey(chainId), null);
  if (cached && Date.now() - cached.at < CACHE_MS) return render(cached.items, chain);

  skeleton();
  try {
    const { items } = await premiumFetch(`/premium/feed?chain=${chainId}`);
    if (run !== generation) return;
    if (!items.length) {
      $('feed-grid').replaceChildren(el('p', 'feed-empty', `No new coins on ${chain.name} right now.`));
      return;
    }
    render(items, chain);
    storeSet(sessionStorage, cacheKey(chainId), { at: Date.now(), items });
  } catch (err) {
    if (run !== generation) return;
    if (err instanceof LockedError) return showLocked();
    $('feed-grid').replaceChildren(el('p', 'feed-empty', "Couldn't load new coins right now. Try again in a minute."));
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

// After signing in or out.
export function reloadFeed() {
  if (started) load(current);
}

export function wireFeed(handler) {
  onPick = handler;
  renderTabs();
  // Only load once the feed scrolls into view.
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      started = true;
      load(current);
    }
  }, { rootMargin: '200px' });
  io.observe($('feed'));
}
