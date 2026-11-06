// Renders the report (summary card, holder chart, findings), the loader and status messages.

import { COUNTED_KINDS } from './analyze.js';
import { $, el, money, pct, reduceMotion, riskOf, RISK_LABEL, shortAddress } from './util.js';

const GROUPS = [
  ['danger', 'High risk'],
  ['warn', 'Caution'],
  ['info', 'Notes'],
  ['good', 'Passed'],
];

// Small line icons per finding level (static markup, never user data).
const ICONS = {
  danger: '<svg viewBox="0 0 16 16"><path d="M8 4.5v4M8 11.2v.1"/></svg>',
  warn: '<svg viewBox="0 0 16 16"><path d="M8 4.5v4M8 11.2v.1"/></svg>',
  info: '<svg viewBox="0 0 16 16"><path d="M8 7.5v4M8 4.8v.1"/></svg>',
  good: '<svg viewBox="0 0 16 16"><path d="M4.5 8.3l2.3 2.3 4.7-5"/></svg>',
};

const KIND_LABEL = {
  burned: 'Burned',
  pool: 'Pool',
  locked: 'Locked',
  token: 'Token contract',
  creator: 'Creator',
  contract: 'Contract',
};

function marketRow(label, value) {
  const row = el('div');
  row.append(el('dt', '', label), el('dd', '', value));
  return row;
}

const CREATOR_BADGE = {
  proven: ['Proven creator', 'good'],
  frequent: ['Frequent launcher', 'warn'],
  first: ['First coin', 'info'],
  repeat: ['Repeat creator', 'info'],
};

function creatorStat(label, value) {
  const box = el('div', 'creator-stat');
  box.append(el('span', 'creator-stat-value', value), el('span', 'creator-stat-label', label));
  return box;
}

// state: null hides the card; 'loading' and 'error' are messages; otherwise a creator record.
export function renderCreator(state) {
  const card = $('creator-card');
  card.hidden = state === null;
  if (state === null) return;

  const head = el('div', 'creator-head');
  head.append(el('h3', '', 'Creator'));

  if (state === 'loading' || state === 'error') {
    const loading = state === 'loading';
    if (loading) head.append(el('span', 'spinner'));
    card.replaceChildren(head, el('p', 'creator-note', loading
      ? "Reading this creator's launch history from the chain…"
      : "Couldn't load this creator's history right now. Try the check again in a minute."));
    return;
  }

  const [label, tone] = CREATOR_BADGE[state.status];
  head.append(el('span', `creator-badge ${tone}`, label));

  const stats = el('div', 'creator-stats');
  stats.append(creatorStat('coins launched', state.total.toLocaleString()), creatorStat('in the last 7 days', String(state.lastWeek)));
  if (state.judged) stats.append(creatorStat('earlier coins still trading', `${state.active} of ${state.judged}`));
  if (state.best?.fdv) stats.append(creatorStat(`best: $${state.best.symbol}`, money(state.best.fdv)));

  card.replaceChildren(
    head,
    el('p', 'creator-wallet', shortAddress(state.creator)),
    stats,
    el('p', 'creator-note', 'Facts from the chain, not an accusation. Most Pons coins go quiet within days, whoever made them.')
  );
}

// quiet: update an open report in place, without replaying the score animation.
export function renderReport(report, { quiet = false } = {}) {
  const { chain, address, result, market } = report;
  const symbol = result.symbol ? `$${result.symbol}` : '';
  $('token-name').textContent = symbol ? `${result.name} (${symbol})` : result.name;
  $('token-meta').textContent = `${chain.name} · ${shortAddress(address)}`;

  const logo = $('token-logo');
  logo.hidden = !market?.imageUrl;
  if (market?.imageUrl) logo.src = market.imageUrl;

  const counts = { danger: 0, warn: 0, good: 0 };
  for (const f of result.findings) if (f.level in counts) counts[f.level]++;
  const tallyLabels = { danger: ['high', 'high risk'], warn: ['medium', 'caution'], good: ['pass', 'passed'] };
  $('tally').replaceChildren(
    ...Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([lvl, n]) => el('span', tallyLabels[lvl][0], `${n} ${tallyLabels[lvl][1]}`))
  );

  const risk = riskOf(result.score);
  $('score').className = `score ${risk}`;
  $('score-label').textContent = RISK_LABEL[risk];
  $('meter').replaceChildren(...Array.from({ length: 10 }, () => el('span')));

  const marketEl = $('market');
  marketEl.replaceChildren();
  if (market?.priceUsd) marketEl.append(marketRow('Price', money(market.priceUsd)));
  if (market) {
    marketEl.append(marketRow('Liquidity', money(market.liquidityUsd)));
    marketEl.append(marketRow('24h volume', money(market.volume24h)));
  }
  if (result.holderCount !== null) marketEl.append(marketRow('Holders', result.holderCount.toLocaleString()));

  renderHolders(result.holders);
  renderFindings(result.findings);

  const shareText = `${symbol || result.name} scored ${result.score}/10 on TrustScore`;
  $('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(location.href)}`;

  $('report').hidden = false;
  if (quiet) showScore(result.score);
  else animateScore(result.score);
}

let scoreRun = 0; // a newer score cancels any count-up still running

