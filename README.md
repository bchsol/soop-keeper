# SoopKeeper

**A retention tracker and archive index for VODs (stream replays) on SOOP, a major Korean live-streaming platform.**

SOOP automatically deletes replays that don't reach certain view or support thresholds. SoopKeeper watches streamers' VOD lists and shows fans which replays are safe, which are scheduled to disappear and when, so they can watch (or help keep) a stream before it is gone.

> **Status:** v1 ran publicly until **3 June 2026** and is now offline. A rebuilt v2 is in progress — see [Roadmap](#roadmap-v2).

## v1 at a glance

| | |
| --- | --- |
| Streamers tracked | 700+ |
| VODs indexed | 540,000+ |
| Refresh cycle | targets a 3-minute cycle, split across 2 crawler servers |
| Per-streamer export | one Google Sheet per streamer, updated automatically |

## How it works

```
 SOOP public APIs
        │  (VOD lists, view counts, support counts)
        ▼
 search.js  ── crawler, sharded with --server=N --total=M, runs under PM2
        │
        ├──▶ Cloudflare R2   summary_*.json, data/<streamer>.json, maintenance.json
        └──▶ Google Sheets   one archive sheet per streamer
                 │
                 ▼
 api/*.js   ── serverless functions: read R2, cache, forward contact forms to Discord
                 │
                 ▼
 index.html + app.js + styles.css  ── static web app (search, sort, per-streamer views)
```

For every VOD the crawler decides a retention status:

- **Safe** – the replay meets SOOP's keep conditions (views or support count) and will not be auto-deleted.
- **Scheduled for deletion** – the replay is below the thresholds; SoopKeeper computes the expected deletion date.
- **Re-check pending** – the API didn't return enough detail yet; the VOD is re-queued.

## Repository layout

| Path | What it is |
| --- | --- |
| `index.html`, `app.js`, `styles.css` | Web front end |
| `api/data.js` | Serves summaries and per-streamer data from R2 with caching |
| `api/maintenance.js` | Reports maintenance / shutdown mode |
| `api/contact.js`, `api/request.js` | Contact and "add a streamer" forms → Discord webhooks |
| `search.js` | Crawler and status calculator |
| `check_inactive.js` | Compares 24-hour snapshots and lists streamers whose endangered VODs were not rescued |
| `dedup.js` | Removes duplicate IDs from `streamers.txt` |
| `tools/` | Maintenance scripts: open/close the site, upload/download R2 data |

## Running locally

Requires Node.js 20+.

```bash
npm install
cp .env.example .env              # fill in your own values
cp streamers.example.txt streamers.txt

node search.js --once             # one crawl cycle and exit
node search.js --server=1 --total=2   # continuous crawling, shard 1 of 2
```

Google Sheets export is optional: it only runs when a service-account key file (`google-key.json`) is present. Key files, `.env`, crawled data and logs are excluded by `.gitignore` and are never committed.

## Roadmap (v2)

v1 search was a plain substring match on titles. Korean stream titles are full of slang, nicknames and inconsistent spacing, so many searches missed the right replay. v2 is being rebuilt search-first:

- **Semantic search** – multilingual embeddings over every VOD title instead of substring matching.
- **Reranking** – a reranker on top results so the most relevant replay comes first.
- **Automatic tags** – extract the game played, collab partners and stream type from each title.
- **Evaluation** – compare against v1 search on a set of typical fan queries, and measure latency and cost per query before relaunch.

## Disclaimer

SoopKeeper is an unofficial fan project and is not affiliated with SOOP. It only reads VOD information that SOOP exposes publicly.
