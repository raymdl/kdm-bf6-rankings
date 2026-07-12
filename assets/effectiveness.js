const MIN_PERCENTILE = 2;
const MAX_PERCENTILE = 98;
const PRIOR_HOURS = 25;
const WIN_PRIOR_MATCHES = 50;
const SEASON_WIN_PRIOR_MATCHES = 25;
const SEASON_WEIGHTS = { Season1: 0.2, Season2: 0.35, Season3: 0.45 };
const RIDGE_LAMBDA = 4;
const AIM_RIDGE_LAMBDA = 1;
const COMBAT_GEOMETRIC_WEIGHT = 0.7;
const COMBAT_ARITHMETIC_WEIGHT = 0.3;
const WEAPON_CATEGORIES = ["ar", "smg", "carbine", "mg", "dmr", "sniper", "shotgun", "pistol"];

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const sum = (values) => values.reduce((total, value) => total + finite(value), 0);

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedGeometric(values, weights) {
  const totalWeight = sum(weights);
  return Math.exp(
    values.reduce((total, value, index) => total + weights[index] * Math.log(Math.max(MIN_PERCENTILE, value)), 0) /
      totalWeight
  );
}

function weightedArithmetic(values, weights) {
  const totalWeight = sum(weights);
  return values.reduce((total, value, index) => total + weights[index] * value, 0) / totalWeight;
}

function shrinkToMedian(rows, key) {
  const center = median(rows.map((row) => row.raw[key]));
  for (const row of rows) {
    const weight = row.hours / (row.hours + PRIOR_HOURS);
    row.adjusted[key] = weight * row.raw[key] + (1 - weight) * center;
  }
}

function addPercentiles(rows, key, direction = 1) {
  const sorted = [...rows].sort((a, b) => direction * (a.adjusted[key] - b.adjusted[key]));
  const denominator = Math.max(1, sorted.length - 1);
  for (let start = 0; start < sorted.length; ) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1].adjusted[key] === sorted[start].adjusted[key]) end += 1;
    const averageRank = (start + end) / 2;
    const percentile = MIN_PERCENTILE + (averageRank / denominator) * (MAX_PERCENTILE - MIN_PERCENTILE);
    for (let index = start; index <= end; index += 1) sorted[index].percentiles[key] = percentile;
    start = end + 1;
  }
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column] || 1e-9;
    for (let cell = column; cell <= size; cell += 1) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell <= size; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
    }
  }
  return augmented.map((row) => row[size]);
}

