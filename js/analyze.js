// Turns raw GoPlus + market data into plain-English findings and a 0-10 score.

import { isOn, known, lower, pct, money, timeAgo, sameAddress } from './util.js';

const BURN = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '1nc1nerator11111111111111111111111111111111',
]);

const LEVEL_ORDER = { danger: 0, warn: 1, info: 2, good: 3 };

// Almost every new coin fades within days, so a clean first-day report can't mean low risk yet.
const TOO_NEW_HOURS = 24;
const TOO_NEW_MAX_SCORE = 6;

const isBurn = (a) => BURN.has(lower(a)) || BURN.has(String(a || ''));

// `creator` is the Pons creator record from creator.js, once it has loaded.
export function analyze(chain, sec, market, address, creator = null) {
  const findings = [];
  const add = (level, title, why, penalty = 0) => findings.push({ level, title, why, penalty });

  const token =
    chain.kind === 'solana'
      ? analyzeSolana(sec, address, add)
      : analyzeEvm(sec, address, add);

  holderFindings(token.holders, add);
  marketFindings(market, add);
  if (creator) creatorFindings(creator, add);

  const penalty = findings.reduce((sum, f) => sum + f.penalty, 0);
  let score = Math.min(10, Math.max(0, Math.floor((100 - penalty) / 10)));
  // Two or more red flags is high risk no matter how good the rest looks.
  if (findings.filter((f) => f.level === 'danger').length >= 2) score = Math.min(score, 4);
  const tooNew = !!market?.createdAt && (Date.now() - market.createdAt) / 36e5 < TOO_NEW_HOURS;
  if (tooNew) score = Math.min(score, TOO_NEW_MAX_SCORE);
  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return { ...token, findings, score, tooNew };
}

// ---------- EVM networks ----------

