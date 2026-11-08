# TrustScore Worker

A small server on Cloudflare's free plan. It does three jobs:

- **Premium for token holders.** People connect a wallet and sign a free message. The Worker checks the
  signature and their TrustScore token balance, then serves Creator Track Record and the new coins feed.
  Premium data only ever comes from here, so editing the website can't unlock it.
- **Caching.** Premium answers are cached for a few minutes, so a busy day costs the free data APIs a
  handful of requests instead of thousands.
- **Proxy.** It can also cache the site's other API calls (see `API_PROXY` in `js/config.js`).

## Set it up (about 10 minutes, no coding)

1. Make a free account at https://dash.cloudflare.com.
2. Go to **Workers & Pages → Create → Create Worker**. Name it `trustscore-proxy` and click **Deploy**.
3. Click **Edit code**, delete everything there, paste in the whole of `dist/worker.js`, and click **Deploy**.
4. Open the Worker's **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   |---|---|---|
   | `PASS_SECRET` | Secret | A long random password. Make one up (40+ random characters) and never share it. |
   | `TOKEN_ADDRESS` | Text | The TrustScore token's contract address. **Leave it out until the token launches.** |
   | `MIN_HOLD` | Text | How many whole tokens a wallet must hold, e.g. `100000`. |
   | `TOKEN_SYMBOL` | Text | The ticker shown on the site, e.g. `TRUST`. |
   | `ALLOW_WALLETS` | Text | Optional. Your own wallet address, so you can test premium before the token exists. Separate several with commas. |

5. Copy the Worker's address. It looks like `https://trustscore-proxy.YOURNAME.workers.dev`.
6. In the website's `js/config.js`, set `export const PREMIUM_API = 'https://trustscore-proxy.YOURNAME.workers.dev';` and publish the site.

## Check it works

Open `https://trustscore-proxy.YOURNAME.workers.dev/premium/info`. You should see something like
`{"launched":false,"token":null,"symbol":"TRUST","minHold":"100000"}`.

## When the token launches

Add `TOKEN_ADDRESS` in the Worker's settings (step 4) and deploy. Nothing on the website needs to change.

## Changing the Worker's code

The source is in `src/`, and it reuses the website's own scoring code from `../js/`. After a change,
rebuild `dist/worker.js` and paste it in again (step 3):

```bash
npm install
npm run build
npm test
```

`npm test` signs in with a throwaway wallet against the live chain and checks that holders get in and
everyone else is refused.

## Safety

- The proxy only forwards to GoPlus, DexScreener and GeckoTerminal, so nobody can use it as a free
  general-purpose proxy.
- Signing in is a plain message signature: no transaction, no gas, no approval, and no funds can move.
- Passes last 6 hours, so a wallet that sells its tokens loses access within 6 hours.
- The free plan allows 100,000 requests a day and a small amount of processing per request. If premium
  gets busy enough to hit that, Cloudflare's $5/month plan raises both.
