// TrustScore: wires the page together. Reads public safety data (GoPlus) and market data
// (DexScreener, GeckoTerminal), turns it into plain-English findings and a 0-10 score.

import { analyze } from './analyze.js';
import { getCreatorHistory } from './creator.js';
import { detectChain, getMarket, getSecurity, RateLimitError } from './api.js';
import { CHAINS, PONS, chainById } from './config.js';
import { wireFeed } from './feed.js';
import { startHeroScene } from './hero.js';
import { wireScroll } from './scroll.js';
import { addRecent, wireRecent } from './recent.js';
import { renderCreator, renderReport, setStatus, startLoader, stopLoader, wireHolderTooltip } from './report.js';
import { looksLikeAddress, pickFromOpenList, searchAndPick, wireSearch } from './search.js';
import { shareCard } from './share.js';
import { $, el, isEvmAddress, isSolanaAddress, normalizeAddress, reduceMotion, shortAddress } from './util.js';

const form = $('check-form');
const chainSelect = $('chain');
const addressInput = $('address');
const checkBtn = $('check-btn');
const reportEl = $('report');

let currentRun = 0;
let lastReport = null;

const BUSY_MESSAGE = 'The safety service is busy right now. Wait a minute and try again.';

// chain: a chain object, or null to auto-detect.
async function runCheck(chain, rawAddress) {
  const address = normalizeAddress(rawAddress.trim());
  if (!looksLikeAddress(address)) {
    setStatus("That doesn't look like a coin address. Paste a contract address, or type a coin's name and pick it from the list.", true);
    return;
  }
  // A Solana address can't be on an EVM network and vice versa; fall back to auto-detect.
  if (chain && (chain.kind === 'solana') !== isSolanaAddress(address)) chain = null;
  if (!isEvmAddress(address) && !isSolanaAddress(address)) chain = null;

  const run = ++currentRun;
  reportEl.hidden = true;
  checkBtn.disabled = true;
  setStatus('');
  startLoader(shortAddress(address), !chain);

  try {
    let sec = null;
    if (!chain) {
      const found = await detectChain(address);
      if (run !== currentRun) return;
      if (!found) {
        stopLoader();
        setStatus("We couldn't find this coin on any network we support. Double-check the address.", true);
        return;
      }
      ({ chain, sec } = found);
    }

    const [secResult, market] = await Promise.all([sec ? sec : getSecurity(chain, address), getMarket(chain, address)]);
    if (run !== currentRun) return;
    stopLoader();

    if (!secResult) {
      setStatus(`We couldn't find this coin on ${chain.name}. Double-check the address and the network.`, true);
      return;
    }

    const url = new URL(location.href);
    url.searchParams.set('chain', chain.id);
    url.searchParams.set('address', address);
    history.replaceState(null, '', url);

    const result = analyze(chain, secResult, market, address);
    lastReport = { chain, address, result, market };
    renderReport(lastReport);
    addRecent({ chain, address, symbol: result.symbol, name: result.name, score: result.score });
    reportEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (chain.id === PONS.chainId) loadCreator(run, secResult);
    else renderCreator(null);
  } catch (err) {
    if (run !== currentRun) return;
    stopLoader();
    console.error(err);
    setStatus(err instanceof RateLimitError ? BUSY_MESSAGE : "Couldn't reach the safety service. Wait a minute and try again.", true);
  } finally {
    if (run === currentRun) checkBtn.disabled = false;
  }
}

// The chain lookup takes a few seconds, so the report shows first and this fills in behind it.
async function loadCreator(run, sec) {
  const { chain, address, market } = lastReport;
  renderCreator('loading');
  let creator;
  try {
    creator = await getCreatorHistory(address, market?.createdAt);
  } catch (err) {
    console.warn('Creator history unavailable.', err);
    if (run === currentRun) renderCreator('error');
    return;
  }
  if (run !== currentRun) return;
  renderCreator(creator);
  if (!creator) return;

  const result = analyze(chain, sec, market, address, creator);
  lastReport = { chain, address, result, market };
  renderReport(lastReport, { quiet: true });
  addRecent({ chain, address, symbol: result.symbol, name: result.name, score: result.score });
}

const selectedChain = () => chainById(chainSelect.value) || null;

// Open a specific coin from anywhere on the page (search, feed, recent, examples).
function openCoin(chain, address) {
  chainSelect.value = chain ? chain.id : 'auto';
  addressInput.value = address;
  runCheck(chain, address);
}

// ---------- wiring ----------

chainSelect.append(Object.assign(el('option', '', 'Auto-detect'), { value: 'auto' }));
for (const chain of CHAINS) chainSelect.append(Object.assign(el('option', '', chain.name), { value: chain.id }));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = addressInput.value.trim();
  if (looksLikeAddress(value)) return runCheck(selectedChain(), value);
  if (value.length < 2) return setStatus('Type a coin name or paste its contract address.', true);

  const pickHint = () => setStatus(`Several coins are called "${value}". Pick the one you mean from the list.`);
  const fromList = pickFromOpenList();
  if (fromList === 'picked') return;
  if (fromList === 'ambiguous') return pickHint();

  try {
    const outcome = await searchAndPick(value);
    if (outcome === 'none') setStatus(`No coins found for "${value}" on our networks.`, true);
    if (outcome === 'ambiguous') pickHint();
  } catch {
    setStatus("Search isn't responding right now. Try pasting the contract address instead.", true);
  }
});

wireSearch((r) => openCoin(r.chain, r.address));
wireRecent(openCoin);
wireFeed(openCoin);
wireHolderTooltip();
wireScroll();
startHeroScene();

document.querySelectorAll('[data-address]').forEach((btn) => {
  btn.addEventListener('click', () => openCoin(chainById(btn.dataset.chain), btn.dataset.address));
});

$('share-btn').addEventListener('click', async () => {
  const btn = $('share-btn');
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'Copied ✓';
  } catch {
    prompt('Copy this link:', location.href);
  }
  setTimeout(() => (btn.textContent = 'Copy link'), 2000);
});

$('image-btn').addEventListener('click', async () => {
  if (!lastReport) return;
  const btn = $('image-btn');
  btn.disabled = true;
  try {
    await shareCard(lastReport);
  } finally {
    btn.disabled = false;
  }
});

// Shared links (?chain=…&address=…) open straight to the report.
const params = new URLSearchParams(location.search);
if (params.get('address')) openCoin(chainById(params.get('chain')), params.get('address'));
