# KDM BF6 Rankings

Static GitHub Pages site with the KDM community's Battlefield 6 leaderboards, per-player history charts, head-to-head comparisons, an activity feed, and an audit log.

The **Effectiveness Lab** adds three role-aware overall measures: Composite Effectiveness Index (CEI), Risk-Adjusted Impact Score (RAIS), and Win Rate Residual (WRR). The bot publisher calculates the full cohort during each tracker publish and writes `data/effectiveness-history.json`; the browser only sorts and renders the generated current snapshot.

See [EFFECTIVENESS_MEASURES.md](EFFECTIVENESS_MEASURES.md) for the complete formulas, normalization pipeline, season weighting, interpretation, and player-level breakdown reference.

Win Rate Residual uses Breakthrough-only season records with 20% / 35% / 45% weights for Seasons 1 / 2 / 3. Each season is stabilized with a 25-match clan prior before the weighted rate is compared with the player's expected win rate.

**Live site:** <https://raymdl.github.io/kdm-bf6-rankings/>

## Period Performance: Career vs Period views

Every cohort page (leaderboards, Players, Compare) has two independent controls:

- **View** — `Career` shows lifetime totals and ratios (the default, always). `Period` shows stats **earned during the selected range only**, derived in [`assets/period.js`](assets/period.js) from `data/counters.json`, a per-day series of cumulative counters: a range's Player K/D is Δ player kills ÷ Δ deaths across the range endpoints, never a change in a career ratio and never an average of daily ratios.
- **Range** — `Today · 3 Days · 7 Days · 14 Days · 30 Days · All Time · Custom…`, shared by both views. In Career view it only sets the movement/delta/sparkline window; in Period view it sets the calculation endpoints. Requested ranges snap to actual snapshot dates and the resolved dates are always displayed.

Semantics worth knowing:

- **Today** means today-so-far (since the previous day's final snapshot, per the artifact's own Eastern-date metadata) and is labeled in progress; it is unavailable before the day's first refresh rather than shown as zero.
- **All Time** means all *tracked* history (daily counters start 2026-07-10), not lifetime — each member ranks from their own first tracked snapshot, and late joiners carry a `tracked since <date>` badge.
- Rate stats (K/D, KPM, Score/Min, HS%) need **15+ active minutes** in the range to rank; under-threshold rows remain visible as unranked "low time" entries. Count stats have no threshold.
- Player Rank is a progression stat with no Period form and always shows Career values with a notice.
- A member whose upstream counters went backwards in the range (reset/correction) is excluded with a note instead of showing negative stats; a ◷ marker means one endpoint was carried from that member's most recent earlier snapshot.
- State lives entirely in the URL (`?view=…&range=…`): a copied link reproduces exactly what the sender saw, and a clean URL always opens Career.

### When the bot changes counter formulas

