# KDM Battlefield Effectiveness Measures

This document specifies the three experimental measures in the KDM BF6 Effectiveness Lab:

1. **Composite Effectiveness Index (CEI)** — balanced overall contribution.
2. **Risk-Adjusted Impact Score (RAIS)** — contribution adjusted for death exposure.
3. **Win Rate Residual (WRR)** — Breakthrough winning above or below the rate predicted by visible performance.

The formulas are calculated in the browser from the newest `data/archive/<date>.json` snapshot. Scores are relative to the currently tracked KDM population, so they can move when players are added, removed, or improve.

## Design scope

- KDM's primary mode is **Breakthrough**. Objective and win inputs are therefore Breakthrough-specific where mode-level data is available.
- Combat uses **player-only kills**. Bot-inclusive top-level kill counters and generic GameTools KPM are not used.
- Lifetime totals are converted to rates or percentages before comparison, so playing more hours does not automatically produce a higher score.
- Accuracy and Headshot % remain important, but are adjusted for weapon mix.
- Support specialists receive credit through Medic, Logistics, and Intel lanes rather than one universal support counter.

## Shared normalization pipeline

Most raw inputs have different units and distributions. Before combining them, the model converts each input to a clan-relative percentile.

### 1. Rate construction

Counts are divided by total play hours, matches, or play seconds as appropriate. Examples include assists/hour, objective actions/hour, Player Kills/match, and objective-time share.

Player-only combat values use the public tracker definitions:

- Player K/D: `infantryKillDeath`
- Player Kills: `dividedKills.human`
- Player Kills/Min: tracked player kills divided by active class minutes

### 2. Exposure shrinkage

Each rate is pulled slightly toward the clan median to reduce small-sample volatility:

```text
w = hours / (hours + 25)
adjusted value = w × player value + (1 - w) × clan median
```

At 25 hours, the player and clan median receive equal weight. At the hundreds of hours held by most tracked members, the adjustment is small.

### 3. Robust percentiles

Adjusted inputs are ranked across the current clan and mapped onto a 2–98 scale:

```text
percentile = 2 + rank_position / (player_count - 1) × 96
```

- Higher values are better for productive inputs.
- Tied values receive their average rank.
- The 2–98 bounds stop a single extreme observation from becoming zero or infinitely dominant in a geometric mean.

### 4. Weighted geometric means

Several components use a weighted geometric mean:

```text
weighted geometric mean = exp(Σ weight_i × ln(value_i) / Σ weight_i)
```

Unlike an arithmetic mean, this rewards balance: an exceptional value cannot completely erase a neglected component.

## Pillar calculations

CEI and RAIS share three underlying pillars: Combat (`C`), Breakthrough Objective (`O`), and Teamwork (`T`). WRR also uses these pillars to estimate expected winning.

### Combat pillar (`C`)

Combat is a weighted geometric mean of six clan-relative percentiles:

| Input | Combat weight | Raw definition |
| --- | ---: | --- |
| Player K/D | 30% | Tracked `infantryKillDeath` |
| Player Kills/Min | 30% | Player-only kills per active minute |
| Player Kills/match | 10% | `dividedKills.human / matchesPlayed` |
| Assists/hour | 10% | Tracked assists divided by hours |
| Weapon-adjusted Accuracy | 10% | Accuracy residual percentile |
| Weapon-adjusted Headshot % | 10% | Headshot residual percentile |

```text
C = geometric_mean(
  Player K/D percentile             weight 0.30,
  Player Kills/Min percentile       weight 0.30,
  Player Kills/match percentile     weight 0.10,
  Assists/hour percentile           weight 0.10,
  adjusted Accuracy percentile      weight 0.10,
  adjusted Headshot % percentile    weight 0.10
)
```

Weapon-adjusted aim is **inside Combat**. It is not a separate CEI pillar.

#### Weapon-mix aim adjustment

Raw Accuracy and Headshot % favor precision weapons. The model estimates the value expected from each player's weapon mix, then scores the residual above or below that expectation.

Weapon usage is approximated by kill share across eight classes:

- Assault rifle
- SMG
- Carbine
- Machine gun
- DMR
- Sniper rifle
- Shotgun
- Pistol

Per-weapon shot totals and playtime are not present in the GameTools dump, so weapon-kill share is the available usage proxy.

For Accuracy and Headshot % separately:

1. Calculate each weapon class's share of the player's categorized weapon kills.
2. Standardize those eight shares across the clan.
3. Fit a ridge regression with an unpenalized intercept and `λ = 1`.
4. Predict the player's expected Accuracy or Headshot % from their weapon mix.
5. Calculate the residual:

```text
accuracy residual = actual Accuracy - weapon-mix expected Accuracy
headshot residual = actual Headshot % - weapon-mix expected Headshot %
```

6. Apply exposure shrinkage and convert each residual to a clan percentile.

The displayed Aim-adjusted subscore is the 50/50 geometric mean of those two residual percentiles. It is shown in player breakdowns for explanation, but only enters overall scores through Combat.

### Breakthrough Objective pillar (`O`)

The Objective pillar is a weighted geometric mean of three Breakthrough-relevant percentiles:

| Input | Objective weight | Raw definition |
| --- | ---: | --- |
| Captures and neutralizations/hour | 50% | `(captured + neutralized) / hours` |
| Objective-zone presence | 30% | `objective time total / seconds played` |
| Attack/defense pressure | 20% | `(objective time attacked + defended) / seconds played` |

```text
O = geometric_mean(
  objective actions/hour percentile     weight 0.50,
  objective presence percentile         weight 0.30,
  attack/defense pressure percentile    weight 0.20
)
```

