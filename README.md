# Ground Truth

A self-refilling idea board for contaminated land, environmental modelling and
visualisation tooling. A weekly GitHub Action searches GitHub, Hacker News,
Reddit and arXiv, and commits what it finds as `ideas.json`. The page is
static — it just reads that file.

**No API keys. No accounts. No cost.** Every source used here is free and open.

## Files

| File | What it is |
|---|---|
| `index.html` | The page itself |
| `keywords.txt` | What it searches for — **this is the one you'll edit** |
| `ideas.json` | The findings. Written by the robot; don't edit by hand |
| `harvest.mjs` | The robot |
| `.github/workflows/harvest.yml` | Tells GitHub when to run the robot |

## How the searching works

`keywords.txt` is a plain list, one term per line. Each run takes the next 8
terms, works down the list, and wraps back to the top at the end. With 48 terms
and a weekly schedule that's a full cycle every six weeks.

Lines starting with `#` are ignored, so you can park terms without deleting them.

**Keeping it fresh:** every month or two, open a Claude chat, paste in your
current `keywords.txt`, and ask for twenty new terms that go somewhere different.
Add them to the file. That's the job the API key would have done, except you're
doing it deliberately with the subscription you already have — and you get to
throw out the suggestions that don't interest you.

## Day to day

- **Fresh batch on demand:** Actions → Harvest ideas → Run workflow. Works from
  the GitHub mobile app.
- **Saved items** live in your browser only. They're per-device and never
  published. *Export saved* writes them to a file; *Import* reads it back on
  another device.
- **Change the schedule** in `.github/workflows/harvest.yml`.

## Tuning

- `PER_RUN` in `harvest.mjs` — search terms used per run (default 8).
- `KEEP` — how many findings stay on the board (default 400, oldest drop off).
- **Sources** — each is a small function in `harvest.mjs`. Remove one from the
  list in `main()` to switch it off.

## LinkedIn

Not included, and can't be. There's no public search API, and scraping breaches
their terms and gets blocked fast. If you want it in the loop, the honest
version is a bookmarked saved search you check by hand.
