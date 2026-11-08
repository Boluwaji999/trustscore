// Premium for TrustScore token holders: wallet sign-in, the holder pass, and the locked panels.
//
// Signing in asks the wallet to sign a short message. That's free: no transaction, no gas, no funds
// move. The Worker checks the signature and the wallet's token balance, then hands back a pass.
// Premium data only comes from the Worker, which checks the pass on every request, so editing this
// page can't unlock anything.

import { PREMIUM_API } from './config.js';
import { $, el, shortAddress, storeGet, storeSet } from './util.js';

const KEY = 'trustscore:pass';
const listeners = new Set();
let info = null;

export class LockedError extends Error {}

export const premiumConfigured = () => Boolean(PREMIUM_API);

export function getPass() {
  const pass = storeGet(localStorage, KEY, null);
  return pass && pass.exp > Date.now() ? pass : null;
}

export const isUnlocked = () => Boolean(getPass());

export function onPremiumChange(fn) {
  listeners.add(fn);
}

function emit() {
  renderWalletButton();
  listeners.forEach((fn) => fn());
}

export function signOut() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
  emit();
}

// What holding unlocks and how much is needed, set on the Worker.
export async function premiumInfo() {
  if (!PREMIUM_API) return null;
  if (info) return info;
  try {
    info = await (await fetch(`${PREMIUM_API}/premium/info`)).json();
  } catch {
    info = null;
  }
  return info;
}

export async function premiumFetch(path) {
  const pass = getPass();
  if (!pass) throw new LockedError('locked');
  const res = await fetch(`${PREMIUM_API}${path}`, { headers: { Authorization: `Bearer ${pass.pass}` } });
  if (res.status === 401) {
    signOut(); // expired or no longer valid
    throw new LockedError('locked');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const toHex = (text) => `0x${[...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

// Plain-English reasons for anything that stops an unlock.
function unlockMessage(error, data, details) {
  const symbol = details?.symbol || 'TRUST';
  switch (error) {
    case 'no_wallet': return 'No wallet found. Install a wallet like MetaMask, or open this site in your wallet app\'s browser.';
    case 'rejected': return 'Sign-in cancelled in your wallet.';
    case 'not_launched': return `The $${symbol} token hasn't launched yet. Holders can unlock this once it does.`;
    case 'not_enough': return `This wallet holds ${Number(data.held).toLocaleString()} $${symbol}. You need ${Number(data.needed).toLocaleString()} to unlock.`;
    case 'expired': return 'That sign-in took too long. Try again.';
    case 'balance_unavailable': return "Couldn't read your balance from the chain right now. Try again in a minute.";
    default: return "Couldn't unlock right now. Try again in a minute.";
  }
}

export async function unlock() {
  const eth = window.ethereum;
  if (!eth) throw Object.assign(new Error('no_wallet'), { code: 'no_wallet' });

  let address;
  let signature;
  const issued = new Date().toISOString();
  try {
    [address] = await eth.request({ method: 'eth_requestAccounts' });
    const message = signInMessage(address, issued);
    signature = await eth.request({ method: 'personal_sign', params: [toHex(message), address] });
  } catch (err) {
    throw Object.assign(new Error('rejected'), { code: err?.code === 4001 ? 'rejected' : 'rejected' });
  }

  const res = await fetch(`${PREMIUM_API}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: signInMessage(address, issued), signature }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'failed'), { code: data.error || 'failed', data });

  storeSet(localStorage, KEY, { pass: data.pass, address: data.address, exp: Date.now() + data.hours * 36e5 - 60000 });
  emit();
  return data;
}

function signInMessage(address, issued) {
  return `Sign in to TrustScore\n\nThis proves you own this wallet. It's free and doesn't move any funds.\n\nWallet: ${address}\nIssued: ${issued}`;
}

// ---------- UI ----------

const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

// A panel that explains what's locked and offers to unlock it.
export function lockPanel(title, description) {
  const panel = el('div', 'lock-panel');
  const icon = el('span', 'lock-icon');
  icon.innerHTML = LOCK_ICON;
  const need = el('p', 'lock-need', 'For TrustScore token holders.');
  const error = el('p', 'lock-error');
  error.hidden = true;
  panel.append(icon, el('h4', '', title), el('p', 'lock-desc', description), need);

  if (!premiumConfigured()) {
    need.textContent = 'Coming soon for TrustScore token holders.';
    return panel;
  }

  const button = el('button', 'btn btn-primary lock-btn', 'Connect wallet to unlock');
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    error.hidden = true;
    button.textContent = 'Check your wallet…';
    try {
      await unlock();
    } catch (err) {
      error.textContent = unlockMessage(err.code, err.data || {}, await premiumInfo());
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Connect wallet to unlock';
    }
  });
  panel.append(button, error, el('p', 'lock-free', "Signing in is free. It doesn't move any funds."));

  premiumInfo().then((details) => {
    if (!details) return;
    need.textContent = details.launched
      ? `Hold ${Number(details.minHold).toLocaleString()} $${details.symbol} to unlock. Nothing is spent.`
      : `Unlocks for $${details.symbol} holders when the token launches.`;
  });
  return panel;
}

function renderWalletButton() {
  const btn = $('wallet-btn');
  if (!btn) return;
  btn.hidden = !premiumConfigured();
  const pass = getPass();
  btn.classList.toggle('connected', Boolean(pass));
  btn.textContent = pass ? `Holder · ${shortAddress(pass.address)}` : 'Connect wallet';
  btn.title = pass ? 'Signed in as a holder. Click to sign out.' : 'Unlock premium with your TrustScore tokens';
}

export function wirePremium() {
  renderWalletButton();
  $('wallet-btn')?.addEventListener('click', async () => {
    if (getPass()) {
      if (confirm('Sign out of TrustScore premium?')) signOut();
      return;
    }
    try {
      await unlock();
    } catch (err) {
      alert(unlockMessage(err.code, err.data || {}, await premiumInfo()));
    }
  });
  // Switching accounts in the wallet means the pass may no longer apply.
  window.ethereum?.on?.('accountsChanged', (accounts) => {
    const pass = getPass();
    if (pass && (accounts?.[0] || '').toLowerCase() !== pass.address) signOut();
  });
}
