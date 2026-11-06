// Name/ticker search with a keyboard-friendly dropdown (ARIA combobox pattern).

import { searchTokens } from './api.js';
import { $, el, isEvmAddress, isSolanaAddress, money } from './util.js';

let results = [];
let active = -1;
let userMoved = false; // true once the person arrows through the list themselves
let controller = null;
let debounce = null;
let onPick = () => {};

const input = () => $('address');
const list = () => $('search-results');

export const looksLikeAddress = (s) => isEvmAddress(s) || isSolanaAddress(s);

// More than one coin sharing a symbol usually means copycats, so never guess for the person.
function copycats() {
  const counts = new Map();
  for (const r of results) {
    const key = (r.symbol || '').toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].find(([, n]) => n > 1)?.[0] || null;
}

function close() {
  list().hidden = true;
  input().setAttribute('aria-expanded', 'false');
  input().removeAttribute('aria-activedescendant');
  active = -1;
}

function setActive(i) {
  const items = [...list().children].filter((n) => n.classList.contains('option'));
  items.forEach((n, j) => n.setAttribute('aria-selected', String(j === i)));
  active = i;
  if (items[i]) {
    input().setAttribute('aria-activedescendant', items[i].id);
    items[i].scrollIntoView({ block: 'nearest' });
  }
}

function render(query) {
  const ul = list();
  if (!results.length) {
    ul.replaceChildren(el('li', 'empty', `No coins found for "${query}" on our networks.`));
  } else {
    ul.replaceChildren(
      ...results.map((r, i) => {
        const li = el('li', 'option');
        li.id = `opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');

        const logo = el('span', 'opt-logo', (r.symbol || '?').slice(0, 1));
        if (r.imageUrl) {
          const img = el('img');
          img.src = r.imageUrl;
          img.alt = '';
          img.loading = 'lazy';
          img.onerror = () => img.remove();
          logo.append(img);
        }
        const text = el('span', 'opt-text');
        text.append(el('strong', '', r.symbol), el('span', '', r.name));
        li.append(logo, text, el('span', 'opt-chain', r.chain.name), el('span', 'opt-liq', money(r.liquidityUsd)));
        li.addEventListener('pointerdown', (e) => {
          e.preventDefault(); // keep focus in the input
          pick(i);
        });
        return li;
      })
    );
  }
  const dupe = copycats();
  if (dupe) {
    const note = el('li', 'note', `Several coins use the name "${dupe.toUpperCase()}". Copycats are common, so check the network and address before you trust one.`);
    note.setAttribute('role', 'presentation');
    ul.prepend(note);
  }
  ul.hidden = false;
  input().setAttribute('aria-expanded', 'true');
  userMoved = false;
  setActive(results.length ? 0 : -1);
}

function pick(i) {
  const r = results[i];
  if (!r) return;
  close();
  input().value = r.address;
  onPick(r);
}

async function runSearch(query) {
  controller?.abort();
  controller = new AbortController();
  try {
    results = await searchTokens(query, controller.signal);
    if (input().value.trim() === query) render(query);
  } catch (err) {
    if (err.name !== 'AbortError') close();
  }
}

// Enter while the list is open. Returns 'picked', 'ambiguous' (copycats; person must choose) or null.
export function pickFromOpenList() {
  if (list().hidden || !results.length) return null;
  if (!userMoved && copycats()) return 'ambiguous';
  pick(Math.max(active, 0));
  return 'picked';
}

// Enter before the list loaded. Returns 'picked', 'ambiguous' or 'none'.
export async function searchAndPick(query) {
  results = await searchTokens(query);
  if (!results.length) return 'none';
  if (copycats()) {
    render(query);
    return 'ambiguous';
  }
  pick(0);
  return 'picked';
}

export function wireSearch(handler) {
  onPick = handler;
  const box = input();

  box.addEventListener('input', () => {
    const q = box.value.trim();
    clearTimeout(debounce);
    if (q.length < 2 || looksLikeAddress(q)) {
      controller?.abort();
      close();
      return;
    }
    debounce = setTimeout(() => runSearch(q), 280);
  });

  box.addEventListener('keydown', (e) => {
    if (list().hidden) return;
    const count = results.length;
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault();
      userMoved = true;
      setActive((active + 1) % count);
    } else if (e.key === 'ArrowUp' && count) {
      e.preventDefault();
      userMoved = true;
      setActive((active - 1 + count) % count);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  box.addEventListener('blur', () => setTimeout(close, 120));
}
