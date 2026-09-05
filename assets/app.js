/* KDM BF6 Rankings — static SPA reading the generated JSON published by the
   kdm-discord-bot daily update. No build step; Chart.js from CDN.

   Data files are resolved through assets/data-source.js rather than fetched by
   literal path, so the app does not care whether they come from R2 or from this
   repository. */

import { dataAge, dataFetchOptions, dataSourceStatus, dataUrl, initDataSource } from "./data-source.js?v=20260904-tighter-player-cards";

import { effectivenessDefinitions } from "./effectiveness.js?v=20260904-tighter-player-cards";
import {
  memberDailySeries,
  memberPeriodDeltas,
  memberPeriodStat,
  minActiveSecondsForWindow,
  periodRanking,
  periodSupported,
  periodUnsupportedReason,
  resolveRange,
  validCounters
} from "./period.js?v=20260904-tighter-player-cards";
import {
  CUSTOM_RANGE_RE,
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  hashRoute,
  equipmentViewParams,
  equipmentViewState,
  normalizedViewRange,
  parseHashRoute,
  playerProfileRoute,
  resolveCareerWindow,
  validateCustomRange,
  viewRangeParams as serializedViewRangeParams
} from "./view-state.js?v=20260904-tighter-player-cards";
import { pairwiseOvertakeFlags } from "./overtakes.js?v=20260904-tighter-player-cards";
import {
  EQUIPMENT_FIELDS,
  equipmentCareerStats,
  equipmentFieldsPresent,
  equipmentPeriodStats,
  latestObservedIndex,
  validEquipmentArtifact,
  validEquipmentCatalogue,
  validEquipmentMemberFile
} from "./equipment.js?v=20260904-tighter-player-cards";

const app = document.getElementById("app");
const skipLink = document.querySelector(".skip-link");

skipLink?.addEventListener("click", (event) => {
  event.preventDefault();
  app.focus({ preventScroll: true });
  app.scrollIntoView({ block: "start" });
});

const state = {
  meta: null,
  latest: null,
  history: { dates: [], members: {} },
  historyProvenance: null,
  historyProvenanceIndex: null,
  audit: null,
  notifications: null,
  effectiveness: null,
  effectivenessHistory: null,
  counters: null,
  equipmentCatalogue: null,
  equipmentIndex: null
};

let charts = [];
let floatingHeaderCleanups = [];
const equipmentProfileCache = new Map();
const equipmentProfileLoads = new Map();
const profileEquipmentTableState = { member: null, category: "weapons", key: "kills", direction: "desc", defaultKey: "kills", defaultDirection: "desc" };
const dataLoads = new Map();
const failedDataFiles = new Set();
const CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js";
const CHART_JS_INTEGRITY = "sha384-vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC";
let chartJsLoad = null;
let renderGeneration = 0;

/* ---------- utilities ---------- */

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtStat(stat, value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (stat.format === "decimal") {
    return value.toFixed(stat.decimals ?? 2);
  }
  if (stat.format === "hours") {
    return `${Math.round(value).toLocaleString("en-US")}h`;
  }
  return Math.round(value).toLocaleString("en-US");
}

function fmtDelta(stat, delta) {
  if (!Number.isFinite(delta) || delta === 0) {
    return null;
  }
  const magnitude = fmtStat(stat, Math.abs(delta));
  return `${delta > 0 ? "+" : "−"}${magnitude}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAge(ms) {
  const hours = Math.floor(ms / 3600000);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function statByKey(key) {
  return state.meta.stats.find((stat) => stat.key === key) ?? null;
}

// Friendly, player-facing label for a stored GameTools identity platform. The
// audit log shows the raw value instead (research/debugging focused). Unknown
// or missing values yield null so callers can omit platform entirely.
const PLATFORM_LABELS = {
  ea: "EA / PC",
  pc: "PC",
  steam: "Steam",
  xboxone: "Xbox",
  xboxseries: "Xbox",
  psn: "PlayStation",
  ps4: "PlayStation",
  ps5: "PlayStation"
};

// Platform SVGs are vendored in assets/icons (downloaded once from
// api.iconify.design/simple-icons) so rendering never depends on a
// third-party origin being up.
const PLATFORM_ICONS = {
  ea: {
    key: "ea",
    label: "EA",
    src: "assets/icons/ea-dark.svg"
  },
  pc: {
    key: "ea",
    label: "EA / PC",
    src: "assets/icons/ea-dark.svg"
  },
  psn: {
    key: "playstation",
    label: "PlayStation",
    src: "assets/icons/playstation.svg"
  },
  ps4: {
    key: "playstation",
    label: "PlayStation",
    src: "assets/icons/playstation.svg"
  },
  ps5: {
    key: "playstation",
    label: "PlayStation",
    src: "assets/icons/playstation.svg"
  },
  steam: {
    key: "steam",
    label: "Steam",
    src: "assets/icons/steam.svg"
  },
  xbox: {
    key: "xbox",
    label: "Xbox",
    src: "assets/icons/xbox.svg"
  },
  xboxone: {
    key: "xbox",
    label: "Xbox",
    src: "assets/icons/xbox.svg"
  },
  xboxseries: {
    key: "xbox",
    label: "Xbox",
    src: "assets/icons/xbox.svg"
  }
};

function platformLabel(platform) {
  if (!platform) {
    return null;
  }
  const key = String(platform).trim().toLowerCase();
  return PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function platformIconHtml(platform) {
  const icon = PLATFORM_ICONS[String(platform ?? "").trim().toLowerCase()];
  if (!icon) {
    return "";
  }

  const accessibleLabel = `${icon.label} platform`;
  return `<span class="platform-icon platform-icon-${icon.key}" role="img" aria-label="${esc(accessibleLabel)}" title="${esc(accessibleLabel)}"><img src="${icon.src}" alt="" aria-hidden="true" loading="lazy" decoding="async"></span>`;
}

function memberName(discordId) {
  const latest = state.latest.members.find((member) => member.discordId === discordId);
  return latest?.displayName ?? state.history.members?.[discordId]?.name ?? `Member ${discordId}`;
}

function memberTrackedSince(discordId) {
  const counterValues = state.counters?.members?.[discordId]?.values ?? {};
  const counterSeries = Object.values(counterValues);
  const counterIndex = (state.counters?.dates ?? []).findIndex((_, index) =>
    counterSeries.some((values) => Number.isFinite(values?.[index]))
  );
  if (counterIndex >= 0) return state.counters.dates[counterIndex];

  const historyValues = state.history.members?.[discordId]?.values ?? {};
  const historySeries = Object.entries(historyValues);
  const historyIndex = state.history.dates.findIndex((date, index) =>
    historySeries.some(([statKey, values]) => Number.isFinite(values?.[index]) && !historyProvenance(discordId, date, statKey))
  );
  return historyIndex >= 0 ? state.history.dates[historyIndex] : null;
}

// The provenance artifact answers one question -- was this (member, date, stat)
// point reconstructed from Tracker sessions rather than observed? -- and v2
// stores it as a shared date axis plus per-member index arrays. Expanding it
// once into a Set keeps the thousands of per-point lookups below O(1).
function buildHistoryProvenanceIndex(artifact) {
  const dates = artifact?.dates ?? [];
  const index = new Set();
  for (const [discordId, member] of Object.entries(artifact?.members ?? {})) {
    for (const [statKey, positions] of Object.entries(member?.estimated ?? {})) {
      for (const position of positions) {
        if (dates[position]) index.add(`${discordId}|${statKey}|${dates[position]}`);
      }
    }
  }
  return index;
}

function historyProvenance(discordId, date, statKey) {
  return Boolean(state.historyProvenanceIndex?.has(`${discordId}|${statKey}|${date}`));
}

function estimatedHistoryNoticeHtml(discordId) {
  const entry = state.historyProvenance?.members?.[discordId];
  if (!entry) {
    return "";
  }
  return `<div class="estimated-history-notice" role="note">
    <strong>Estimated from Tracker session history</strong>
    <span>${entry.coverageStart ? fmtDate(`${entry.coverageStart}T12:00:00`) : "Historical coverage"} through ${entry.coverageEnd ? fmtDate(`${entry.coverageEnd}T12:00:00`) : "the first authoritative KDM snapshot"}. Grouped sessions may be assigned to a refresh/display date, so individual match dates are approximate.</span>
  </div>`;
}

function memberBackfillFields(discordId) {
  return new Set(Object.keys(state.historyProvenance?.members?.[discordId]?.estimated ?? {}));
}

// The member's own equipment file, already cached by the panel below. Returns
// null until that fetch lands, so the graph simply stays on the soldier stat
// rather than rendering an empty box.
function profileEquipmentSelection(discordId, equipmentId) {
  const cached = equipmentProfileCache.get(discordId);
  const data = cached?.status === "loaded" ? cached.data : null;
  if (!data) return null;
  for (const category of ["weapons", "vehicles"]) {
    const entry = data[category]?.[equipmentId];
    if (entry) {
      return { id: equipmentId, category, entry, data, name: equipmentDisplayName(category, equipmentId) };
    }
  }
  return null;
}

// The selected stat per date in Career, or the same stat measured over the
// window start-to-date in Period -- the same two readings the soldier-stat chart
// shows. Dates the member has no observation for stay null so the line breaks
// instead of implying data.
function equipmentChartPoints(selection, periodWindow, metric = "kills") {
  const dates = Array.isArray(selection.data.dates) ? selection.data.dates : [];
  const observed = selection.data.observed ?? [];
  const trackingStarts = selection.data.fieldTrackingStarts;
  const from = periodWindow ? periodWindow.startIndex : 0;
  const to = periodWindow ? periodWindow.endIndex : dates.length - 1;
  const points = [];
  for (let index = Math.max(0, from); index <= Math.min(to, dates.length - 1); index += 1) {
    const stats = periodWindow
      ? equipmentPeriodStats(selection.entry, selection.category, from, index, dates, observed, trackingStarts)
      : equipmentCareerStats(selection.entry, selection.category, index, observed, dates, trackingStarts);
    const raw = equipmentMetricValue(stats, metric);
    const value = Number.isFinite(raw)
      ? (metric === "timeEquipped" || metric === "timeIn" ? raw / 3600 : raw)
      : null;
    points.push({ date: dates[index], value });
  }
  return points;
}

// Chart axis/tooltip formatting for an equipment metric. Time series are
// converted to hours by equipmentChartPoints, so this matches that unit.
function equipmentChartStat(metric, name) {
  const label = EQUIPMENT_METRIC_LABELS[metric] ?? "Kills";
  const format = metric === "timeEquipped" || metric === "timeIn"
    ? "hours"
    : metric === "kpm" || metric === "accuracy" || metric === "hsPercent"
      ? "decimal"
      : "integer";
  return { key: metric, title: `${name} ${label}`, format, decimals: metric === "kpm" ? 2 : 1, label };
}

function playerHistoryHref(discordId, statKey, showEstimated, equipment = equipmentViewState()) {
  return playerProfileRoute(discordId, statKey, viewRangeState, {
    estimated: showEstimated,
    equipmentOpen: equipment.open,
    equipmentGrouping: equipment.grouping
  });
}

function playerHref(discordId, statKey = state.meta.stats[0].key) {
  return playerProfileRoute(discordId, statKey, viewRangeState);
}

function parsedHashRoute() {
  return parseHashRoute(location.hash);
}

function replaceHashAndRender(hash, { preserveScroll = true } = {}) {
  const scrollY = window.scrollY;
  history.replaceState(null, "", hash);
  Promise.resolve(render()).then(() => {
    if (preserveScroll) window.scrollTo(0, scrollY);
  });
}

function shareButtonHtml() {
  return `<button class="share-button" type="button">Share</button>`;
}

/* ---------- favorites ----------
   Per-browser only (localStorage); the site has no accounts, so favorites
   never leave the visitor's machine. */

const FAVORITES_STORAGE_KEY = "kdm-favorite-players";

const favoriteIds = new Set((() => {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
})());

function isFavorite(discordId) {
  return favoriteIds.has(discordId);
}

function toggleFavorite(discordId) {
  if (!favoriteIds.delete(discordId)) {
    favoriteIds.add(discordId);
  }
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favoriteIds]));
  } catch {
    // Private browsing or full storage — the in-memory set still works for
    // this visit.
  }
}

function favoriteButtonHtml(discordId, { size = "" } = {}) {
  const active = isFavorite(discordId);
  const label = active ? "Remove from favorites" : "Add to favorites";
  return `<button class="fav-toggle ${size} ${active ? "active" : ""}" type="button" data-fav-id="${discordId}" aria-pressed="${active}" aria-label="${label}" title="${label}">${active ? "♥" : "♡"}</button>`;
}

function favoriteBadgeHtml(discordId) {
  return isFavorite(discordId) ? `<span class="fav-badge" title="Favorite">♥</span>` : "";
}

function wireFavoriteToggles() {
  for (const button of app.querySelectorAll(".fav-toggle")) {
    button.addEventListener("click", (event) => {
      // Hearts can sit inside link cards; the toggle must never navigate.
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(button.dataset.favId);
      replaceHashAndRender(location.hash || "#/");
    });
  }
}

async function copyText(text) {
  // Modern clipboard API first; the hidden-textarea execCommand path stays as
  // a fallback for older/permission-restricted browsers.
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to execCommand.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Copy failed");
  }
}

function wireShareButton() {
  const button = app.querySelector(".share-button");
  button?.addEventListener("click", async () => {
    try {
      await copyText(location.href);
      button.textContent = "Copied!";
      setTimeout(() => {
        if (button.isConnected) {
          button.textContent = "Share";
        }
      }, 1600);
    } catch {
      button.textContent = "Copy failed";
    }
  });
}

function destroyCharts() {
  for (const chart of charts) {
    chart.destroy();
  }
  charts = [];
}

/* ---------- history helpers ---------- */

function series(discordId, statKey) {
  return state.history.members?.[discordId]?.values?.[statKey] ?? [];
}

// Last finite value at or before the given date index (members keep their last
// known value on days a fetch failed).
function valueAt(discordId, statKey, dateIndex) {
  const values = series(discordId, statKey);
  for (let i = Math.min(dateIndex, values.length - 1); i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) {
      return values[i];
    }
  }
  return null;
}

function authoritativeValueAt(discordId, statKey, dateIndex, fromIndex = 0) {
  const values = series(discordId, statKey);
  for (let index = Math.min(dateIndex, values.length - 1); index >= fromIndex; index -= 1) {
    if (Number.isFinite(values[index]) && !historyProvenance(discordId, state.history.dates[index], statKey)) {
      return values[index];
    }
  }
  return null;
}

function authoritativeBaselineValueAt(discordId, statKey, fromIndex, lastIndex) {
  const values = series(discordId, statKey);
  const end = Math.min(lastIndex - 1, values.length - 1);
  for (let index = Math.max(0, fromIndex); index <= end; index += 1) {
    if (Number.isFinite(values[index]) && !historyProvenance(discordId, state.history.dates[index], statKey)) {
      return values[index];
    }
  }
  return null;
}

function authoritativeHistoryIndexes(
  statKey = null,
  memberIds = Object.keys(state.history.members ?? {}),
  { includeEstimated = false } = {}
) {
  return state.history.dates
    .map((date, index) =>
      memberIds.some((discordId) => {
        const values = state.history.members?.[discordId]?.values ?? {};
        const statKeys = statKey ? [statKey] : Object.keys(values);
        return statKeys.some(
          (key) => Number.isFinite(values[key]?.[index]) && (includeEstimated || !historyProvenance(discordId, date, key))
        );
      })
        ? index
        : -1
    )
    .filter((index) => index >= 0);
}

function authoritativeRankingAt(statKey, dateIndex, memberIds) {
  return memberIds
    .map((discordId) => ({ discordId, value: authoritativeValueAt(discordId, statKey, dateIndex, dateIndex) }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

function authoritativeBaselineRankingAt(statKey, fromIndex, lastIndex, memberIds) {
  return memberIds
    .map((discordId) => ({
      discordId,
      value: authoritativeBaselineValueAt(discordId, statKey, fromIndex, lastIndex)
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

function latestRanking(statKey) {
  return state.latest.members
    .map((member) => ({ discordId: member.discordId, value: member.stats[statKey], member }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

function indexOnOrBefore(targetDate) {
  const dates = state.history.dates;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (dates[i] <= targetDate) {
      return i;
    }
  }
  return -1;
}

function shiftDateString(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------- Career/Period view + range state (URL-only) ----------

   Two independent controls (see BF6_CAREER_PERIOD_STATS_IMPLEMENTATION_PLAN.md):
   - View: Career (lifetime values) vs Period (stats earned between two
     counter snapshots, computed by assets/period.js).
   - Range: the same options in both views. In Career view it only drives
     movement/deltas/chart windows; in Period view it sets the calculation
     endpoints.
   State lives exclusively in the URL so shared links reproduce the sender's
   exact view and a parameterless URL always opens Career. No storage. */

const viewRangeState = { view: "career", range: DEFAULT_RANGE, custom: null };
let lastRenderedRoutePath = null;
const RECENT_PERFORMANCE_STORAGE_KEY = "kdm-recent-performance-collapsed";
let recentPerformanceCollapsed = (() => {
  try {
    return localStorage.getItem(RECENT_PERFORMANCE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
})();

function periodDataAvailable() {
  return validCounters(state.counters) && state.counters.dates.length >= 2;
}

// Whether one stat has a Period form given the artifact we actually loaded.
// Always ask through here rather than importing periodSupported directly — the
// counters argument is what makes a bot-side counter rename cost a single stat
// instead of the whole Period view.
function statHasPeriodForm(statKey) {
  return periodSupported(statKey, state.counters);
}

function periodUnsupportedNote(stat, fallback = "Career history") {
  return periodUnsupportedReason(stat.key, state.counters) === "counters_missing"
    ? `${stat.title} has no Period data in the current counters artifact — showing ${fallback}.`
    : `${stat.title} is a progression stat with no Period form — showing ${fallback}.`;
}

function loadViewRange(params, defaultRange = DEFAULT_RANGE) {
  Object.assign(viewRangeState, normalizedViewRange(params, {
    periodAvailable: periodDataAvailable(),
    defaultRange
  }));
}

// Params to merge into every in-site navigation so the selection follows the
// user; defaults are omitted so a clean URL stays clean.
function viewRangeParams() {
  return serializedViewRangeParams(viewRangeState);
}

function activePeriodWindow() {
  if (viewRangeState.view !== "period" || !periodDataAvailable()) {
    return null;
  }
  const window = resolveRange(
    state.counters,
    viewRangeState.range === "custom" ? "custom" : viewRangeState.range,
    viewRangeState.custom
  );
  return window.unavailable ? null : window;
}

function fmtShortDate(date) {
  return fmtDate(`${date}T12:00:00`);
}

// Month and day only. Coverage badges sit inline beside a player's name, often
// two at once, and the year pushes them wide enough to crowd the name off.
function fmtBadgeDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Snapshot dates use the Eastern calendar day.
function easternDateKey(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function asOfEasternText(iso) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit"
  });
}

function periodWindowText(window) {
  if (!window) {
    return "";
  }
  if (window.requested === "today") {
    return `Today's performance · as of ${asOfEasternText(window.asOf)} ET`;
  }
  const label = RANGE_OPTIONS.find((option) => option.key === window.requested)?.label
    ?? (window.requested === "custom" ? "Custom" : "Period");
  // Preset Period values are daily intervals after the baseline snapshot.
  // Label the dates the chart/table actually shows (e.g. a 3-day window has
  // points for Jul 15–17 even though Jul 14 is the subtraction baseline).
  const displayStartDate = /^\d+d$/.test(window.requested ?? "")
    ? shiftDateString(window.startDate, 1)
    : window.startDate;
  const clampNote = window.clamped ? " · tracking began " + fmtShortDate(window.startDate) : "";
  return `${label} · performance ${fmtShortDate(displayStartDate)} → ${fmtShortDate(window.endDate)}${window.partialEnd ? " (in progress)" : ""}${clampNote}`;
}

function careerRangeWindowText(window, { includeLabel = false, includeClamp = true } = {}) {
  if (!window || window.unavailable) return "the selected range";
  const clampNote = includeClamp && window.clamped ? ` · tracking began ${fmtShortDate(window.startDate)}` : "";
  const dateRange = `${fmtShortDate(window.startDate)} → ${fmtShortDate(window.endDate)}`;
  if (!includeLabel) return `${dateRange}${clampNote}`;
  if (window.requested === "today") {
    return `Current career · change since ${fmtShortDate(window.startDate)}`;
  }
  if (window.requested === "all") {
    return `Current career · change since tracking began ${fmtShortDate(window.startDate)}`;
  }
  return `Current career · change ${dateRange}${clampNote}`;
}

function rangeChipAvailability(key) {
  if (viewRangeState.view !== "period") {
    return { enabled: true, title: "" };
  }
  const window = resolveRange(state.counters, key);
  if (!window.unavailable) {
    return { enabled: true, title: "" };
  }
  const reasons = {
    no_refresh_today: "Available after today's first refresh",
    not_enough_history: `Needs more tracked history (daily counters start ${fmtShortDate(state.counters.dates[0])})`,
    no_prior_baseline: "Needs a prior day's snapshot",
    single_snapshot: "Needs at least two snapshots"
  };
  return { enabled: false, title: reasons[window.reason] ?? "Unavailable" };
}

const customCalendarState = { open: false, from: null, to: null, selecting: "from", month: null };

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function shiftMonth(month, amount) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

function calendarDate(year, month, day) {
  return new Date(Date.UTC(year, month, day, 12)).toISOString().slice(0, 10);
}

function openCustomCalendar(dates) {
  Object.assign(customCalendarState, {
    open: true,
    from: null,
    to: null,
    selecting: "from",
    month: monthKey(dates.at(-1))
  });
}

function rangeCalendarHtml(dates) {
  if (!customCalendarState.open) return "";
  const minDate = dates[0];
  const maxDate = dates.at(-1);
  const minMonth = monthKey(minDate);
  const maxMonth = monthKey(maxDate);
  const month = customCalendarState.month && customCalendarState.month >= minMonth && customCalendarState.month <= maxMonth
    ? customCalendarState.month
    : minMonth;
  customCalendarState.month = month;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthIndex = monthNumber - 1;
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1, 12)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  const validation = validateCustomRange(customCalendarState.from, customCalendarState.to, minDate, maxDate);
  const availableDates = new Set(dates);
  const dayCells = [];
  for (let blank = 0; blank < firstWeekday; blank += 1) dayCells.push('<span class="calendar-day-spacer"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = calendarDate(year, monthIndex, day);
    const noData = date < minDate || date > maxDate || !availableDates.has(date);
    const blockedByEnd = customCalendarState.selecting === "from" && customCalendarState.to && date >= customCalendarState.to;
    const blockedByStart = customCalendarState.selecting === "to" && customCalendarState.from && date <= customCalendarState.from;
    const selectionBlocked = !noData && (blockedByEnd || blockedByStart);
    const disabled = noData || selectionBlocked;
    const classes = ["calendar-day"];
    if (noData) classes.push("no-data");
    if (selectionBlocked) classes.push("selection-blocked");
    if (date === customCalendarState.from) classes.push("range-start");
    if (date === customCalendarState.to) classes.push("range-end");
    if (customCalendarState.from && customCalendarState.to && date > customCalendarState.from && date < customCalendarState.to) classes.push("in-range");
    dayCells.push(`<button type="button" class="${classes.join(" ")}" data-calendar-date="${date}" ${disabled ? "disabled" : ""} aria-label="${esc(fmtShortDate(date))}">${day}</button>`);
  }
  const monthLabel = new Date(Date.UTC(year, monthIndex, 1, 12)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return `<div class="range-calendar-popover" role="dialog" aria-label="Choose custom date range">
    <div class="range-calendar-fields">
      <button type="button" class="calendar-field ${customCalendarState.selecting === "from" ? "active" : ""}" data-calendar-field="from"><span>From</span><strong>${customCalendarState.from ? esc(fmtShortDate(customCalendarState.from)) : "Choose date"}</strong></button>
      <span class="calendar-range-arrow" aria-hidden="true">→</span>
      <button type="button" class="calendar-field ${customCalendarState.selecting === "to" ? "active" : ""}" data-calendar-field="to"><span>To</span><strong>${customCalendarState.to ? esc(fmtShortDate(customCalendarState.to)) : "Choose date"}</strong></button>
    </div>
    <div class="calendar-range-track" aria-hidden="true"><span></span></div>
    <div class="range-calendar-month-head">
      <button type="button" class="calendar-month-nav" data-month-shift="-1" ${month <= minMonth ? "disabled" : ""} aria-label="Previous month">‹</button>
      <strong>${esc(monthLabel)}</strong>
      <button type="button" class="calendar-month-nav" data-month-shift="1" ${month >= maxMonth ? "disabled" : ""} aria-label="Next month">›</button>
    </div>
    <div class="calendar-weekdays" aria-hidden="true">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="calendar-grid">${dayCells.join("")}</div>
    <div class="range-calendar-actions">
      <button type="button" class="chip" id="range-calendar-cancel">Cancel</button>
      <button type="button" class="chip calendar-reset" id="range-calendar-reset">Reset</button>
      <button type="button" class="chip range-apply" id="range-apply" ${validation.valid ? "" : "disabled"}>Apply range</button>
    </div>
  </div>`;
}