function analyzeEvm(sec, address, add) {
  // Can you sell?
  if (isOn(sec.is_honeypot)) {
    add('danger', "Honeypot: you can buy, but you can't sell",
      "Tests show this coin can't be sold once you buy it. This is one of the most common scams.", 100);
  } else if (known(sec.is_honeypot)) {
    add('good', 'You can sell it', 'Tests show this coin can be bought and sold normally.');
  }
  if (isOn(sec.honeypot_with_same_creator)) {
    add('danger', 'This creator has made scam coins before',
      "The wallet that made this coin also made coins people couldn't sell.", 30);
  }
  if (isOn(sec.cannot_sell_all)) {
    add('warn', "You can't sell all your coins at once",
      'The coin stops you from selling your whole bag in one go.', 15);
  }

  // Is the code public?
  if (sec.is_open_source === '0') {
    add('danger', 'The code is hidden',
      "Nobody can read this coin's code, so nobody can check what it really does.", 25);
  } else if (isOn(sec.is_open_source)) {
    add('good', 'The code is public', "Anyone can read this coin's code and check what it does.");
  }

  // Who's in charge?
  const ownerGone = isBurn(sec.owner_address);
  if (ownerGone) {
    add('good', 'The creator gave up control',
      "The coin's owner powers were handed to an address nobody controls, so nobody can change the rules.");
  } else if (known(sec.owner_address)) {
    add('info', 'Someone still controls this coin',
      "One wallet still has owner powers. That isn't bad on its own, but it means the powers below can be used.");
  }

  // Powers that only matter while someone owns the coin.
  const ownerPowers = [
    ['is_mintable', 'danger', 'The creator can make unlimited new coins',
      "Printing new coins makes everyone else's coins worth less. Scammers use this to dump on buyers.", 25],
    ['owner_change_balance', 'danger', "The owner can change people's balances",
      'The owner could take coins out of your wallet or give themselves more.', 30],
    ['slippage_modifiable', 'warn', 'The owner can change the fees',
      'The buy/sell fee can be raised at any time, even to 100%.', 15],
    ['transfer_pausable', 'warn', 'Trading can be paused',
      'The owner can freeze all transfers, which would trap your coins.', 10],
    ['is_blacklisted', 'warn', 'The owner can block wallets',
      'Specific wallets can be stopped from selling. Some projects use this on bots; scammers use it on buyers.', 10],
    ['personal_slippage_modifiable', 'warn', 'Different wallets can be charged different fees',
      'The owner can set a special (higher) fee for specific wallets.', 10],
    ['trading_cooldown', 'warn', "There's a forced wait between trades",
      "You may have to wait before you're allowed to sell again.", 5],
    ['anti_whale_modifiable', 'warn', 'The max-buy limit can be changed',
      'The owner can change how much one wallet is allowed to buy or hold.', 3],
  ];
  let unusablePowers = 0;
  for (const [field, level, title, why, penalty] of ownerPowers) {
    if (!isOn(sec[field])) continue;
    if (ownerGone) unusablePowers++;
    else add(level, title, why, penalty);
  }
  if (unusablePowers > 0) {
    add('info', `${unusablePowers} owner power${unusablePowers > 1 ? 's exist' : ' exists'}, but nobody can use ${unusablePowers > 1 ? 'them' : 'it'}`,
      'The code has some owner-only switches, but since control was given up, nobody can flip them.');
  }

  // Dangerous no matter who owns it.
  if (isOn(sec.hidden_owner)) {
    add('danger', "There's a hidden owner",
      'Someone has secret control of this coin even if it looks like nobody does.', 25);
  }
  if (isOn(sec.can_take_back_ownership)) {
    add('danger', 'The creator can take control back',
      "Even if they \"gave up\" control, there's a way for them to get it back.", 25);
  }
  if (isOn(sec.selfdestruct)) {
    add('danger', 'The coin can be deleted', 'The code has a self-destruct switch.', 20);
  }
  if (isOn(sec.is_proxy)) {
    add('warn', 'The code can be swapped out later',
      'This coin is built so its code can be replaced. The rules could change after you buy.', 10);
  }
  if (isOn(sec.external_call)) {
    add('warn', 'The coin depends on another contract',
      "Part of how it works lives in a different contract, so we can't see all of it.", 5);
  }

  // Fees
  if (known(sec.buy_tax) || known(sec.sell_tax)) {
    const buy = Number(sec.buy_tax || 0);
    const sell = Number(sec.sell_tax || 0);
    const worst = Math.max(buy, sell);
    const feeText = `${pct(buy)} to buy, ${pct(sell)} to sell`;
    if (worst > 0.3) add('danger', `Huge fees: ${feeText}`, 'You lose a big chunk of your money every time you trade.', 40);
    else if (worst > 0.1) add('warn', `High fees: ${feeText}`, 'Trading this coin costs a lot more than normal.', 15);
    else if (worst > 0) add('info', `Small fees: ${feeText}`, 'Some coins take a small cut of each trade. This one is low.');
    else add('good', 'No buy/sell fees', "The coin doesn't take a cut when you trade.");
  }

  if (Number(sec.creator_percent) > 0.2) {
    add('warn', `The creator still holds ${pct(Number(sec.creator_percent))}`,
      'The person who made the coin could sell a big pile at any time.', 10);
  }

  // Is the trading money locked?
  if (Array.isArray(sec.lp_holders) && sec.lp_holders.length) {
    // Pool shares that are locked, burned, or held by the coin contract itself can't be pulled out by a person.
    const locked = sec.lp_holders
      .filter((h) => isOn(h.is_locked) || isBurn(h.address) || sameAddress(h.address, address))
      .reduce((sum, h) => sum + Number(h.percent || 0), 0);
    lockFinding(locked, add);
  } else {
    add('info', "Couldn't check if the trading money is locked",
      "This coin trades on newer pool types we can't check yet. Look it up on the coin's trading page.");
  }

  // Holders, labelled for the chart and the concentration check.
  const pools = new Set((sec.dex || []).map((d) => lower(d.pair)));
  const holders = (sec.holders || []).map((h) => {
    let kind = 'wallet';
    if (isBurn(h.address)) kind = 'burned';
    else if (pools.has(lower(h.address))) kind = 'pool';
    else if (isOn(h.is_locked)) kind = 'locked';
    else if (sameAddress(h.address, address)) kind = 'token';
    else if (sameAddress(h.address, sec.creator_address)) kind = 'creator';
    else if (isOn(h.is_contract)) kind = 'contract';
    return { address: h.address, tag: h.tag || '', percent: Number(h.percent || 0), kind };
  });

  return {
    name: sec.token_name || 'Unknown token',
    symbol: sec.token_symbol || '',
    holderCount: known(sec.holder_count) ? Number(sec.holder_count) : null,
    holders,
  };
}

