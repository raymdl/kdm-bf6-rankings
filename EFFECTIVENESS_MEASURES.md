# KDM Battlefield Effectiveness Measures

This document describes the three measures in the KDM BF6 Effectiveness Lab, model version 2. All three are **Breakthrough-only**: every input comes from the Breakthrough slice of a member's GameTools payload or from the Breakthrough rows of their per-season record. Lifetime all-mode counters, tracker win rates and win-rate regressions are not used.

1. **Effectiveness Index (EI)** — a clan percentile combining combat, objective and teamwork per Breakthrough hour.
2. **Impact Rate (IR)** — raw in-game score per Breakthrough minute, in absolute units.
3. **Form Index** — the same percentile machinery over recency-weighted per-season Breakthrough rates.

The formulas run in the bot publisher from the complete cohort in each retained private numeric-archive snapshot. The generated `data/effectiveness-history.json` (history version 2) carries compact `ei`, `ir`, `form`, `combat`, `objective` and `teamwork` series plus the detailed current snapshot. The browser only sorts and renders; it never recalculates.

## Why Breakthrough-only

Members spend anywhere from a small fraction to nearly all of their play time in Breakthrough. The earlier model (CEI, RAIS, WRR) scored lifetime all-mode counters and a win-rate residual that explained almost none of the win-rate spread. The objective pillar in particular correlated only weakly with a Breakthrough-native version because it counted all-mode captures and had no defend counter. The evidence is in the bot repository's `docs/EFFECTIVENESS_LAB_REVIEW.md`.

Breakthrough is asymmetric: attacker deaths cost tickets and defender deaths do not, and the payload does not say which side a player was on. The model therefore has no death penalty; K/D already prices the trade. Win rate is a squad and server outcome with no rank relationship to any individual stat in the cohort, so it is shown but never scored.

## Shared pipeline

### Rates

Every input is a rate over Breakthrough time: K/D, kills per minute, damage per minute, headshot share, share of time on the objective, captures plus defends per hour, revives, repairs, spots and kill assists per hour, and score per minute.

### Shrinkage

Each rate is pulled toward the clan median with a 25 Breakthrough-hour prior: a member with 25 hours is weighted half their own rate and half the median; with 100 hours, four fifths their own. Breakthrough hours are smaller than lifetime hours, so the prior does real work for members with one or two seasons.

### Percentiles

Shrunk rates are ranked within the tracked clan and mapped to 2–98 with tied ranks averaged.

### Softened geometric mean

Pillars and the Effectiveness Index are weighted geometric means with 20 added to every percentile before the logarithm and subtracted after. One weak pillar dents the score instead of sinking it: a member at the 2nd percentile on objective and the 50th on the other two scores in the mid thirties rather than the teens.

## Pillars

| Pillar (weight in EI) | Inputs |
| --- | --- |
| Combat (0.40) | K/D 0.35, kills per minute 0.30, damage per minute 0.25, headshot share 0.10 |
| Objective (0.30) | time on objective 0.50, captures + defends per hour 0.50 |
| Teamwork (0.30) | lane score 0.70, kill assists per hour 0.30 |

**Lane score.** The three support lanes are Medic (revives per hour), Engineer (repairs per hour) and Intel (spots per hour). The lane score is the member's best lane percentile plus 0.15 × their second-best lane, capped at 98. A pure medic scores their full medic percentile; a flexible player earns a bonus. Specialists are never docked for a lane they do not play.

## 1. Effectiveness Index (`ei`)

```
EI = (C + 20)^0.40 × (O + 20)^0.30 × (T + 20)^0.30 − 20
```

Combat and objective percentiles are negatively related in the cohort, which is the expected trade-off between farming and playing the point and the reason a multiplicative combination is kept over a sum.

## 2. Impact Rate (`ir`)

```
IR = Breakthrough score ÷ Breakthrough minutes
```

Published raw: no shrinkage and no percentile. It is the figure a member could compute from their own Breakthrough tab, so it is comparable across dates and rosters and shows real improvement. It relies on the game's own scoring, which already credits captures, defends, revives, resupplies, repairs, spots and squad play, with a weighting that is EA's and opaque. Squad-leader and vehicle bonuses can inflate a short sample.

Rows under 25 Breakthrough hours carry `provisional: true`. The site marks them and, on the Impact Rate tab, ranks them after every member with a full sample.

## 3. Form Index (`form`)

Per-season Breakthrough rows carry kills, deaths, revives, score and seconds played. Form takes the newest three seasons with play time, weights them 0.5 / 0.3 / 0.2 newest first (renormalized over the seasons a member actually has), and blends the recency-weighted rates:

| Input | Weight |
| --- | --- |
| K/D | 0.30 |
| Score per minute | 0.30 |
| Kills per minute | 0.25 |
| Revives per hour | 0.15 |

Shrinkage uses only the hours in those seasons, so early in a season everyone sits nearer the middle. Objective time and captures are not broken out per season, so score per minute stands in for objective play.

## Player-level breakdowns

Every row in the Full KDM Ranking table has a **Breakdown** control. Expanding it shows the equation with the member's own values, the pillar scores with their weights, each input's raw rate and clan percentile, the support lanes, and for Form the seasons counted with their weights and rates.

## Row contract

Version 2 rows expose `scores.{ei,ir,form}`, `provisional`, `pillars.*`, `lanes.{medic,engineer,intel}`, `bestSupportLanes`, `laneScore`, `percentiles.*`, `raw.*`, `adjusted.*`, `formSeasons`, `formHours`, `breakthroughWinPercent`, `hours` and `matches`. Constants published with the snapshot: `priorHours`, `provisionalHours`, `geometricOffset`, `seasonRecencyWeights`, `pillarWeights`, `combatWeights`, `objectiveWeights`, `laneBonus`, `teamworkWeights`, `formWeights`, `medianScorePerMinute`, `medianDeathsPerHour` and `cohortBreakthroughWinPercent`.

Numeric-archive dates before the projection kept the Breakthrough slice have no v2 values. Dates from 2026-08-12 onward were re-projected from the raw gzip archive; earlier dates publish as null.

## Implementation reference

- Display definitions: [`assets/effectiveness.js`](assets/effectiveness.js)
- Page rendering and row breakdowns: [`assets/app.js`](assets/app.js)
- Canonical formulas and model version: `src/bf6-effectiveness.js` in the private `kdm-discord-bot` repository
- Design review and evidence: `docs/EFFECTIVENESS_LAB_REVIEW.md` in the same repository
- Generated current/history contract: [`data/effectiveness-history.json`](data/effectiveness-history.json) (the repository copy is a frozen rollback snapshot; production is in R2)

The bot's `EFFECTIVENESS_MODEL_VERSION` must be incremented whenever a formula, weight, normalization rule, input definition or prior changes. A version change triggers a complete historical rebuild from the private numeric archive.
