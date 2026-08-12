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

`test/parity.test.js` re-derives representative values from the raw archive files to prove the published artifact and the browser engine agree — the two are computed by independent code (the bot publisher writes `data/counters.json`; `assets/period.js` derives Period values from it), so drift between them would show wrong numbers with no error.

The raw archives moved to a separate private repo on 2026-07-26 and this checkout no longer carries them, so the test **skips by default**. Point it at a private archive checkout to run the real comparison:

```
BF6_PARITY_ARCHIVE_DIR=../.bf6-archive-repo/archive/bf6 npm test
```

It needs two archive dates to compare range endpoints, and asserts kills exactly plus K/D and KPM within `1e-9` across at least three fully comparable members. Without the variable it skips rather than fails, because a bare clone before the first publish legitimately has neither input.

## Layout

- `index.html` + `assets/` — the single-page site; it reads the JSON below at runtime.
- `data/*.json` — generated leaderboard data (current stats, daily history, overtake notifications, link audit log, stat definitions).
- `data/archive/` — **gone.** Raw per-day GameTools payloads now go to a private archive repository, and the publisher removes this directory from the site checkout. Anything needing raw payloads has to read the private archive, not this repo.
- `data/history-provenance.json` — which pre-2026-07-10 chart points were reconstructed from Tracker sessions rather than observed, so the site can dash them and offer the Hide Backfill toggle. **Version 2** is a shared `dates[]` axis plus per-member `estimated: { statKey: [dateIndex] }`; the browser expands it into a lookup set when a history-bearing route first loads. Version 1 carried the reconstruction's full working detail — per-point `source`, `confidence`, `groupedSessions`, and a repeated notice string — none of which the site read, at 3.7 MB per page load. The window is closed (`anchorDate` 2026-07-10) so this file never grows. The v1 dump is retained outside this repo; see `tools/README.md` in the bot repo.

## Do not edit `data/` by hand

Everything under `data/` is machine-generated and pushed automatically by the [kdm-discord-bot](https://github.com/raymdl/kdm-discord-bot) tracker. The mini PC is the primary scheduled publisher; `!bf6-refresh` also publishes, and GitHub Actions retains a complete emergency fallback. The publisher syncs its checkout to `origin/main` and discards local `data/` drift before writing, so manual edits there will be overwritten.

All documentation — which stats are tracked and how they're derived, the data file formats, and the publishing workflows — lives in the [kdm-discord-bot README](https://github.com/raymdl/kdm-discord-bot#readme).
