# Caching proxy (optional, free)

You don't need this to launch. Turn it on when the site gets busy and people start seeing
"the safety service is busy" messages. It caches API answers at Cloudflare so the free APIs
get far fewer requests.

## Set it up (about 5 minutes, no coding)

1. Make a free account at https://dash.cloudflare.com.
2. Go to **Workers & Pages → Create → Create Worker**. Name it `trustscore-proxy` and click **Deploy**.
3. Click **Edit code**, delete what's there, paste in everything from `worker.js`, and click **Deploy**.
4. Copy your worker's address. It looks like `https://trustscore-proxy.YOURNAME.workers.dev`.
5. Open `js/config.js` in the site and set:

   ```js
   export const API_PROXY = 'https://trustscore-proxy.YOURNAME.workers.dev';
   ```

6. Re-upload the site. Done.

The free plan allows 100,000 requests per day.

## Check it works

Open this in a browser (with your worker's address):

```
https://trustscore-proxy.YOURNAME.workers.dev/?url=https%3A%2F%2Fapi.dexscreener.com%2Flatest%2Fdex%2Fsearch%3Fq%3Dpepe
```

You should see JSON. Load it twice; the second time the `X-Cache` response header says `HIT`.

## Safety

The worker only forwards to GoPlus, DexScreener and GeckoTerminal. Requests to any other site
are refused, so nobody can use your worker as a free general-purpose proxy.
