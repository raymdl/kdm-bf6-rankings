# Career and Period views

Current source reference, reviewed 2026-09-07.

Every cohort page (leaderboards, Players, Compare) has two independent controls:

- **View** — `Career` shows lifetime totals and ratios (the default, always). `Period` shows stats **earned during the selected range only**, derived in [`assets/period.js`](../assets/period.js) from `data/counters.json`, a per-day series of cumulative counters: a range's Player K/D is Δ player kills ÷ Δ deaths across the range endpoints, never a change in a career ratio and never an average of daily ratios.
- **Range** — `Today · 3 Days · 7 Days · 14 Days · 30 Days · All Time · Custom…`, shared by both views. In Career view it only sets the movement/delta/sparkline window; in Period view it sets the calculation endpoints. Requested ranges snap to actual snapshot dates and the resolved dates are always displayed.

Semantics worth knowing:

- **Today** means today-so-far (since the previous day's final snapshot, per the artifact's current-day metadata; date keys follow Pacific midnight) and is labeled in progress; it is unavailable before the day's first refresh rather than shown as zero.
- In **Period**, **All Time** means all *tracked* history (daily counters start 2026-07-10), not lifetime — each member ranks from their own first tracked snapshot, and late joiners carry a `tracked since <date>` badge.
- Rate stats (K/D, KPM, Score/Min, HS%) need **15 active minutes per calendar day in the resolved window** to rank (45 minutes for three days, 450 for 30 days); under-threshold rows remain visible as unranked "low time" entries. Count stats have no threshold.
- Player Rank is a progression stat with no Period form and always shows Career values with a notice.
- A member whose upstream counters went backwards in the range (reset/correction) is excluded with a note instead of showing negative stats; a ◷ marker means one endpoint was carried from that member's most recent earlier snapshot.
- State lives entirely in the URL (`?view=…&range=…`): a copied link reproduces the chosen filters and route; it resolves the current release, so it does not preserve old numeric results, and a clean URL always opens Career.

### When the bot changes counter formulas

The bot owns `BF6_COUNTERS_FORMULA_VERSION` ([`src/bf6-counters.js`](https://github.com/raymdl/kdm-discord-bot/blob/main/src/bf6-counters.js)) and bumps it whenever counter keys or their math change. **A bump alone requires no site change.** `validCounters()` checks the artifact's *structure* only; formula compatibility is decided per stat by `periodSupported()`, which feature-detects each stat's declared `requires` against the counter keys actually present.

> Historical incident, 2026-08-08. This was not always true. Until 2026-08-08 `validCounters()` pinned `formulaVersion === 1`, so the weapon-only headshot bump made the site reject every published artifact — which hid the entire Career/Period toggle and range-chip row site-wide, on all pages, while still rendering Career numbers. Nothing errored; the controls simply stopped existing. Keep the version check structural.

Find your case:

| What the bot changed | Site behavior with no action | What to update |
| --- | --- | --- |
| Bumped `formulaVersion`, counters unchanged | Nothing changes | Nothing |
| **Added** a counter | Nothing changes | Only if exposing a new Period stat: add a `PERIOD_STAT_DEFS` entry with `requires` + `derive` |
| **Renamed or removed** a counter a stat uses | That stat alone degrades to Career with *"has no Period data in the current counters artifact"*; every other stat keeps working | Update that stat's `requires` **and** `derive` in [`assets/period.js`](../assets/period.js) |
| **Changed the meaning** of a counter, same key | ⚠️ **Undetectable** — the site derives confidently wrong numbers | Update `derive`, and add the old version to `KNOWN_INCOMPATIBLE_FORMULA_VERSIONS` only if wrong numbers are worse than none (that set blanks the Period UI until the site ships) |
| Changed the artifact envelope (`version`, `dates`, `members` shape) | Period UI disappears — correctly, the engine can't read it | `validCounters()` in [`assets/period.js`](../assets/period.js) |

`requires` is load-bearing, not documentation — it is what makes a rename cost one stat instead of the whole view. Keep it in sync with `derive`; note the stat key is not always the counter key (`kills` reads `playerKills`). `test/period.test.js` asserts every def declares its counters and that removing any declared counter actually costs that stat its value, so a `requires` list that drifts from its `derive` fails the suite.

After any change here: run `npm test`, and bump the `?v=` string in `index.html` and the `assets/app.js` imports (one shared value — `test/asset-versions.test.js` enforces it) or browsers keep the old modules.

## Favorites

Star any player to pin them. Favorites are **per-browser only** — the site has no accounts — and live in `localStorage` under `kdm-favorite-players`, so they do not follow you between devices and are cleared along with site data. Favorited rows are highlighted site-wide (leaderboards, Players, Compare) using the `--fav` theme variables. Clearing every star returns the site to its default ordering.
