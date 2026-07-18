/* KDM BF6 Rankings — pure Period calculation engine over data/counters.json.
   DOM-free and side-effect-free so it runs identically in the browser and in
   `node --test`. All semantics follow BF6_CAREER_PERIOD_STATS_IMPLEMENTATION_PLAN.md:
   Period stats are differences of cumulative counter endpoint columns; ratios
   are always derived from full-window deltas, never averaged from daily
   values; missing member endpoints carry the last observed column forward
   with provenance; negative deltas invalidate the member's window. */

export const MIN_ACTIVE_SECONDS_TO_RANK = 900;

export const PERIOD_RANGE_KEYS = ["today", "3d", "7d", "14d", "30d", "all", "custom"];
export const CUSTOM_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

// Site stat key → how its Period value derives from window counter deltas.
// `rate: true` marks stats subject to the minimum-active-time qualification.
// Anything absent here (playerRank) is Career-only.
export const PERIOD_STAT_DEFS = {
  infantryKillDeath: { rate: true, derive: (d) => ratio(d.playerKills, d.deaths) },
  killDeath: { rate: true, derive: (d) => ratio(d.kills, d.deaths) },
  playerKillsPerMinute: { rate: true, derive: (d) => ratio(d.playerKills, d.activeSeconds / 60) },
  scorePerMinute: { rate: true, derive: (d) => ratio(d.score, d.activeSeconds / 60) },
  kills: { rate: false, derive: (d) => d.playerKills },
  assists: { rate: false, derive: (d) => d.assists },
  vehicleKills: { rate: false, derive: (d) => d.vehicleKills },
  revives: { rate: false, derive: (d) => d.revives },
  headshotPercent: { rate: true, derive: (d) => ratio(d.headShots * 100, d.kills) },
  timePlayedHours: { rate: false, derive: (d) => (Number.isFinite(d.activeSeconds) ? d.activeSeconds / 3600 : null) },
  objectiveCaptures: { rate: false, derive: (d) => d.objectiveCaptures },
  multiKills: { rate: false, derive: (d) => d.multiKills },
  defibKills: { rate: false, derive: (d) => d.defibKills },
  meleeKills: { rate: false, derive: (d) => d.meleeKills }
};

export function periodSupported(statKey) {
  return Boolean(PERIOD_STAT_DEFS[statKey]);
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

export function validCounters(counters) {
  return Boolean(
    counters &&
      counters.version === 1 &&
      counters.formulaVersion === 1 &&
      Array.isArray(counters.dates) &&
      counters.dates.length > 0 &&
      counters.members &&
      typeof counters.members === "object"
  );
}

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function indexOnOrBefore(dates, target) {
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (dates[i] <= target) return i;
  }
  return -1;
}

/* ---------- range resolution ---------- */