function viewRangeControlHtml(trailingControl = "") {
  if (!periodDataAvailable()) {
    return "";
  }
  const dates = state.counters.dates;
  const isCustom = viewRangeState.range === "custom";
  return `<div class="view-range-bar">
    <div class="view-range-group" role="group" aria-label="Stat view">
      <span class="view-range-label">View</span>
      <div class="view-toggle">
        <button type="button" class="view-toggle-option ${viewRangeState.view === "career" ? "active" : ""}" data-view="career" aria-pressed="${viewRangeState.view === "career"}" title="Lifetime totals and ratios">Career</button>
        <button type="button" class="view-toggle-option ${viewRangeState.view === "period" ? "active" : ""}" data-view="period" aria-pressed="${viewRangeState.view === "period"}" title="Stats earned during the selected range only">Period</button>
      </div>
    </div>
    <div class="view-range-group" role="group" aria-label="Date range">
      <span class="view-range-label">${viewRangeState.view === "period" ? "Performance window" : "Change window"}</span>
      ${RANGE_OPTIONS.map((option) => {
        const availability = rangeChipAvailability(option.key);
        return `<button type="button" class="chip range-chip ${viewRangeState.range === option.key ? "active" : ""}" data-range="${option.key}" ${availability.enabled ? "" : "disabled"} title="${esc(availability.title)}">${option.label}</button>`;
      }).join("")}
      <span class="range-calendar-anchor"><button type="button" class="chip range-chip ${isCustom ? "active" : ""}" data-range="custom" title="Pick an exact date range" aria-expanded="${customCalendarState.open}">Custom…</button>${rangeCalendarHtml(dates)}</span>
    </div>
    ${trailingControl}
  </div>`;
}

function wireViewRangeControl(hrefFor) {
  const navigate = () => replaceHashAndRender(hrefFor(viewRangeParams()));
  const rerender = () => replaceHashAndRender(location.hash);
  for (const button of app.querySelectorAll(".view-toggle-option[data-view]")) {
    button.addEventListener("click", () => {
      customCalendarState.open = false;
      viewRangeState.view = button.dataset.view === "period" && periodDataAvailable() ? "period" : "career";
      navigate();
    });
  }
  for (const chip of app.querySelectorAll(".range-chip[data-range]")) {
    chip.addEventListener("click", () => {
      const key = chip.dataset.range;
      if (key === "custom") {
        openCustomCalendar(state.counters?.dates ?? state.history.dates);
        rerender();
        return;
      }
      customCalendarState.open = false;
      viewRangeState.range = key;
      viewRangeState.custom = null;
      navigate();
    });
  }
  for (const field of app.querySelectorAll("[data-calendar-field]")) {
    field.addEventListener("click", () => {
      customCalendarState.selecting = field.dataset.calendarField;
      rerender();
    });
  }
  for (const button of app.querySelectorAll("[data-month-shift]")) {
    button.addEventListener("click", () => {
      customCalendarState.month = shiftMonth(customCalendarState.month, Number(button.dataset.monthShift));
      rerender();
    });
  }
  for (const day of app.querySelectorAll("[data-calendar-date]")) {
    day.addEventListener("click", () => {
      const date = day.dataset.calendarDate;
      if (customCalendarState.selecting === "from") {
        customCalendarState.from = date;
        customCalendarState.to = null;
        customCalendarState.selecting = "to";
      } else if (customCalendarState.selecting === "to") {
        customCalendarState.to = date;
        customCalendarState.selecting = "done";
      } else {
        customCalendarState.from = date;
        customCalendarState.to = null;
        customCalendarState.selecting = "to";
      }
      rerender();
    });
  }
  document.getElementById("range-calendar-cancel")?.addEventListener("click", () => {
    customCalendarState.open = false;
    rerender();
  });
  document.getElementById("range-calendar-reset")?.addEventListener("click", () => {
    customCalendarState.from = null;
    customCalendarState.to = null;
    customCalendarState.selecting = "from";
    rerender();
  });
  document.getElementById("range-apply")?.addEventListener("click", () => {
    const dates = state.counters?.dates ?? state.history.dates;
    const from = customCalendarState.from;
    const to = customCalendarState.to;
    if (!validateCustomRange(from, to, dates[0], dates.at(-1)).valid) return;
    customCalendarState.open = false;
    viewRangeState.range = "custom";
    viewRangeState.custom = `${from}..${to}`;
    navigate();
  });
}

document.addEventListener("click", (event) => {
  if (!customCalendarState.open || event.target.closest?.(".range-calendar-anchor")) return;
  customCalendarState.open = false;
  replaceHashAndRender(location.hash);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !customCalendarState.open) return;
  customCalendarState.open = false;
  replaceHashAndRender(location.hash);
});

// A drawn mark rather than a typed one: an emoji is a colour glyph that ignores
// `color`, so it arrived brown inside both badges. This is stroked and filled
// with currentColor and takes whichever badge it sits in.
//
// A half-filled circle because that is what the badge actually reports: this
// row covers part of the range you asked for, not all of it.
const COVERAGE_MARK_SVG =
  '<svg class="badge-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
  '<path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/></svg>';

function trackedSinceBadgeHtml(window, trackedSince, title = "This member's tracking began after this range's start; their stats cover their own tracked portion of it") {
  if (!window || !trackedSince || trackedSince === window.startDate) {
    return "";
  }
  return ` <span class="badge tracked-since" title="${esc(title)}">stat${COVERAGE_MARK_SVG}${esc(fmtBadgeDate(trackedSince))}</span>`;
}

// On an equipment board the shortfall can be the member's own start date or the
// date the metric itself began being recorded, so the badge does not blame one.
const EQUIPMENT_COVERAGE_BADGE_TITLE =
  "This figure covers part of the selected range: either this metric or this member started being recorded after the range began";

function timeMachineTrackedSinceBadgeHtml(trackedSince) {
  if (!trackedSince) return `<span class="badge tracked-since">not tracked yet</span>`;
  return `<span class="badge tracked-since" title="This player's first authoritative GameTools snapshot">tracked since ${esc(fmtShortDate(trackedSince))}</span>`;
}

/* ---------- shared render pieces ---------- */

function sparklineSvg(values, width = 110, height = 28) {
  const points = values.filter((value) => Number.isFinite(value));
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <circle cx="${width / 2}" cy="${height / 2}" r="2.2"></circle>
    </svg>`;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (points.length - 1);
  const coords = points.map((value, index) => {
    const x = pad + index * step;
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lastX, lastY] = coords[coords.length - 1].split(",");
  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <polyline points="${coords.join(" ")}"></polyline>
    <circle cx="${lastX}" cy="${lastY}" r="2.2"></circle>
  </svg>`;
}

// Human-readable description of the selected date range, used consistently for
// the leaderboard/compare sub-headings, movement tooltips, and podium deltas.
function movementHtml(prevRank, currentRank, windowText = "the previous day") {
  if (prevRank == null && currentRank != null) {
    return `<span class="movement flat" title="New to this leaderboard">NEW</span>`;
  }
  if (prevRank == null || currentRank == null) {
    return `<span class="movement flat" title="No comparable rank at both endpoints">–</span>`;
  }
  const diff = prevRank - currentRank;
  if (diff > 0) {
    return `<span class="movement up" title="Up ${diff} vs ${windowText}">▲${diff}</span>`;
  }
  if (diff < 0) {
    return `<span class="movement down" title="Down ${-diff} vs ${windowText}">▼${-diff}</span>`;
  }
  return `<span class="movement flat">–</span>`;
}

function rankingControlsHtml(statKey, category = "combat", selectedId = null, metric = "kills") {
  const routeButton = (label, href, active) => `<button type="button" data-ranking-route="${esc(href)}" aria-pressed="${active}">${esc(label)}</button>`;
  const groups = category === "combat" ? [] : equipmentGroups()[category];
  const selectedGroup = groups.find((group) => group.items.includes(selectedId)) ?? groups[0];
  const stats = category === "combat"
    ? state.meta.stats.map((stat) => routeButton(stat.title, hashRoute(`board/${stat.key}`, viewRangeParams()), stat.key === statKey)).join("")
    : equipmentMetricFields(category).map((key) => routeButton(EQUIPMENT_METRIC_LABELS[key], hashRoute("board/equipment", { equipment: selectedId, metric: key, ...viewRangeParams() }), key === metric)).join("");
  return `<div class="ranking-controls">
    <div class="ranking-categories" role="group" aria-label="Statistics category">${[["combat", "Soldier"], ["weapons", "Weapons"], ["vehicles", "Vehicles"]].map(([key, label]) => `<button type="button" data-ranking-category="${key}" aria-pressed="${category === key}">${label}</button>`).join("")}</div>
    <div class="ranking-options" role="group" aria-label="Statistic">${stats}</div>
    ${groups.length ? `<div class="ranking-equipment">
      <div class="ranking-group-tabs" role="group" aria-label="${category === "weapons" ? "Weapon class" : "Vehicle type"}">${groups.map((group, index) => `<button type="button" data-ranking-group="${index}" aria-pressed="${group === selectedGroup}">${esc(group.label)}</button>`).join("")}</div>
      ${groups.map((group, index) => `<div class="ranking-options ranking-items" data-ranking-items="${index}" role="group" aria-label="${esc(group.label)}"${group === selectedGroup ? "" : " hidden"}>${group.items.map((id) => routeButton(equipmentDisplayName(category, id), hashRoute("board/equipment", { equipment: id, metric, ...viewRangeParams() }), id === selectedId)).join("")}</div>`).join("")}
    </div>` : ""}
    <span class="ranking-control-status" role="status"></span>
  </div>`;
}
function wireRankingControls() {
  for (const button of app.querySelectorAll("[data-ranking-route]")) {
    button.addEventListener("click", () => replaceHashAndRender(button.dataset.rankingRoute));
  }
  for (const button of app.querySelectorAll("[data-ranking-group]")) {
    button.addEventListener("click", () => {
      for (const tab of app.querySelectorAll("[data-ranking-group]")) tab.setAttribute("aria-pressed", String(tab === button));
      for (const group of app.querySelectorAll("[data-ranking-items]")) group.hidden = group.dataset.rankingItems !== button.dataset.rankingGroup;
    });
  }
  for (const button of app.querySelectorAll("[data-ranking-category]")) {
    button.addEventListener("click", async () => {
      if (button.getAttribute("aria-pressed") === "true") return;
      const category = button.dataset.rankingCategory;
      if (category === "combat") {
        replaceHashAndRender(hashRoute(`board/${state.meta.stats[0].key}`, viewRangeParams()));
        return;
      }
      const hash = location.hash;
      const status = app.querySelector(".ranking-control-status");
      button.disabled = true;
      status.textContent = "Loading equipment…";
      try {
        await loadEquipmentData();
        if (location.hash !== hash) return;
        const id = equipmentGroups()[category][0]?.items[0];
        if (id) replaceHashAndRender(hashRoute("board/equipment", { equipment: id, ...viewRangeParams() }));
        else status.textContent = "No equipment records available.";
      } catch {
        status.textContent = "Could not load equipment. Try again.";
      } finally {
        button.disabled = false;
      }
    });
  }
}

function statTabsHtml(activeKey, hrefFor) {
  return `<div class="stat-tabs">${state.meta.stats
    .map(
      (stat) =>
        `<button class="${stat.key === activeKey ? "active" : ""}" data-stat="${stat.key}" aria-pressed="${stat.key === activeKey}" data-href="${hrefFor ? hrefFor(stat.key) : ""}">${esc(stat.title)}</button>`
    )
    .join("")}</div>`;
}

// Selecting any weapon or vehicle chip navigates to the equipment board, so the
// panel works identically whichever leaderboard you are looking at.
function wireEquipmentChips() {
  for (const button of app.querySelectorAll("[data-equipment]")) {
    button.addEventListener("click", () => {
      const category = button.dataset.equipmentCategory;
      const requestedMetric = parsedHashRoute().params.get("metric") ?? "kills";
      // Time Played survives a category switch under the other category's field
      // name; a stat the new category cannot report at all falls back to Kills.
      const metric = equipmentMetricAppliesTo(requestedMetric, category)
        ? resolvedEquipmentMetric(sharedEquipmentMetric(requestedMetric), category)
        : "kills";
      replaceHashAndRender(hashRoute("board/equipment", {
        equipment: button.dataset.equipment,
        metric: metric === "kills" ? null : metric,
        ...viewRangeParams()
      }));
    });
  }
}

function wireEquipmentMetricTabs() {
  for (const button of app.querySelectorAll("[data-equipment-metric]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      replaceHashAndRender(hashRoute("board/equipment", {
        equipment: button.dataset.equipmentTarget,
        metric: button.dataset.equipmentMetric === "kills" ? null : button.dataset.equipmentMetric,
        ...viewRangeParams()
      }));
    });
  }
}

function wireStatTabs(onSelect) {
  for (const button of app.querySelectorAll(".stat-tabs button[data-stat]")) {
    button.addEventListener("click", () => {
      const href = button.dataset.href;
      if (href) {
        // Same in-place swap the equipment buttons use. Assigning location.hash
        // scrolls back to the top, which throws the panel out from under the
        // pointer when the panel is what you were clicking in.
        replaceHashAndRender(href);
      } else {
        onSelect?.(button.dataset.stat);
      }
    });
  }
}

function cachedMarkerHtml() {
  return `<span class="cached-marker" role="img" aria-label="Cached stats" title="Cached stats">◷</span>`;
}

function backfillMarkerHtml() {
  return `<span class="cached-marker" role="img" aria-label="Tracker-backfilled history displayed" title="Tracker-backfilled history displayed">◷</span>`;
}

function cachedFootnoteHtml(hasCachedStats) {
  return hasCachedStats
    ? `<p class="cached-footnote">${cachedMarkerHtml()} Cached stats are from the last successful GameTools refresh.</p>`
    : "";
}

const CHART_COLORS = ["#f26522", "#60a5fa", "#4ade80", "#c084fc", "#facc15", "#22d3ee", "#fb7185", "#a3e635"];

function chartBase() {
  Chart.defaults.color = "#a4acb4";
  Chart.defaults.borderColor = "rgba(42, 48, 56, 0.6)";
  Chart.defaults.font.family = "'Inter', 'Segoe UI', sans-serif";
}

// Soft glow behind overtake points, drawn as a plugin so it stays out of the
// legend and index-mode tooltips and is never clipped at the chart edge.
const overtakeHaloPlugin = {
  id: "overtakeHalo",
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!dataset.overtakes || !chart.isDatasetVisible(datasetIndex)) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      dataset.overtakes.forEach((flag, pointIndex) => {
        if (!flag) return;
        const element = meta.data[pointIndex];
        if (!element || element.skip) return;
        ctx.save();
        ctx.fillStyle = dataset.borderColor;
        ctx.strokeStyle = dataset.borderColor;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(element.x, element.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      });
    });
  }
};

