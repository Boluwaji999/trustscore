// Premium for TrustScore token holders: connect a wallet, check its token balance, show the locked
// panels.
//
// Connecting only reads the wallet's address and balance: nothing is signed, spent or approved. The
// check runs in the browser, so someone technical could get around it; worker/README.md has the
// server-checked version for when that matters.

import { PONS, TOKEN } from './config.js';
import { $, el, shortAddress, storeGet, storeSet, wait } from './util.js';

const KEY = 'trustscore:holder';
const CHECK_HOURS = 6; // re-check the balance this often, so a wallet that sold loses access
const listeners = new Set();

export class LockedError extends Error {}

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

// For premium features: throws LockedError if this visitor hasn't unlocked.
export function requireUnlocked() {
  if (!isUnlocked()) throw new LockedError('locked');
}

async function ethCall(to, data) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(PONS.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message);
      return body.result;
    } catch (err) {
      lastError = err;
      await wait(700 * (attempt + 1));
    }
  }
  throw lastError;
}

// Whole tokens held, as a BigInt.
async function tokenBalance(wallet) {
  const pad = wallet.slice(2).toLowerCase().padStart(64, '0');
  const [raw, decimals] = await Promise.all([
    ethCall(TOKEN.address, `0x70a08231${pad}`), // balanceOf(wallet)
    ethCall(TOKEN.address, '0x313ce567'), // decimals()
  ]);
  return BigInt(raw) / 10n ** BigInt(parseInt(decimals, 16));
}

const fail = (code, data = {}) => Object.assign(new Error(code), { code, data });

export async function unlock() {
  const eth = window.ethereum;
  if (!eth) throw fail('no_wallet');

  let address;
  try {
    [address] = await eth.request({ method: 'eth_requestAccounts' });
  } catch {
    throw fail('rejected');
  }
  address = String(address || '').toLowerCase();
  if (!address) throw fail('rejected');

  const allowed = TOKEN.allowWallets.map((w) => w.toLowerCase()).includes(address);
  let held = null;
  if (!allowed) {
    if (!TOKEN.address) throw fail('not_launched');
    try {
      held = await tokenBalance(address);
    } catch {
      throw fail('balance_unavailable');
    }
    if (held < BigInt(TOKEN.minHold)) throw fail('not_enough', { held, needed: TOKEN.minHold });
  }

  storeSet(localStorage, KEY, { address, exp: Date.now() + CHECK_HOURS * 36e5 });
  emit();
}

// Plain-English reasons for anything that stops an unlock.
function unlockMessage(error, data) {
  const symbol = TOKEN.symbol;
  switch (error) {
    case 'no_wallet': return "No wallet found. Install a wallet like MetaMask, or open this site in your wallet app's browser.";
    case 'rejected': return 'Connection cancelled in your wallet.';
    case 'not_launched': return `The $${symbol} token hasn't launched yet. Holders can unlock this once it does.`;
    case 'not_enough': return `This wallet holds ${Number(data.held).toLocaleString()} $${symbol}. You need ${Number(data.needed).toLocaleString()} to unlock.`;
    case 'balance_unavailable': return "Couldn't read your balance from the chain right now. Try again in a minute.";
    default: return "Couldn't unlock right now. Try again in a minute.";
  }
}

// ---------- UI ----------

const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

// A panel that explains what's locked and offers to unlock it.
export function lockPanel(title, description) {
  const panel = el('div', 'lock-panel');
  const icon = el('span', 'lock-icon');
  icon.innerHTML = LOCK_ICON;
  const need = el('p', 'lock-need', TOKEN.address
    ? `Hold ${TOKEN.minHold.toLocaleString()} $${TOKEN.symbol} to unlock. Nothing is spent.`
    : `Unlocks for $${TOKEN.symbol} holders when the token launches.`);
  const error = el('p', 'lock-error');
  error.hidden = true;

  const button = el('button', 'btn btn-primary lock-btn', 'Connect wallet to unlock');
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    error.hidden = true;
    button.textContent = 'Check your wallet…';
    try {
      await unlock();
    } catch (err) {
      error.textContent = unlockMessage(err.code, err.data || {});
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Connect wallet to unlock';
    }
  });

  panel.append(icon, el('h4', '', title), el('p', 'lock-desc', description), need, button, error,
    el('p', 'lock-free', "Connecting is free. TrustScore only reads your balance and never moves funds."));
  return panel;
}

function renderWalletButton() {
  const btn = $('wallet-btn');
  if (!btn) return;
  btn.hidden = false;
  const pass = getPass();
  btn.classList.toggle('connected', Boolean(pass));
  btn.textContent = pass ? `Holder · ${shortAddress(pass.address)}` : 'Connect wallet';
  btn.title = pass ? 'Unlocked as a holder. Click to disconnect.' : `Unlock premium with your $${TOKEN.symbol}`;
}

export function wirePremium() {
  renderWalletButton();
  $('wallet-btn')?.addEventListener('click', async () => {
    if (getPass()) {
      if (confirm('Disconnect your wallet from TrustScore premium?')) signOut();
      return;
    }
    try {
      await unlock();
    } catch (err) {
      alert(unlockMessage(err.code, err.data || {}));
    }
  });
  // Switching accounts in the wallet means the unlock may no longer apply.
  window.ethereum?.on?.('accountsChanged', (accounts) => {
    const pass = getPass();
    if (pass && (accounts?.[0] || '').toLowerCase() !== pass.address) signOut();
  });
}