// Resolve a range selection against the actual snapshot columns.
// Returns { startIndex, endIndex, startDate, endDate, requested, partialEnd }
// or { unavailable: true, reason } when the selection cannot be satisfied.
// "all" resolves the global window (column 0 → last); per-member start dates
// are applied by memberPeriod()/allTimeStart() below.
export function resolveRange(counters, rangeKey, customRange = null) {
  if (!validCounters(counters)) {
    return { unavailable: true, reason: "no_counters" };
  }
  const dates = counters.dates;
  const endIndex = dates.length - 1;

  if (rangeKey === "today") {
    if (counters.current?.settled !== false || counters.current.date !== dates[endIndex]) {
      return { unavailable: true, reason: "no_refresh_today" };
    }
    if (endIndex === 0) {
      return { unavailable: true, reason: "no_prior_baseline" };
    }
    return window_(dates, endIndex - 1, endIndex, { requested: "today", partialEnd: true, asOf: counters.current.asOf });
  }

  const partialEnd = counters.current?.settled === false && counters.current.date === dates[endIndex];

  if (rangeKey === "all") {
    if (endIndex === 0) {
      return { unavailable: true, reason: "single_snapshot" };
    }
    return window_(dates, 0, endIndex, { requested: "all", partialEnd });
  }

  const preset = /^(\d+)d$/.exec(rangeKey ?? "");
  if (preset) {
    const startIndex = indexOnOrBefore(dates, shiftDate(dates[endIndex], -Number(preset[1])));
    if (startIndex < 0 || startIndex >= endIndex) {
      return { unavailable: true, reason: "not_enough_history" };
    }
    return window_(dates, startIndex, endIndex, { requested: rangeKey, partialEnd });
  }

  if (rangeKey === "custom") {
    const match = CUSTOM_RANGE_RE.exec(customRange ?? "");
    if (!match || match[1] >= match[2]) {
      return { unavailable: true, reason: "invalid_custom_range" };
    }
    const startIndex = indexOnOrBefore(dates, match[1]);
    const customEnd = indexOnOrBefore(dates, match[2]);
    if (startIndex < 0 || customEnd <= startIndex) {
      return { unavailable: true, reason: "not_enough_history" };
    }
    return window_(dates, startIndex, customEnd, {
      requested: customRange,
      partialEnd: partialEnd && customEnd === endIndex
    });
  }

  return { unavailable: true, reason: "unknown_range" };
}

function window_(dates, startIndex, endIndex, extra) {
  return { startIndex, endIndex, startDate: dates[startIndex], endDate: dates[endIndex], ...extra };
}

/* ---------- member endpoint + delta resolution ---------- */

// Last observed column at or before `index` for one counter, with provenance:
// carried=true means the member was missing from the endpoint's snapshot and
// their previous cumulative value was carried forward (assumed zero gameplay
// since; any activity surfaces in the interval after their next observation).
function endpointValue(series, index) {
  for (let i = Math.min(index, series.length - 1); i >= 0; i -= 1) {
    if (Number.isFinite(series[i])) {
      return { value: series[i], index: i, carried: i !== index };
    }
  }
  return null;
}

// The index of a member's first observed column (their tracking start), or -1.
export function memberFirstObservedIndex(counters, discordId) {
  const values = counters.members?.[discordId]?.values ?? {};
  let first = -1;
  for (const series of Object.values(values)) {
    for (let i = 0; i < series.length; i += 1) {
      if (Number.isFinite(series[i])) {
        if (first < 0 || i < first) first = i;
        break;
      }
    }
  }
  return first;
}

// Counter deltas for one member across a window. Result:
//   { deltas, activeSeconds, startCarried, endCarried, trackedSinceIndex }
// or { invalid: true, reason } — reasons: "no_data", "negative_delta" (with
// `counter` naming the offender; indicates a reset/upstream correction).
// In All-Time windows the member's own first observed column becomes their
// start (per-member start dates); `trackedSinceIndex` reports it.
export function memberPeriodDeltas(counters, discordId, window) {
  if (!window || window.unavailable || !counters.members?.[discordId]) {
    return { invalid: true, reason: "no_data" };
  }
  const values = counters.members[discordId].values ?? {};
  const firstObserved = memberFirstObservedIndex(counters, discordId);
  if (firstObserved < 0 || firstObserved >= window.endIndex) {
    return { invalid: true, reason: "no_data" };
  }
  const startIndex = Math.max(window.startIndex, firstObserved);
  const deltas = {};
  let startCarried = false;
  let endCarried = false;
  let any = false;
  for (const [key, series] of Object.entries(values)) {
    const start = endpointValue(series, startIndex);
    const end = endpointValue(series, window.endIndex);
    if (!start || !end) {
      deltas[key] = null;
      continue;
    }
    if (end.value < start.value) {
      return { invalid: true, reason: "negative_delta", counter: key };
    }
    deltas[key] = end.value - start.value;
    startCarried = startCarried || start.carried;
    endCarried = endCarried || end.carried;
    any = true;
  }
  if (!any) {
    return { invalid: true, reason: "no_data" };
  }
  return {
    deltas,
    activeSeconds: Number.isFinite(deltas.activeSeconds) ? deltas.activeSeconds : null,
    startCarried,
    endCarried,
    trackedSinceIndex: startIndex
  };
}

