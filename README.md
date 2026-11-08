# 🛡️ TrustScore

**Live at [usetrustscore.xyz](https://usetrustscore.xyz)**

Check a coin before you buy it. Search by name or paste a contract address and get a plain-English risk report: honeypots, hidden owners, unlimited minting, freeze keys, unlocked liquidity, whale wallets, high fees and brand-new coins.

- **Networks:** Robinhood Chain, Solana, Ethereum, Base, Arbitrum, BNB Chain, Polygon
- **Cost:** $0. A static site with no backend, no API keys and no accounts. Your only cost is a domain.
- **Data:** [GoPlus Security](https://gopluslabs.io) (safety), [DexScreener](https://dexscreener.com) (price, liquidity, search), [GeckoTerminal](https://www.geckoterminal.com) (newest coins, and market data for small launchpad coins) and the public Robinhood Chain RPC (Pons launches). All free, with no keys.

## Coming soon mode (currently on)

The site shows a "Coming soon" page: the 3D scene, headline and feature list, with no checker,
search or feed, and no calls to the data APIs. To launch, edit `index.html`:

1. Delete the line `<script>document.documentElement.classList.add('coming-soon');</script>`
   (and the comment above it).
2. Change `js/soon.js` to `js/main.js` in the script tag near the bottom.

Then push. Everything else is already in place.

## Features

- **Search by name or ticker**, with logos, plus a warning when several coins share a name (copycats)
- **Auto-detects the network** from the address
- **Risk score out of 10** with grouped findings: High risk, Caution, Notes, Passed
- **Creator Track Record** for Pons coins: who launched it, how many coins they have launched, how many are still trading, and their best coin
- **Top 10 holders chart** with pools, locked and burned wallets labeled
- **Live "new coins" feed** of the newest coins on Robinhood Chain, Base, Solana and Ethereum, already scored
- **Save result image**, a 1200×630 card for posting on X or Telegram
- **Recent checks**, remembered only in the person's own browser
- **Share links**: `?chain=…&address=…` opens straight to a report
- Full-page 3D background that reacts to scrolling and the mouse, with a flat fallback
- Dark design, works on phones, respects the device's reduce-motion setting

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page |
| `style.css` | All styling |
| `og.png` | The image shown when someone shares your link |
| `js/main.js` | Wires everything together, runs a check |
| `js/config.js` | Networks, feed tabs, optional proxy URL |
| `js/api.js` | All calls to the data services |
| `js/creator.js` | Creator Track Record: reads Pons launches from the chain |
| `js/analyze.js` | **The rules:** every finding and its penalty, for EVM and Solana |
| `js/report.js` | Draws the report, holder chart and loader |
| `js/search.js` | Name search dropdown |
| `js/feed.js` | New coins feed |
| `js/flow3d.js` | The 3D background: shield, coins and how scrolling moves them |
| `js/flow.js` | Flat fallback when 3D is not available |
| `js/scroll.js` | Progress bar, hero fade and section reveals on scroll |
| `js/share.js` | Result image |
| `js/recent.js` | Recent checks |
| `worker/` | Optional caching proxy (see `worker/README.md`) |

To change how strict the checker is, edit `js/analyze.js`. Each finding has a penalty, the score is `(100 − penalties) ÷ 10`, and two or more red flags cap the score at 4.

## Run it on your computer

```bash
python -m http.server 5173
```

Then open http://localhost:5173. It must run through a local server like this. Double-clicking `index.html` won't work, because the code uses JavaScript modules.

## Put it online for free

**Netlify Drop (easiest)**
1. Go to https://app.netlify.com/drop
2. Drag the whole `trustscore` folder onto the page.
3. You get a free link like `something.netlify.app`.

GitHub Pages, Vercel and Cloudflare Pages also work and are free.

**Custom domain:** buy one, then add it in your host's domain settings and follow the DNS steps they show.

## After you have a domain

1. **Link previews:** in `index.html`, replace both `SITE_URL` with your domain (e.g. `trustscore.xyz`), so shared links show the `og.png` preview on X, Telegram and Discord.
2. **Analytics (free, no cookie banner needed):** create a site in [Cloudflare Web Analytics](https://dash.cloudflare.com/?to=/:account/web-analytics), copy your token, paste it in place of `YOUR_TOKEN` in `index.html`, and remove the `<!--` and `-->` around that script line.
3. **If it gets busy:** set up the caching proxy in `worker/README.md`.

## Limits to know

- The free APIs have rate limits. The feed checks only 6 coins per network, spaces out its requests and caches for 5 minutes. If many people use the site at once, set up the caching proxy.
- Creator Track Record covers coins launched through the current Pons factory (see `PONS` in `js/config.js`). Earlier launches, and other launchpads, show no Creator card.
- It reads a public chain server that sometimes drops requests. It retries, and if it still fails the report shows without creator data.
- Scores in the new-coins feed leave out creator history to stay within free limits, so a coin's full report can score differently.
- On Solana there's no buy/sell simulation, so honeypots can't be detected there. The report says so.
- Results are warning signs, not guarantees. Keep the disclaimer on the page.
