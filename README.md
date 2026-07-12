# KDM BF6 Rankings

Static GitHub Pages site with the KDM community's Battlefield 6 leaderboards, per-player history charts, head-to-head comparisons, an activity feed, and an audit log.

The **Effectiveness Lab** adds three experimental, role-aware overall measures: Composite Effectiveness Index, Risk-Adjusted Impact Score, and Win Rate Residual. The browser calculates them from the newest raw archive on each load, so new tracker snapshots and linked members flow into the rankings without a separate build step.

See [EFFECTIVENESS_MEASURES.md](EFFECTIVENESS_MEASURES.md) for the complete formulas, normalization pipeline, season weighting, interpretation, and player-level breakdown reference.

Win Rate Residual uses Breakthrough-only season records with 20% / 35% / 45% weights for Seasons 1 / 2 / 3. Each season is stabilized with a 25-match clan prior before the weighted rate is compared with the player's expected win rate.

**Live site:** <https://raymdl.github.io/kdm-bf6-rankings/>

## Layout

- `index.html` + `assets/` — the single-page site; it reads the JSON below at runtime.
- `data/*.json` — generated leaderboard data (current stats, daily history, overtake notifications, link audit log, stat definitions).

## Do not edit `data/` by hand

Everything under `data/` is machine-generated and pushed automatically by the [kdm-discord-bot](https://github.com/raymdl/kdm-discord-bot) tracker — its daily workflow, its 15-minute link-change checks, and the local bot's `!bf6-refresh`. The publisher syncs its checkout to `origin/main` and discards local `data/` drift before writing, so manual edits there will be overwritten.

All documentation — which stats are tracked and how they're derived, the data file formats, and the publishing workflows — lives in the [kdm-discord-bot README](https://github.com/raymdl/kdm-discord-bot#readme).
