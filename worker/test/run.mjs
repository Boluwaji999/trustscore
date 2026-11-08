// End-to-end test of the Worker against the live chain, using a throwaway wallet that signs for real.
// Run from the worker folder: node test/run.mjs
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import worker from '../dist/worker.js';

const STAND_IN_TOKEN = '0x585f316bc48f568297e833207695cd5a92b805fb'; // an existing Pons coin, until TrustScore's launches
const BASE = 'https://worker.test';
const ctx = { waitUntil() {} };
let failures = 0;

function wallet() {
  const key = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(key, false).slice(1);
  return { key, address: `0x${bytesToHex(keccak_256(pub).slice(-20))}` };
}

// Same steps a wallet takes for personal_sign.
function sign(key, message) {
  const bytes = utf8ToBytes(message);
  const prefixed = new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${bytes.length}`), ...bytes]);
  const sig = secp256k1.sign(keccak_256(prefixed), key);
  return `0x${sig.toCompactHex()}${(27 + sig.recovery).toString(16)}`;
}

const message = (address, issued = new Date()) =>
  `Sign in to TrustScore\n\nThis proves you own this wallet. It's free and doesn't move any funds.\n\nWallet: ${address}\nIssued: ${issued.toISOString()}`;

// One message, signed once, so the signature always matches what's sent.
function signed(owner, signer = owner) {
  const m = message(owner.address);
  return { message: m, signature: sign(signer.key, m) };
}

async function call(env, method, path, { body, pass } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (pass) headers.Authorization = `Bearer ${pass}`;
  const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body && JSON.stringify(body) }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => null) };
}

function expect(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const me = wallet();
const other = wallet();
const secret = 'test-secret-' + bytesToHex(secp256k1.utils.randomPrivateKey());
const before = { PASS_SECRET: secret, TOKEN_ADDRESS: '', MIN_HOLD: '100000', TOKEN_SYMBOL: 'TRUST' };

let r = await call(before, 'GET', '/premium/info');
expect('info before launch says not launched', r.status === 200 && r.data.launched === false, JSON.stringify(r.data));

r = await call(before, 'POST', '/auth', { body: signed(me) });
expect('sign-in before launch is refused', r.status === 403 && r.data.error === 'not_launched', r.data?.error);

r = await call({ ...before, ALLOW_WALLETS: me.address }, 'POST', '/auth', { body: signed(me) });
expect('allow-listed wallet gets a pass before launch', r.status === 200 && !!r.data.pass);
const pass = r.data?.pass;

r = await call(before, 'POST', '/auth', { body: signed(me, other) });
expect('signature from a different wallet is refused', r.status === 401, r.data?.error);

const old = message(me.address, new Date(Date.now() - 30 * 60 * 1000));
r = await call({ ...before, ALLOW_WALLETS: me.address }, 'POST', '/auth', { body: { message: old, signature: sign(me.key, old) } });
expect('old signed message is refused', r.status === 401 && r.data.error === 'expired', r.data?.error);

const launched = { ...before, TOKEN_ADDRESS: STAND_IN_TOKEN, MIN_HOLD: '1' };
r = await call(launched, 'POST', '/auth', { body: signed(me) });
expect('wallet without enough tokens is refused, balance read from chain', r.status === 403 && r.data.error === 'not_enough' && r.data.held === '0', JSON.stringify(r.data));

r = await call({ ...launched, MIN_HOLD: '0' }, 'POST', '/auth', { body: signed(me) });
expect('wallet meeting the threshold gets a pass', r.status === 200 && !!r.data.pass && r.data.held === '0', JSON.stringify({ status: r.status, held: r.data?.held }));

r = await call(before, 'GET', `/premium/creator?token=${STAND_IN_TOKEN}`);
expect('premium data without a pass is refused', r.status === 401 && r.data.error === 'locked');

const forged = pass.slice(0, -2) + (pass.endsWith('A') ? 'BB' : 'AA');
r = await call(before, 'GET', `/premium/creator?token=${STAND_IN_TOKEN}`, { pass: forged });
expect('tampered pass is refused', r.status === 401);

r = await call({ ...before, PASS_SECRET: 'a-different-secret' }, 'GET', `/premium/creator?token=${STAND_IN_TOKEN}`, { pass });
expect('pass from another server secret is refused', r.status === 401);

let t = Date.now();
r = await call(before, 'GET', `/premium/creator?token=${STAND_IN_TOKEN}`, { pass });
expect('holder gets creator history', r.status === 200 && r.data.record?.creator, `${r.data?.record?.status}, ${r.data?.record?.total} coins, ${((Date.now() - t) / 1000).toFixed(1)}s`);

t = Date.now();
r = await call(before, 'GET', '/premium/feed?chain=4663', { pass });
const done = (r.data?.items || []).filter((i) => i.state === 'done').length;
expect('holder gets the new coins feed', r.status === 200 && r.data.items?.length > 0, `${r.data?.items?.length} coins, ${done} scored, ${((Date.now() - t) / 1000).toFixed(1)}s`);

r = await call(before, 'GET', '/premium/feed?chain=nope', { pass });
expect('unknown network is refused', r.status === 400);

r = await call(before, 'GET', `/?url=${encodeURIComponent('https://example.com/')}`);
expect('proxy still refuses other sites', r.status === 403 || r.status === 400);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