The bot owns `BF6_COUNTERS_FORMULA_VERSION` ([`src/bf6-counters.js`](https://github.com/raymdl/kdm-discord-bot/blob/main/src/bf6-counters.js)) and bumps it whenever counter keys or their math change. **A bump alone requires no site change.** `validCounters()` checks the artifact's *structure* only; formula compatibility is decided per stat by `periodSupported()`, which feature-detects each stat's declared `requires` against the counter keys actually present.

> This was not always true. Until 2026-08-08 `validCounters()` pinned `formulaVersion === 1`, so the weapon-only headshot bump made the site reject every published artifact — which hid the entire Career/Period toggle and range-chip row site-wide, on all pages, while still rendering Career numbers. Nothing errored; the controls simply stopped existing. Keep the version check structural.

Find your case:

| What the bot changed | Site behavior with no action | What to update |
| --- | --- | --- |
| Bumped `formulaVersion`, counters unchanged | Nothing changes | Nothing |
| **Added** a counter | Nothing changes | Only if exposing a new Period stat: add a `PERIOD_STAT_DEFS` entry with `requires` + `derive` |
| **Renamed or removed** a counter a stat uses | That stat alone degrades to Career with *"has no Period data in the current counters artifact"*; every other stat keeps working | Update that stat's `requires` **and** `derive` in [`assets/period.js`](assets/period.js) |
| **Changed the meaning** of a counter, same key | ⚠️ **Undetectable** — the site derives confidently wrong numbers | Update `derive`, and add the old version to `KNOWN_INCOMPATIBLE_FORMULA_VERSIONS` only if wrong numbers are worse than none (that set blanks the Period UI until the site ships) |
| Changed the artifact envelope (`version`, `dates`, `members` shape) | Period UI disappears — correctly, the engine can't read it | `validCounters()` in [`assets/period.js`](assets/period.js) |

`requires` is load-bearing, not documentation — it is what makes a rename cost one stat instead of the whole view. Keep it in sync with `derive`; note the stat key is not always the counter key (`kills` reads `playerKills`). `test/period.test.js` asserts every def declares its counters and that removing any declared counter actually costs that stat its value, so a `requires` list that drifts from its `derive` fails the suite.

After any change here: run `npm test`, and bump the `?v=` string in `index.html` and the `assets/app.js` imports (one shared value — `test/asset-versions.test.js` enforces it) or browsers keep the old modules.

## Favorites

Star any player to pin them. Favorites are **per-browser only** — the site has no accounts — and live in `localStorage` under `kdm-favorite-players`, so they do not follow you between devices and are cleared along with site data. Favorited rows are highlighted site-wide (leaderboards, Players, Compare) using the `--fav` theme variables. Clearing every star returns the site to its default ordering.

## Where the data comes from

Since 2026-08-24 the generated JSON is **not** served from this repository. GitHub
Pages hosts the page shell; the data lives in a Cloudflare R2 bucket behind a
thin delivery Worker at `https://kdm-bf6-data.kdm-analytics.workers.dev`.

[`assets/data-source.js`](assets/data-source.js) is the only place that knows
this. Every data path in the app goes through `dataUrl()` — do not inline a base
URL in a route loader.

**How a page session resolves data:**

1. `initDataSource()` fetches `current.json` from the Worker with `cache: "no-cache"`.
2. The pointer is validated: `version` must be 1, `refreshId` / `observedAt` /
   `releasePrefix` must be non-empty strings, `observedAt` must parse as a date,
   and `releasePrefix` must actually start with `releases/<refreshId>/` and end
   with `/`. A pointer that names one refresh while pointing at another
   release's bytes is rejected, not served.
3. The session is **pinned** to that release for its whole lifetime, so a publish
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

## Runtime loading

The site remains a no-build vanilla JavaScript application, but it no longer
downloads every optional artifact at startup. Meta and current standings are
shared; history, counters, and provenance load only for leaderboard/history
views, while Activity, Audit, Effectiveness, and equipment data load only when
their route or panel is opened. Per-player equipment files load
only when that profile section is expanded. Chart.js is pinned with SRI and is
injected only for Player and Compare views; if the CDN is unavailable, the rest
of those pages remains usable. Successful optional loads are cached for the
browser session, while failed optional fetches remain retryable.

## Tests

Tests for the calculation engine run with `npm test` (plain `node --test`, no build step).

The publication parity check moved to `test/bf6-publication-parity.test.js` in the bot repository when routine generated-data commits stopped. It reads the active publication-state generation and the private raw archive through `BF6_PARITY_PUBLICATION_STATE_DIR` and `BF6_PARITY_ARCHIVE_DIR`, so it follows current R2 output instead of this repository's frozen rollback snapshot.

## Layout

- `index.html` + `assets/` — the single-page site; it reads the JSON below at runtime.
- `data/*.json` — **a frozen rollback snapshot.** Generated leaderboard data now comes from Cloudflare R2 (see [Where the data comes from](#where-the-data-comes-from)); nothing rewrites these files any more, including roster changes, so they drift further from reality with age.
- `data/archive/` — **gone.** Raw per-day GameTools payloads now go to a private archive repository, and the publisher removes this directory from the site checkout. Anything needing raw payloads has to read the private archive, not this repo.
- `data/history-provenance.json` — which pre-2026-07-10 chart points were reconstructed from Tracker sessions rather than observed, so the site can dash them and offer the Hide Backfill toggle. **Version 2** is a shared `dates[]` axis plus per-member `estimated: { statKey: [dateIndex] }`; the browser expands it into a lookup set when a history-bearing route first loads. Version 1 carried the reconstruction's full working detail — per-point `source`, `confidence`, `groupedSessions`, and a repeated notice string — none of which the site read, at 3.7 MB per page load. The window is closed (`anchorDate` 2026-07-10) so this file never grows. The v1 dump is retained outside this repo; see `tools/README.md` in the bot repo.

## Do not edit `data/` by hand

Everything under `data/` is machine-generated by the [kdm-discord-bot](https://github.com/raymdl/kdm-discord-bot) tracker. It is now a frozen rollback snapshot rather than live data: routine refreshes publish to R2 and no longer commit here. Editing it by hand still achieves nothing useful — the site does not read it, and if Git publication is ever restored the publisher syncs to `origin/main` and discards local `data/` drift before writing.

The mini PC is the primary scheduled publisher; `!bf6-refresh` also publishes, and GitHub Actions retains a complete emergency fallback that publishes to the same R2 bucket.

All documentation — which stats are tracked and how they're derived, the data file formats, and the publishing workflows — lives in the [kdm-discord-bot README](https://github.com/raymdl/kdm-discord-bot#readme).