function lineChart(canvas, labels, datasets, stat, options = {}) {
  if (!globalThis.Chart || !canvas) return null;
  chartBase();
  const lastIndex = labels.length - 1;
  const todayInProgress =
    lastIndex > 0 && labels[lastIndex] === easternDateKey(new Date().toISOString());
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((dataset, index) => {
        const color = CHART_COLORS[index % CHART_COLORS.length];
        const baseRadius = labels.length > 45 ? 0 : 2.5;
        const overtakes = dataset.overtakes;
        const pointColorAt = (pointIndex) => (dataset.estimated?.[pointIndex] ? "#facc15" : color);
        return {
          ...dataset,
          data: stat.key === "playerRank"
            ? dataset.data.map(value => Number.isFinite(value) && value > 0 ? value : null)
            : dataset.data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          // Edge values sit exactly on the top gridline; without this the
          // overtake halo's host point gets shaved off by the chart area.
          clip: false,
          // Overtake days grow slightly; the glow itself comes from
          // overtakeHaloPlugin. Today-in-progress keeps a visible point even
          // on dense charts so its hollow marker can read.
          pointRadius: labels.map((_, pointIndex) =>
            overtakes?.[pointIndex]
              ? 3.5
              : todayInProgress && pointIndex === lastIndex
                ? Math.max(baseRadius, 3)
                : baseRadius
          ),
          pointHoverRadius: labels.map((_, pointIndex) => (overtakes?.[pointIndex] ? 5.5 : 4)),
          // A hollow final point marks today's still-updating value.
          pointBackgroundColor: labels.map((_, pointIndex) =>
            todayInProgress && pointIndex === lastIndex ? "#151b20" : pointColorAt(pointIndex)
          ),
          pointBorderColor: labels.map((_, pointIndex) => pointColorAt(pointIndex)),
          pointBorderWidth: labels.map((_, pointIndex) =>
            todayInProgress && pointIndex === lastIndex ? 1.5 : 1
          ),
          segment: {
            borderColor: (ctx) => dataset.estimated?.[ctx.p0DataIndex] || dataset.estimated?.[ctx.p1DataIndex]
              ? "#facc15"
              : color,
            borderDash: (ctx) =>
              stat.key === "playerRank" && (ctx.p0.skip || ctx.p1.skip || ctx.p1DataIndex > ctx.p0DataIndex + 1)
                ? [2, 4]
                : todayInProgress && ctx.p1DataIndex === lastIndex ? [5, 4] : undefined
          },
          spanGaps: true,
          // Monotone cubic interpolation softens corners without overshooting
          // the observed values; equal adjacent points remain truly flat.
          cubicInterpolationMode: "monotone",
          tension: 0.22
        };
      })
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: {
          // Keep the tooltip clear of the hovered points instead of sitting
          // on top of them (it flips to the other side near the chart edge).
          caretPadding: 24,
          ...(options.itemSort ? { itemSort: options.itemSort } : {}),
          callbacks: {
            afterTitle: (items) =>
              todayInProgress && items[0]?.dataIndex === lastIndex ? "today · in progress" : "",
            label: (ctx) => `${ctx.dataset.label}${ctx.dataset.estimated?.[ctx.dataIndex] ? " (estimated)" : ""}: ${fmtStat(stat, ctx.parsed.y)}${ctx.dataset.overtakes?.[ctx.dataIndex] ? " · overtake" : ""}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { ticks: { callback: (value) => fmtStat(stat, value) } }
      }
    },
    plugins: [overtakeHaloPlugin]
  });
  charts.push(chart);
  return chart;
}

/* ---------- views ---------- */

const leaderboardSortState = { context: null, key: "rank", direction: "asc", defaultKey: "rank", defaultDirection: "asc" };
const effectivenessSortState = { context: null, key: "rank", direction: "asc", defaultKey: "rank", defaultDirection: "asc" };

function resetSortState(sortState) {
  sortState.key = sortState.defaultKey;
  sortState.direction = sortState.defaultDirection;
}

function prepareSortState(sortState, context) {
  if (sortState.context !== context) {
    sortState.context = context;
    resetSortState(sortState);
  }
}

function advanceSortState(sortState, key) {
  if (sortState.key !== key) {
    sortState.key = key;
    sortState.direction = "desc";
  } else if (key === sortState.defaultKey) {
    sortState.direction = sortState.direction === "desc" ? "asc" : "desc";
  } else if (sortState.direction === "desc") {
    sortState.direction = "asc";
  } else {
    resetSortState(sortState);
  }
}

function sortableHeaderHtml(label, key, sortState, { numeric = false } = {}) {
  const direction = sortState.key === key ? sortState.direction : null;
  const nextAction = key === sortState.defaultKey
    ? direction === "desc" ? "ascending" : "descending"
    : direction === "desc" ? "ascending" : direction === "asc" ? "unsorted" : "descending";
  const indicator = direction === "desc" ? "&#9660;" : direction === "asc" ? "&#9650;" : "&#8645;";
  return `<th class="sortable-column${numeric ? " num" : ""}" aria-sort="${direction === "desc" ? "descending" : direction === "asc" ? "ascending" : "none"}"><button class="sort-button" type="button" data-sort-key="${key}" aria-label="Sort ${esc(label)} ${nextAction}"><span>${esc(label)}</span><span class="sort-indicator" aria-hidden="true">${indicator}</span></button></th>`;
}

function sortedRows(rows, sortState, valueFor) {
  if (!sortState.key || !sortState.direction) {
    return rows;
  }
  return [...rows].sort((a, b) => {
    const aValue = valueFor(a, sortState.key);
    const bValue = valueFor(b, sortState.key);
    const aMissing = aValue === null || aValue === undefined || (typeof aValue === "number" && !Number.isFinite(aValue));
    const bMissing = bValue === null || bValue === undefined || (typeof bValue === "number" && !Number.isFinite(bValue));
    if (aMissing !== bMissing) {
      return aMissing ? 1 : -1;
    }
    let comparison = 0;
    if (!aMissing) {
      comparison = typeof aValue === "string"
        ? aValue.localeCompare(String(bValue), undefined, { sensitivity: "base", numeric: true })
        : aValue - bValue;
    }
    if (comparison !== 0) {
      return sortState.direction === "desc" ? -comparison : comparison;
    }
    return a.originalRank - b.originalRank;
  });
}

function wireSortableHeaders(sortState) {
  for (const button of app.querySelectorAll(".sort-button[data-sort-key]")) {
    button.addEventListener("click", () => {
      advanceSortState(sortState, button.dataset.sortKey);
      replaceHashAndRender(location.hash);
    });
  }
}

function leaderboardHrefFor(statKey) {
  return (params) => hashRoute(`board/${statKey}`, params);
}

function activeTimeText(activeSeconds) {
  if (!Number.isFinite(activeSeconds)) {
    return "—";
  }
  const minutes = Math.round(activeSeconds / 60);
  return minutes < 90 ? `${minutes} min` : `${(activeSeconds / 3600).toFixed(1)}h`;
}

function renderPeriodLeaderboard(stat, window) {
  prepareSortState(leaderboardSortState, `period:${stat.key}:${window.startDate}:${window.endDate}`);
  const { ranked, provisional, invalid } = periodRanking(state.counters, stat.key, window);
  // Active-playtime floor to rank scales with the range length (15 min/day).
  const floorMin = Math.round(minActiveSecondsForWindow(window) / 60);

  const podium = ranked.slice(0, 3);
  const podiumHtml = podium.length
    ? `<div class="podium">${podium
        .map(
          (row, index) => `<div class="podium-card p${index + 1}">
            <div class="podium-rank">#${index + 1}${index === 0 ? " · TOP DOG" : ""}</div>
            <div class="podium-name"><a class="player-link" href="${playerHref(row.discordId, stat.key)}">${esc(memberName(row.discordId))}</a></div>
            <div class="podium-value">${fmtStat(stat, row.value)} <span class="podium-stat-label">${esc(stat.title)}</span></div>
            <div class="podium-delta">${esc(activeTimeText(row.activeSeconds))} played this period</div>
          </div>`
        )
        .join("")}</div>`
    : "";

  const allRows = [
    ...ranked.map((row) => ({ ...row, provisionalRow: false, originalRank: row.rank })),
    ...provisional.map((row, index) => ({ ...row, provisionalRow: true, originalRank: ranked.length + index + 1 }))
  ];
  const sortedRanking = sortedRows(allRows, leaderboardSortState, (row, key) => ({
    rank: row.originalRank,
    player: memberName(row.discordId),
    value: row.value,
    time: row.activeSeconds
  })[key]);
  // Members with no derivable stats in this range (didn't play, or not yet
  // tracked) still appear at the bottom with null values, like Time Machine.
  const shownIds = new Set(allRows.map((row) => row.discordId));
  const invalidIds = new Set(invalid.map((row) => row.discordId));
  const missingRows = state.latest.members
    .map((member) => member.discordId)
    .filter((discordId) => !shownIds.has(discordId) && !invalidIds.has(discordId))
    .map((discordId) => ({ discordId, trackedSince: memberTrackedSince(discordId) }))
    .sort((a, b) =>
      String(a.trackedSince ?? "9999-99-99").localeCompare(String(b.trackedSince ?? "9999-99-99"))
      || memberName(a.discordId).localeCompare(memberName(b.discordId), undefined, { sensitivity: "base", numeric: true })
    );
  const bodyRows = sortedRanking
    .map((row) => {
      const spark = memberDailySeries(state.counters, row.discordId, stat.key, window).map((point) => point.value);
      const carried = row.provenance?.startCarried || row.provenance?.endCarried;
      return `<tr class="${row.provisionalRow ? "period-provisional" : `r${row.originalRank}`}${isFavorite(row.discordId) ? " fav-row" : ""}">
        <td class="rank-cell">${row.provisionalRow ? "–" : row.originalRank}</td>
        <td><a class="player-link" href="${playerHref(row.discordId, stat.key)}">${esc(memberName(row.discordId))}</a>${favoriteBadgeHtml(row.discordId)}${
          row.provisionalRow
            ? ` <span class="badge provisional" title="Under ${floorMin} active minutes in this range — too small a sample to rank">low time</span>`
            : ""
        }${trackedSinceBadgeHtml(window, row.trackedSince)}${
          carried ? ` <span class="cached-marker" role="img" aria-label="Endpoint carried from an earlier snapshot" title="One endpoint was carried from this member's most recent earlier snapshot (they were missing from a refresh)">◷</span>` : ""
        }</td>
        <td class="num value-cell">${fmtStat(stat, row.value)}</td>
        <td class="num">${esc(activeTimeText(row.activeSeconds))}</td>
        <td>${sparklineSvg(spark)}</td>
      </tr>`;
    })
    .join("");
  const missingRowsHtml = missingRows
    .map((row) => `<tr class="time-machine-unranked${isFavorite(row.discordId) ? " fav-row" : ""}">
        <td class="rank-cell">—</td>
        <td><a class="player-link" href="${playerHref(row.discordId, stat.key)}">${esc(memberName(row.discordId))}</a>${favoriteBadgeHtml(row.discordId)} <span class="badge provisional" title="No gameplay recorded in this range">no play</span></td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td></td>
      </tr>`)
    .join("");

  const invalidNote = invalid.length
    ? `<p class="cached-footnote">Not shown (counter reset or upstream correction in this range): ${invalid
        .map((row) => esc(memberName(row.discordId)))
        .join(", ")}.</p>`
    : "";

  app.innerHTML = `
    <h1 class="page-title">${esc(stat.title)} Leaderboard <span class="period-title-tag">${esc(periodWindowText(window))}</span></h1>
    <p class="page-sub">Stats earned during this range only, from daily snapshot differences · rates need ${floorMin}+ active minutes to rank · daily trend per player</p>
    <section class="ranking-toolbar" aria-label="Ranking filters">
      ${viewRangeControlHtml()}
      ${rankingControlsHtml(stat.key)}
    </section>
    ${podiumHtml}
    <div class="table-wrap">
      <table>
        <thead><tr>${sortableHeaderHtml("#", "rank", leaderboardSortState)}${sortableHeaderHtml("Player", "player", leaderboardSortState)}${sortableHeaderHtml(stat.title, "value", leaderboardSortState, { numeric: true })}${sortableHeaderHtml("Active Time", "time", leaderboardSortState, { numeric: true })}<th>Daily trend</th></tr></thead>
        <tbody>${bodyRows}${missingRowsHtml}${bodyRows || missingRowsHtml ? "" : `<tr><td colspan="5" class="empty">No gameplay recorded in this range.</td></tr>`}</tbody>
      </table>
    </div>
    ${invalidNote}`;
  wireViewRangeControl(leaderboardHrefFor(stat.key));
  wireStatTabs();
  wireEquipmentChips();
  // The panel is the same control on every board, so its stat buttons have to
  // work here too -- they were only wired on the equipment board, which left
  // them inert on the soldier-stat boards.
  wireEquipmentMetricTabs();
  wirePanelState();
  wireSortableHeaders(leaderboardSortState);
}

// Weapons grouped by class, alphabetical within each group; vehicles in the
// catalogue's published class order. Both are rendered as buttons rather than a
// dropdown: the whole point of the panel is seeing what exists, and a <select>
// hides the grouping that makes 60-odd weapons navigable.
// `source` narrows the buttons to one member's own equipment file: a profile
// should only offer what that player has actually used, while the leaderboard
// offers everything the catalogue and index know about.
function equipmentGroups(source = null) {
  const catalogue = equipmentCatalogue();
  const seen = { weapons: new Set(), vehicles: new Set() };
  for (const category of ["weapons", "vehicles"]) {
    if (source) {
      for (const id of Object.keys(source?.[category] ?? {})) seen[category].add(id);
      continue;
    }
    for (const id of Object.keys(catalogue?.[category] ?? {})) seen[category].add(id);
    for (const member of Object.values(state.equipmentIndex?.members ?? {})) {
      for (const id of Object.keys(member?.[category] ?? {})) seen[category].add(id);
    }
  }

  const byClass = new Map();
  for (const id of seen.weapons) {
    const classId = equipmentCatalogue()?.weapons?.[id]?.class ?? weaponClassId(id);
    if (!byClass.has(classId)) byClass.set(classId, []);
    byClass.get(classId).push(id);
  }
  const classOrder = Object.keys(catalogue?.classes ?? EQUIPMENT_CLASS_FALLBACKS);
  const weapons = classOrder
    .filter((classId) => byClass.has(classId))
    .map((classId) => ({
      key: classId,
      label: weaponClassLabel(classId),
      items: byClass.get(classId).sort((a, b) =>
        equipmentDisplayName("weapons", a).localeCompare(equipmentDisplayName("weapons", b), undefined, { sensitivity: "base", numeric: true }))
    }));

  // Vehicle classes keep their published order; an unpublished one still shows
  // rather than vanishing, so a content drop is visible instead of silent.
  const vehicleOrder = Array.isArray(catalogue?.vehicleOrder) ? catalogue.vehicleOrder : [];
  // Every real class stays visible even when unused -- an empty leaderboard is
  // still a target to race for. `unclassified` is the exception: it exists only
  // to catch vehicles a content drop added before the class map caught up, so
  // showing it empty just advertises an internal bucket.
  const hasData = (id) => (source
    ? Boolean(source.vehicles?.[id])
    : Object.values(state.equipmentIndex?.members ?? {}).some((member) => member?.vehicles?.[id]));
  const orderedVehicles = [...vehicleOrder, ...[...seen.vehicles].filter((id) => !vehicleOrder.includes(id))]
    .filter((id) => seen.vehicles.has(id))
    .filter((id) => id !== "unclassified" || hasData(id));

  const domains = Array.isArray(catalogue?.vehicleDomains) && catalogue.vehicleDomains.length
    ? catalogue.vehicleDomains
    : VEHICLE_DOMAIN_FALLBACKS;
  const byDomain = new Map(domains.map((domain) => [domain.key, []]));
  const undomained = [];
  for (const id of orderedVehicles) {
    const domain = catalogue?.vehicles?.[id]?.domain;
    if (domain && byDomain.has(domain)) byDomain.get(domain).push(id);
    else undomained.push(id);
  }
  const vehicles = domains
    .map((domain) => ({ key: domain.key, label: domain.label, items: byDomain.get(domain.key) ?? [] }))
    .filter((group) => group.items.length)
    // A class with no domain (the internal catch-all, or one added before the
    // site learned its domain) still has to be reachable.
    .concat(undomained.length ? [{ key: "other", label: "Other", items: undomained }] : []);

  return { weapons, vehicles };
}

// Time Played is one button over two differently named fields, so the panel
// reasons in shared names and only resolves to a real field once a category is
// known. Every other metric is its own shared name.
const EQUIPMENT_SHARED_METRICS = ["kills", "assists", "kpm", "timePlayed", "accuracy", "hsPercent", "vehiclesDestroyed", "roadKills"];

// Which categories a stat can be read for. Accuracy and Headshot % are weapon
// readings; Vehicles Destroyed, Assists and Roadkills are vehicle readings --
// GameTools publishes no per-weapon assists counter at all.
const EQUIPMENT_METRIC_CATEGORIES = {
  accuracy: ["weapons"],
  hsPercent: ["weapons"],
  vehiclesDestroyed: ["vehicles"],
  assists: ["vehicles"],
  roadKills: ["vehicles"]
};

function sharedEquipmentMetric(metric) {
  return metric === "timeEquipped" || metric === "timeIn" ? "timePlayed" : metric;
}

function resolvedEquipmentMetric(sharedMetric, category) {
  return sharedMetric === "timePlayed" ? (category === "vehicles" ? "timeIn" : "timeEquipped") : sharedMetric;
}

function equipmentMetricCategories(metric) {
  return EQUIPMENT_METRIC_CATEGORIES[sharedEquipmentMetric(metric)] ?? ["weapons", "vehicles"];
}

function equipmentMetricAppliesTo(metric, category) {
  return equipmentMetricCategories(metric).includes(category);
}

// `unavailable` greys the chip without disabling it, the same bargain the stat
// tabs strike: the stat on screen cannot be read for this half of the panel, but
// the chip is still the way to get to that item. Blocking the click meant
// picking a vehicle from a weapon-only stat took two moves through a stat you
// did not want, so the click is allowed and it takes the stat back to Kills.
function equipmentButtonHtml(category, id, selectedId, unavailable = false) {
  const title = unavailable
    ? `Not recorded for ${category === "vehicles" ? "vehicles" : "weapons"} — opens this ${category === "vehicles" ? "vehicle" : "weapon"} on Kills`
    : category === "vehicles"
      ? (equipmentCatalogue()?.vehicles?.[id]?.vehicles ?? []).join(", ")
      : weaponClassLabel(equipmentCatalogue()?.weapons?.[id]?.class ?? weaponClassId(id));
  return `<button type="button" class="equipment-chip${id === selectedId ? " active" : ""}${unavailable ? " unavailable" : ""}" data-equipment="${esc(id)}" data-equipment-category="${esc(category)}"${title ? ` title="${esc(title)}"` : ""}>${esc(equipmentDisplayName(category, id))}</button>`;
}

// The stat is pickable first and the item second: a metric button is never
// truly disabled over what happens to be selected, because that made the two
// halves of the panel argue -- the selection blocked the stat and the stat
// blocked the selection, with no way out of either. A stat the current
// selection cannot report is greyed to say so and still clickable; taking it
// drops that selection, which is the only honest thing it could do.
function equipmentMetricTabsHtml(selectedCategory, activeMetric, selectedId, firstWeapon, firstVehicle) {
  const activeShared = sharedEquipmentMetric(activeMetric);
  return `<div class="stat-tabs equipment-panel-metrics" role="group" aria-label="Weapon and vehicle leaderboard stat">${EQUIPMENT_SHARED_METRICS
    .map((sharedMetric) => {
      const categories = equipmentMetricCategories(sharedMetric);
      const applies = !selectedCategory || categories.includes(selectedCategory);
      const targetCategory = applies && selectedCategory ? selectedCategory : categories[0];
      const metric = resolvedEquipmentMetric(sharedMetric, targetCategory);
      const targetId = applies && selectedCategory
        ? selectedId
        : (targetCategory === "vehicles" ? firstVehicle : firstWeapon);
      const active = sharedMetric === activeShared;
      const label = EQUIPMENT_METRIC_LABELS[metric];
      const title = applies ? "" : ` title="Not recorded for ${selectedCategory === "vehicles" ? "vehicles" : "weapons"}"`;
      return `<button type="button" class="${active ? "active" : ""}${applies ? "" : " unavailable"}" data-equipment-metric="${esc(metric)}" data-equipment-target="${esc(targetId)}"${title}>${esc(label)}</button>`;
    })
    .join("")}</div>`;
}

function equipmentBandHtml(category, rows) {
  const title = category === "weapons" ? "Weapons" : "Vehicles";
  const id = `panel-equipment-${category}`;
  return `<details class="equipment-band" id="${id}"${panelIsOpen(id, true) ? " open" : ""}>
    <summary class="equipment-band-head">
      <h3>${title}</h3>
      <span class="panel-toggle" aria-hidden="true"></span>
    </summary>
    <div class="equipment-band-body">${rows}</div>
  </details>`;
}

// `selectedMetric` null means no stat is picked yet, which is not the same as
// Kills: the soldier-stat boards and the players list mount this panel purely as
// a way in, so nothing there is highlighted until the user picks something.
function equipmentPanelHtml(selectedId, selectedMetric = null, source = null) {
  const groups = equipmentGroups(source);
  if (!groups.weapons.length && !groups.vehicles.length) return "";
  const selectedCategory = groups.weapons.some((group) => group.items.includes(selectedId))
    ? "weapons"
    : groups.vehicles.some((group) => group.items.includes(selectedId))
      ? "vehicles"
      : null;
  // An item that cannot report the selected stat is greyed rather than hidden:
  // it still shows what exists, and the greying says why this stat is not the
  // one you will land on.
  const weaponsUnavailable = !equipmentMetricAppliesTo(selectedMetric, "weapons");
  const vehiclesUnavailable = !equipmentMetricAppliesTo(selectedMetric, "vehicles");
  const weaponRows = groups.weapons
    .map((group) => `<div class="equipment-class"><h4>${esc(group.label)}</h4><div class="equipment-chips">${group.items.map((id) => equipmentButtonHtml("weapons", id, selectedId, weaponsUnavailable)).join("")}</div></div>`)
    .join("");
  const vehicleRows = groups.vehicles
    .map((group) => `<div class="equipment-class"><h4>${esc(group.label)}</h4><div class="equipment-chips">${group.items.map((id) => equipmentButtonHtml("vehicles", id, selectedId, vehiclesUnavailable)).join("")}</div></div>`)
    .join("");
  const firstWeapon = groups.weapons[0]?.items[0] ?? "";
  const firstVehicle = groups.vehicles[0]?.items[0] ?? "";
  const metricTabs = equipmentMetricTabsHtml(selectedCategory, selectedMetric, selectedId, firstWeapon, firstVehicle);
  return `${metricTabs}${weaponRows ? equipmentBandHtml("weapons", weaponRows) : ""}${vehicleRows ? equipmentBandHtml("vehicles", vehicleRows) : ""}`;
}

function equipmentIndexHasField(category, field) {
  return equipmentFieldsPresent(state.equipmentIndex, category).has(field);
}

function equipmentMetricRequiredFields(category, metric) {
  if (metric === "kpm") return ["kills", category === "weapons" ? "timeEquipped" : "timeIn"];
  if (metric === "accuracy") return ["shotsHit", "shotsFired"];
  if (metric === "hsPercent") return ["headshotKills", "kills"];
  if (metric === "vehiclesDestroyed") return ["vehiclesDestroyedWith"];
  return [metric];
}

function equipmentMetricAvailable(category, metric) {
  return equipmentMetricRequiredFields(category, metric).every((field) => equipmentIndexHasField(category, field));
}

function equipmentObservedIndexes(selectedId, category) {
  const indexes = new Set();
  for (const member of Object.values(state.equipmentIndex?.members ?? {})) {
    if (!member?.[category]?.[selectedId]) continue;
    for (const index of member.observed ?? []) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

function equipmentStatsAt(entry, member, category, index) {
  return equipmentCareerStats(
    entry,
    category,
    index,
    member.observed,
    state.equipmentIndex.dates,
    state.equipmentIndex.fieldTrackingStarts
  );
}

function equipmentTrend(entry, member, category, metric, indexes, periodStartIndex = null) {
  return indexes.map((index) => {
    const stats = periodStartIndex === null
      ? equipmentStatsAt(entry, member, category, index)
      : equipmentPeriodStats(
          entry,
          category,
          periodStartIndex,
          index,
          state.equipmentIndex.dates,
          member.observed,
          state.equipmentIndex.fieldTrackingStarts
        );
    return equipmentMetricValue(stats, metric);
  });
}

// The latest start among the fields this metric is built from: a rate begins
// where its later half begins, not where its earlier half does.
function equipmentCoverageStart(stats, category, metric) {
  return equipmentMetricRequiredFields(category, metric)
    .map((field) => (stats.fields?.[field]?.known ? stats.fields[field].startDate : null))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

// Time on the item, plus the date that reading starts from when it covers less
// of the range than the value beside it. Equipped time has been recorded since
// Aug 10 and kills for far longer, so on a long window the two genuinely
// describe different spans -- but withholding the figure would empty the column
// on every All Time view forever, so it is shown and dated instead.
function equipmentActiveTime(stats, category, metric) {
  const timeField = category === "vehicles" ? "timeIn" : "timeEquipped";
  const time = stats.fields?.[timeField];
  if (!time?.known) return { seconds: null, since: null };
  const valueStart = equipmentCoverageStart(stats, category, metric);
  return {
    seconds: stats.timeSeconds,
    since: time.startDate && time.startDate !== valueStart ? time.startDate : null
  };
}

// Gold, against the blue of the player's own tracked-since badge, and sitting
// next to it in the player cell: one dates the stat, the other the play time
// behind it, and a row can carry both.
function equipmentTimeSinceBadgeHtml(since, category) {
  if (!since) return "";
  const noun = category === "vehicles" ? "Time in this vehicle" : "Time on this weapon";
  return ` <span class="badge time-since" title="${esc(noun)} has only been recorded since ${esc(fmtShortDate(since))}, so the Active Time total covers that part of the range while the figure beside it covers all of it">time${COVERAGE_MARK_SVG}${esc(fmtBadgeDate(since))}</span>`;
}

function equipmentLeaderboardRows(selectedId, category, metric, periodWindow, usePeriod, careerWindow) {
  const comparisonIndexes = usePeriod
    ? Array.from({ length: periodWindow.endIndex - periodWindow.startIndex + 1 }, (_, offset) => periodWindow.startIndex + offset)
    : (careerWindow?.indexes ?? []);
  const comparisonStart = comparisonIndexes[0] ?? null;
  const comparisonEnd = comparisonIndexes.at(-1) ?? null;
  const rows = Object.entries(state.equipmentIndex?.members ?? {})
    .map(([discordId, member]) => {
      const entry = member?.[category]?.[selectedId];
      if (!entry) return null;
      const stats = usePeriod
        ? equipmentPeriodStats(entry, category, periodWindow.startIndex, periodWindow.endIndex, state.equipmentIndex.dates, member.observed, state.equipmentIndex.fieldTrackingStarts)
        : equipmentStatsAt(entry, member, category, latestObservedIndex(member.observed));
      const value = equipmentMetricValue(stats, metric);
      const startStats = comparisonStart === null ? null : equipmentStatsAt(entry, member, category, comparisonStart);
      const endStats = comparisonEnd === null ? null : equipmentStatsAt(entry, member, category, comparisonEnd);
      const startValue = startStats ? equipmentMetricValue(startStats, metric) : null;
      const endValue = endStats ? equipmentMetricValue(endStats, metric) : null;
      const change = Number.isFinite(startValue) && Number.isFinite(endValue) ? endValue - startValue : null;
      const activeTime = usePeriod ? equipmentActiveTime(stats, category, metric) : { seconds: null, since: null };
      return {
        discordId,
        name: member.name ?? memberName(discordId),
        value,
        change,
        // Rows on one board can cover different spans — a metric that started
        // being recorded mid-window, or a member linked after it began — so each
        // row carries the date its own figure starts from.
        coverageStart: usePeriod ? equipmentCoverageStart(stats, category, metric) : null,
        // How long this item was actually carried in the window. Career keeps
        // showing movement instead: over a window, the change and the value are
        // the same subtraction, so a Change column would just print the figure
        // beside itself.
        //
        // `activeSince` is set when that time covers less of the range than the
        // value does, which its own badge then says out loud.
        activeSeconds: activeTime.seconds,
        activeSince: activeTime.since,
        trend: equipmentTrend(entry, member, category, metric, comparisonIndexes, usePeriod ? comparisonStart : null)
      };
    })
    .filter((row) => row && Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  return rows.map((row, index) => ({ ...row, originalRank: index + 1 }));
}

function equipmentDeltaText(metric, value) {
  if (!Number.isFinite(value) || value === 0) return "–";
  return `${value > 0 ? "+" : "−"}${equipmentValueText(metric, Math.abs(value))}`;
}

// Career cards carry movement against the comparison window. Period cards carry
// time on the item instead, the same way the soldier Period podium reads: the
// window's change is its value, so printing both says one thing twice.
function equipmentPodiumHtml(rows, metric, windowText, usePeriod = false, category = "weapons", equipmentName = "") {
  return rows.length
    ? `<div class="podium">${rows.slice(0, 3).map((row, index) => {
        const delta = equipmentDeltaText(metric, row.change);
        const deltaClass = Number.isFinite(row.change) ? (row.change > 0 ? "up" : row.change < 0 ? "down" : "flat") : "";
        const footer = usePeriod
          ? `${esc(activeTimeText(row.activeSeconds))} on this ${category === "vehicles" ? "vehicle" : "weapon"} this period`
          : delta !== "–"
            ? `<span class="podium-delta-value ${deltaClass}">${delta}</span> <span class="podium-delta-context">vs ${esc(windowText)}</span>`
            : "&nbsp;";
        return `<div class="podium-card p${index + 1}">
          <div class="podium-rank">#${index + 1}${index === 0 ? " · TOP DOG" : ""}</div>
          <div class="podium-name"><a class="player-link" href="${playerHref(row.discordId)}">${esc(row.name)}</a></div>
          <div class="podium-value">${equipmentValueText(metric, row.value)} <span class="podium-stat-label">${esc(`${equipmentName} ${EQUIPMENT_METRIC_LABELS[metric]}`.trim())}</span></div>
          <div class="podium-delta">${footer}</div>
        </div>`;
      }).join("")}</div>`
    : "";
}

function renderEquipmentLeaderboard(params) {
  loadViewRange(params);
  const groups = equipmentGroups();
  const allItems = groups.weapons.flatMap((group) => group.items.map((id) => ({ id, category: "weapons" })))
    .concat(groups.vehicles.flatMap((group) => group.items.map((id) => ({ id, category: "vehicles" }))));
  const selected = allItems.find((item) => item.id === params.get("equipment")) ?? allItems[0] ?? null;
  const requestedMetric = params.get("metric") ?? "kills";
  const metric = selected && equipmentMetricFields(selected.category).includes(requestedMetric) ? requestedMetric : "kills";
  const artifactReady = validEquipmentArtifact(state.equipmentIndex);
  const metricReady = Boolean(artifactReady && selected && equipmentMetricAvailable(selected.category, metric));
  const periodWindow = activePeriodWindow();
  const periodMatches = Boolean(periodWindow && state.equipmentIndex?.dates[periodWindow.startIndex] === periodWindow.startDate && state.equipmentIndex?.dates[periodWindow.endIndex] === periodWindow.endDate);
  const usePeriod = Boolean(selected && periodMatches && metricReady);
  const observedIndexes = selected ? equipmentObservedIndexes(selected.id, selected.category) : [];
  const resolvedCareerWindow = selected ? resolveCareerWindow(state.equipmentIndex?.dates ?? [], observedIndexes, viewRangeState.range, viewRangeState.custom) : null;
  const careerWindow = resolvedCareerWindow?.unavailable ? null : resolvedCareerWindow;
  const rows = selected ? equipmentLeaderboardRows(selected.id, selected.category, metric, periodWindow, usePeriod, careerWindow) : [];
  const rankedIds = new Set(rows.map((row) => row.discordId));
  const missingRows = state.latest.members
    .filter((member) => !rankedIds.has(member.discordId))
    .sort((a, b) => memberName(a.discordId).localeCompare(memberName(b.discordId), undefined, { sensitivity: "base", numeric: true }));
  const missingRowsHtml = missingRows.map((member) => `<tr class="time-machine-unranked${isFavorite(member.discordId) ? " fav-row" : ""}">
    <td class="rank-cell">—</td>
    <td><a class="player-link" href="${playerHref(member.discordId)}">${esc(memberName(member.discordId))}</a>${favoriteBadgeHtml(member.discordId)} <span class="badge provisional" title="No tracked stats for this equipment and metric in the selected view">no play</span></td>
    <td class="num">—</td><td class="num">—</td><td></td>
  </tr>`).join("");
  prepareSortState(leaderboardSortState, `equipment:${selected?.id ?? "none"}:${metric}:${usePeriod ? `period:${periodWindow?.startDate}:${periodWindow?.endDate}` : "career"}`);
  const sorted = sortedRows(rows, leaderboardSortState, (row, key) => ({
    rank: row.originalRank,
    player: row.name,
    value: row.value,
    change: row.change,
    time: row.activeSeconds
  })[key]);
  const periodNote = viewRangeState.view === "period"
    ? !periodWindow
      ? `<p class="period-unsupported-note" role="note">The selected Period range is not available yet — showing Career ${esc(EQUIPMENT_METRIC_LABELS[metric])}.</p>`
      : !periodMatches
        ? `<p class="period-unsupported-note" role="note">The selected Period range is not available in the equipment archive — showing Career ${esc(EQUIPMENT_METRIC_LABELS[metric])}.</p>`
        : selected && !metricReady
          ? `<p class="period-unsupported-note" role="note">This equipment item has no Period ${esc(EQUIPMENT_METRIC_LABELS[metric])} data — showing Career values.</p>`
          : ""
    : "";
  const artifactNote = !artifactReady
    ? `<p class="period-unsupported-note" role="note">Equipment data has not been published yet. This leaderboard is unavailable until the next equipment refresh.</p>`
    : !metricReady
      ? `<p class="period-unsupported-note" role="note">The equipment artifact has no usable ${esc(EQUIPMENT_METRIC_LABELS[metric])} data for this selection.</p>`
      : "";
  const body = (sorted.length
    ? sorted.map((row) => {
        const delta = equipmentDeltaText(metric, row.change);
        const deltaClass = Number.isFinite(row.change) ? (row.change > 0 ? "up" : row.change < 0 ? "down" : "flat") : "flat";
        const trailingCell = usePeriod
          ? `<td class="num">${esc(activeTimeText(row.activeSeconds))}</td>`
          : `<td class="num"><span class="delta ${deltaClass}">${delta}</span></td>`;
        return `<tr class="r${row.originalRank}${isFavorite(row.discordId) ? " fav-row" : ""}"><td class="rank-cell">${row.originalRank}</td><td><a class="player-link" href="${playerHref(row.discordId)}">${esc(row.name)}</a>${favoriteBadgeHtml(row.discordId)}${usePeriod ? `${trackedSinceBadgeHtml(periodWindow, row.coverageStart, EQUIPMENT_COVERAGE_BADGE_TITLE)}${equipmentTimeSinceBadgeHtml(row.activeSince, selected?.category)}` : ""}</td><td class="num value-cell">${equipmentValueText(metric, row.value)}</td>${trailingCell}<td>${sparklineSvg(row.trend)}</td></tr>`;
      }).join("")
    : missingRows.length ? "" : `<tr><td colspan="5" class="empty">No observed ${esc(EQUIPMENT_METRIC_LABELS[metric])} for this equipment item in the selected range.</td></tr>`) + missingRowsHtml;
  const equipmentName = selected ? equipmentDisplayName(selected.category, selected.id) : "Equipment";
  const heading = `${equipmentName} ${EQUIPMENT_METRIC_LABELS[metric]}`;
  const windowText = usePeriod ? periodWindowText(periodWindow) : careerRangeWindowText(careerWindow);
  app.innerHTML = `
    <h1 class="page-title">${esc(heading)} Leaderboard <span class="period-title-tag ${usePeriod ? "" : "career-title-tag"}">${esc(usePeriod ? periodWindowText(periodWindow) : careerRangeWindowText(careerWindow, { includeLabel: true }))}</span></h1>
    <p class="page-sub">${usePeriod ? "Stats earned during this range only, from daily snapshot differences · active time and daily trend per player" : "Current Career values · movement, deltas, and sparkline show change over " + esc(windowText)}</p>
    <section class="ranking-toolbar" aria-label="Ranking filters">
      ${viewRangeControlHtml()}
      ${rankingControlsHtml(null, selected?.category ?? "weapons", selected?.id, metric)}
    </section>
    ${artifactNote}${periodNote}
    ${equipmentPodiumHtml(rows, metric, windowText, usePeriod, selected?.category ?? "weapons", equipmentName)}
    ${selected ? `<div class="table-wrap equipment-leaderboard-table"><table><thead><tr>${sortableHeaderHtml("#", "rank", leaderboardSortState)}${sortableHeaderHtml("Player", "player", leaderboardSortState)}${sortableHeaderHtml(heading, "value", leaderboardSortState, { numeric: true })}${usePeriod ? sortableHeaderHtml("Active Time", "time", leaderboardSortState, { numeric: true }) : sortableHeaderHtml("Change", "change", leaderboardSortState, { numeric: true })}<th>${usePeriod ? "Daily trend" : "Trend"}</th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty">No weapon or vehicle records are available yet.</div>`}`;
  const equipmentHref = (rangeParams) => hashRoute("board/equipment", { equipment: selected?.id ?? null, metric: metric === "kills" ? null : metric, ...rangeParams });
  wireViewRangeControl(equipmentHref);
  wireStatTabs();
  wireEquipmentChips();
  wireEquipmentMetricTabs();
  wirePanelState();
  wireSortableHeaders(leaderboardSortState);
}

function renderLeaderboard(statKey, params) {
  if (statKey === "equipment") {
    renderEquipmentLeaderboard(params);
    return;
  }
  loadViewRange(params);
  const stat = statByKey(statKey) ?? state.meta.stats[0];
  const periodWindow = activePeriodWindow();
  if (periodWindow && statHasPeriodForm(stat.key)) {
    renderPeriodLeaderboard(stat, periodWindow);
    return;
  }
  const periodNotice =
    viewRangeState.view === "period" && !statHasPeriodForm(stat.key)
      ? `<div class="period-unsupported-note" role="note">${esc(periodUnsupportedNote(stat, "Career values"))}</div>`
      : viewRangeState.view === "period" && !periodWindow
        ? `<div class="period-unsupported-note" role="note">The selected range is not available yet — showing Career values.</div>`
        : "";
  const ranking = latestRanking(stat.key);
  prepareSortState(leaderboardSortState, stat.key);
  const memberIds = Object.keys(state.history.members ?? {});
  const authoritativeIndexes = authoritativeHistoryIndexes(stat.key, memberIds);
  const lastIndex = authoritativeIndexes.at(-1) ?? -1;
  // In Career view the range only drives the movement/delta baseline and the
  // sparkline window; the primary values stay lifetime Career values.
  const careerWindow = resolveCareerWindow(
    state.history.dates,
    authoritativeIndexes,
    viewRangeState.range,
    viewRangeState.custom
  );
  const sparkIndexes = careerWindow.unavailable ? authoritativeIndexes.slice(-2) : careerWindow.indexes;
  const sparkStart = sparkIndexes[0] ?? lastIndex;
  const comparisonEndIndex = sparkIndexes.at(-1) ?? lastIndex;
  const windowText = careerRangeWindowText(careerWindow);
  const podiumWindowText = careerRangeWindowText(careerWindow, { includeClamp: false });
  const baselineIndex = sparkStart;
  const prevRanking =
    baselineIndex >= 0 && baselineIndex < comparisonEndIndex
      ? authoritativeBaselineRankingAt(stat.key, baselineIndex, comparisonEndIndex, memberIds)
      : [];
  const endRanking = comparisonEndIndex === lastIndex
    ? ranking
    : authoritativeRankingAt(stat.key, comparisonEndIndex, memberIds);
  const prevRankById = new Map(prevRanking.map((row, index) => [row.discordId, index + 1]));
  const prevValueById = new Map(prevRanking.map((row) => [row.discordId, row.value]));
  const endRankById = new Map(endRanking.map((row, index) => [row.discordId, index + 1]));
  const endValueById = new Map(endRanking.map((row) => [row.discordId, row.value]));

  const podium = ranking.slice(0, 3);
  const podiumHtml = podium.length
    ? `<div class="podium">${podium
        .map((row, index) => {
          const deltaValue = (endValueById.get(row.discordId) ?? NaN) - (prevValueById.get(row.discordId) ?? NaN);
          const delta = fmtDelta(stat, deltaValue);
          const deltaClass = Number.isFinite(deltaValue) ? (deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "flat") : "";
          return `<div class="podium-card p${index + 1}">
            <div class="podium-rank">#${index + 1}${index === 0 ? " · TOP DOG" : ""}</div>
            <div class="podium-name"><a class="player-link" href="${playerHref(row.discordId, stat.key)}">${esc(memberName(row.discordId))}</a></div>
            <div class="podium-value">${fmtStat(stat, row.value)} <span class="podium-stat-label">${esc(stat.title)}</span></div>
            <div class="podium-delta">${delta ? `<span class="podium-delta-value ${deltaClass}">${delta}</span> <span class="podium-delta-context">vs ${podiumWindowText}</span>` : "&nbsp;"}</div>
          </div>`;
        })
        .join("")}</div>`
    : "";

  const sortableRanking = ranking.map((row, index) => {
    const rank = index + 1;
    const prevRank = prevRankById.get(row.discordId) ?? null;
    const prevValue = prevValueById.get(row.discordId);
    const endRank = endRankById.get(row.discordId) ?? null;
    const endValue = endValueById.get(row.discordId);
    return {
      ...row,
      originalRank: rank,
      movement: prevRank === null || endRank === null ? null : prevRank - endRank,
      change: Number.isFinite(prevValue) && Number.isFinite(endValue) ? endValue - prevValue : null
    };
  });
  const sortedRanking = sortedRows(sortableRanking, leaderboardSortState, (row, key) => ({
    rank: row.originalRank,
    movement: row.movement,
    player: memberName(row.discordId),
    value: row.value,
    change: row.change
  })[key]);
  const rows = sortedRanking
    .map((row) => {
      const rank = row.originalRank;
      const prevRank = prevRankById.get(row.discordId) ?? null;
      const prevValue = prevValueById.get(row.discordId);
      const endRank = endRankById.get(row.discordId) ?? null;
      const endValue = endValueById.get(row.discordId);
      const delta = fmtDelta(stat, (endValue ?? NaN) - (prevValue ?? NaN));
      const deltaClass = delta ? (endValue > prevValue ? "up" : "down") : "flat";
      const values = series(row.discordId, stat.key);
      const spark = sparkIndexes.map((historyIndex) =>
        historyProvenance(row.discordId, state.history.dates[historyIndex], stat.key) ? null : values[historyIndex]
      );
      const cached = row.member?.cachedStats ? cachedMarkerHtml() : "";
      return `<tr class="r${rank}${isFavorite(row.discordId) ? " fav-row" : ""}">
        <td class="rank-cell">${rank}</td>
        <td>${movementHtml(prevRank, endRank, windowText)}</td>
        <td><a class="player-link" href="${playerHref(row.discordId, stat.key)}">${esc(memberName(row.discordId))}</a>${favoriteBadgeHtml(row.discordId)}${cached}</td>
        <td class="num value-cell">${fmtStat(stat, row.value)}</td>
        <td class="num"><span class="delta ${deltaClass}">${delta ?? "–"}</span></td>
        <td>${sparklineSvg(spark)}</td>
      </tr>`;
    })
    .join("");

  app.innerHTML = `
    <h1 class="page-title">${esc(stat.title)} Leaderboard <span class="period-title-tag career-title-tag">${esc(careerRangeWindowText(careerWindow, { includeLabel: true }))}</span></h1>
    ${periodNotice}
    <p class="page-sub">Current Career values · movement, deltas, and sparkline show change over ${esc(windowText)}</p>
    <section class="ranking-toolbar" aria-label="Ranking filters">
      ${viewRangeControlHtml()}
      ${rankingControlsHtml(stat.key)}
    </section>
    ${podiumHtml}
    <div class="table-wrap">
      <table>
        <thead><tr>${sortableHeaderHtml("#", "rank", leaderboardSortState)}${sortableHeaderHtml("Δ", "movement", leaderboardSortState)}${sortableHeaderHtml("Player", "player", leaderboardSortState)}${sortableHeaderHtml(stat.title, "value", leaderboardSortState, { numeric: true })}${sortableHeaderHtml("Change", "change", leaderboardSortState, { numeric: true })}<th>Trend</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">No stats yet.</td></tr>`}</tbody>
      </table>
    </div>
    ${cachedFootnoteHtml(ranking.some((row) => row.member?.cachedStats))}`;
  wireViewRangeControl(leaderboardHrefFor(stat.key));
  wireStatTabs();
  wireEquipmentChips();
  // The panel is the same control on every board, so its stat buttons have to
  // work here too -- they were only wired on the equipment board, which left
  // them inert on the soldier-stat boards.
  wireEquipmentMetricTabs();
  wirePanelState();
  wireSortableHeaders(leaderboardSortState);
}

function renderPlayers(params) {
  loadViewRange(params);
  const periodWindow = activePeriodWindow();
  const careerWindow = periodWindow ? null : resolveCareerWindow(
    state.history.dates, authoritativeHistoryIndexes(), viewRangeState.range, viewRangeState.custom
  );
  const kd = statByKey("infantryKillDeath") ?? state.meta.stats[0];
  const playerKpm = statByKey("playerKillsPerMinute");
  const kills = statByKey("kills");
  const sorted = [...state.latest.members].sort((a, b) =>
    String(a.displayName ?? a.discordId).localeCompare(String(b.displayName ?? b.discordId), undefined, {
      sensitivity: "base",
      numeric: true
    })
  );
  const playerSearchText = (member) =>
    [member.displayName, member.discordUsername, member.eaName, member.profileName]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
  const cardStat = (member, stat) => {
    if (!periodWindow) {
      return { value: member.stats[stat.key], title: "" };
    }
    const period = memberPeriodStat(state.counters, member.discordId, stat.key, periodWindow);
    if (period.invalid) {
      const titles = {
        no_data: "No snapshot coverage for this member in this range",
        negative_delta: "Counter reset detected in this range",
        career_only: "Career-only stat"
      };
      return { value: null, title: titles[period.reason] ?? "Unavailable" };
    }
    return { value: period.value, title: period.value == null ? "No gameplay recorded in this range" : "" };
  };

  app.innerHTML = `
    <div class="players-toolbar">
      <div class="players-heading-row">
        <h1 class="page-title">Players <span class="period-title-tag ${periodWindow ? "" : "career-title-tag"}">${esc(periodWindow ? periodWindowText(periodWindow) : careerRangeWindowText(careerWindow, { includeLabel: true }))}</span></h1>
      <label class="player-search"><span class="sr-only">Search players</span><input id="player-search" type="search" placeholder="Search players" autocomplete="off"></label>
      </div>
      <p class="page-sub">${sorted.length} linked member(s) · click a player for full history · cards show ${periodWindow ? "selected Period" : "current Career"} stats</p>
    </div>
    ${viewRangeControlHtml()}
    <div class="player-grid">${sorted
      .map(
        (member) => `<a class="player-card ${isFavorite(member.discordId) ? "favorited" : ""}" data-player-search="${esc(playerSearchText(member))}" href="${playerHref(member.discordId, kd.key)}">
          <div class="player-card-name"><span title="${esc(member.displayName ?? member.discordId)}">${esc(member.displayName ?? member.discordId)}</span>${platformIconHtml(member.platform)}${
            member.cachedStats ? cachedMarkerHtml() : ""
          }</div>
          ${favoriteButtonHtml(member.discordId)}
          <div class="player-card-sub">${esc(member.profileName ?? member.eaName ?? "")}</div>
          <div class="player-card-stats">
            ${[[kd, kd.label], playerKpm ? [playerKpm, "Player KPM"] : null, kills ? [kills, kills.label] : null]
              .filter(Boolean)
              .map(([stat, label]) => {
                const card = cardStat(member, stat);
                return `<div class="mini-stat"${card.title ? ` title="${esc(card.title)}"` : ""}><div class="k">${esc(label.replace(/^Player /, ""))}</div><div class="v">${fmtStat(stat, card.value)}</div></div>`;
              })
              .join("")}
          </div>
        </a>`
      )
      .join("")}</div>
    <p id="player-search-empty" class="empty" hidden>No players match that search.</p>
    ${cachedFootnoteHtml(sorted.some((member) => member.cachedStats))}`;
  wireViewRangeControl((params) => hashRoute("players", params));
  wireFavoriteToggles();

  const search = document.getElementById("player-search");
  const empty = document.getElementById("player-search-empty");
  const cards = [...app.querySelectorAll(".player-card")];
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    const visibleCount = cards.reduce((total, card) => {
      const matches = !query || card.dataset.playerSearch.includes(query);
      card.hidden = !matches;
      return total + Number(matches);
    }, 0);
    empty.hidden = visibleCount > 0;
  });
}

function renderPlayer(discordId, statKey, params) {
  const member = state.latest.members.find((candidate) => candidate.discordId === discordId);
  const historyEntry = state.history.members?.[discordId];
  if (!member && !historyEntry) {
    app.innerHTML = `<div class="empty">Player not found. <a href="#/players">Back to players</a></div>`;
    return;
  }

  const name = member?.displayName ?? historyEntry?.name ?? discordId;
  const stat = statByKey(statKey) ?? state.meta.stats[0];
  const dates = state.history.dates;
  const lastIndex = dates.length - 1;
  const showEstimated = params?.get("estimated") === "1";
  const equipmentView = equipmentViewState(params);
  loadViewRange(params, "all");
  const periodWindow = activePeriodWindow();
  const backfillFields = memberBackfillFields(discordId);
  const playerHistoryIndexes = authoritativeHistoryIndexes(null, [discordId], { includeEstimated: showEstimated });
  const careerWindow = resolveCareerWindow(
    dates,
    playerHistoryIndexes,
    viewRangeState.range,
    viewRangeState.custom
  );
  const rangeStart = careerWindow.unavailable ? Math.max(0, lastIndex - 1) : careerWindow.startIndex;
  const rangeEnd = careerWindow.unavailable ? lastIndex : careerWindow.endIndex;

  const baselineForRange = (statKeyToRead) => {
    const values = series(discordId, statKeyToRead);
    for (let index = rangeStart; index < rangeEnd; index += 1) {
      const estimated = Boolean(historyProvenance(discordId, dates[index], statKeyToRead));
      if (Number.isFinite(values[index]) && (showEstimated || !estimated)) {
        return values[index];
      }
    }
    return null;
  };

  const endForRange = (statKeyToRead) => {
    const values = series(discordId, statKeyToRead);
    for (let index = Math.min(rangeEnd, values.length - 1); index >= rangeStart; index -= 1) {
      const estimated = Boolean(historyProvenance(discordId, dates[index], statKeyToRead));
      if (Number.isFinite(values[index]) && (showEstimated || !estimated)) return values[index];
    }
    return null;
  };

  // Only one thing drives the graph at a time. While a weapon or vehicle has it,
  // no soldier stat is selected -- leaving one highlighted claimed a selection
  // the chart was not showing.
  const statCardActive = (candidate) => candidate.key === stat.key && !chartEquipment;

  const periodSummaryCard = (candidate) => {
    if (!statHasPeriodForm(candidate.key)) {
      const career = member ? member.stats[candidate.key] : valueAt(discordId, candidate.key, lastIndex);
      return `<div class="stat-summary ${statCardActive(candidate) ? "active" : ""}" data-stat="${candidate.key}">
        <div class="stat-summary-head"><div class="k">${esc(candidate.title)}</div></div>
        <div class="v">${fmtStat(candidate, career)}</div>
        <div class="m">${periodUnsupportedReason(candidate.key, state.counters) === "counters_missing" ? "No Period data" : "Career-only stat"}</div>
      </div>`;
    }
    const periodStat = memberPeriodStat(state.counters, discordId, candidate.key, periodWindow);
    const value = periodStat.invalid ? null : periodStat.value;
    let meta = "No gameplay in this range";
    if (periodStat.invalid && periodStat.reason === "negative_delta") {
      meta = "Counter reset in this range";
    } else if (value != null) {
      const { ranked } = periodRanking(state.counters, candidate.key, periodWindow);
      const rankIndex = ranked.findIndex((row) => row.discordId === discordId);
      meta =
        rankIndex >= 0
          ? `Rank #${rankIndex + 1} of ${ranked.length} this range`
          : `<span class="badge provisional" title="Under 15 active minutes in this range — too small a sample to rank">low time</span>`;
    }
    return `<div class="stat-summary ${statCardActive(candidate) ? "active" : ""}" data-stat="${candidate.key}">
      <div class="stat-summary-head"><div class="k">${esc(candidate.title)}</div></div>
      <div class="v">${fmtStat(candidate, value)}</div>
      <div class="m">${meta}</div>
    </div>`;
  };

  const careerSummaryCard = (candidate) => {
    const current = member ? member.stats[candidate.key] : valueAt(discordId, candidate.key, lastIndex);
    const ranking = latestRanking(candidate.key);
    const rankIndex = ranking.findIndex((row) => row.discordId === discordId);
    const baseline = baselineForRange(candidate.key);
    const rangeEndValue = endForRange(candidate.key);
    const delta = Number.isFinite(rangeEndValue) && Number.isFinite(baseline) ? fmtDelta(candidate, rangeEndValue - baseline) : null;
    const deltaClass = delta ? (rangeEndValue > baseline ? "up" : "down") : "flat";
    const hasBackfill = backfillFields.has(candidate.key);
    return `<div class="stat-summary ${statCardActive(candidate) ? "active" : ""}" data-stat="${candidate.key}">
      <div class="stat-summary-head"><div class="k">${esc(candidate.title)}</div>${showEstimated && hasBackfill ? backfillMarkerHtml() : ""}</div>
      <div class="v">${fmtStat(candidate, current)}</div>
      <div class="m"><span>${rankIndex >= 0 ? `Rank #${rankIndex + 1} of ${ranking.length}` : "Unranked"}${
        delta ? ` · <span class="delta ${deltaClass}">${delta}</span>` : ""
      }</span></div>
    </div>`;
  };

  // A weapon or vehicle selected in the panel below takes over the graph; with
  // nothing selected it stays the soldier-stat chart it has always been.
  const chartEquipmentId = params.get("equipment");
  const chartEquipment = chartEquipmentId ? profileEquipmentSelection(discordId, chartEquipmentId) : null;
  // The metric buttons drive the graph. An item's category decides which metrics
  // exist, so a metric the selection cannot report falls back to Kills.
  // An absent param is "no stat picked", which is not the same as Kills: a
  // soldier stat takes the graph back and leaves the panel with nothing to
  // highlight. Once an item is selected the panel is live again, and Kills is
  // what it is graphing, so that button lights up.
  const requestedEquipmentMetric = params.get("equipmentMetric");
  const equipmentMetric = chartEquipment
    ? (equipmentMetricAppliesTo(requestedEquipmentMetric, chartEquipment.category)
        ? resolvedEquipmentMetric(sharedEquipmentMetric(requestedEquipmentMetric ?? "kills"), chartEquipment.category)
        : "kills")
    : requestedEquipmentMetric;
  const panelMetric = chartEquipmentId ? equipmentMetric ?? "kills" : requestedEquipmentMetric;
  const equipmentChartStatDescriptor = chartEquipment ? equipmentChartStat(equipmentMetric ?? "kills", chartEquipment.name) : null;
  const chartHeading = chartEquipment
    ? `${esc(chartEquipment.name)} ${esc(equipmentChartStatDescriptor.label)} ${periodWindow ? "· daily Period form" : "over time"}`
    : `${esc(stat.title)} ${
        periodWindow && statHasPeriodForm(stat.key)
          ? `· daily Period form${
              memberDailySeries(state.counters, discordId, stat.key, periodWindow).some((point) => point.value != null && !point.observedEnd)
                ? " (yellow = carried snapshot)"
                : ""
            }`
          : "over time"
      }`;

  const summaries = state.meta.stats
    .map((candidate) => (periodWindow ? periodSummaryCard(candidate) : careerSummaryCard(candidate)))
    .join("");

  const playerAudit = (state.audit.events ?? []).filter((event) => event.discordId === discordId);
  const auditHtml = playerAudit.length
    ? `<div class="chart-card"><h3>Link history</h3><div class="feed">${[...playerAudit]
        .reverse()
        .map((event) => `<div class="feed-item"><span class="feed-date">${fmtDate(event.at)}</span>${auditText(event)}</div>`)
        .join("")}</div></div>`
    : "";

  // Only a canonical Tracker.gg BF6 profile URL is ever rendered; anything
  // else in the data is ignored rather than linked.
  const trackerUrl =
    typeof member?.trackerUrl === "string" && /^https:\/\/tracker\.gg\/bf6\/profile\/\d+\/overview$/.test(member.trackerUrl)
      ? member.trackerUrl
      : null;
  const profileIdentityParts = [
    member?.profileName ? `Profile <strong>${esc(member.profileName)}</strong>` : "",
    member?.eaName ? `EA <span class="mono">${esc(member.eaName)}</span>` : "",
    platformLabel(member?.platform) ? `Platform <strong>${esc(platformLabel(member.platform))}</strong>` : "",
    member?.personaId ? `<span class="profile-id-field">Persona ID <span class="mono">${esc(member.personaId)}</span></span>` : "",
    member?.nucleusId ? `<span class="profile-id-field">Nucleus ID <span class="mono">${esc(member.nucleusId)}</span></span>` : "",
    !member ? `<span class="badge unlinked">no longer linked</span>` : ""
  ].filter(Boolean);
  const profileLinkParts = [
    member?.gameToolsUrl ? `<a href="${esc(member.gameToolsUrl)}" target="_blank" rel="noopener">GameTools profile ↗</a>` : "",
    trackerUrl ? `<a href="${esc(trackerUrl)}" target="_blank" rel="noopener noreferrer">Tracker.gg profile ↗</a>` : ""
  ].filter(Boolean);

  app.innerHTML = `
    <div class="player-profile-top">
      <div class="player-profile-identity">
        <div class="profile-head">
          <h1 class="page-title">${esc(name)} ${favoriteButtonHtml(discordId, { size: "fav-toggle-lg" })} <span class="period-title-tag ${periodWindow ? "" : "career-title-tag"}">${esc(periodWindow ? periodWindowText(periodWindow) : careerRangeWindowText(careerWindow, { includeLabel: true }))}</span></h1>
          ${member?.cachedStats ? cachedMarkerHtml() : ""}
        </div>
        <p class="profile-sub"><span class="profile-identity-row">${profileIdentityParts.join(" · ")}</span>${profileLinkParts.length ? `<span class="profile-links-row">${profileLinkParts.join(" · ")}</span>` : ""}</p>
      </div>
    </div>
    ${viewRangeState.view === "period" && !periodWindow ? `<div class="period-unsupported-note" role="note">The selected range is not available yet — showing Career values.</div>` : ""}
    ${viewRangeControlHtml(viewRangeState.view === "career" && backfillFields.size > 0 ? `<button class="chip range-chip profile-backfill ${showEstimated ? "active" : ""}" id="tracker-history-toggle" type="button" aria-pressed="${showEstimated}">${showEstimated ? "Hide Backfill" : "Show Backfill"}</button>` : "")}
    ${showEstimated && !periodWindow ? estimatedHistoryNoticeHtml(discordId) : ""}
    ${recentFormCardHtml(discordId, member)}
    <details class="chart-card player-stats-details" id="player-stats-panel"${panelIsOpen("player-stats-panel", true) ? " open" : ""}>
      <summary class="recent-form-summary">
        <h3>Soldier Performance</h3>
        <span class="panel-toggle" aria-hidden="true"></span>
      </summary>
      <div class="player-stats-content">
        <div class="stat-summary-grid">${summaries}</div>
      </div>
    </details>
    ${equipmentDetailsHtml(discordId, equipmentView, periodWindow, chartEquipmentId, panelMetric)}
    <details class="chart-card player-chart-panel" id="player-chart-panel"${panelIsOpen("player-chart-panel", true) ? " open" : ""}>
      <summary class="recent-form-summary"><h3>${chartHeading}</h3><span class="panel-toggle" aria-hidden="true"></span></summary>
      <div class="chart-box"><canvas id="player-chart"></canvas></div>
    </details>
    <details class="chart-card profile-equipment-table" id="profile-equipment-table"${panelIsOpen("profile-equipment-table", true) ? " open" : ""}><summary class="recent-form-summary"><h3>Full Weapon/Vehicle Stats</h3><span class="panel-toggle" aria-hidden="true"></span></summary><div id="profile-equipment-table-content"></div></details>
    ${auditHtml}
    ${cachedFootnoteHtml(Boolean(member?.cachedStats))}`;

  for (const card of app.querySelectorAll(".stat-summary")) {
    card.addEventListener("click", () => {
      replaceHashAndRender(playerHistoryHref(discordId, card.dataset.stat, showEstimated, equipmentView));
    });
  }

  wireViewRangeControl((rangeParams) =>
    hashRoute(`player/${encodeURIComponent(discordId)}/${stat.key}`, {
      estimated: showEstimated ? 1 : null,
      ...equipmentViewParams(equipmentView),
      ...rangeParams
    })
  );
  document.getElementById("tracker-history-toggle")?.addEventListener("click", () => {
    if (!showEstimated) {
      viewRangeState.view = "career";
      viewRangeState.range = "all";
      viewRangeState.custom = null;
    }
    replaceHashAndRender(playerHistoryHref(discordId, stat.key, !showEstimated, equipmentView));
  });
  wireFavoriteToggles();
  const recentPerformanceCard = app.querySelector(".recent-form-card");
  recentPerformanceCard?.addEventListener("toggle", () => {
    recentPerformanceCollapsed = !recentPerformanceCard.open;
    try {
      localStorage.setItem(RECENT_PERFORMANCE_STORAGE_KEY, String(recentPerformanceCollapsed));
    } catch {
      // Storage may be unavailable in privacy-restricted browsers; the
      // in-memory preference still survives normal SPA navigation.
    }
  });
  wireEquipmentDetails(discordId, stat.key, showEstimated, equipmentView, chartEquipmentId, panelMetric);
  renderProfileEquipmentTable(discordId, periodWindow);
  // The weapon/vehicle bands inside the panel are the same collapsibles the
  // leaderboard uses, so they get the same click guard and remembered state.
  wirePanelState();
  for (const summary of app.querySelectorAll(".chart-card > summary.recent-form-summary")) {
    wireSummaryClickGuard(summary);
  }
  document.getElementById("player-chart-panel").addEventListener("toggle", (event) => {
    if (event.currentTarget.open) globalThis.Chart?.getChart("player-chart")?.resize();
  });

  const periodChartWindow = periodWindow && statHasPeriodForm(stat.key) ? periodWindow : null;
  if (chartEquipment) {
    const points = equipmentChartPoints(chartEquipment, periodWindow, equipmentMetric ?? "kills");
    lineChart(
      document.getElementById("player-chart"),
      points.map((point) => point.date),
      [{ label: equipmentChartStatDescriptor.title, data: points.map((point) => point.value) }],
      equipmentChartStatDescriptor
    );
  } else if (periodChartWindow) {
    const points = memberDailySeries(state.counters, discordId, stat.key, periodChartWindow);
    lineChart(
      document.getElementById("player-chart"),
      points.map((point) => point.date),
      [{ label: name, data: points.map((point) => point.value), estimated: points.map((point) => !point.observedEnd) }],
      stat
    );
  } else if (dates.length > 0) {
    const fullSeries = series(discordId, stat.key);
    let firstVisible = rangeStart;
    while (firstVisible < dates.length) {
      const value = fullSeries[firstVisible];
      const estimated = Boolean(historyProvenance(discordId, dates[firstVisible], stat.key));
      if (Number.isFinite(value) && (showEstimated || !estimated)) {
        break;
      }
      firstVisible += 1;
    }
    const chartDates = dates.slice(firstVisible, rangeEnd + 1);
    const chartData = fullSeries
      .slice(firstVisible, rangeEnd + 1)
      .map((value, index) => (showEstimated || !historyProvenance(discordId, chartDates[index], stat.key) ? value : null));
    lineChart(
      document.getElementById("player-chart"),
      chartDates,
      [{ label: name, data: chartData, estimated: chartDates.map((date) => showEstimated && Boolean(historyProvenance(discordId, date, stat.key))) }],
      stat
    );
  }
}

/* ---------- equipment profile ---------- */

const EQUIPMENT_CLASS_FALLBACKS = {
  ar: "Assault Rifles",
  crb: "Carbines",
  smg: "SMGs",
  mg: "LMGs",
  sg: "Shotguns",
  snp: "Sniper Rifles",
  dmr: "DMRs",
  pst: "Pistols",
  other: "Other"
};

const VEHICLE_DOMAIN_FALLBACKS = [
  { key: "land", label: "Land" },
  { key: "air", label: "Air" },
  { key: "naval", label: "Naval" }
];

const EQUIPMENT_METRIC_LABELS = {
  kills: "Kills",
  accuracy: "Accuracy",
  hsPercent: "Headshot %",
  timeEquipped: "Time Played",
  timeIn: "Time Played",
  shotsHit: "Accuracy",
  headshotKills: "Headshot %",
  kpm: "KPM",
  vehiclesDestroyed: "Vehicles Destroyed",
  vehiclesDestroyedWith: "Vehicles Destroyed",
  assists: "Assists",
  roadKills: "Roadkills"
};

// One indicator, not a stacked pair: [+] when collapsed, [-] when open. The
// glyph is CSS-driven off the open attribute so it can never disagree with the
// element's real state.
// A panel the user opened stays open when they pick a different stat or weapon.
// The route only supplies the FIRST-visit default; after that their choice wins,
// because re-deriving from the route silently collapsed a panel they had just
// opened. Per-browser only, like favorites -- the site has no accounts.
const PANEL_STATE_STORAGE_KEY = "kdm-bf6-panel-state";

function readPanelState() {
  try {
    const raw = JSON.parse(localStorage.getItem(PANEL_STATE_STORAGE_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writePanelState(id, open) {
  try {
    localStorage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify({ ...readPanelState(), [id]: open }));
  } catch {
    /* storage disabled; the panel still works for this page view */
  }
}

function panelIsOpen(id, fallback) {
  const stored = readPanelState()[id];
  return typeof stored === "boolean" ? stored : fallback;
}

// Only the header text and the [-]/[+] indicator toggle a panel. The rest of
// the summary bar is a wide, easy target to hit by accident, and collapsing a
// panel the user was reading is the most annoying way to lose their place.
// Keyboard activation (event.detail === 0) always passes through.
function wireSummaryClickGuard(summary) {
  summary?.addEventListener("click", (event) => {
    if (event.detail === 0) return;
    if (!event.target.closest(".panel-title, .panel-toggle, .equipment-band-head h3, .recent-form-summary h3")) {
      event.preventDefault();
    }
  });
}

function wirePanelState() {
  // The profile's Soldier Stats panel is in here too: it used to render with a
  // hardcoded `open`, so any re-render -- including opening the panel below it
  // -- silently re-expanded a panel the user had collapsed.
  for (const panel of app.querySelectorAll(".stat-panel[id], .equipment-band[id], .player-stats-details[id], .profile-equipment-table[id], .player-chart-panel[id]")) {
    wireSummaryClickGuard(panel.querySelector(":scope > summary"));
    panel.addEventListener("toggle", () => writePanelState(panel.id, panel.open));
  }
}

function panelHtml(id, title, defaultOpen, body, extraClass = "") {
  const open = panelIsOpen(id, defaultOpen);
  return `<details class="stat-panel ${extraClass}" id="${esc(id)}"${open ? " open" : ""}>
    <summary><span class="panel-title">${esc(title)}</span><span class="panel-toggle" aria-hidden="true"></span></summary>
    <div class="stat-panel-body">${body}</div>
  </details>`;
}

function equipmentCatalogue() {
  return validEquipmentCatalogue(state.equipmentCatalogue) ? state.equipmentCatalogue : null;
}

function equipmentDisplayName(category, id) {
  return equipmentCatalogue()?.[category]?.[id]?.name ?? id;
}

function weaponClassId(id) {
  return String(id).match(/^wp_([^_]+)_/)?.[1] ?? "other";
}

function weaponClassLabel(classId) {
  return equipmentCatalogue()?.classes?.[classId] ?? EQUIPMENT_CLASS_FALLBACKS[classId] ?? String(classId).toUpperCase();
}

function equipmentValueText(metric, value) {
  if (!Number.isFinite(value)) return "—";
  if (metric === "timeEquipped" || metric === "timeIn") {
    const minutes = Math.round(value / 60);
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
  }
  if (metric === "accuracy" || metric === "hsPercent") return `${value.toFixed(1)}%`;
  if (metric === "kpm") return value.toFixed(2);
  return Math.round(value).toLocaleString("en-US");
}

function equipmentMetricFields(category) {
  return category === "weapons"
    ? ["kills", "kpm", "accuracy", "hsPercent", "timeEquipped"]
    : ["kills", "assists", "kpm", "vehiclesDestroyed", "roadKills", "timeIn"];
}

function equipmentMetricValue(stats, metric) {
  if (metric === "timeEquipped" || metric === "timeIn") return stats.timeSeconds;
  if (metric === "accuracy") return stats.accuracy;
  if (metric === "hsPercent") return stats.hsPercent;
  if (metric === "vehiclesDestroyed") return stats.vehiclesDestroyed;
  if (metric === "assists") return stats.assists;
  if (metric === "roadKills") return stats.roadKills;
  return stats[metric] ?? null;
}

// A stored field carries the derived stats built on it, so a note about
// timeEquipped has to name KPM too — that is the one the reader was looking at.
function equipmentMetricLabelsFor(fieldNames, category) {
  const metricFields = new Set(fieldNames);
  if (category === "weapons") {
    if (metricFields.has("shotsFired") || metricFields.has("shotsHit")) metricFields.add("accuracy");
    if (metricFields.has("headshotKills")) metricFields.add("hsPercent");
    if (metricFields.has("timeEquipped")) metricFields.add("kpm");
  }
  if (category === "vehicles" && metricFields.has("timeIn")) metricFields.add("kpm");
  return [...metricFields].map((field) => EQUIPMENT_METRIC_LABELS[field]).filter(Boolean);
}

function readableLabelList(labels) {
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}` : labels[0];
}

