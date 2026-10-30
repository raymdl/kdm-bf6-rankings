import { shiftDate } from "./counter-math.js?v=20261030-route-guard";

// BF6 seasons, oldest first. `firstDate`/`lastDate` are Pacific tracker days,
// so "This Season" subtracts the final snapshot of the day before the season
// began (Season 5: end of Oct 12 → today). The season in progress has
// lastDate null. Add a row (and close the previous one) when a new season
// starts; the bot keeps the same list in src/bf6-query-windows.js.
export const SEASONS = Object.freeze([
  Object.freeze({ number: 1, label: "Season 1", firstDate: "2025-10-28", lastDate: "2026-02-16" }),
  Object.freeze({ number: 2, label: "Season 2", firstDate: "2026-02-17", lastDate: "2026-05-11" }),
  Object.freeze({ number: 3, label: "Season 3", firstDate: "2026-05-12", lastDate: "2026-07-20" }),
  Object.freeze({ number: 4, label: "Season 4", firstDate: "2026-07-21", lastDate: "2026-10-12" }),
  Object.freeze({ number: 5, label: "Season 5", firstDate: "2026-10-13", lastDate: null })
]);

// The season in progress on `date`, or null before the first listed season.
export function currentSeason(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return null;
  for (let index = SEASONS.length - 1; index >= 0; index -= 1) {
    if (SEASONS[index].firstDate <= date) return SEASONS[index];
  }
  return null;
}

// The snapshot date a season's numbers subtract from: the day before it began.
export function seasonBaselineDate(season) {
  return season ? shiftDate(season.firstDate, -1) : null;
}

export function seasonByNumber(number) {
  return SEASONS.find((season) => season.number === number) ?? null;
}

// Range keys: "season" is whichever season is in progress (a shared link keeps
// following it), "season-4" is always Season 4.
export const SEASON_RANGE_RE = /^season(?:-(\d+))?$/;

export function isSeasonRangeKey(rangeKey) {
  return SEASON_RANGE_RE.test(String(rangeKey ?? ""));
}

export function seasonRangeKey(season, latestDate) {
  return season === currentSeason(latestDate) ? "season" : `season-${season.number}`;
}

// The season a range key names as of `latestDate`, or { reason } when none.
export function seasonForRangeKey(rangeKey, latestDate) {
  const match = SEASON_RANGE_RE.exec(String(rangeKey ?? ""));
  if (!match) return { reason: "unknown_range" };
  const current = currentSeason(latestDate);
  if (!current) return { reason: "no_season" };
  if (!match[1]) return { season: current };
  const season = seasonByNumber(Number(match[1]));
  return season && season.number <= current.number ? { season } : { reason: "unknown_season" };
}

// Snapshot targets for a season: from the end of the day before it began to
// the end of its last day, or through `latestDate` while it is in progress.
export function seasonTargets(season, latestDate) {
  return {
    startTarget: seasonBaselineDate(season),
    endTarget: season.lastDate && season.lastDate < latestDate ? season.lastDate : latestDate
  };
}

// Seasons worth offering in the menu: started by `latestDate` and not over
// before tracking began on `firstTrackedDate`. Newest first.
export function menuSeasons(latestDate, firstTrackedDate) {
  const current = currentSeason(latestDate);
  if (!current) return [];
  return SEASONS
    .filter((season) => season.number <= current.number && (!season.lastDate || !firstTrackedDate || season.lastDate > firstTrackedDate))
    .map((season) => ({ season, key: seasonRangeKey(season, latestDate), partial: Boolean(firstTrackedDate && seasonBaselineDate(season) < firstTrackedDate) }))
    .reverse();
}