### Teamwork pillar (`T`)

Teamwork first creates three role lanes.

#### Medic lane

```text
Medic = geometric_mean(
  revives/hour percentile          weight 0.45,
  squad revives/hour percentile    weight 0.20,
  heals/hour percentile            weight 0.35
)
```

#### Logistics lane

```text
Logistics = geometric_mean(
  resupplies/hour percentile    weight 0.55,
  repairs/hour percentile       weight 0.45
)
```

#### Intel lane

```text
Intel = geometric_mean(
  spots/hour percentile         weight 0.55,
  spot assists/hour percentile  weight 0.45
)
```

The final Teamwork pillar uses the player's two strongest lanes:

```text
T = 0.70 × best support lane + 0.30 × second-best support lane
```

This rewards meaningful specialization while requiring more than one narrow support behavior.

## 1. Composite Effectiveness Index (CEI)

CEI is the default balanced overall measure. It combines Combat, Breakthrough Objective, and Teamwork with a geometric mean:

```text
CEI = C^0.40 × O^0.30 × T^0.30
```

Interpretation:

- A higher score means stronger balanced contribution relative to the current tracked clan.
- Combat has the largest weight, but Objective and Teamwork together make up 60%.
- Because the formula is geometric, a weak pillar materially lowers the total.
- CEI is best treated as the primary all-around leaderboard.

## 2. Risk-Adjusted Impact Score (RAIS)

RAIS measures productive impact relative to death exposure. It begins with an arithmetic upside score:

```text
upside = 0.40 × C + 0.30 × O + 0.30 × T
```

The downside multiplier compares adjusted deaths/hour with the current clan median:

```text
downside = (player deaths/hour / clan median deaths/hour)^0.35
```

The downside multiplier is capped to the range `0.72–1.40`. The exponent and cap deliberately make death exposure a soft adjustment rather than allowing low-death passive play to dominate.

```text
RAIS_raw = upside / downside
```

`RAIS_raw` is then converted to a 2–98 clan percentile. The published RAIS number is that percentile.

Interpretation:

- High impact with controlled death exposure ranks well.
- Aggression is not automatically punished because Combat, Objective, and Teamwork create the numerator.
- A value of 90 means the player ranks above roughly 90% of the current tracked population on risk-adjusted impact.

## 3. Win Rate Residual (WRR)

WRR measures whether a player wins more or less often than expected from their visible Combat, Objective, and Teamwork profile.

### Step 1: Breakthrough season records

Only the `Breakthrough0` mode record inside each season is used. Each season supplies wins and losses independently.

Raw season win rate:

```text
season raw win rate = wins / (wins + losses)
```

### Step 2: Stabilize each season

Each season is smoothed toward that season's clan-wide Breakthrough win rate with a 25-match prior:

```text
season stabilized rate =
  (player wins + 25 × clan season win rate)
  / (player wins + player losses + 25)
```

This prevents a very small seasonal record from receiving the same confidence as hundreds of matches.

### Step 3: Weight recent seasons more heavily

```text
weighted Breakthrough win rate =
  0.15 × Season 1 stabilized rate
  + 0.30 × Season 2 stabilized rate
  + 0.55 × Season 3 stabilized rate
```

If a season is unavailable, the remaining weights are renormalized. Season 3 therefore has the largest influence, allowing recent improvement or decline to affect WRR more strongly.

### Step 4: Estimate expected winning

Combat, Objective, and Teamwork pillar scores are standardized across the clan:

```text
zC = (C - clan mean C) / clan standard deviation C
zO = (O - clan mean O) / clan standard deviation O
zT = (T - clan mean T) / clan standard deviation T
```

For each player, the model fits a ridge regression on the other tracked members only:

```text
expected win rate = β0 + βC × zC + βO × zO + βT × zT
```

- Ridge penalty: `λ = 4`
- The intercept is not penalized.
- Leave-one-player-out fitting prevents a player's own win rate from pulling their expectation toward itself.
- Expected values are clamped to `0–100%`.

### Step 5: Calculate the residual

```text
WRR = weighted Breakthrough win rate - expected win rate
```

WRR is expressed in percentage points, not as a 0–100 score.

Interpretation:

- Positive WRR: the player wins more often than their visible pillar profile predicts.
- Near-zero WRR: their winning is broadly consistent with their measured profile.
- Negative WRR: their weighted win rate is below the model expectation.
- WRR may reflect positioning, coordination, communication, timing, leadership, or recurring team composition. It identifies unexplained winning association; it does not prove individual causation.

If season-mode data is temporarily unavailable, the implementation falls back to lifetime wins/losses stabilized by a 50-match clan prior. Current published data includes Breakthrough season records for all tracked players.

## Player-level breakdowns

Every row in the Full KDM Ranking table has a **Breakdown** control. Expanding it displays:

- The exact selected-measure equation with that player's values.
- Combat, Objective, and Teamwork pillar scores.
- Player-only K/D, KPM, kills/match, and assists/hour.
- Actual versus weapon-mix-expected Accuracy and Headshot %.
- Clan percentiles and component weights.
- RAIS upside, death multiplier, and raw score when viewing RAIS.
- Season 1/2/3 Breakthrough records, stabilized rates, weights, expected win rate, and final residual when viewing WRR.

## Implementation reference

- Formulas and normalization: [`assets/effectiveness.js`](assets/effectiveness.js)
- Page rendering and row breakdowns: [`assets/app.js`](assets/app.js)
- Current raw snapshots: [`data/archive/`](data/archive/)

The code is the authoritative implementation if this document and the live calculation ever diverge.
