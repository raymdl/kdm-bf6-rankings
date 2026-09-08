# Site data loading

Current source reference, reviewed 2026-09-07.

## Data source

Since 2026-08-24 the generated JSON is **not** served from this repository. GitHub
Pages hosts the page shell; the data lives in a Cloudflare R2 bucket behind a
thin delivery Worker at `https://kdm-bf6-data.kdm-analytics.workers.dev`.

[`assets/data-source.js`](../assets/data-source.js) is the only place that knows
this. Every data path in the app goes through `dataUrl()` — do not inline a base
URL in a route loader.

**How a page session resolves data:**

1. `initDataSource()` fetches `current.json` from the Worker with `cache: "no-cache"`.
2. The pointer is validated: `version` must be 1, `refreshId` / `observedAt` /
   `releasePrefix` must be non-empty strings, `observedAt` must parse as a date,
   and `releasePrefix` must actually start with `releases/<refreshId>/` and end
   with `/`. A pointer that names one refresh while pointing at another
   release's bytes is rejected, not served.
3. The session is **pinned** to that release until a full reload. When the tab becomes visible, `checkForNewRelease()` checks the pointer without switching the pinned data. A new release shows a dismissible Reload notice; failed background checks stay quiet. A publish
   landing mid-session cannot produce a page showing half one refresh and half
   the next.
4. `dataUrl("data/x.json")` then resolves to `<worker>/<releasePrefix>x.json`.

`dataUrl()` **fails closed**: if the pointer never resolved, it throws instead of
falling back to this repository's path. Silently falling back to Pages is what
produced the 2026-08-18 publication divergence, and it would now serve a frozen
snapshot that looks current.

`dataAge()` is the freshness check that survives every cause — an R2 outage, a
stuck publisher, a bad pointer, a Worker misconfiguration. It marks data stale
past **eight hours**, chosen because the published schedule's largest gap is
02:45 → 09:00 ET. In `pages` mode there is no pointer, so the caller passes
`meta.json`'s `observedAt` instead.

### Caching expectations

Release keys are immutable, so release artifacts are fetched with default
caching and carry a one-year immutable policy from the Worker. Only
`current.json` needs revalidation and it is served `no-cache`; it is never
fetched through `dataFetchOptions()`.

Caching is *not* a substitute for the cache-busting `?v=` string on
`index.html`'s module imports — that governs the site's own code, which is still
deployed through Pages.

### Local preview

The Worker grants CORS only to `https://raymdl.github.io` and to ports **4173**
and **4174** on `localhost` / `127.0.0.1`. A preview served on any other port
gets no CORS grant and every data fetch fails. Serve the repository root on one
of those ports:

```bash
npx serve -l 4173 .
```

Then open <http://localhost:4173/>. To preview against this repository's frozen
`data/` instead of live R2, set `DATA_SOURCE = "pages"` in
`assets/data-source.js` locally — but do not commit that, and remember the
snapshot is frozen rather than current.

### Rolling back to Pages

Changing `DATA_SOURCE` alone has not been a complete rollback since Git
publication was retired. `data/` here is a frozen snapshot; flipping the
constant would serve stale leaderboards that look current. Restore publication
first, verify Pages serves the new refresh, and change `DATA_SOURCE` last — the
ordered procedure is in the bot repository's
[publication recovery runbook](https://github.com/raymdl/kdm-discord-bot/blob/main/docs/BF6_PUBLICATION_RECOVERY_RUNBOOK.md).

```mermaid
sequenceDiagram
  participant Browser
  participant Worker
  Browser->>Worker: Read current.json with revalidation
  Worker-->>Browser: Release pointer
  Note over Browser: Pin one release
  Browser->>Worker: Fetch required immutable artifacts
  Worker-->>Browser: Release data
  Note over Browser: Tab becomes visible
  Browser->>Worker: Check current.json again
  Worker-->>Browser: Latest pointer
  Note over Browser: Offer Reload if different; keep current data
```

## Runtime loading

The site remains a no-build vanilla JavaScript application, but it no longer
downloads every optional artifact at startup. Meta and current standings are
shared; history, counters, and provenance load for routes that need them, while Activity, Audit, Effectiveness, and equipment data load only when
their route or panel is opened. Per-player equipment files load
only when that profile section is expanded. Chart.js is pinned with SRI and is
injected only for Player and Compare views; if the CDN is unavailable, the rest
of those pages remains usable. Successful optional loads are cached for the browser session, while failed optional fetches remain retryable. Career and Period routes await counters with their initial required data so a later counter fetch does not rebuild the rendered chart. Load failures offer Retry. A full Reload keeps the route and resolves a consistent new release. Timestamps use `America/New_York`, including daylight-saving time.

## Tests

Tests for the calculation engine run with `npm test` (plain `node --test`, no build step).

The publication parity check moved to `test/bf6-publication-parity.test.js` in the bot repository when routine generated-data commits stopped. It reads the active publication-state generation and the private numeric archive through `BF6_PARITY_PUBLICATION_STATE_DIR` and `BF6_PARITY_ARCHIVE_DIR`, so it follows current R2 output instead of this repository's frozen rollback snapshot.

## Layout

- `index.html` + `assets/` — the single-page site; it reads the JSON below at runtime.
- `data/*.json` — **a frozen rollback snapshot.** Generated leaderboard data now comes from Cloudflare R2 (see [Where the data comes from](#data-source)); nothing rewrites these files any more, including roster changes, so they drift further from reality with age.
- `data/archive/` — **gone.** Numeric daily projections now live in private R2. Untouched payloads are separate Mini PC gzip files and their private-R2 mirror. None is publicly served by this site.
- `data/history-provenance.json` — which pre-2026-07-10 chart points were reconstructed from Tracker sessions rather than observed, so the site can dash them and offer the Hide Backfill toggle. **Version 2** is a shared `dates[]` axis plus per-member `estimated: { statKey: [dateIndex] }`; the browser expands it into a lookup set when a history-bearing route first loads. Version 1 carried the reconstruction's full working detail — per-point `source`, `confidence`, `groupedSessions`, and a repeated notice string — none of which the site read, at 3.7 MB per page load. The window is closed (`anchorDate` 2026-07-10) so this file never grows. The v1 dump is retained outside this repo; see `tools/README.md` in the bot repo.

## Do not edit `data/` by hand

Everything under `data/` is machine-generated by the [kdm-discord-bot](https://github.com/raymdl/kdm-discord-bot) tracker. It is now a frozen rollback snapshot rather than live data: routine refreshes publish to R2 and no longer commit here. Editing it by hand still achieves nothing useful — the site does not read it, and if Git publication is ever restored the publisher syncs to `origin/main` and discards local `data/` drift before writing.

The mini PC is the primary scheduled publisher; `!bf6-refresh` also publishes, and GitHub Actions retains a complete emergency fallback that publishes to the same R2 bucket.

Producer-side formulas, artifacts, operations, and historical records are linked from the [bot documentation index](https://github.com/raymdl/kdm-discord-bot/blob/main/docs/README.md).