// Two different situations, and the difference matters to whoever picked the
// window: a metric that starts later than the window still has real figures for
// the part it covers, and only a metric with no covered span at all is empty.
function equipmentPeriodTrackingNote(fields, category) {
  const entries = Object.entries(fields);
  const clamped = entries.filter(([, field]) => field?.known && field.clamped);
  const uncovered = entries.filter(([, field]) => field?.reason === "tracking_not_started");
  const notes = [];
  if (clamped.length) {
    const labels = equipmentMetricLabelsFor(clamped.map(([field]) => field), category);
    const from = clamped.map(([, field]) => field.startDate).filter(Boolean).sort().at(-1);
    if (labels.length && from) {
      notes.push(`${readableLabelList(labels)} ${labels.length > 1 ? "cover" : "covers"} ${fmtShortDate(from)} onward — the rest of the selected window predates ${labels.length > 1 ? "those metrics" : "that metric"}.`);
    }
  }
  if (uncovered.length) {
    const labels = equipmentMetricLabelsFor(uncovered.map(([field]) => field), category);
    const trackingStart = uncovered.map(([, field]) => field.trackingStartDate).find(Boolean);
    if (labels.length) {
      notes.push(`${readableLabelList(labels)} ${labels.length > 1 ? "have" : "has"} no data in this window; tracking began ${trackingStart ? fmtShortDate(trackingStart) : "after it"}.`);
    }
  }
  return notes.join(" ");
}

