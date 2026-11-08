export const isOn = (v) => v === '1' || v === 1;
export const known = (v) => v !== undefined && v !== null && v !== '';
export const lower = (s) => String(s || '').toLowerCase();
export const pct = (fraction) => `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;

export const isEvmAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
export const isSolanaAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

// EVM addresses are case-insensitive; Solana addresses are not, so leave those alone.
export const normalizeAddress = (s) => (isEvmAddress(s) ? s.toLowerCase() : s);
export const sameAddress = (a, b) => normalizeAddress(String(a || '')) === normalizeAddress(String(b || ''));

export const shortAddress = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Guarded so this module also loads on the server, where there's no screen.
export const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const money = (n) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: n >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: n >= 1 ? 2 : 8,
  }).format(n);

export function timeAgo(ms) {
  const hours = (Date.now() - ms) / 36e5;
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return `${Math.floor(hours)} hours`;
  const days = Math.floor(hours / 24);
  return days < 365 ? `${days} days` : `${(days / 365).toFixed(1)} years`;
}

export function shortAgo(ms) {
  const mins = Math.max(0, (Date.now() - ms) / 6e4);
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 60 * 48) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export const riskOf = (score) => (score >= 8 ? 'low' : score >= 5 ? 'medium' : 'high');
export const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const $ = (id) => document.getElementById(id);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// localStorage can throw (private mode, blocked storage); never let that break the page.
export function storeGet(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
export function storeSet(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: feature just won't persist */
  }
}
