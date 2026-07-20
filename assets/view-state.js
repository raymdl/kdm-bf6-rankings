export const RANGE_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "3d", label: "3 Days" },
  { key: "7d", label: "7 Days" },
  { key: "14d", label: "14 Days" },
  { key: "30d", label: "30 Days" },
  { key: "all", label: "All Time" }
];

export const DEFAULT_RANGE = "7d";
export const CUSTOM_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
const LEGACY_RANGE_KEYS = { 1: "today", 3: "3d", 7: "7d", 14: "14d", 30: "30d", 90: "30d" };

export function hashRoute(route, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }
  const suffix = query.toString();
  return `#/${route}${suffix ? `?${suffix}` : ""}`;
}

export function parseHashRoute(hash) {
  const raw = String(hash ?? "").replace(/^#\/?/, "");
  const question = raw.indexOf("?");
  const path = question >= 0 ? raw.slice(0, question) : raw;
  const query = question >= 0 ? raw.slice(question + 1) : "";
  return { parts: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}

export function normalizedViewRange(params, { periodAvailable = true, defaultRange = DEFAULT_RANGE } = {}) {
  const requestedView = params?.get("view") === "period" ? "period" : "career";
  const raw = params?.get("range") ?? "";
  const normalized = LEGACY_RANGE_KEYS[Number(raw)] ?? raw;
  if (CUSTOM_RANGE_RE.test(normalized)) {
    return {
      view: requestedView === "period" && periodAvailable ? "period" : "career",
      range: "custom",
      custom: normalized
    };
  }
  return {
    view: requestedView === "period" && periodAvailable ? "period" : "career",
    range: RANGE_OPTIONS.some((option) => option.key === normalized) ? normalized : defaultRange,
    custom: null
  };
}

export function viewRangeParams(viewRange) {
  const range = viewRange.range === "custom" ? viewRange.custom : viewRange.range;
  return {
    view: viewRange.view === "period" ? "period" : null,
    range: viewRange.view === "career" && range === DEFAULT_RANGE ? null : range
  };
}

export function playerProfileRoute(discordId, statKey, viewRange, { estimated = false } = {}) {
  return hashRoute(`player/${encodeURIComponent(discordId)}/${statKey}`, {
    estimated: estimated ? 1 : null,
    ...viewRangeParams(viewRange)
  });
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function positionOnOrBefore(dates, indexes, target) {
  for (let position = indexes.length - 1; position >= 0; position -= 1) {
    if (dates[indexes[position]] <= target) return position;
  }
  return -1;
}

// Career values remain lifetime totals. This window controls only the two
// historical comparison endpoints and the trend/chart slice. Preset labels
// describe elapsed calendar time, so a 7-day range needs endpoints seven days
// apart (normally eight daily snapshots), just like Period.
export function resolveCareerWindow(dates, authoritativeIndexes, rangeKey, customRange = null) {
  if (!Array.isArray(dates) || !Array.isArray(authoritativeIndexes) || authoritativeIndexes.length < 2) {
    return { unavailable: true, reason: "not_enough_history" };
  }
  const indexes = authoritativeIndexes.filter((index) => Number.isInteger(index) && dates[index]);
  if (indexes.length < 2) return { unavailable: true, reason: "not_enough_history" };
  const endPositionDefault = indexes.length - 1;
  let startPosition = 0;
  let endPosition = endPositionDefault;
  let requested = rangeKey;
  let clamped = false;

  if (rangeKey === "today") {
    startPosition = endPositionDefault - 1;
  } else if (rangeKey === "all") {
    startPosition = 0;
  } else if (/^(\d+)d$/.test(rangeKey ?? "")) {
    const days = Number(rangeKey.slice(0, -1));
    const target = shiftDate(dates[indexes[endPositionDefault]], -days);
    const resolved = positionOnOrBefore(dates, indexes, target);
    startPosition = Math.max(0, resolved);
    clamped = resolved < 0;
  } else if (rangeKey === "custom") {
    const match = CUSTOM_RANGE_RE.exec(customRange ?? "");
    if (!match || match[1] >= match[2]) return { unavailable: true, reason: "invalid_custom_range" };
    requested = customRange;
    const requestedStart = positionOnOrBefore(dates, indexes, match[1]);
    const requestedEnd = positionOnOrBefore(dates, indexes, match[2]);
    startPosition = Math.max(0, requestedStart);
    endPosition = requestedEnd;
    clamped = requestedStart < 0;
    if (endPosition <= startPosition) return { unavailable: true, reason: "not_enough_history" };
  } else {
    return { unavailable: true, reason: "unknown_range" };
  }

  const selectedIndexes = indexes.slice(startPosition, endPosition + 1);
  return {
    requested,
    startIndex: selectedIndexes[0],
    endIndex: selectedIndexes.at(-1),
    startDate: dates[selectedIndexes[0]],
    endDate: dates[selectedIndexes.at(-1)],
    indexes: selectedIndexes,
    clamped
  };
}

export function validateCustomRange(from, to, minDate, maxDate) {
  if (!from || !to) return { valid: false, message: "Choose both a From and To date." };
  if (from < minDate || from > maxDate || to < minDate || to > maxDate) {
    return { valid: false, message: `Choose dates from ${minDate} through ${maxDate}.` };
  }
  if (from >= to) return { valid: false, message: "From must be earlier than To." };
  return { valid: true, message: "" };
}