function equipmentProfileMember(data, discordId) {
  return data?.members?.[discordId] ?? (data?.weapons || data?.vehicles ? data : null);
}

// Notes for the item currently driving the graph. The panel shows one weapon or
// vehicle at a time, so a caveat about the whole file's coverage would be noise;
// only the selected item's own gaps are worth interrupting for.
function equipmentSelectionNotesHtml(category, entry, memberData, dates, fieldTrackingStarts, periodWindow, usePeriod) {
  if (!usePeriod || !entry) return "";
  const missingNames = [...new Set(
    EQUIPMENT_FIELDS[category]
      .filter((field) => !Array.isArray(entry?.[field]))
      .map((field) => EQUIPMENT_METRIC_LABELS[field])
      .filter(Boolean)
  )];
  const missingNote = missingNames.length
    ? `<p class="period-unsupported-note" role="note">Period data is missing ${esc(missingNames.join(", "))} for this item — those stats show Career values.</p>`
    : "";
  const stats = equipmentPeriodStats(entry, category, periodWindow.startIndex, periodWindow.endIndex, dates, memberData.observed, fieldTrackingStarts);
  const trackingNote = equipmentPeriodTrackingNote(stats.fields, category);
  return `${missingNote}${trackingNote ? `<p class="period-unsupported-note" role="note">${esc(trackingNote)}</p>` : ""}`;
}

function equipmentProfileContentHtml(discordId, equipmentView, periodWindow, selectedId, metric) {
  const cached = equipmentProfileCache.get(discordId);
  if (cached?.status === "missing") return `<p class="equipment-empty">No equipment data has been published for this member yet.</p>`;
  if (cached?.status === "error") return `<p class="equipment-empty">Equipment data is temporarily unavailable. Try expanding this section again later.</p>`;
  const data = cached?.data;
  const memberData = equipmentProfileMember(data, discordId);
  if (!memberData) return `<p class="equipment-empty">No equipment data has been published for this member yet.</p>`;
  const dates = Array.isArray(data?.dates) ? data.dates : [];
  const periodMatches = periodWindow && dates[periodWindow.startIndex] === periodWindow.startDate && dates[periodWindow.endIndex] === periodWindow.endDate;
  const periodRequested = viewRangeState.view === "period";
  const periodAvailable = Boolean(periodMatches);
  const periodNote = periodRequested && !periodAvailable
    ? `<p class="period-unsupported-note" role="note">The selected Period range is not available for this equipment file — showing Career values.</p>`
    : "";
  const usePeriod = periodAvailable;
  const source = { weapons: memberData.weapons ?? {}, vehicles: memberData.vehicles ?? {} };
  if (!Object.keys(source.weapons).length && !Object.keys(source.vehicles).length) {
    return `<p class="equipment-empty">No weapons or vehicles are recorded for this member yet.</p>`;
  }
  const selectedCategory = source.weapons[selectedId] ? "weapons" : source.vehicles[selectedId] ? "vehicles" : null;
  const selectionNotes = selectedCategory
    ? equipmentSelectionNotesHtml(selectedCategory, source[selectedCategory][selectedId], memberData, dates, data.fieldTrackingStarts, periodWindow, usePeriod)
    : "";
  return `<div class="equipment-content-head"><p class="page-sub">${usePeriod ? esc(periodWindowText(periodWindow)) : "Career totals at the latest observed equipment snapshot."} Pick a stat and an item to graph it below.</p></div>
    ${periodNote}
    ${selectionNotes}
    ${equipmentPanelHtml(selectedId, metric, source)}`;
}