function showScore(score) {
  scoreRun++;
  $('score-num').textContent = score;
  [...$('meter').children].slice(0, score).forEach((s) => s.classList.add('on'));
}

function renderFindings(findings) {
  let index = 0;
  $('checks').replaceChildren(
    ...GROUPS.filter(([lvl]) => findings.some((f) => f.level === lvl)).map(([lvl, title]) => {
      const items = findings.filter((f) => f.level === lvl);
      const group = el('section', 'group');
      const heading = el('h4', 'group-title', title);
      heading.append(el('span', 'count', String(items.length)));
      const list = el('ul', 'rows');
      for (const f of items) {
        const li = el('li', `row ${f.level}`);
        li.style.setProperty('--i', index++);
        const icon = el('span', 'row-icon');
        icon.innerHTML = ICONS[f.level];
        const body = el('div');
        body.append(el('p', 'row-title', f.title), el('p', 'row-why', f.why));
        li.append(icon, body);
        list.append(li);
      }
      group.append(heading, list);
      return group;
    })
  );
}

// ---------- holder chart ----------

function renderHolders(holders) {
  const card = $('holders');
  const top = holders.slice(0, 10);
  card.hidden = top.length === 0;
  if (!top.length) return;

  // Scale to the largest bar so small holders stay visible; the % label carries the real value.
  const max = Math.max(...top.map((h) => h.percent), 0.0001);
  const list = $('holder-bars');
  list.replaceChildren(
    ...top.map((h, i) => {
      const counted = COUNTED_KINDS.has(h.kind);
      const li = el('li', `hbar${counted ? '' : ' muted'}`);
      li.style.setProperty('--i', i);
      li.style.setProperty('--w', `${(h.percent / max) * 100}%`);
      li.dataset.address = h.address;
      li.dataset.percent = pct(h.percent);
      li.dataset.kind = KIND_LABEL[h.kind] || 'Wallet';
      li.dataset.counted = counted ? 'Counted as a holder who could sell' : 'Not counted: this can\'t be dumped by a person';
      li.tabIndex = 0;

      const label = el('span', 'hbar-label');
      label.append(el('span', 'hbar-name', h.tag || shortAddress(h.address)));
      if (KIND_LABEL[h.kind]) label.append(el('span', 'hbar-kind', KIND_LABEL[h.kind]));
      const track = el('span', 'hbar-track');
      track.append(el('span', 'hbar-fill'));
      li.append(label, track, el('span', 'hbar-value', pct(h.percent)));
      return li;
    })
  );
}

function showTip(target, x, y) {
  const tip = $('chart-tip');
  tip.replaceChildren(
    el('strong', '', target.dataset.percent + ' of supply'),
    el('span', 'tip-kind', target.dataset.kind),
    el('code', '', target.dataset.address),
    el('span', 'tip-note', target.dataset.counted)
  );
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), innerWidth - box.width - 8);
  const top = y + 16 + box.height > innerHeight ? y - box.height - 12 : y + 16;
  tip.style.transform = `translate(${left}px, ${top}px)`;
}

export function wireHolderTooltip() {
  const list = $('holder-bars');
  const hide = () => ($('chart-tip').hidden = true);
  list.addEventListener('pointermove', (e) => {
    const row = e.target.closest('.hbar');
    if (row) showTip(row, e.clientX, e.clientY);
    else hide();
  });
  list.addEventListener('pointerleave', hide);
  list.addEventListener('focusin', (e) => {
    const row = e.target.closest('.hbar');
    if (!row) return;
    const r = row.getBoundingClientRect();
    showTip(row, r.left + r.width / 2, r.bottom);
  });
  list.addEventListener('focusout', hide);
  addEventListener('scroll', hide, { passive: true });
}

// ---------- score animation ----------

function animateScore(score) {
  const num = $('score-num');
  const segments = [...$('meter').children];

  if (reduceMotion) {
    showScore(score);
    return;
  }

  const run = ++scoreRun;
  segments.slice(0, score).forEach((s, i) => setTimeout(() => s.classList.add('on'), 200 + i * 70));

  const start = performance.now();
  const duration = 200 + score * 70;
  const tick = (now) => {
    if (run !== scoreRun) return;
    const t = Math.min(1, (now - start) / duration);
    num.textContent = Math.round(score * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- loader + status ----------

const SCAN_STEPS = [
  'Checking whether it can be sold',
  'Checking contract ownership',
  'Looking for mint and pause powers',
  'Measuring holder concentration',
  'Checking liquidity locks',
  'Reading taxes and market data',
];

let loaderTimer = null;

export function startLoader(label, detecting) {
  $('loader-addr').textContent = label;
  const steps = detecting ? ['Finding the network', ...SCAN_STEPS] : SCAN_STEPS;
  const items = steps.map((text) => el('li', '', text));
  $('loader-steps').replaceChildren(...items);
  let step = 0;
  items[0].className = 'active';
  $('loader').hidden = false;
  clearInterval(loaderTimer);
  loaderTimer = setInterval(() => {
    if (step >= items.length - 1) return;
    items[step].className = 'done';
    items[++step].className = 'active';
  }, 380);
}

export function stopLoader() {
  clearInterval(loaderTimer);
  $('loader').hidden = true;
}

export function setStatus(text, isError = false) {
  const status = $('status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}
