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

Tests for the calculation engine run with `npm test` (plain `node --test`, no build step); `test/parity.test.js` re-derives representative values straight from the raw archives to prove the artifact and engine agree.

## Layout

- `index.html` + `assets/` — the single-page site; it reads the JSON below at runtime.
- `data/*.json` — generated leaderboard data (current stats, daily history, overtake notifications, link audit log, stat definitions).

## Do not edit `data/` by hand

Everything under `data/` is machine-generated and pushed automatically by the [kdm-discord-bot](https://github.com/raymdl/kdm-discord-bot) tracker — its daily workflow, its 15-minute link-change checks, and the local bot's `!bf6-refresh`. The publisher syncs its checkout to `origin/main` and discards local `data/` drift before writing, so manual edits there will be overwritten.

All documentation — which stats are tracked and how they're derived, the data file formats, and the publishing workflows — lives in the [kdm-discord-bot README](https://github.com/raymdl/kdm-discord-bot#readme).