function renderProfileEquipmentTable(discordId, periodWindow) {
  const panel = document.getElementById("profile-equipment-table-content");
  if (!panel) return;
  const sorting = profileEquipmentTableState;
  if (sorting.member !== discordId) {
    sorting.member = discordId;
    sorting.category = "weapons";
    sorting.filter = "all";
    resetSortState(sorting);
  }
  const category = sorting.category;
  const cached = equipmentProfileCache.get(discordId);
  const data = cached?.data;
  const member = equipmentProfileMember(data, discordId);
  const dates = data?.dates ?? [];
  const usePeriod = Boolean(periodWindow && dates[periodWindow.startIndex] === periodWindow.startDate && dates[periodWindow.endIndex] === periodWindow.endDate);
  const fields = equipmentMetricFields(category);
  const source = Object.fromEntries(["weapons", "vehicles"].map((kind) => [kind, {
    ...equipmentCatalogue()?.[kind], ...member?.[kind]
  }]));
  if (!member?.vehicles?.unclassified) delete source.vehicles.unclassified;
  const groups = equipmentGroups(source)[category];
  if (category === "vehicles") {
    groups.push(
      { key: "helicopters", label: "Helicopters", items: ["attackheli", "scoutheli", "transportheli"] },
      { key: "jets", label: "Jets", items: ["attackjet", "fighter"] }
    );
  }
  const activeGroup = groups.find((group) => group.key === sorting.filter);
  const rows = Object.keys(source[category]).map((id, index) => {
    const entry = member?.[category]?.[id] ?? {};
    const stats = usePeriod
      ? equipmentPeriodStats(entry, category, periodWindow.startIndex, periodWindow.endIndex, dates, member?.observed, data?.fieldTrackingStarts)
      : equipmentCareerStats(entry, category, latestObservedIndex(member?.observed), member?.observed, dates, data?.fieldTrackingStarts);
    return { id, name: equipmentDisplayName(category, id), stats, originalRank: index,
      note: usePeriod ? equipmentPeriodTrackingNote(stats.fields, category) : "" };
  });
  const filtered = activeGroup ? rows.filter((row) => activeGroup.items.includes(row.id)) : rows;
  const sorted = sortedRows(filtered, sorting, (row, key) => key === "name" ? row.name : equipmentMetricValue(row.stats, key) ?? 0);
  const message = !cached ? "Loading equipment data…"
    : cached.status === "error" ? "Equipment data is temporarily unavailable. Reload to try again."
    : !filtered.length ? "No equipment data is recorded for this selection." : "";
  const caption = usePeriod ? periodWindowText(periodWindow)
    : viewRangeState.view === "period" ? "This Period range is unavailable for equipment — showing Career totals."
    : "Career totals at the latest observed equipment snapshot.";
  panel.innerHTML = `<div class="equipment-table-controls"><div class="stat-tabs" role="group" aria-label="Equipment table category">${["weapons", "vehicles"].map((item) => `<button type="button" data-table-category="${item}" class="${item === category ? "active" : ""}" aria-pressed="${item === category}">${item === "weapons" ? "Weapons" : "Vehicles"}</button>`).join("")}</div>
    <label class="equipment-table-filter">${category === "weapons" ? "Class" : "Type"}<select id="equipment-table-filter"><option value="all">All</option>${groups.map((group) => `<option value="${esc(group.key)}"${activeGroup === group ? " selected" : ""}>${esc(group.label)}</option>`).join("")}</select></label></div>
    <p class="page-sub">${esc(caption)}${rows.some((row) => row.note) ? " · † Partial coverage; hover the item name for dates." : ""} · Unrecorded values are shown as 0.</p>
    ${message ? `<p class="equipment-empty">${message}</p>` : `<div class="table-wrap"><table><thead><tr>${sortableHeaderHtml(category === "weapons" ? "Weapon" : "Vehicle", "name", sorting)}${fields.map((field) => sortableHeaderHtml(EQUIPMENT_METRIC_LABELS[field], field, sorting, { numeric: true })).join("")}</tr></thead><tbody>${sorted.map((row) => `<tr><td${row.note ? ` title="${esc(row.note)}"` : ""}>${esc(row.name)}${row.note ? " †" : ""}</td>${fields.map((field) => `<td class="num">${equipmentValueText(field, equipmentMetricValue(row.stats, field) ?? 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`}`;
  for (const button of panel.querySelectorAll("[data-table-category]")) {
    button.addEventListener("click", () => {
      sorting.category = button.dataset.tableCategory;
      sorting.filter = "all";
      resetSortState(sorting);
      renderProfileEquipmentTable(discordId, periodWindow);
    });
  }
  panel.querySelector("#equipment-table-filter").addEventListener("change", (event) => {
    sorting.filter = event.target.value;
    renderProfileEquipmentTable(discordId, periodWindow);
  });
  for (const button of panel.querySelectorAll("[data-sort-key]")) {
    button.addEventListener("click", () => {
      advanceSortState(sorting, button.dataset.sortKey);
      renderProfileEquipmentTable(discordId, periodWindow);
    });
  }
  wireFloatingTableHeaders();
}

function equipmentDetailsHtml(discordId, equipmentView, periodWindow, selectedId, metric) {
  const cached = equipmentProfileCache.get(discordId);
  const content = cached ? equipmentProfileContentHtml(discordId, equipmentView, periodWindow, selectedId, metric) : equipmentView.open
    ? `<div class="equipment-loading">Loading equipment data…</div>`
    : `<p class="equipment-empty">Expand to load this member’s weapon and vehicle history.</p>`;
  return `<details id="equipment-details" class="chart-card equipment-details" ${equipmentView.open ? "open" : ""}>
    <summary class="recent-form-summary"><h3>Weapon/Vehicle Performance</h3><span class="panel-toggle" aria-hidden="true"></span></summary>
    ${content}
  </details>`;
}

async function fetchEquipmentProfile(discordId) {
  if (equipmentProfileCache.has(discordId)) return equipmentProfileCache.get(discordId);
  if (equipmentProfileLoads.has(discordId)) return equipmentProfileLoads.get(discordId);
  const load = (async () => {
    try {
      const response = await fetch(dataUrl(`data/equipment/${encodeURIComponent(discordId)}.json`), dataFetchOptions());
      if (response.status === 404) return { status: "missing" };
      if (!response.ok) return { status: "error" };
      const data = await response.json();
      return validEquipmentMemberFile(data) ? { status: "loaded", data } : { status: "error" };
    } catch {
      return { status: "error" };
    }
  })();
  equipmentProfileLoads.set(discordId, load);
  const result = await load;
  equipmentProfileLoads.delete(discordId);
  equipmentProfileCache.set(discordId, result);
  return result;
}

function wireEquipmentDetails(discordId, statKey, showEstimated, equipmentView, selectedId, metric) {
  const details = document.getElementById("equipment-details");
  if (!details) return;
  const updateRoute = ({ open = true, equipment = null, equipmentMetric = "kills" }) =>
    replaceHashAndRender(playerProfileRoute(discordId, statKey, viewRangeState, {
      estimated: showEstimated,
      equipmentOpen: open,
      equipmentGrouping: equipmentView.grouping,
      equipment,
      equipmentMetric
    }));
  details.addEventListener("toggle", () => {
    if (details.open && equipmentProfileCache.get(discordId)?.status === "error") {
      equipmentProfileCache.delete(discordId);
    }
    if (details.open !== equipmentView.open) {
      updateRoute({ open: details.open, equipment: selectedId, equipmentMetric: metric });
    }
  });
  // Picking a chip graphs that item; picking it again clears back to the soldier
  // stat, so the chip doubles as the off switch and needs no separate control.
  for (const button of details.querySelectorAll("[data-equipment]")) {
    button.addEventListener("click", () => {
      const id = button.dataset.equipment;
      const category = button.dataset.equipmentCategory;
      const deselecting = selectedId === id;
      updateRoute({
        equipment: deselecting ? null : id,
        // Chips for a stat this category cannot report are greyed out, so the
        // metric always survives the pick -- Time Played under the field name
        // this category uses for it. Deselecting hands the graph back to the
        // soldier stat, so the panel goes back to nothing picked with it:
        // leaving a stat lit would claim a graph it no longer owns.
        equipmentMetric: deselecting ? null : resolvedEquipmentMetric(sharedEquipmentMetric(metric), category)
      });
    });
  }
  // Same deal as the leaderboard: a stat always graphs something. It keeps the
  // current selection when that item can report the stat, and otherwise falls
  // to the panel's first item of a category that can -- so picking a stat is
  // never a dead click, and the graph is never left empty.
  for (const button of details.querySelectorAll("[data-equipment-metric]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const nextMetric = button.dataset.equipmentMetric;
      const selectedCategory = selectedId ? profileEquipmentSelection(discordId, selectedId)?.category : null;
      const keepsSelection = Boolean(selectedCategory) && equipmentMetricAppliesTo(nextMetric, selectedCategory);
      updateRoute({
        equipment: keepsSelection ? selectedId : button.dataset.equipmentTarget || null,
        equipmentMetric: keepsSelection ? resolvedEquipmentMetric(sharedEquipmentMetric(nextMetric), selectedCategory) : nextMetric
      });
    });
  }
  if (!equipmentProfileCache.has(discordId)) {
    fetchEquipmentProfile(discordId).then(() => {
      const route = parseHashRoute(location.hash);
      if (route.parts[0] === "player" && decodeURIComponent(route.parts[1] ?? "") === discordId) {
        render();
      }
    });
  }
}

// Career vs recent-window performance, side by side. This is the direct answer
// to "am I improving?" — career ratios barely move once thousands of hours are
// banked, while these columns show what the player actually did lately.
// Career vs recent-window performance, side by side (Task 5). This is the
// direct answer to "am I improving?" — career ratios barely move once
// thousands of hours are banked, while these columns show what the player
// actually did lately. Columns render only for ranges the data supports.
function recentFormCardHtml(discordId, member) {
  if (!periodDataAvailable() || !state.counters.members?.[discordId]) {
    return "";
  }
  const columns = ["today", "3d", "7d", "14d", "30d", "all"]
    .map((key) => ({ key, window: resolveRange(state.counters, key) }))
    .filter((column) => column.key === "today" || !column.window.unavailable);
  if (!columns.length) {
    return "";
  }
  const labels = { today: "Today", "3d": "3 days", "7d": "7 days", "14d": "14 days", "30d": "30 days", all: "All tracked" };
  const decimal = { format: "decimal", decimals: 2 };
  const integer = { format: "integer" };
  const hours = { format: "hours" };
  const lastIndex = state.counters.dates.length - 1;
  const careerDeathsSeries = state.counters.members[discordId].values?.deaths ?? [];
  let careerDeaths = null;
  for (let i = lastIndex; i >= 0; i -= 1) {
    if (Number.isFinite(careerDeathsSeries[i])) {
      careerDeaths = careerDeathsSeries[i];
      break;
    }
  }
  const rows = [
    { label: "Player K/D", stat: decimal, career: member?.stats?.infantryKillDeath, statKey: "infantryKillDeath" },
    { label: "Player KPM", stat: decimal, career: member?.stats?.playerKillsPerMinute, statKey: "playerKillsPerMinute" },
    { label: "Player Kills", stat: integer, career: member?.stats?.kills, statKey: "kills" },
    { label: "Active Time", stat: hours, career: member?.stats?.timePlayedHours, statKey: "timePlayedHours" }
  ];
  const windowValue = (row, window) => {
    if (window.unavailable) return null;
    if (row.counterKey) {
      const resolved = memberPeriodDeltas(state.counters, discordId, window);
      return resolved.invalid ? null : resolved.deltas[row.counterKey] ?? null;
    }
    const stat = memberPeriodStat(state.counters, discordId, row.statKey, window);
    return stat.invalid ? null : stat.value;
  };
  return `<details class="chart-card recent-form-card" ${recentPerformanceCollapsed ? "" : "open"}>
    <summary class="recent-form-summary">
      <h3>Recent Performance Snapshot</h3>
      <span class="panel-toggle" aria-hidden="true"></span>
    </summary>
    <div class="recent-form-content">
    <div class="table-wrap"><table class="recent-form-table">
      <thead><tr><th></th>${columns
        .map((column) => `<th class="num period-column ${column.key === "today" ? "today-column" : ""}">${labels[column.key]}<small>Period</small></th>`)
        .join("")}<th class="num career-column">Lifetime<small>Career</small></th></tr></thead>
      <tbody>${rows
        .map(
          (row) => `<tr><td>${esc(row.label)}</td>${columns
            .map((column) => `<td class="num value-cell period-column ${column.key === "today" ? "today-column" : ""}"${column.window.unavailable ? ` title="Available after today's first refresh"` : ""}>${fmtStat(row.stat, windowValue(row, column.window))}</td>`)
            .join("")}<td class="num career-column">${fmtStat(row.stat, row.career)}</td></tr>`
        )
        .join("")}</tbody>
    </table></div>
    <p class="cached-footnote">Career is the current lifetime total. Period columns are performance during that window only, including today so far.</p>
    </div>
  </details>`;
}

const compareState = { selected: [], statKey: null, selectionMode: "default" };

function compareTooltipItemSort(a, b) {
  const aValue = Number.isFinite(a.parsed?.y) ? a.parsed.y : Number.NEGATIVE_INFINITY;
  const bValue = Number.isFinite(b.parsed?.y) ? b.parsed.y : Number.NEGATIVE_INFINITY;
  return bValue - aValue || a.datasetIndex - b.datasetIndex;
}

// Default selection follows whichever view is active: Period form for the
// selected range when the stat supports it, otherwise the Career standings.
function defaultCompareSelection(statKey) {
  const periodWindow = activePeriodWindow();
  if (periodWindow && statHasPeriodForm(statKey)) {
    const candidateIds = new Set(state.latest.members.map((member) => member.discordId));
    const { ranked } = periodRanking(state.counters, statKey, periodWindow);
    const top = ranked
      .map((row) => row.discordId)
      .filter((id) => candidateIds.has(id))
      .slice(0, 2);
    if (top.length > 0) {
      return top;
    }
  }
  return latestRanking(statKey).slice(0, 2).map((row) => row.discordId);
}

function compareHref(
  statKey = compareState.statKey,
  selected = compareState.selected,
  selectionMode = compareState.selectionMode
) {
  return hashRoute("compare", {
    stat: statKey,
    players: selectionMode === "manual" ? selected : null,
    ...viewRangeParams()
  });
}

function loadCompareState(params) {
  loadViewRange(params);
  const stat = statByKey(params.get("stat")) ?? state.meta.stats[0];
  const candidateIds = new Set(state.latest.members.map((member) => member.discordId));
  compareState.statKey = stat.key;
  if (params.has("players")) {
    compareState.selectionMode = "manual";
    compareState.selected = [...new Set((params.get("players") ?? "").split(",").filter((id) => candidateIds.has(id)))];
  } else {
    compareState.selectionMode = "default";
    compareState.selected = defaultCompareSelection(stat.key);
  }
}



function compareHistoryWindow(statKey) {
  const dates = state.history.dates;
  const hasDataAt = (index) =>
    compareState.selected.some(
      (id) => Number.isFinite(series(id, statKey)[index]) && !historyProvenance(id, dates[index], statKey)
    );
  const indexes = dates.map((_, index) => (hasDataAt(index) ? index : -1)).filter((index) => index >= 0);
  if (indexes.length < 2) {
    return { labels: [], start: 0, end: 0 };
  }
  const window = resolveCareerWindow(dates, indexes, viewRangeState.range, viewRangeState.custom);
  const selected = window.unavailable ? indexes.slice(-2) : window.indexes;
  const start = selected[0];
  const end = selected.at(-1) + 1;
  return {
    labels: dates.slice(start, end),
    start,
    end,
    window
  };
}

function renderCompare() {
  const stat = statByKey(compareState.statKey) ?? state.meta.stats[0];
  compareState.statKey = stat.key;

  const candidates = [...state.latest.members].sort((a, b) =>
    String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""))
  );
  if (compareState.selectionMode === "default") {
    compareState.selected = defaultCompareSelection(stat.key);
  }
  history.replaceState(null, "", compareHref());

  const periodWindow = activePeriodWindow();
  const periodMode = Boolean(periodWindow && statHasPeriodForm(stat.key));
  const careerHistoryWindow = periodMode ? null : compareHistoryWindow(stat.key);
  app.innerHTML = `
    <div class="page-heading-row"><h1 class="page-title">Head to Head <span class="period-title-tag ${periodMode ? "" : "career-title-tag"}">${esc(periodMode ? periodWindowText(periodWindow) : careerRangeWindowText(careerHistoryWindow?.window, { includeLabel: true }))}</span></h1>${shareButtonHtml()}</div>
    ${viewRangeState.view === "period" && !statHasPeriodForm(stat.key) ? `<div class="period-unsupported-note" role="note">${esc(periodUnsupportedNote(stat))}</div>` : ""}
    <p class="page-sub">${
      periodMode
        ? "Overlaying each player's day-by-day Period form inside the selected range · gaps are days without gameplay · yellow points are carried (member missing from that refresh)"
        : `Pick players and a stat to overlay their daily Career history · comparing ${esc(careerRangeWindowText(careerHistoryWindow?.window))}`
    }</p>
    ${viewRangeControlHtml()}
    <div class="compare-workspace">
      <aside class="compare-stat-picker" aria-label="Comparison statistic">
        <div class="group-label">Compare by</div>
        ${statTabsHtml(stat.key)}
      </aside>
      <div class="compare-results">
        <div class="compare-lineup" aria-label="Selected players">${compareState.selected.map((id) => {
          const member = candidates.find((candidate) => candidate.discordId === id);
          return `<span>${esc(member?.displayName ?? id)}</span>`;
        }).join('<b aria-hidden="true">/</b>') || '<span>Select players to start comparing</span>'}</div>
<div class="chart-card">
      <h3>${esc(stat.title)}</h3>
      <div class="chart-box"><canvas id="compare-chart"></canvas></div>
    </div>
    <section class="compare-player-picker" aria-labelledby="compare-picker-title"><h2 class="compare-picker-title" id="compare-picker-title">Choose players <span>${compareState.selected.length} selected</span></h2><div class="compare-player-toolbar"><label class="compare-search-label">Find a player<input id="compare-player-search" type="search" placeholder="Search the clan…" autocomplete="off" /></label><span class="compare-player-actions"><button class="compare-favorites" type="button" ${candidates.some((member) => isFavorite(member.discordId)) ? "" : "disabled"} title="Select your favorited players">&hearts; Favorites</button><button class="compare-reset" type="button">Reset to Top 2</button><button class="compare-clear" type="button" ${compareState.selected.length === 0 ? "disabled" : ""}>Unselect all</button></span></div>
    <div class="chip-row compare-roster">${candidates
      .map(
        (member) =>
          `<button class="chip ${compareState.selected.includes(member.discordId) ? "active" : ""}" data-id="${member.discordId}" aria-pressed="${compareState.selected.includes(member.discordId)}">${isFavorite(member.discordId) ? `<span class="chip-fav">&hearts;</span>` : ""}${esc(member.displayName ?? member.discordId)}</button>`
      )
      .join("")}</div></section>
      </div>
    </div>`;

  wireStatTabs((key) => replaceHashAndRender(compareHref(key)));
  wirePanelState();
  wireViewRangeControl(() => compareHref());
  app.querySelector(".compare-clear")?.addEventListener("click", () => {
    compareState.selectionMode = "manual";
    compareState.selected = [];
    replaceHashAndRender(compareHref());
  });
  app.querySelector(".compare-reset")?.addEventListener("click", () => {
    compareState.selectionMode = "default";
    compareState.selected = defaultCompareSelection(stat.key);
    replaceHashAndRender(compareHref());
  });
  app.querySelector(".compare-favorites")?.addEventListener("click", () => {
    compareState.selectionMode = "manual";
    compareState.selected = candidates
      .filter((member) => isFavorite(member.discordId))
      .map((member) => member.discordId);
    replaceHashAndRender(compareHref());
  });
  app.querySelector("#compare-player-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase();
    for (const chip of app.querySelectorAll(".compare-roster .chip")) {
      chip.hidden = Boolean(query) && !chip.textContent.toLocaleLowerCase().includes(query);
    }
  });
  for (const chip of app.querySelectorAll(".chip[data-id]")) {
    chip.addEventListener("click", () => {
      const id = chip.dataset.id;
      // Until a player chip is touched, every stat gets its own top-two
      // default. A manual selection (including an intentionally empty one)
      // remains stable while the user switches stats.
      compareState.selectionMode = "manual";
      compareState.selected = compareState.selected.includes(id)
        ? compareState.selected.filter((existing) => existing !== id)
        : [...compareState.selected, id];
      replaceHashAndRender(compareHref());
    });
  }

  if (periodMode && compareState.selected.length > 0) {
    const labels = state.counters.dates.slice(periodWindow.startIndex + 1, periodWindow.endIndex + 1);
    lineChart(
      document.getElementById("compare-chart"),
      labels,
      compareState.selected.map((id) => {
        const points = memberDailySeries(state.counters, id, stat.key, periodWindow);
        return {
          label: memberName(id),
          data: points.map((point) => point.value),
          estimated: points.map((point) => !point.observedEnd)
        };
      }),
      stat,
      { itemSort: compareTooltipItemSort }
    );
  } else if (state.history.dates.length > 0 && compareState.selected.length > 0) {
    const window = compareHistoryWindow(stat.key);
    const careerSeries = Object.fromEntries(
      compareState.selected.map((id) => [
        id,
        series(id, stat.key)
          .slice(window.start, window.end)
          .map((value, index) => (historyProvenance(id, window.labels[index], stat.key) ? null : value))
      ])
    );
    const overtakeFlags = pairwiseOvertakeFlags(careerSeries);
    lineChart(
      document.getElementById("compare-chart"),
      window.labels,
      compareState.selected.map((id) => ({
        label: memberName(id),
        data: careerSeries[id],
        overtakes: overtakeFlags[id]
      })),
      stat,
      { itemSort: compareTooltipItemSort }
    );
  }
  wireShareButton();
}

const timeMachineState = { index: null, statKey: null };

function timeMachineHref(statKey = timeMachineState.statKey, index = timeMachineState.index) {
  const snapshotIndexes = authoritativeHistoryIndexes();
  return hashRoute("history", { stat: statKey, date: state.history.dates[snapshotIndexes[index]] });
}

function timeMachinePlayerHref(discordId, statKey) {
  return hashRoute(`player/${encodeURIComponent(discordId)}/${statKey}`);
}

function loadTimeMachineState(params) {
  const dates = state.history.dates;
  const snapshotIndexes = authoritativeHistoryIndexes();
  const requestedDate = params.get("date");
  timeMachineState.statKey = (statByKey(params.get("stat")) ?? state.meta.stats[0]).key;
  const requestedHistoryIndex = requestedDate ? dates.indexOf(requestedDate) : -1;
  const requestedSnapshotIndex = snapshotIndexes.indexOf(requestedHistoryIndex);
  timeMachineState.index = requestedSnapshotIndex >= 0 ? requestedSnapshotIndex : snapshotIndexes.length - 1;
}

function renderTimeMachine() {
  const dates = state.history.dates;
  const snapshotIndexes = authoritativeHistoryIndexes();
  if (snapshotIndexes.length === 0) {
    app.innerHTML = `<div class="empty">No snapshots yet — check back after the first daily update.</div>`;
    return;
  }

  const stat = statByKey(timeMachineState.statKey) ?? state.meta.stats[0];
  timeMachineState.statKey = stat.key;
  const index = timeMachineState.index ?? snapshotIndexes.length - 1;
  timeMachineState.index = index;
  const historyIndex = snapshotIndexes[index];
  const date = dates[historyIndex];
  history.replaceState(null, "", timeMachineHref(stat.key, index));

  const memberIds = state.latest.members.map((member) => member.discordId);
  const ranking = authoritativeRankingAt(stat.key, historyIndex, memberIds);
  const rankedIds = new Set(ranking.map((row) => row.discordId));
  const missingRows = memberIds
    .filter((discordId) => !rankedIds.has(discordId))
    .map((discordId) => ({ discordId, trackedSince: memberTrackedSince(discordId) }))
    .sort((a, b) =>
      String(a.trackedSince ?? "9999-99-99").localeCompare(String(b.trackedSince ?? "9999-99-99"))
      || memberName(a.discordId).localeCompare(memberName(b.discordId), undefined, { sensitivity: "base", numeric: true })
    );

  app.innerHTML = `
    <div class="page-heading-row"><h1 class="page-title">Time Machine</h1>${shareButtonHtml()}</div>
    <p class="page-sub">The ${esc(stat.title)} leaderboard as it stood on any snapshot day</p>
    ${statTabsHtml(stat.key)}
    <div class="date-control">
      <span class="date-label" id="date-label">${fmtDate(`${date}T12:00:00`)}</span>
      <input type="range" min="0" max="${snapshotIndexes.length - 1}" value="${index}" id="date-slider" />
      <span class="mono" id="snapshot-position">${index + 1}/${snapshotIndexes.length} snapshots</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Player</th><th class="num">${esc(stat.title)}</th></tr></thead>
        <tbody>${ranking
          .map(
            (row, rankIndex) => `<tr class="r${rankIndex + 1}${isFavorite(row.discordId) ? " fav-row" : ""}">
              <td class="rank-cell">${rankIndex + 1}</td>
              <td><a class="player-link" href="${timeMachinePlayerHref(row.discordId, stat.key)}">${esc(memberName(row.discordId))}</a>${favoriteBadgeHtml(row.discordId)}</td>
              <td class="num value-cell">${fmtStat(stat, row.value)}</td>
            </tr>`
          )
          .join("")}${missingRows
            .map((row) => `<tr class="time-machine-unranked${isFavorite(row.discordId) ? " fav-row" : ""}">
              <td class="rank-cell">—</td>
              <td><a class="player-link" href="${timeMachinePlayerHref(row.discordId, stat.key)}">${esc(memberName(row.discordId))}</a>${favoriteBadgeHtml(row.discordId)} ${timeMachineTrackedSinceBadgeHtml(row.trackedSince)}</td>
              <td class="num">—</td>
            </tr>`)
            .join("")}</tbody>
      </table>
    </div>`;

  wireStatTabs((key) => replaceHashAndRender(timeMachineHref(key, index)));
  const dateSlider = document.getElementById("date-slider");
  dateSlider.addEventListener("input", (event) => {
    timeMachineState.index = Number(event.target.value);
    const selectedHistoryIndex = snapshotIndexes[timeMachineState.index];
    document.getElementById("date-label").textContent = fmtDate(`${dates[selectedHistoryIndex]}T12:00:00`);
    document.getElementById("snapshot-position").textContent = `${timeMachineState.index + 1}/${snapshotIndexes.length} snapshots`;
    history.replaceState(null, "", timeMachineHref(stat.key, timeMachineState.index));
  });
  dateSlider.addEventListener("change", () => {
    replaceHashAndRender(timeMachineHref(stat.key, timeMachineState.index));
  });
  wireShareButton();
}

