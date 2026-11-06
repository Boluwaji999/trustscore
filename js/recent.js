// The last few coins this person checked, kept only in their own browser.

import { chainById } from './config.js';
import { $, el, riskOf, storeGet, storeSet } from './util.js';

const KEY = 'trustscore:recent';
const MAX = 6;

let onPick = () => {};

export function addRecent({ chain, address, symbol, name, score }) {
  const list = storeGet(localStorage, KEY, []).filter((r) => !(r.chain === chain.id && r.address === address));
  list.unshift({ chain: chain.id, address, symbol, name, score });
  storeSet(localStorage, KEY, list.slice(0, MAX));
  renderRecent();
}

export function renderRecent() {
  const box = $('recent');
  const list = storeGet(localStorage, KEY, []).filter((r) => chainById(r.chain));
  box.hidden = list.length === 0;
  if (!list.length) return;

  const clear = el('button', 'recent-clear', 'Clear');
  clear.type = 'button';
  clear.addEventListener('click', () => {
    storeSet(localStorage, KEY, []);
    renderRecent();
  });

  box.replaceChildren(
    el('span', 'recent-label', 'Recent'),
    ...list.map((r) => {
      const chip = el('button', `chip recent-chip ${riskOf(r.score)}`);
      chip.type = 'button';
      chip.title = `${r.name || r.symbol} on ${chainById(r.chain).name}`;
      chip.append(el('span', 'dot'), document.createTextNode(r.symbol || r.name || 'Token'), el('em', '', `${r.score}/10`));
      chip.addEventListener('click', () => onPick(chainById(r.chain), r.address));
      return chip;
    }),
    clear
  );
}

export function wireRecent(handler) {
  onPick = handler;
  renderRecent();
}
