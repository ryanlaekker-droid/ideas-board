# Ground Truth

A self-refilling idea board for contaminated land, environmental modelling and
visualisation tooling. A nightly GitHub Action asks Claude for fresh search
terms, runs them against GitHub, Hacker News, Reddit and arXiv, and commits the
results as `data/ideas.json`. The page is static — it just reads that file.

**No visitor ever triggers an API call.** Your Anthropic spend is one scheduled
run per day regardless of traffic, and the key never leaves GitHub's runner.

## Setup

1. Create a repo and drop these files in at the root.
2. **Settings → Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Get an API key at [console.anthropic.com](https://console.anthropic.com) and add
   a little credit. This is separate from a Claude.ai subscription — a Pro or Max
   plan does not include API access.
4. **Settings → Secrets and variables → Actions → New repository secret**
   Name `ANTHROPIC_API_KEY`, value your key.
5. **Settings → Actions → General → Workflow permissions** → *Read and write*.
   Without this the bot can't commit its results.
6. **Actions → Harvest ideas → Run workflow.** About a minute later the board fills.

The sample cards shipped in `data/ideas.json` are deleted automatically on that
first real run.

## Day to day

- Fresh batch on demand: **Actions → Harvest ideas → Run workflow**, which works
  from the GitHub mobile app.
- Saved items live in your browser's local storage — they're per-device and never
  published. **Export saved** writes them to a JSON file; **Import** reads it back
  on another device.
- Change the schedule in `.github/workflows/harvest.yml`. Weekly (`0 18 * * 1`) is
  plenty and costs a fifth as much.

## Tuning it

- **What it searches for**: the `DOMAIN` constant at the top of `scripts/harvest.mjs`.
  This is the highest-leverage thing to edit — it steers every keyword Claude picks.
- **How much it keeps**: `KEEP` in the same file (default 400, oldest drop off).
- **Sources**: each is a small function in `harvest.mjs`. Deleting one from the
  loop in `main()` is enough to turn it off.

## Sources, and one that's missing

GitHub, Hacker News, Reddit and arXiv are all free, keyless, and fine to query
from a server.

LinkedIn is not included. There's no public search API, and scraping it breaches
their terms and gets blocked quickly. If you want LinkedIn in the loop, the
honest version is a bookmark to a saved search you check by hand.

## Cost

Two Claude calls per run, both small. At a daily schedule this lands in the
low cents per month. Set a spend limit in the Anthropic console anyway — it costs
nothing to have a backstop.
