// Wallet sign-in for TrustScore premium.
//
// 1. The site asks the wallet to sign a short, free message (no transaction, no gas).
// 2. We recover the signer from the signature, so we know the person really controls that wallet.
// 3. We read the wallet's TrustScore token balance on Robinhood Chain.
// 4. Holders get a signed pass that premium requests must carry. The pass is signed with
//    PASS_SECRET, which only this Worker knows, so nobody can forge one.

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { PONS } from '../../js/config.js';

const SIGN_IN_WINDOW_MS = 10 * 60 * 1000; // a signed message is only accepted for 10 minutes
const PASS_HOURS = 6; // passes expire so a wallet that sold its tokens loses access

// ---------- signatures ----------

// EIP-191 "personal_sign": what wallets actually sign.
function personalMessageHash(message) {
  const bytes = utf8ToBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const joined = new Uint8Array(prefix.length + bytes.length);
  joined.set(prefix);
  joined.set(bytes, prefix.length);
  return keccak_256(joined);
}

export function recoverSigner(message, signatureHex) {
  const sig = hexToBytes(signatureHex.replace(/^0x/, ''));
  if (sig.length !== 65) throw new Error('Bad signature length');
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error('Bad signature');
  const point = secp256k1.Signature.fromCompact(sig.slice(0, 64))
    .addRecoveryBit(v)
    .recoverPublicKey(personalMessageHash(message));
  const publicKey = point.toRawBytes(false).slice(1); // drop the 0x04 prefix
  return `0x${bytesToHex(keccak_256(publicKey).slice(-20))}`;
}

// The message the site asks people to sign. Its fields are checked here, so a signature made for
// another site or long ago can't be reused.
export function readSignInMessage(message) {
  if (!message.startsWith('Sign in to TrustScore')) return null;
  const address = /Wallet: (0x[0-9a-fA-F]{40})/.exec(message)?.[1];
  const issued = /Issued: (\S+)/.exec(message)?.[1];
  if (!address || !issued) return null;
  return { address: address.toLowerCase(), issuedAt: Date.parse(issued) };
}

// ---------- token balance ----------

async function ethCall(to, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
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
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

// Returns whole tokens held, as a BigInt (fractions don't matter for a holding threshold).
export async function tokenBalance(token, wallet) {
  const pad = wallet.slice(2).toLowerCase().padStart(64, '0');
  const [raw, decimals] = await Promise.all([
    ethCall(token, `0x70a08231${pad}`), // balanceOf(wallet)
    ethCall(token, '0x313ce567'), // decimals()
  ]);
  return BigInt(raw) / 10n ** BigInt(parseInt(decimals, 16));
}

// ---------- passes ----------

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', utf8ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8ToBytes(text)));
}

export async function issuePass(secret, address) {
  const payload = b64url(utf8ToBytes(JSON.stringify({ a: address, exp: Date.now() + PASS_HOURS * 36e5 })));
  return { pass: `${payload}.${b64url(await hmac(secret, payload))}`, hours: PASS_HOURS };
}

export async function checkPass(secret, pass) {
  const [payload, sig] = String(pass || '').split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmac(secret, payload));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  return data.exp > Date.now() ? data : null;
}

// ---------- the sign-in request ----------

// Returns { status, body } for the route to send back.
export async function signIn({ message, signature }, env) {
  const fields = readSignInMessage(String(message || ''));
  if (!fields) return { status: 400, body: { error: 'bad_message' } };
  if (!(Math.abs(Date.now() - fields.issuedAt) < SIGN_IN_WINDOW_MS)) return { status: 401, body: { error: 'expired' } };

  let signer;
  try {
    signer = recoverSigner(message, String(signature || ''));
  } catch {
    return { status: 401, body: { error: 'bad_signature' } };
  }
  if (signer !== fields.address) return { status: 401, body: { error: 'bad_signature' } };

  // Wallets you list in ALLOW_WALLETS (for example your own, for testing) are let in without tokens.
  const allowed = String(env.ALLOW_WALLETS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const token = String(env.TOKEN_ADDRESS || '').trim();
  const needed = BigInt(String(env.MIN_HOLD || '0').replace(/[^0-9]/g, '') || '0');

  let held = null;
  if (!allowed.includes(signer)) {
    if (!token) return { status: 403, body: { error: 'not_launched' } };
    try {
      held = await tokenBalance(token, signer);
    } catch {
      return { status: 503, body: { error: 'balance_unavailable' } };
    }
    if (held < needed) return { status: 403, body: { error: 'not_enough', held: held.toString(), needed: needed.toString() } };
  }

  const { pass, hours } = await issuePass(env.PASS_SECRET, signer);
  return { status: 200, body: { pass, address: signer, hours, held: held === null ? null : held.toString() } };
}
