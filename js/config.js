// Networks we support. `id` is GoPlus's chain id, `dex` is DexScreener's, `gecko` is GeckoTerminal's.
export const CHAINS = [
  { id: '4663', name: 'Robinhood Chain', dex: 'robinhood', gecko: 'robinhood', kind: 'evm' },
  { id: '1', name: 'Ethereum', dex: 'ethereum', gecko: 'eth', kind: 'evm' },
  { id: '8453', name: 'Base', dex: 'base', gecko: 'base', kind: 'evm' },
  { id: '42161', name: 'Arbitrum', dex: 'arbitrum', gecko: 'arbitrum', kind: 'evm' },
  { id: '56', name: 'BNB Chain', dex: 'bsc', gecko: 'bsc', kind: 'evm' },
  { id: '137', name: 'Polygon', dex: 'polygon', gecko: 'polygon_pos', kind: 'evm' },
  { id: 'solana', name: 'Solana', dex: 'solana', gecko: 'solana', kind: 'solana' },
];

export const chainById = (id) => CHAINS.find((c) => c.id === id);
export const chainByDex = (dex) => CHAINS.find((c) => c.dex === dex);

// Networks shown as tabs in the "new coins" feed, in order.
export const FEED_CHAINS = ['4663', '8453', 'solana', '1'];

// Optional: your Cloudflare Worker URL (see worker/README.md), e.g. 'https://trustscore-proxy.you.workers.dev'.
// When set, every API call goes through it and gets cached. Leave empty to call the APIs directly.
export const API_PROXY = '';

// Your Worker's address (see worker/README.md), e.g. 'https://trustscore-proxy.you.workers.dev'.
// Premium (Creator Track Record and the new coins feed) comes from it, for token holders only.
// Leave empty and premium shows as "coming soon".
export const PREMIUM_API = '';

// Pons, the launchpad on Robinhood Chain. Every launch emits this event on the factory contract:
// topic 1 is the coin and topic 3 is the wallet that launched it.
export const PONS = {
  chainId: '4663',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  factory: '0xe33e9e479df8802cb0866d5d05258bec4cf62948',
  launchEvent: '0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37',
  firstBlock: 28000000, // the factory has no launches before about here
  maxBlockRange: 9900000, // the public RPC refuses log queries wider than 10 million blocks
};