function overtakeText(event) {
  const stat = statByKey(event.statKey);
  const compare = stat
    ? `<a class="feed-action" href="${hashRoute("compare", {
        stat: stat.key,
        players: [event.overtakerId, event.overtakenId],
        range: "7d"
      })}">Compare ↗</a>`
    : "";
  return `<span class="feed-text"><span class="badge overtake">overtake</span>
    <a class="who player-link" href="${playerHref(event.overtakerId)}">${esc(memberName(event.overtakerId))}</a>${favoriteBadgeHtml(event.overtakerId)}
    passed
    <a class="who player-link" href="${playerHref(event.overtakenId)}">${esc(memberName(event.overtakenId))}</a>${favoriteBadgeHtml(event.overtakenId)}
    in <strong>${esc(stat?.title ?? event.statKey)}</strong>${compare}</span>`;
}

const activityFilterState = { text: "" };

function activitySearchText(event) {
  const memberTerms = (discordId) => {
    const member = state.latest.members.find((candidate) => candidate.discordId === discordId);
    return [
      discordId,
      memberName(discordId),
      member?.displayName,
      member?.discordUsername,
      member?.eaName,
      member?.profileName,
      member?.personaId,
      member?.nucleusId
    ];
  };
  const stat = statByKey(event.statKey);
  return [
    ...memberTerms(event.overtakerId),
    ...memberTerms(event.overtakenId),
    event.statKey,
    stat?.title,
    stat?.label
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function auditOutcome(event) {
  return event.outcome ?? "success";
}

function auditActionLabel(action) {
  return (
    {
      linked: "linked",
      relinked: "relinked",
      unlinked: "unlinked",
      unlisted: "unlisted",
      relisted: "relisted",
      tracker_linked: "Tracker linked",
      tracker_updated: "Tracker updated",
      tracker_unlinked: "Tracker unlinked",
      link_attempt: "link attempt",
      relink_attempt: "relink attempt",
      unlink_attempt: "unlink attempt"
    }[action] ?? action
  );
}

function auditFailureLabel(reason) {
  return (
    {
      profile_not_found: "profile not found",
      profile_already_linked: "profile already linked",
      lookup_unavailable: "lookup unavailable"
    }[reason] ?? "link failed"
  );
}

function auditMemberHtml(event) {
  const name = event.displayName ?? (event.discordId ? memberName(event.discordId) : "Unknown member");
  const member = event.discordId
    ? `<a class="who player-link" href="${playerHref(event.discordId)}">${esc(name)}</a>`
    : `<strong>${esc(name)}</strong>`;
  return `${member}${event.discordUsername ? ` <span class="mono">@${esc(event.discordUsername)}</span>` : ""}`;
}

function auditText(event) {
  const who = auditMemberHtml(event);

  if (event.action === "tracker_linked" || event.action === "tracker_updated") {
    return `<span class="feed-text"><span class="badge ${esc(event.action)}">${esc(auditActionLabel(event.action))}</span> ${who} set Tracker profile <span class="mono">${esc(event.trackerProfileId ?? "unknown")}</span></span>`;
  }
  if (event.action === "tracker_unlinked") {
    return `<span class="feed-text"><span class="badge tracker_unlinked">Tracker unlinked</span> ${who} removed their Tracker profile mapping</span>`;
  }

  if (auditOutcome(event) === "failed") {
    return `<span class="feed-text"><span class="badge failed">failed</span> ${auditMemberHtml(event)} could not ${
      event.action === "relink_attempt" ? "relink" : "link"
    } EA account <span class="mono">${esc(event.eaName ?? "unknown")}</span> <span class="muted">(${esc(
      auditFailureLabel(event.failureReason)
    )})</span></span>`;
  }

  if (event.action === "unlinked") {
    return `<span class="feed-text"><span class="badge unlinked">unlinked</span> ${who} detached EA account <span class="mono">${esc(
      event.eaName ?? "unknown"
    )}</span>${event.profileName ? ` (${esc(event.profileName)})` : ""}</span>`;
  }
  if (event.action === "relinked") {
    return `<span class="feed-text"><span class="badge relinked">relinked</span> ${who} switched <span class="mono">${esc(
      event.previousEaName ?? "?"
    )}</span> <span class="arrow">→</span> <span class="mono">${esc(event.eaName)}</span></span>`;
  }
  return `<span class="feed-text"><span class="badge linked">linked</span> ${who} linked EA account <span class="mono">${esc(
    event.eaName ?? "?"
  )}</span>${event.profileName ? ` (${esc(event.profileName)})` : ""}</span>`;
}

function renderActivity() {
  if (failedDataFiles.has("data/notifications.json")) {
    app.innerHTML = `<div class="error-box" role="alert"><strong>Activity data is temporarily unavailable.</strong><br>Leaderboards and other pages are unaffected.</div>`;
    return;
  }
  const items = (state.notifications.events ?? [])
    .map((event) => ({
      at: event.at,
      html: overtakeText(event),
      search: activitySearchText(event),
      favorited: isFavorite(event.overtakerId) || isFavorite(event.overtakenId)
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 120);

  app.innerHTML = `
    <div class="activity-toolbar">
      <div class="activity-heading-row">
        <h1 class="page-title">Activity</h1>
        <label class="player-search"><span class="sr-only">Search overtake activity</span><input id="activity-search" type="search" placeholder="Search players or stats" autocomplete="off" value="${esc(activityFilterState.text)}"></label>
      </div>
      <p class="page-sub">Recent leaderboard overtakes</p>
    </div>
    ${
      items.length
        ? `<div class="feed">${items
            .map((item) => `<div class="feed-item${item.favorited ? " favorited" : ""}" data-activity-search="${esc(item.search)}"><span class="feed-date">${fmtDateTime(item.at)}</span>${item.html}</div>`)
            .join("")}</div><p id="activity-search-empty" class="empty" hidden>No overtake activity matches that search.</p>`
        : `<div class="empty">No overtakes yet — this feed records leaderboard changes only.</div>`
    }`;

  const search = document.getElementById("activity-search");
  const cards = [...app.querySelectorAll("[data-activity-search]")];
  const empty = document.getElementById("activity-search-empty");
  const applyFilter = () => {
    activityFilterState.text = search.value;
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const card of cards) {
      card.hidden = Boolean(query) && !card.dataset.activitySearch.includes(query);
      if (!card.hidden) visible += 1;
    }
    if (empty) empty.hidden = visible > 0;
  };
  search?.addEventListener("input", applyFilter);
  if (search) applyFilter();
}

const auditFilterState = { text: "", action: "all", outcome: "all" };

function wireFloatingTableHeader(wrapper) {
  const table = wrapper.querySelector("table");
  const sourceHead = table?.querySelector("thead");
  const siteHeader = document.querySelector(".site-header");
  if (!table || !sourceHead || !siteHeader) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "floating-table-header";
  if (wrapper.closest(".profile-equipment-table")) overlay.classList.add("profile-equipment-table");
  overlay.setAttribute("aria-hidden", "true");
  const cloneTable = table.cloneNode(false);
  cloneTable.append(sourceHead.cloneNode(true));
  overlay.append(cloneTable);
  if (sourceHead.querySelector(".sort-button")) {
    overlay.classList.add("sortable");
    for (const button of cloneTable.querySelectorAll(".sort-button")) {
      button.tabIndex = -1;
    }
    overlay.addEventListener("click", (event) => {
      const clonedButton = event.target.closest(".sort-button[data-sort-key]");
      if (!clonedButton) {
        return;
      }
      const sourceButton = [...sourceHead.querySelectorAll(".sort-button[data-sort-key]")]
        .find((button) => button.dataset.sortKey === clonedButton.dataset.sortKey);
      sourceButton?.click();
    });
  }
  document.body.append(overlay);

  const syncWidths = () => {
    cloneTable.style.width = `${table.offsetWidth}px`;
    const sourceCells = sourceHead.querySelectorAll("th");
    const clonedCells = cloneTable.querySelectorAll("th");
    for (const [index, cell] of sourceCells.entries()) {
      const width = `${cell.getBoundingClientRect().width}px`;
      clonedCells[index].style.width = width;
      clonedCells[index].style.minWidth = width;
      clonedCells[index].style.maxWidth = width;
    }
  };

  const update = () => {
    const wrapperRect = wrapper.getBoundingClientRect();
    const headerBottom = Math.max(0, siteHeader.getBoundingClientRect().bottom);
    const headerHeight = sourceHead.getBoundingClientRect().height;
    const visible = wrapperRect.top < headerBottom && wrapperRect.bottom > headerBottom + headerHeight;
    overlay.hidden = !visible;
    if (!visible) {
      return;
    }

    overlay.style.top = `${Math.round(headerBottom)}px`;
    overlay.style.left = `${Math.round(wrapperRect.left)}px`;
    overlay.style.width = `${Math.round(wrapperRect.width)}px`;
    overlay.style.height = `${Math.round(headerHeight)}px`;
    cloneTable.style.transform = `translateX(${-wrapper.scrollLeft}px)`;
  };

  let frame = null;
  const scheduleUpdate = () => {
    if (frame !== null) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  };

  syncWidths();
  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  wrapper.addEventListener("scroll", scheduleUpdate, { passive: true });
  const handleResize = () => {
    syncWidths();
    scheduleUpdate();
  };
  window.addEventListener("resize", handleResize);
  const observer = new ResizeObserver(handleResize);
  observer.observe(wrapper);
  observer.observe(sourceHead);
  floatingHeaderCleanups.push(() => {
    window.removeEventListener("scroll", scheduleUpdate);
    wrapper.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", handleResize);
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    overlay.remove();
  });
}

// Keep column labels visible on every long table (Leaderboard, Time Machine,
// Audit Log): pin a fixed clone of each table's header row just below the
// sticky site header while the real header is scrolled out of view.
function wireFloatingTableHeaders() {
  for (const cleanup of floatingHeaderCleanups) cleanup();
  floatingHeaderCleanups = [];
  for (const wrapper of app.querySelectorAll(".table-wrap")) {
    wireFloatingTableHeader(wrapper);
  }
}

function renderAudit() {
  if (failedDataFiles.has("data/audit.json")) {
    app.innerHTML = `<div class="error-box" role="alert"><strong>Audit data is temporarily unavailable.</strong><br>Leaderboards and other pages are unaffected.</div>`;
    return;
  }
  const events = [...(state.audit.events ?? [])].reverse();
  const filtered = events.filter((event) => {
    if (auditFilterState.action !== "all" && event.action !== auditFilterState.action) {
      return false;
    }
    if (auditFilterState.outcome !== "all" && auditOutcome(event) !== auditFilterState.outcome) {
      return false;
    }
    return true;
  });

  // The text filter hides rows that are already on the page rather than
  // rebuilding it. Re-rendering per keystroke destroyed the input the keystroke
  // came from, and focus went with it -- one letter per click into the box.
  // Activity and Players have always filtered in place; this now matches.
  const searchIndex = (event) => [
    event.displayName,
    event.discordUsername,
    event.eaName,
    event.previousEaName,
    event.profileName,
    event.playerId,
    event.nucleusId,
    event.trackerProfileId,
    event.previousTrackerProfileId,
    event.requesterUsername,
    event.failureReason
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  app.innerHTML = `
    <h1 class="page-title">Audit Log</h1>
    <p class="page-sub">Completed profile and roster visibility changes, imported Tracker mappings, and failed link attempts</p>
    <div class="filter-row">
      <input type="search" id="audit-search" placeholder="Filter by name, EA account, player, nucleus, or Tracker.gg ID…" value="${esc(auditFilterState.text)}" />
      <select id="audit-action">
        ${["all", "linked", "relinked", "unlinked", "unlisted", "relisted", "tracker_linked", "tracker_updated", "tracker_unlinked", "link_attempt", "relink_attempt"]
          .map(
            (action) =>
              `<option value="${action}" ${auditFilterState.action === action ? "selected" : ""}>${
                action === "all" ? "All actions" : auditActionLabel(action)
              }</option>`
          )
          .join("")}
      </select>
      <select id="audit-outcome">
        ${["all", "success", "failed"]
          .map(
            (outcome) =>
              `<option value="${outcome}" ${auditFilterState.outcome === outcome ? "selected" : ""}>${
                outcome === "all" ? "All results" : outcome
              }</option>`
          )
          .join("")}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Result</th><th>Discord member</th><th>EA account</th><th>Persona / Player ID</th><th>User / Nucleus ID</th><th>Platform</th><th>Tracker.gg ID</th></tr></thead>
        <tbody>${filtered
          .map(
            (event) => `<tr data-audit-search="${esc(searchIndex(event))}">
              <td><span class="mono">${fmtDateTime(event.at)}</span></td>
              <td><span class="badge ${esc(event.action)}">${esc(auditActionLabel(event.action))}</span></td>
              <td><span class="badge ${esc(auditOutcome(event))}"${event.failureReason ? ` title="${esc(auditFailureLabel(event.failureReason))}"` : ""}>${esc(auditOutcome(event))}</span></td>
              <td>${auditMemberHtml(event)}</td>
              <td>${
                event.action === "relinked" || event.action === "relink_attempt"
                  ? `<span class="mono">${esc(event.previousEaName ?? "?")}</span> <span class="arrow">→</span> <span class="mono">${esc(event.eaName)}</span>`
                  : `<span class="mono">${esc(event.eaName ?? "—")}</span>`
              }</td>
              <td class="mono">${esc(event.playerId ?? "—")}</td>
              <td class="mono">${esc(event.nucleusId ?? "—")}</td>
              <td class="mono">${esc(event.platform ?? "—")}</td>
              <td class="mono">${esc(event.trackerProfileId ?? "—")}</td>
            </tr>`
          )
          .join("") || `<tr><td colspan="9" class="empty">No matching events.</td></tr>`}
          <tr id="audit-search-empty" hidden><td colspan="9" class="empty">No matching events.</td></tr></tbody>
      </table>
    </div>`;

  const search = document.getElementById("audit-search");
  const rows = [...app.querySelectorAll("[data-audit-search]")];
  const searchEmpty = document.getElementById("audit-search-empty");
  const applyTextFilter = () => {
    auditFilterState.text = search.value;
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      row.hidden = Boolean(query) && !row.dataset.auditSearch.includes(query);
      if (!row.hidden) visible += 1;
    }
    if (searchEmpty) searchEmpty.hidden = visible > 0 || rows.length === 0;
  };
  search.addEventListener("input", applyTextFilter);
  // A dropdown change rebuilds the rows, so the typed filter is reapplied.
  applyTextFilter();
  document.getElementById("audit-action").addEventListener("change", (event) => {
    auditFilterState.action = event.target.value;
    render();
  });
  document.getElementById("audit-outcome").addEventListener("change", (event) => {
    auditFilterState.outcome = event.target.value;
    render();
  });
}

/* ---------- effectiveness lab ---------- */

const EFFECTIVENESS_KEYS = ["trident", "sortino", "alpha"];

function effectivenessScoreText(key, value) {
  if (key === "alpha") return `${value >= 0 ? "+" : ""}${value.toFixed(2)} pp`;
  return value.toFixed(1);
}

function effectivenessTabsHtml(activeKey) {
  return `<div class="effectiveness-tabs" role="navigation" aria-label="Effectiveness measures">${EFFECTIVENESS_KEYS.map((key, index) => {
    const definition = effectivenessDefinitions[key];
    const subtitle = key === "trident" ? "balanced all-round value" : key === "sortino" ? "risk-adjusted impact" : "wins above expectation";
    return `<a class="effectiveness-tab ${key === activeKey ? "active" : ""}" href="#/effectiveness/${key}">
      <span class="effectiveness-tab-number">0${index + 1}</span>
      <span><strong>${esc(definition.title)}</strong><small>${subtitle}</small></span>
    </a>`;
  }).join("")}</div>`;
}

function effectivenessMethodHtml(key, constants) {
  if (key === "trident") {
    return `<div class="effectiveness-method-grid">
      <div class="formula-card">
        <div class="formula-kicker">The equation</div>
        <p class="measure-summary">A balanced overall rating of combat, Breakthrough objective play, and teamwork. It rewards complete players while preventing one exceptional specialty from dominating the result.</p>
        <div class="formula">CEI = C<sup>0.40</sup> &times; O<sup>0.30</sup> &times; T<sup>0.30</sup></div>
        <p>A weighted geometric mean of three 2&ndash;98 clan percentiles. The geometric mean is the anti-one-trick device: a missing pillar drags the whole score down, while a strength can still carry its fair share.</p>
      </div>
      <div class="pillar-list">
        <div><span class="pillar-letter combat">C</span><p><strong>Combat</strong><br>A 70/30 blend of the weighted geometric and arithmetic scores for Player K/D (30%), Player Kills/Min (30%), Player Kills per match (10%), assists/hour (10%), weapon-adjusted Accuracy (10%), and weapon-adjusted Headshot % (10%). Aim is part of Combat, not a separate CEI pillar.</p></div>
        <div><span class="pillar-letter objective">O</span><p><strong>Breakthrough Objective</strong><br>Captures and neutralizations (50%), objective-zone presence (30%), and time attacking or defending objectives (20%).</p></div>
        <div><span class="pillar-letter teamwork">T</span><p><strong>Teamwork</strong><br>70% best + 30% second-best of Medic, Logistics and Intel lanes. Specialists count, but one spammed action cannot own the score.</p></div>
      </div>
    </div>`;
  }
  if (key === "sortino") {
    return `<div class="effectiveness-method-grid">
      <div class="formula-card">
        <div class="formula-kicker">The equation</div>
        <p class="measure-summary">A risk-adjusted rating of how much useful impact a player produces relative to their death exposure. It favors efficient, repeatable contribution over reckless volume.</p>
        <div class="formula formula-small">RAIS<sub>raw</sub> = (0.40C + 0.30O + 0.30T) &divide; (Deaths/hr &divide; ${constants.medianDeathsPerHour.toFixed(1)})<sup>0.35</sup></div>
        <p>The published score is the raw result's 2&ndash;98 clan percentile. Following a downside-risk framework, only deaths are penalized. The mild exponent and capped penalty keep a cautious camper from winning merely by avoiding deaths.</p>
      </div>
      <div class="pillar-list">
        <div><span class="pillar-letter combat">&uarr;</span><p><strong>Upside production</strong><br>Combat supplies 40%; objective pressure and teamwork supply 30% each. A strong gun alone is not enough.</p></div>
        <div><span class="pillar-letter risk">&darr;</span><p><strong>Downside exposure</strong><br>Deaths per hour versus the clan median. The adjustment is deliberately soft and capped from 0.72&times; to 1.40&times;.</p></div>
        <div><span class="pillar-letter teamwork">%</span><p><strong>Clan-relative finish</strong><br>The final percentile makes the number readable: 90 means the player beats roughly 90% of the current tracked field on risk-adjusted impact.</p></div>
      </div>
    </div>`;
  }
  return `<div class="effectiveness-method-grid">
    <div class="formula-card">
      <div class="formula-kicker">The equation</div>
      <p class="measure-summary">The percentage-point gap between a player's stabilized win rate and the rate predicted by their Combat, Objective, and Teamwork profile. A positive residual means they win more often than their visible statistics predict.</p>
      <div class="formula formula-small">WRR = weighted Breakthrough Win% &minus; expected Win%(zC, zO, zT)</div>
      <p>Observed win rate blends Breakthrough results from Season 1 (20%), Season 2 (35%), and Season 3 (45%). Each season is stabilized with a ${constants.seasonWinPriorMatches}-match clan prior before weighting; expected win rate comes from a leave-one-player-out ridge model (&lambda;=${constants.ridgeLambda}).</p>
    </div>
    <div class="pillar-list">
      <div><span class="pillar-letter combat">W</span><p><strong>Observed winning</strong><br>Breakthrough wins and losses by season, with Season 3 weighted most heavily so recent improvement matters more.</p></div>
      <div><span class="pillar-letter objective">E</span><p><strong>Expected winning</strong><br>The model asks what win rate normally accompanies the same combat, objective and teamwork profile.</p></div>
      <div><span class="pillar-letter risk">&epsilon;</span><p><strong>The unexplained gap</strong><br>Potential squad leadership, positioning, comms and timing live here&mdash;along with team-stack effects. Treat the residual as a clue, not proof of causation.</p></div>
    </div>
  </div>`;
}

function effectivenessPodiumHtml(key, ranking) {
  return `<div class="podium effectiveness-podium">${ranking.slice(0, 3).map((row, index) => `<div class="podium-card p${index + 1}">
    <div class="podium-rank">#${index + 1}${index === 0 ? " &middot; STANDARD BEARER" : ""}</div>
    <div class="podium-name"><a class="player-link" href="${playerHref(row.discordId)}">${esc(row.name)}</a></div>
    <div class="podium-value">${effectivenessScoreText(key, row.scores[key])}</div>
    <div class="podium-delta">C ${row.pillars.combat.toFixed(0)} &middot; O ${row.pillars.objective.toFixed(0)} &middot; T ${row.pillars.teamwork.toFixed(0)}</div>
  </div>`).join("")}</div>`;
}

function effectivenessBarsHtml(key, ranking) {
  const top = ranking.slice(0, 10);
  const values = ranking.map((row) => row.scores[key]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `<div class="effectiveness-chart" role="img" aria-label="Top ten ${esc(effectivenessDefinitions[key].title)} scores">
    <div class="effectiveness-chart-title">Top 10 at a glance</div>
    ${top.map((row, index) => {
      const width = 12 + 88 * ((row.scores[key] - min) / Math.max(0.001, max - min));
      return `<div class="effectiveness-bar-row"><span class="effectiveness-bar-rank">${index + 1}</span><span class="effectiveness-bar-name">${esc(row.name)}</span><span class="effectiveness-bar-track"><span style="width:${width.toFixed(1)}%"></span></span><strong>${effectivenessScoreText(key, row.scores[key])}</strong></div>`;
    }).join("")}
  </div>`;
}

function breakdownStatHtml(label, value, context = "") {
  return `<div class="breakdown-stat"><span>${esc(label)}</span><strong>${value}</strong>${context ? `<small>${context}</small>` : ""}</div>`;
}

function effectivenessBreakdownHtml(key, row) {
  const p = row.percentiles;
  if (key === "trident") {
    return `<div class="score-breakdown">
      <div class="breakdown-equation"><span>CEI calculation</span><div>CEI = ${row.pillars.combat.toFixed(1)}<sup>0.40</sup> &times; ${row.pillars.objective.toFixed(1)}<sup>0.30</sup> &times; ${row.pillars.teamwork.toFixed(1)}<sup>0.30</sup> = <strong>${row.scores.trident.toFixed(1)}</strong></div></div>
      <div class="breakdown-pillar-grid">
        ${breakdownStatHtml("Combat pillar", row.pillars.combat.toFixed(1), "40% of CEI")}
        ${breakdownStatHtml("Balanced Combat", row.combatGeometric.toFixed(1), "70% of Combat · geometric mean")}
        ${breakdownStatHtml("Additive Combat", row.combatArithmetic.toFixed(1), "30% of Combat · arithmetic mean")}
        ${breakdownStatHtml("Objective pillar", row.pillars.objective.toFixed(1), "30% of CEI")}
        ${breakdownStatHtml("Teamwork pillar", row.pillars.teamwork.toFixed(1), `30% of CEI · ${row.bestSupportLanes.join(" + ")}`)}
      </div>
      <div class="breakdown-subhead">Combat inputs</div>
      <div class="breakdown-input-grid">
        ${breakdownStatHtml("Player K/D", row.raw.infantryKd.toFixed(2), `${p.infantryKd.toFixed(0)}th percentile · 30% of Combat`)}
        ${breakdownStatHtml("Player Kills / Min", row.raw.infantryKpm.toFixed(2), `${p.infantryKpm.toFixed(0)}th percentile · 30%`)}
        ${breakdownStatHtml("Player Kills / match", row.raw.playerKillsPerMatch.toFixed(1), `${p.playerKillsPerMatch.toFixed(0)}th percentile · 10%`)}
        ${breakdownStatHtml("Assists / hour", row.raw.assistsPerHour.toFixed(1), `${p.assistsPerHour.toFixed(0)}th percentile · 10%`)}
        ${breakdownStatHtml("Accuracy, weapon-adjusted", `${row.raw.accuracy.toFixed(1)}%`, `expected ${row.expectedAccuracy.toFixed(1)}% · ${p.accuracyResidual.toFixed(0)}th percentile · 10%`)}
        ${breakdownStatHtml("Headshots, weapon-adjusted", `${row.raw.headshotPercent.toFixed(1)}%`, `expected ${row.expectedHeadshotPercent.toFixed(1)}% · ${p.headshotResidual.toFixed(0)}th percentile · 10%`)}
      </div>
      <p class="breakdown-note">CEI rewards balance: because the three pillars use a geometric mean, a weak pillar pulls the overall score down.</p>
    </div>`;
  }

  if (key === "sortino") {
    const medianDeaths = state.effectiveness.constants.medianDeathsPerHour;
    const deathRatio = row.adjusted.deathsPerHour / medianDeaths;
    return `<div class="score-breakdown">
      <div class="breakdown-equation"><span>RAIS calculation</span><div>RAIS<sub>raw</sub> = ${row.sortinoUpside.toFixed(1)} &divide; ${row.sortinoDownside.toFixed(3)} = ${row.sortinoRaw.toFixed(1)} &rarr; <strong>${row.scores.sortino.toFixed(1)} percentile</strong></div></div>
      <div class="breakdown-subhead">Upside production</div>
      <div class="breakdown-pillar-grid">
        ${breakdownStatHtml("Weighted upside", row.sortinoUpside.toFixed(1), "0.40C + 0.30O + 0.30T")}
        ${breakdownStatHtml("Combat pillar", row.pillars.combat.toFixed(1), "40% of upside")}
        ${breakdownStatHtml("Objective pillar", row.pillars.objective.toFixed(1), "30% of upside")}
        ${breakdownStatHtml("Teamwork pillar", row.pillars.teamwork.toFixed(1), "30% of upside")}
      </div>
      <div class="breakdown-subhead">Death-risk adjustment</div>
      <div class="breakdown-input-grid">
        ${breakdownStatHtml("Deaths / hour", row.adjusted.deathsPerHour.toFixed(1), "player death exposure")}
        ${breakdownStatHtml("Clan median", medianDeaths.toFixed(1), `player is ${deathRatio.toFixed(2)}&times; median`)}
        ${breakdownStatHtml("Downside multiplier", row.sortinoDownside.toFixed(3), `(${deathRatio.toFixed(2)})<sup>0.35</sup> · capped 0.72–1.40`)}
        ${breakdownStatHtml("Raw RAIS", row.sortinoRaw.toFixed(1), "upside &divide; downside")}
        ${breakdownStatHtml("Clan percentile", row.scores.sortino.toFixed(1), "published RAIS score")}
      </div>
      <p class="breakdown-note">A multiplier above 1 reduces the upside score; below 1 increases it. The soft exponent keeps low-death passive play from dominating RAIS.</p>
    </div>`;
  }

  const seasonHtml = Object.entries({ Season1: "Season 1", Season2: "Season 2", Season3: "Season 3" }).map(([seasonId, label]) => {
    const season = row.seasonWinRates[seasonId];
    return season
      ? breakdownStatHtml(`${label} · ${(season.weight * 100).toFixed(0)}%`, `${(season.rawRate * 100).toFixed(1)}%`, `${season.wins}-${season.losses} · stabilized ${(season.smoothedRate * 100).toFixed(1)}%`)
      : breakdownStatHtml(label, "No record");
  }).join("");
  return `<div class="score-breakdown">
    <div class="breakdown-equation"><span>WRR calculation</span><div>WRR = ${row.smoothedWinPercent.toFixed(1)}% &minus; ${row.expectedWinPercent.toFixed(1)}% = <strong>${effectivenessScoreText("alpha", row.scores.alpha)}</strong></div></div>
    <div class="breakdown-pillar-grid">
      ${breakdownStatHtml("Stabilized Win%", `${row.smoothedWinPercent.toFixed(1)}%`, "weighted observed Breakthrough winning")}
      ${breakdownStatHtml("Expected Win%", `${row.expectedWinPercent.toFixed(1)}%`, "predicted from the visible pillar profile")}
      ${breakdownStatHtml("Win Rate Residual", effectivenessScoreText("alpha", row.scores.alpha), row.scores.alpha >= 0 ? "winning above expectation" : "winning below expectation")}
    </div>
    <div class="breakdown-subhead">Observed Breakthrough winning</div>
    <div class="breakdown-season-grid">${seasonHtml}</div>
    <div class="breakdown-subhead">Expected-win model inputs</div>
    <div class="breakdown-input-grid">
      ${breakdownStatHtml("Combat profile", row.pillars.combat.toFixed(1), `z-score ${row.model.combat >= 0 ? "+" : ""}${row.model.combat.toFixed(2)}`)}
      ${breakdownStatHtml("Objective profile", row.pillars.objective.toFixed(1), `z-score ${row.model.objective >= 0 ? "+" : ""}${row.model.objective.toFixed(2)}`)}
      ${breakdownStatHtml("Teamwork profile", row.pillars.teamwork.toFixed(1), `z-score ${row.model.teamwork >= 0 ? "+" : ""}${row.model.teamwork.toFixed(2)}`)}
    </div>
    <p class="breakdown-note">WRR is the unexplained percentage-point gap after comparing this player with the rest of the clan. It can suggest positioning, coordination, or team effects, but does not prove individual causation.</p>
  </div>`;
}

function effectivenessTableHtml(key, ranking) {
  const header = key === "alpha"
    ? `${sortableHeaderHtml("Residual", "score", effectivenessSortState, { numeric: true })}${sortableHeaderHtml("Win%", "win", effectivenessSortState, { numeric: true })}${sortableHeaderHtml("Expected", "expected", effectivenessSortState, { numeric: true })}`
    : key === "sortino"
      ? `${sortableHeaderHtml("Score", "score", effectivenessSortState, { numeric: true })}${sortableHeaderHtml("Upside", "upside", effectivenessSortState, { numeric: true })}${sortableHeaderHtml("Deaths/hr", "deaths", effectivenessSortState, { numeric: true })}`
      : `${sortableHeaderHtml("Score", "score", effectivenessSortState, { numeric: true })}<th>Support lanes</th>`;
  const columnCount = key === "trident" ? 7 : 8;
  const sortableRanking = ranking.map((row, index) => ({ ...row, originalRank: index + 1 }));
  const sortedRanking = sortedRows(sortableRanking, effectivenessSortState, (row, sortKey) => ({
    rank: row.originalRank,
    player: row.name,
    score: row.scores[key],
    win: row.smoothedWinPercent,
    expected: row.expectedWinPercent,
    upside: row.sortinoUpside,
    deaths: row.adjusted.deathsPerHour,
    combat: row.pillars.combat,
    objective: row.pillars.objective,
    teamwork: row.pillars.teamwork
  })[sortKey]);
  const rows = sortedRanking.map((row) => {
    const detail = key === "alpha"
      ? `<td class="num value-cell ${row.scores.alpha >= 0 ? "positive-score" : "negative-score"}">${effectivenessScoreText(key, row.scores.alpha)}</td><td class="num">${row.smoothedWinPercent.toFixed(1)}%</td><td class="num">${row.expectedWinPercent.toFixed(1)}%</td>`
      : key === "sortino"
        ? `<td class="num value-cell">${row.scores.sortino.toFixed(1)}</td><td class="num">${row.sortinoUpside.toFixed(1)}</td><td class="num">${row.adjusted.deathsPerHour.toFixed(1)}</td>`
        : `<td class="num value-cell">${row.scores.trident.toFixed(1)}</td><td>${row.bestSupportLanes.map((lane) => lane[0].toUpperCase() + lane.slice(1)).join(" + ")}</td>`;
    const detailId = `score-detail-${key}-${row.discordId}`;
    return `<tr class="r${row.originalRank}${isFavorite(row.discordId) ? " fav-row" : ""}"><td class="rank-cell">${row.originalRank}</td><td><div class="ranking-player-cell"><a class="player-link" href="${playerHref(row.discordId)}">${esc(row.name)}</a>${favoriteBadgeHtml(row.discordId)}${row.cachedStats ? cachedMarkerHtml() : ""}<button class="rank-detail-toggle" type="button" aria-expanded="false" aria-controls="${detailId}" data-detail-id="${detailId}">Breakdown</button></div></td>${detail}<td class="num pillar-score">${row.pillars.combat.toFixed(1)}</td><td class="num pillar-score">${row.pillars.objective.toFixed(1)}</td><td class="num pillar-score">${row.pillars.teamwork.toFixed(1)}</td></tr>
      <tr class="rank-detail-row" id="${detailId}" hidden><td colspan="${columnCount}">${effectivenessBreakdownHtml(key, row)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap effectiveness-table"><table><thead><tr>${sortableHeaderHtml("#", "rank", effectivenessSortState)}${sortableHeaderHtml("Player", "player", effectivenessSortState)}${header}${sortableHeaderHtml("Combat", "combat", effectivenessSortState, { numeric: true })}${sortableHeaderHtml("Objective", "objective", effectivenessSortState, { numeric: true })}${sortableHeaderHtml("Teamwork", "teamwork", effectivenessSortState, { numeric: true })}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function wireEffectivenessBreakdowns() {
  for (const button of app.querySelectorAll(".rank-detail-toggle")) {
    button.addEventListener("click", () => {
      const detail = document.getElementById(button.dataset.detailId);
      if (!detail) return;
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      button.textContent = expanded ? "Breakdown" : "Hide breakdown";
      detail.hidden = expanded;
    });
  }
}

function renderEffectiveness(requestedKey) {
  const key = EFFECTIVENESS_KEYS.includes(requestedKey) ? requestedKey : "trident";
  prepareSortState(effectivenessSortState, key);
  const calculation = state.effectiveness;
  if (failedDataFiles.has("data/effectiveness-history.json")) {
    app.innerHTML = `<div class="error-box" role="alert"><strong>Effectiveness data is temporarily unavailable.</strong><br>Leaderboards and other pages are unaffected.</div>`;
    return;
  }
  if (!calculation?.rows?.length) {
    app.innerHTML = `<div class="error-box"><strong>Effectiveness data has not been published yet.</strong><br>The next tracker refresh will generate it.</div>`;
    return;
  }
  const ranking = [...calculation.rows].sort((a, b) => b.scores[key] - a.scores[key]);
  const definition = effectivenessDefinitions[key];
  const recommendation = key === "trident" ? "Best default overall ranking" : key === "sortino" ? "Best for efficient, repeatable impact" : "Best for finding hidden winning influence";
  app.innerHTML = `
    <div class="effectiveness-hero">
      <div class="effectiveness-eyebrow">KDM analytics &middot; snapshot ${esc(calculation.archiveDate ?? "latest")}</div>
      <h1 class="page-title">The Effectiveness Lab</h1>
      <p class="page-sub">Three answers to one messy Battlefield question: who creates the most value? Each lens is calibrated for KDM's primary mode, Breakthrough.</p>
    </div>
    ${effectivenessTabsHtml(key)}
    <div class="measure-heading"><div><span class="measure-number">PROPOSAL 0${EFFECTIVENESS_KEYS.indexOf(key) + 1}</span><h2>${esc(definition.title)}</h2></div><p>${recommendation}</p></div>
    ${effectivenessMethodHtml(key, calculation.constants)}
    ${effectivenessPodiumHtml(key, ranking)}
    ${effectivenessBarsHtml(key, ranking)}
    <div class="ranking-heading"><h2>Full KDM ranking</h2><p>${ranking.length} tracked players &middot; rates and stabilized percentages, never lifetime-volume totals</p></div>
    ${effectivenessTableHtml(key, ranking)}`;
  wireEffectivenessBreakdowns();
  wireSortableHeaders(effectivenessSortState);
}

/* ---------- route-level loading ---------- */

async function fetchJson(path, fallback, { essential = false } = {}) {
  try {
    // `path` stays the repository-relative logical name so failure messages and
    // the failedDataFiles keys remain readable; only the request is redirected.
    const response = await fetch(dataUrl(path), dataFetchOptions());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    failedDataFiles.delete(path);
    if (essential) {
      const index = failedBootFiles.indexOf(path);
      if (index >= 0) failedBootFiles.splice(index, 1);
    }
    return value;
  } catch {
    failedDataFiles.add(path);
    if (essential && !failedBootFiles.includes(path)) failedBootFiles.push(path);
    return fallback;
  }
}

function loadData(key, path, fallback, options = {}) {
  if (dataLoads.has(key)) return dataLoads.get(key);
  const load = fetchJson(path, fallback, options).then((value) => {
    state[key] = value;
    if (failedDataFiles.has(path)) dataLoads.delete(key);
    return value;
  });
  dataLoads.set(key, load);
  return load;
}

async function loadBaseData() {
  const [meta, latest] = await Promise.all([
    loadData("meta", "data/meta.json", null, { essential: true }),
    loadData("latest", "data/latest.json", { members: [] }, { essential: true })
  ]);
  state.meta = meta;
  state.latest = latest;
}

async function loadHistoryData() {
  const [history, historyProvenanceData] = await Promise.all([
    loadData("history", "data/history.json", { dates: [], members: {} }, { essential: true }),
    loadData("historyProvenance", "data/history-provenance.json", null)
  ]);
  state.history = history;
  state.historyProvenance = historyProvenanceData;
  state.historyProvenanceIndex = buildHistoryProvenanceIndex(historyProvenanceData);
}

async function loadCountersData() {
  const counters = await loadData("counters", "data/counters.json", null);
  state.counters = counters?.dates && counters?.members ? counters : null;
  return state.counters;
}

async function loadEquipmentData() {
  const [catalogue, index] = await Promise.all([
    loadData("equipmentCatalogue", "data/equipment-catalogue.json", null),
    loadData("equipmentIndex", "data/equipment-index.json", null)
  ]);
  state.equipmentCatalogue = validEquipmentCatalogue(catalogue) ? catalogue : null;
  state.equipmentIndex = validEquipmentArtifact(index) ? index : null;
}

async function loadEffectivenessData() {
  const history = await loadData("effectivenessHistory", "data/effectiveness-history.json", null);
  state.effectivenessHistory = history?.version === 1 && Number.isInteger(history?.modelVersion) ? history : null;
  state.effectiveness = state.effectivenessHistory?.current ?? null;
}

function loadChartJs() {
  if (globalThis.Chart) return Promise.resolve(globalThis.Chart);
  if (chartJsLoad) return chartJsLoad;
  chartJsLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHART_JS_URL;
    script.integrity = CHART_JS_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(globalThis.Chart);
    script.onerror = () => {
      chartJsLoad = null;
      reject(new Error("Chart.js failed to load."));
    };
    document.head.append(script);
  });
  return chartJsLoad;
}

async function ensureRouteData(parts, params) {
  const route = parts[0] || "board";
  const loads = [];
  if (route !== "activity" && route !== "audit" && route !== "effectiveness") loads.push(loadHistoryData());
  if (["board", "players", "player", "compare"].includes(route) && params?.get("view") === "period") {
    loads.push(loadCountersData());
  }
  if (route === "activity") loads.push(loadData("notifications", "data/notifications.json", { events: [] }));
  if (route === "audit" || route === "player") loads.push(loadData("audit", "data/audit.json", { events: [] }));
  if (route === "player") loads.push(loadData("equipmentCatalogue", "data/equipment-catalogue.json", null));
  if (route === "effectiveness") loads.push(loadEffectivenessData());
  if ((route === "board" && parts[1] === "equipment") ||
      (route === "player" && equipmentViewState(params).open)) loads.push(loadEquipmentData());
  if (route === "player" || route === "compare") loads.push(loadChartJs().catch(() => null));
  await Promise.all(loads);
}

function prefetchCountersAfterCareerRender(route, params) {
  if (!["board", "players", "player", "compare"].includes(route || "board") || params?.get("view") === "period" || dataLoads.has("counters") || validCounters(state.counters)) {
    return;
  }
  const renderedHash = location.hash;
  loadCountersData().then(() => {
    if (location.hash !== renderedHash || !validCounters(state.counters) || state.counters.dates.length < 2) {
      return;
    }
    const scrollY = window.scrollY;
    Promise.resolve(render()).then(() => {
      if (location.hash === renderedHash) {
        window.scrollTo(0, scrollY);
      }
    });
  });
}

/* ---------- router ---------- */

async function render() {
  const generation = ++renderGeneration;
  const routeState = parsedHashRoute();
  try {
    await ensureRouteData(routeState.parts, routeState.params);
  } catch (error) {
    if (generation === renderGeneration) {
      app.innerHTML = `<div class="error-box" role="alert"><strong>This view could not finish loading.</strong><br>${esc(error.message)} Try refreshing.</div>`;
    }
    return;
  }
  if (generation !== renderGeneration) return;
  destroyCharts();
  for (const cleanup of floatingHeaderCleanups) {
    cleanup();
  }
  floatingHeaderCleanups = [];
  const { parts, params } = routeState;
  const [route] = parts;
  document.body.dataset.route = route || "board";
  const routePath = parts.join("/");
  if (lastRenderedRoutePath != null && routePath !== lastRenderedRoutePath) {
    customCalendarState.open = false;
  }
  lastRenderedRoutePath = routePath;

  let nav = "board";
  if (!route || route === "board") {
    renderLeaderboard(parts[1] ?? state.meta.stats[0].key, params);
  } else if (route === "players") {
    nav = "players";
    renderPlayers(params);
  } else if (route === "player") {
    nav = "players";
    renderPlayer(decodeURIComponent(parts[1] ?? ""), parts[2], params);
  } else if (route === "compare") {
    nav = "compare";
    loadCompareState(params);
    renderCompare();
  } else if (route === "history") {
    nav = "history";
    loadTimeMachineState(params);
    renderTimeMachine();
  } else if (route === "activity") {
    nav = "activity";
    renderActivity();
  } else if (route === "audit") {
    nav = "audit";
    renderAudit();
  } else if (route === "effectiveness") {
    nav = "effectiveness";
    renderEffectiveness(parts[1]);
  } else {
    renderLeaderboard(state.meta.stats[0].key, params);
  }

  if (nav === "board") wireRankingControls();

  const selectedStatKey =
    route === "board"
      ? (statByKey(parts[1]) ?? state.meta.stats[0]).key
      : route === "player"
        ? (statByKey(parts[2]) ?? state.meta.stats[0]).key
        : route === "compare"
          ? compareState.statKey
          : state.meta.stats[0].key;
  const persistentParams = viewRangeParams();
  for (const link of document.querySelectorAll("#site-nav a")) {
    if (link.dataset.nav === "board") link.href = hashRoute(`board/${selectedStatKey}`, persistentParams);
    if (link.dataset.nav === "players") link.href = hashRoute("players", persistentParams);
    if (link.dataset.nav === "compare") link.href = hashRoute("compare", { stat: selectedStatKey, ...persistentParams });
    link.classList.toggle("active", link.dataset.nav === nav);
    if (link.dataset.nav === nav) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const failureNotice = bootFailureNoticeHtml();
  if (failureNotice) {
    app.insertAdjacentHTML("afterbegin", failureNotice);
  }
  wireFloatingTableHeaders();
  prefetchCountersAfterCareerRender(route, params);
  window.scrollTo(0, 0);
}

/* ---------- boot ---------- */

const failedBootFiles = [];

// Essential files degrade the whole site when missing, so their failures get a
// visible notice; the rest (provenance, effectiveness, counters) are optional
// by design and simply switch their features off.
function bootFailureNoticeHtml() {
  if (failedBootFiles.length === 0) {
    return "";
  }
  return `<div class="error-box" role="alert"><strong>Some data failed to load</strong> (${esc(failedBootFiles.join(", "))}). Rankings may be incomplete — try refreshing.</div>`;
}

async function boot() {
  await initDataSource();
  const { status: dataStatus, failureReason } = dataSourceStatus();
  // Only a failed R2 lookup is an error. The "pages" rollback deliberately has
  // no release pointer, and must boot normally rather than being mistaken for
  // an outage - which is the whole point of keeping it as a rollback.
  if (dataStatus === "failed") {
    app.innerHTML = `<div class="error-box" role="alert"><strong>Live data is unavailable.</strong><br />
      Could not read the published release pointer${failureReason ? ` (${esc(failureReason)})` : ""}.
      This is a publication problem, not a problem with your connection — try again shortly.</div>`;
    return;
  }

  await loadBaseData();

  if (!state.meta) {
    app.innerHTML = `<div class="error-box"><strong>No data published yet.</strong><br />
      The daily update hasn't pushed its first snapshot. Check back soon.</div>`;
    return;
  }

  document.getElementById("field-roster").textContent = `${state.latest.members.length} PLAYERS / ONE CLAN`;
  const updated = document.getElementById("footer-updated");
  const age = dataAge(Date.now(), state.meta.observedAt ?? state.meta.updatedAt ?? null);
  updated.textContent = `Last updated ${fmtDateTime(state.meta.updatedAt)} ET`;
  if (age.known && age.stale) {
    updated.classList.add("stale");
    updated.textContent += ` — ${formatAge(age.ageMs)} old`;
    updated.title = age.refreshId
      ? `Newest published refresh is ${age.refreshId}. A refresh appears to have been missed.`
      : "A refresh appears to have been missed.";
  }

  window.addEventListener("hashchange", render);
  await render();
}

boot();