/* ---------- stat derivation ---------- */

// One member's Period value for one stat across a window:
//   { value, activeSeconds, qualifies, provenance: {startCarried, endCarried},
//     trackedSince } — value is null when underivable (zero denominator, no
//     gameplay). Or { invalid, reason } for missing/reset members.
export function memberPeriodStat(counters, discordId, statKey, window) {
  const def = PERIOD_STAT_DEFS[statKey];
  if (!def) {
    return { invalid: true, reason: "career_only" };
  }
  const resolved = memberPeriodDeltas(counters, discordId, window);
  if (resolved.invalid) {
    return resolved;
  }
  const value = def.derive(resolved.deltas);
  return {
    value: Number.isFinite(value) ? value : null,
    activeSeconds: resolved.activeSeconds,
    qualifies: !def.rate || (resolved.activeSeconds ?? 0) >= MIN_ACTIVE_SECONDS_TO_RANK,
    isRate: def.rate,
    provenance: { startCarried: resolved.startCarried, endCarried: resolved.endCarried },
    trackedSince: counters.dates[resolved.trackedSinceIndex] ?? null
  };
}

// Day-by-day Period values across a window for trend charts. Each point:
//   { date, value, activeSeconds, observedEnd } — value null when the day is
// underivable for the stat (idle day for a ratio, missing data). Count stats
// report observed zeros as 0. observedEnd=false marks a carried (assumed)
// endpoint so charts can distinguish unknown days from real performance dips.
// Daily points are derived independently from daily deltas; multi-day ratios
// must come from memberPeriodStat over the full window, never from averaging
// these points.
export function memberDailySeries(counters, discordId, statKey, window) {
  const def = PERIOD_STAT_DEFS[statKey];
  if (!def || !window || window.unavailable) {
    return [];
  }
  const points = [];
  for (let index = window.startIndex + 1; index <= window.endIndex; index += 1) {
    const day = { startIndex: index - 1, endIndex: index };
    const resolved = memberPeriodDeltas(counters, discordId, day);
    if (resolved.invalid) {
      points.push({ date: counters.dates[index], value: null, activeSeconds: null, observedEnd: false });
      continue;
    }
    const value = def.derive(resolved.deltas);
    points.push({
      date: counters.dates[index],
      value: Number.isFinite(value) ? value : null,
      activeSeconds: resolved.activeSeconds,
      observedEnd: !resolved.endCarried
    });
  }
  return points;
}

/* ---------- cohort ranking ---------- */

// All members' Period values for a stat, ranked. Qualified rows get rank
// numbers; provisional (under-threshold rate) rows follow unranked; invalid
// windows (resets, no data) are reported separately for diagnostics.
export function periodRanking(counters, statKey, window) {
  if (!validCounters(counters) || !PERIOD_STAT_DEFS[statKey] || !window || window.unavailable) {
    return { ranked: [], provisional: [], invalid: [] };
  }
  const ranked = [];
  const provisional = [];
  const invalid = [];
  for (const discordId of Object.keys(counters.members)) {
    const stat = memberPeriodStat(counters, discordId, statKey, window);
    if (stat.invalid) {
      if (stat.reason !== "no_data") invalid.push({ discordId, reason: stat.reason });
      continue;
    }
    if (stat.value == null) {
      continue;
    }
    (stat.qualifies ? ranked : provisional).push({ discordId, ...stat });
  }
  const byValue = (a, b) => b.value - a.value || String(a.discordId).localeCompare(String(b.discordId));
  ranked.sort(byValue);
  provisional.sort(byValue);
  return {
    ranked: ranked.map((row, index) => ({ ...row, rank: index + 1 })),
    provisional,
    invalid
  };
}