// ---------- Solana ----------

function analyzeSolana(sec, address, add) {
  const status = (field) => isOn(sec[field]?.status);

  if (sec.trusted_token === 1 || sec.trusted_token === '1') {
    add('good', 'A well-known, trusted token', 'This token is on GoPlus\'s list of established Solana tokens.');
  }
  add('info', "Sell test isn't available on Solana",
    "We can't simulate a sell on Solana, so check the other findings and the trading page carefully.");

  if (status('mintable')) {
    add('danger', 'The creator can make unlimited new coins',
      "Printing new coins makes everyone else's coins worth less. Scammers use this to dump on buyers.", 25);
  } else if (sec.mintable) {
    add('good', 'Minting is switched off', 'Nobody can create more of this coin.');
  }
  if (status('freezable')) {
    add('danger', 'Your coins can be frozen',
      'Someone holds a "freeze" key that can lock any wallet\'s coins so they can\'t be sold.', 25);
  } else if (sec.freezable) {
    add('good', "Coins can't be frozen", 'Nobody has the power to lock your coins in your wallet.');
  }
  if (status('balance_mutable_authority')) {
    add('danger', "Someone can change people's balances",
      'A special key can take coins out of wallets or change how many people hold.', 30);
  }
  if (status('closable')) {
    add('warn', 'The coin can be shut down', 'Someone has the power to close this token entirely.', 15);
  }
  if (isOn(sec.non_transferable)) {
    add('danger', "The coin can't be transferred", "You couldn't send or sell it after buying.", 40);
  }
  if (sec.default_account_state === '2') {
    add('danger', 'New wallets start frozen', 'Anyone who buys starts with coins they can\'t move until someone unfreezes them.', 30);
  }
  if (sec.transfer_fee && Object.keys(sec.transfer_fee).length) {
    add('warn', 'There is a fee on every transfer', 'Part of every send or trade is taken as a fee.', 10);
  }
  if (status('transfer_fee_upgradable')) {
    add('warn', 'The transfer fee can be changed', 'The fee could be raised later, even very high.', 10);
  }
  if (Array.isArray(sec.transfer_hook) && sec.transfer_hook.length) {
    add('warn', 'Extra code runs on every transfer', 'Hidden rules can run each time the coin moves, including blocking sells.', 10);
  }
  if (status('transfer_hook_upgradable')) {
    add('warn', 'Transfer rules can be changed later', 'The code that runs on every transfer can be swapped out.', 5);
  }
  if (status('metadata_mutable')) {
    add('info', 'Name and logo can be changed', 'The creator can rename the coin or swap its picture, which scammers use to impersonate others.', 3);
  }

  // Liquidity: GoPlus reports how much of each pool's LP was burned.
  const burns = (sec.dex || []).map((d) => d.burn_percent).filter((b) => b !== null && b !== undefined).map(Number);
  if (burns.length) lockFinding(Math.max(...burns) / 100, add);
  else {
    add('info', "Couldn't check if the trading money is locked",
      "This coin trades on pool types we can't check yet. Look it up on the coin's trading page.");
  }

  const holders = (sec.holders || []).map((h) => ({
    address: h.account,
    tag: h.tag || '',
    percent: Number(h.percent || 0),
    // Tagged accounts on Solana are pools and exchanges, so they don't count as whales.
    kind: isOn(h.is_locked) ? 'locked' : isBurn(h.account) ? 'burned' : h.tag ? 'pool' : 'wallet',
  }));

  return {
    name: sec.metadata?.name || 'Unknown token',
    symbol: sec.metadata?.symbol || '',
    holderCount: known(sec.holder_count) ? Number(sec.holder_count) : null,
    holders,
  };
}