function ridgePredict(trainingRows, target) {
  const dimension = 4;
  const xtx = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const xty = Array(dimension).fill(0);
  for (const row of trainingRows) {
    const x = [1, row.model.combat, row.model.objective, row.model.teamwork];
    for (let i = 0; i < dimension; i += 1) {
      xty[i] += x[i] * row.smoothedWinPercent;
      for (let j = 0; j < dimension; j += 1) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let index = 1; index < dimension; index += 1) xtx[index][index] += RIDGE_LAMBDA;
  const coefficients = solveLinearSystem(xtx, xty);
  return clamp(
    coefficients[0] + coefficients[1] * target.model.combat + coefficients[2] * target.model.objective + coefficients[3] * target.model.teamwork,
    0,
    100
  );
}

function weaponCategory(weaponId) {
  if (weaponId.startsWith("wp_ar_")) return "ar";
  if (weaponId.startsWith("wp_smg_")) return "smg";
  if (weaponId.startsWith("wp_crb_")) return "carbine";
  if (weaponId.startsWith("wp_mg_")) return "mg";
  if (weaponId.startsWith("wp_dmr_")) return "dmr";
  if (weaponId.startsWith("wp_snp_")) return "sniper";
  if (weaponId.startsWith("wp_sg_")) return "shotgun";
  if (weaponId.startsWith("wp_pst_")) return "pistol";
  return null;
}

function weaponKillMix(stats) {
  const kills = Object.fromEntries(WEAPON_CATEGORIES.map((category) => [category, 0]));
  for (const [weaponId, weapon] of Object.entries(stats.weapons ?? {})) {
    const category = weaponCategory(weaponId);
    if (category) kills[category] += Math.max(0, finite(weapon?.kills));
  }
  const total = sum(Object.values(kills));
  return Object.fromEntries(WEAPON_CATEGORIES.map((category) => [category, total > 0 ? kills[category] / total : 0]));
}

function ridgeAimPredict(trainingRows, target, outcomeKey) {
  const dimension = WEAPON_CATEGORIES.length + 1;
  const xtx = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const xty = Array(dimension).fill(0);
  for (const row of trainingRows) {
    const x = [1, ...row.weaponModel];
    for (let i = 0; i < dimension; i += 1) {
      xty[i] += x[i] * row.raw[outcomeKey];
      for (let j = 0; j < dimension; j += 1) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let index = 1; index < dimension; index += 1) xtx[index][index] += AIM_RIDGE_LAMBDA;
  const coefficients = solveLinearSystem(xtx, xty);
  return clamp(
    coefficients[0] + target.weaponModel.reduce((total, value, index) => total + value * coefficients[index + 1], 0),
    0,
    100
  );
}

function addWeaponAdjustedAim(rows) {
  const means = Object.fromEntries(
    WEAPON_CATEGORIES.map((category) => [category, sum(rows.map((row) => row.weaponMix[category])) / rows.length])
  );
  const deviations = Object.fromEntries(
    WEAPON_CATEGORIES.map((category) => [
      category,
      Math.sqrt(sum(rows.map((row) => (row.weaponMix[category] - means[category]) ** 2)) / rows.length) || 1
    ])
  );
  for (const row of rows) {
    row.weaponModel = WEAPON_CATEGORIES.map(
      (category) => (row.weaponMix[category] - means[category]) / deviations[category]
    );
  }
  for (const row of rows) {
    row.expectedAccuracy = ridgeAimPredict(rows, row, "accuracy");
    row.expectedHeadshotPercent = ridgeAimPredict(rows, row, "headshotPercent");
    row.raw.accuracyResidual = row.raw.accuracy - row.expectedAccuracy;
    row.raw.headshotResidual = row.raw.headshotPercent - row.expectedHeadshotPercent;
  }
}

function breakthroughSeasonRecords(stats) {
  const records = {};
  for (const [seasonId, season] of Object.entries(stats.seasons ?? {})) {
    const modes = season?.modes ?? {};
    const breakthrough = Object.entries(modes).find(([modeId]) => /^breakthrough/i.test(modeId))?.[1];
    if (!breakthrough) continue;
    const wins = Math.max(0, finite(breakthrough.wins));
    const losses = Math.max(0, finite(breakthrough.losses, finite(breakthrough.loses)));
    const matches = Math.max(wins + losses, finite(breakthrough.matches));
    if (matches > 0) records[seasonId] = { wins, losses, matches };
  }
  return records;
}

function buildRawRow(discordId, member, current) {
  const stats = member?.stats ?? {};
  const tracked = current?.stats ?? {};
  const allClass = stats.classes?.kit ?? {};
  const activeSeconds = Math.max(1, finite(allClass.secondsPlayed));
  const activeMinutes = activeSeconds / 60;
  const seconds = Math.max(1, finite(stats.secondsPlayed, activeSeconds));
  const hours = seconds / 3600;
  const objective = stats.objective ?? {};
  const objectiveTime = objective.time ?? {};
  const spotAssists = finite(stats.devidedAssists?.spot);
  // Prefer the public tracker's player-only fields. Raw GameTools dividedKills.human
  // is the only allowed fallback; top-level kills and KPM include bots.
  const playerKills = finite(tracked.kills, finite(stats.dividedKills?.human));
  const playerKillDeath = finite(tracked.infantryKillDeath, finite(stats.infantryKillDeath));
  const playerKillsPerMinute = finite(tracked.playerKillsPerMinute, playerKills / activeMinutes);
  const breakthroughObjectiveActions = finite(objective.captured) + finite(objective.neutralized);

  return {
    discordId,
    name: current?.displayName ?? member?.name ?? discordId,
    hours,
    matches: Math.max(0, finite(stats.matchesPlayed)),
    wins: Math.max(0, finite(stats.wins)),
    losses: Math.max(0, finite(stats.loses)),
    cachedStats: false,
    weaponMix: weaponKillMix(stats),
    breakthroughSeasons: breakthroughSeasonRecords(stats),
    raw: {
      infantryKd: playerKillDeath,
      infantryKpm: playerKillsPerMinute,
      playerKillsPerMatch: playerKills / Math.max(1, finite(stats.matchesPlayed)),
      assistsPerHour: finite(tracked.assists, finite(stats.assists)) / hours,
      accuracy: finite(stats.accuracy),
      headshotPercent: finite(tracked.headshotPercent, finite(stats.headshots)),
      objectiveActionsPerHour: breakthroughObjectiveActions / hours,
      objectivePresence: finite(objectiveTime.total) / seconds,
      breakthroughPressure: (finite(objectiveTime.attacked) + finite(objectiveTime.defended)) / seconds,
      revivesPerHour: finite(stats.revives) / hours,
      squadRevivesPerHour: finite(stats.squadmateRevive) / hours,
      healsPerHour: finite(stats.heals) / hours,
      resuppliesPerHour: finite(stats.resupplies) / hours,
      repairsPerHour: finite(stats.repairs) / hours,
      spotsPerHour: finite(stats.enemiesSpotted) / hours,
      spotAssistsPerHour: spotAssists / hours,
      deathsPerHour: finite(stats.deaths) / hours
    },
    adjusted: {},
    percentiles: {},
    lanes: {},
    pillars: {},
    model: {},
    scores: {}
  };
}

export function calculateEffectiveness(archive, latest = { members: [] }) {
  const latestById = new Map((latest.members ?? []).map((member) => [String(member.discordId), member]));
  const rows = Object.entries(archive?.members ?? {})
    .map(([discordId, member]) => {
      const current = latestById.get(String(discordId));
      const row = buildRawRow(discordId, member, current);
      row.cachedStats = Boolean(current?.cachedStats);
      return row;
    })
    .filter((row) => row.hours > 0 && row.matches > 0);

  if (!rows.length) return { rows: [], archiveDate: archive?.date ?? null, constants: {} };

  addWeaponAdjustedAim(rows);

  const featureDirections = {
    infantryKd: 1,
    infantryKpm: 1,
    playerKillsPerMatch: 1,
    assistsPerHour: 1,
    accuracyResidual: 1,
    headshotResidual: 1,
    objectiveActionsPerHour: 1,
    objectivePresence: 1,
    breakthroughPressure: 1,
    revivesPerHour: 1,
    squadRevivesPerHour: 1,
    healsPerHour: 1,
    resuppliesPerHour: 1,
    repairsPerHour: 1,
    spotsPerHour: 1,
    spotAssistsPerHour: 1,
    deathsPerHour: -1
  };
  for (const [key, direction] of Object.entries(featureDirections)) {
    shrinkToMedian(rows, key);
    addPercentiles(rows, key, direction);
  }

  for (const row of rows) {
    const p = row.percentiles;
    const combatValues = [
      p.infantryKd,
      p.infantryKpm,
      p.playerKillsPerMatch,
      p.assistsPerHour,
      p.accuracyResidual,
      p.headshotResidual
    ];
    const combatWeights = [0.3, 0.3, 0.1, 0.1, 0.1, 0.1];
    row.combatGeometric = weightedGeometric(combatValues, combatWeights);
    row.combatArithmetic = weightedArithmetic(combatValues, combatWeights);
    row.pillars.combat =
      COMBAT_GEOMETRIC_WEIGHT * row.combatGeometric + COMBAT_ARITHMETIC_WEIGHT * row.combatArithmetic;
    row.aimScore = weightedGeometric([p.accuracyResidual, p.headshotResidual], [0.5, 0.5]);
    row.pillars.objective = weightedGeometric(
      [p.objectiveActionsPerHour, p.objectivePresence, p.breakthroughPressure],
      [0.5, 0.3, 0.2]
    );
    row.lanes.medic = weightedGeometric([p.revivesPerHour, p.squadRevivesPerHour, p.healsPerHour], [0.45, 0.2, 0.35]);
    row.lanes.logistics = weightedGeometric([p.resuppliesPerHour, p.repairsPerHour], [0.55, 0.45]);
    row.lanes.intel = weightedGeometric([p.spotsPerHour, p.spotAssistsPerHour], [0.55, 0.45]);
    const supportLanes = Object.entries(row.lanes).sort((a, b) => b[1] - a[1]);
    row.bestSupportLanes = supportLanes.slice(0, 2).map(([key]) => key);
    row.pillars.teamwork = 0.7 * supportLanes[0][1] + 0.3 * supportLanes[1][1];

    row.scores.trident = weightedGeometric(
      [row.pillars.combat, row.pillars.objective, row.pillars.teamwork],
      [0.4, 0.3, 0.3]
    );
    row.sortinoUpside = 0.4 * row.pillars.combat + 0.3 * row.pillars.objective + 0.3 * row.pillars.teamwork;
  }

  const medianDeathsPerHour = median(rows.map((row) => row.adjusted.deathsPerHour));
  for (const row of rows) {
    const downside = clamp((row.adjusted.deathsPerHour / Math.max(0.01, medianDeathsPerHour)) ** 0.35, 0.72, 1.4);
    row.sortinoDownside = downside;
    row.sortinoRaw = row.sortinoUpside / downside;
    row.adjusted.sortinoRaw = row.sortinoRaw;
  }
  addPercentiles(rows, "sortinoRaw", 1);
  for (const row of rows) row.scores.sortino = row.percentiles.sortinoRaw;

  const lifetimeClanWinRate = sum(rows.map((row) => row.wins)) / Math.max(1, sum(rows.map((row) => row.wins + row.losses)));
  const seasonClanRates = Object.fromEntries(
    Object.keys(SEASON_WEIGHTS).map((seasonId) => {
      const wins = sum(rows.map((row) => row.breakthroughSeasons[seasonId]?.wins ?? 0));
      const losses = sum(rows.map((row) => row.breakthroughSeasons[seasonId]?.losses ?? 0));
      return [seasonId, wins / Math.max(1, wins + losses)];
    })
  );
  const means = {
    combat: sum(rows.map((row) => row.pillars.combat)) / rows.length,
    objective: sum(rows.map((row) => row.pillars.objective)) / rows.length,
    teamwork: sum(rows.map((row) => row.pillars.teamwork)) / rows.length
  };
  const deviations = {
    combat: Math.sqrt(sum(rows.map((row) => (row.pillars.combat - means.combat) ** 2)) / rows.length) || 1,
    objective: Math.sqrt(sum(rows.map((row) => (row.pillars.objective - means.objective) ** 2)) / rows.length) || 1,
    teamwork: Math.sqrt(sum(rows.map((row) => (row.pillars.teamwork - means.teamwork) ** 2)) / rows.length) || 1
  };
  for (const row of rows) {
    row.seasonWinRates = {};
    let weightedRate = 0;
    let availableWeight = 0;
    for (const [seasonId, weight] of Object.entries(SEASON_WEIGHTS)) {
      const record = row.breakthroughSeasons[seasonId];
      if (!record) continue;
      const decisions = Math.max(1, record.wins + record.losses);
      const rawRate = record.wins / decisions;
      const smoothedRate =
        (record.wins + SEASON_WIN_PRIOR_MATCHES * seasonClanRates[seasonId]) /
        (decisions + SEASON_WIN_PRIOR_MATCHES);
      row.seasonWinRates[seasonId] = { ...record, rawRate, smoothedRate, weight };
      weightedRate += weight * smoothedRate;
      availableWeight += weight;
    }
    if (availableWeight > 0) {
      row.smoothedWinPercent = (100 * weightedRate) / availableWeight;
      row.winDataSource = "season-breakthrough";
    } else {
      const decisions = Math.max(1, row.wins + row.losses);
      row.smoothedWinPercent =
        (100 * (row.wins + WIN_PRIOR_MATCHES * lifetimeClanWinRate)) / (decisions + WIN_PRIOR_MATCHES);
      row.winDataSource = "lifetime-fallback";
    }
    row.model = {
      combat: (row.pillars.combat - means.combat) / deviations.combat,
      objective: (row.pillars.objective - means.objective) / deviations.objective,
      teamwork: (row.pillars.teamwork - means.teamwork) / deviations.teamwork
    };
  }
  const clanWinPercent = sum(rows.map((row) => row.smoothedWinPercent)) / rows.length;
  for (const row of rows) {
    row.expectedWinPercent = ridgePredict(rows.filter((candidate) => candidate !== row), row);
    row.scores.alpha = row.smoothedWinPercent - row.expectedWinPercent;
  }

  return {
    rows,
    archiveDate: archive?.date ?? null,
    constants: {
      priorHours: PRIOR_HOURS,
      winPriorMatches: WIN_PRIOR_MATCHES,
      seasonWinPriorMatches: SEASON_WIN_PRIOR_MATCHES,
      seasonWeights: SEASON_WEIGHTS,
      seasonClanRates,
      ridgeLambda: RIDGE_LAMBDA,
      aimRidgeLambda: AIM_RIDGE_LAMBDA,
      combatBlend: {
        geometric: COMBAT_GEOMETRIC_WEIGHT,
        arithmetic: COMBAT_ARITHMETIC_WEIGHT
      },
      clanWinPercent,
      medianDeathsPerHour
    }
  };
}

export const effectivenessDefinitions = {
  trident: { title: "Composite Effectiveness Index", scoreLabel: "score", higherIsBetter: true },
  sortino: { title: "Risk-Adjusted Impact Score", scoreLabel: "percentile", higherIsBetter: true },
  alpha: { title: "Win Rate Residual", scoreLabel: "pp", higherIsBetter: true }
};