// ---------- Pons creators ----------

// These state facts about a wallet's history and never call anyone a scammer.
function creatorFindings(c, add) {
  add('info', 'Launched on Pons',
    "Pons coins share a standard contract, so code checks say less here. Who made the coin matters more.");

  if (c.status === 'proven') {
    add('good', `Proven creator: ${c.hits} earlier coin${c.hits > 1 ? 's' : ''} still going`,
      "Most Pons coins go quiet within days. This creator has made one that lasted, which is rare. It's a good sign, not a guarantee.", -10);
  } else if (c.status === 'frequent') {
    add('warn', `This creator launched ${c.lastWeek} coins in 7 days`,
      'Coins from very frequent launchers rarely keep trading. That makes this one a riskier bet, not proof of a scam.',
      c.lastWeek >= 20 ? 15 : 10);
  } else if (c.status === 'first') {
    add('info', "This is the creator's first Pons coin", "There's no history to judge yet, good or bad.");
  } else {
    const record = c.judged ? ` ${c.active} of ${c.judged} earlier coins checked are still trading.` : '';
    add('info', `This creator has launched ${c.total} coins`,
      `${record} Most Pons coins go quiet within days, so that alone isn't a red flag.`.trim());
  }
}

// ---------- shared ----------

function lockFinding(locked, add) {
  if (locked >= 0.9) {
    add('good', 'The trading money is locked', "The money people trade against can't be pulled out by the creator.");
  } else if (locked >= 0.5) {
    add('warn', `Only ${pct(locked)} of the trading money is locked`,
      'Some of the money people trade against could still be pulled out.', 8);
  } else {
    add('danger', "The trading money isn't locked",
      'The creator could pull out the money people trade against and leave holders with coins nobody can buy. That is a rug pull.', 15);
  }
}

// Wallet kinds that are counted as people who could dump.
export const COUNTED_KINDS = new Set(['wallet', 'creator', 'contract']);

function holderFindings(holders, add) {
  if (!holders.length) return;
  const top = holders
    .filter((h) => COUNTED_KINDS.has(h.kind))
    .slice(0, 10)
    .reduce((sum, h) => sum + h.percent, 0);
  const title = `The top 10 wallets own ${pct(top)}`;
  if (top > 0.5) add('danger', title, 'A few wallets could sell at once and crash the price.', 20);
  else if (top > 0.25) add('warn', title, 'A small group holds a lot. Some may be exchanges, but check who they are.', 8);
  else add('good', title, 'The coins are spread across lots of wallets, so no small group controls the price.');
}

function marketFindings(market, add) {
  if (!market) {
    add('warn', 'No trading found',
      "We couldn't find anywhere this coin trades on this network, so you may not be able to sell it.", 10);
    return;
  }
  const liq = market.liquidityUsd;
  if (liq < 10000) {
    add('warn', `Very little trading money (${money(liq)})`,
      'Even small sells will crash the price, and you may struggle to get out.', 15);
  } else if (liq < 50000) {
    add('warn', `Not much trading money (${money(liq)})`, 'Bigger trades will move the price a lot.', 5);
  } else {
    add('good', `Plenty of trading money (${money(liq)})`, 'You can buy and sell without moving the price too much.');
  }

  if (market.createdAt) {
    const ageHours = (Date.now() - market.createdAt) / 36e5;
    const title = `Started trading ${timeAgo(market.createdAt)} ago`;
    if (ageHours < TOO_NEW_HOURS) add('warn', title, "It's too new to judge. Most new coins fade fast, so its score is capped until it has lasted a day.", 10);
    else if (ageHours < 24 * 7) add('warn', title, "It's still very new. Give it time to prove itself.", 5);
    else add('good', title, "It's been around for a while, which is a better sign than a brand-new coin.");
  }
}
