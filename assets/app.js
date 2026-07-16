/* KDM BF6 Rankings — static SPA reading data/*.json published by the
   kdm-discord-bot daily update. No build step; Chart.js from CDN. */

import { effectivenessDefinitions } from "./effectiveness.js";

const app = document.getElementById("app");

const state = {
  meta: null,
  latest: null,
  history: null,
  historyProvenance: null,
  audit: null,
  notifications: null,
  effectiveness: null,
  effectivenessHistory: null
};

let charts = [];
let floatingHeaderCleanups = [];
let leaderboardSparklineRange = 14;

const SPARKLINE_RANGES = [
  { value: 1, label: "1 Day" },
  { value: 7, label: "7 Days" },
  { value: 14, label: "14 Days" },
  { value: 30, label: "30 Days" },
  { value: 90, label: "90 Days" },
  { value: "all", label: "All Time" }
];
const PLAYER_HISTORY_DEFAULT_RANGE = "all";

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

const PLATFORM_ICONS = {
  ea: {
    key: "ea",
    label: "EA",
    src: "https://api.iconify.design/simple-icons:ea.svg?color=%230d0f12"
  },
  pc: {
    key: "ea",
    label: "EA / PC",
    src: "https://api.iconify.design/simple-icons:ea.svg?color=%230d0f12"
  },
  psn: {
    key: "playstation",
    label: "PlayStation",
    src: "https://api.iconify.design/simple-icons:playstation.svg?color=%239aa3ad"
  },
  ps4: {
    key: "playstation",
    label: "PlayStation",
    src: "https://api.iconify.design/simple-icons:playstation.svg?color=%239aa3ad"
  },
  ps5: {
    key: "playstation",
    label: "PlayStation",
    src: "https://api.iconify.design/simple-icons:playstation.svg?color=%239aa3ad"
  },
  steam: {
    key: "steam",
    label: "Steam",
    src: "https://api.iconify.design/simple-icons:steam.svg?color=%239aa3ad"
  },
  xbox: {
    key: "xbox",
    label: "Xbox",
    src: "https://api.iconify.design/simple-icons:xbox.svg?color=%239aa3ad"
  },
  xboxone: {
    key: "xbox",
    label: "Xbox",
    src: "https://api.iconify.design/simple-icons:xbox.svg?color=%239aa3ad"
  },
  xboxseries: {
    key: "xbox",
    label: "Xbox",
    src: "https://api.iconify.design/simple-icons:xbox.svg?color=%239aa3ad"
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

function historyProvenance(discordId, date, statKey = null) {
  const entry = state.historyProvenance?.members?.[discordId];
  const dateEntry = entry?.dates?.[date];
  if (!dateEntry) {
    return null;
  }
  if (statKey) {
    return dateEntry.fields?.[statKey] ?? null;
  }
  return dateEntry;
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
  const entry = state.historyProvenance?.members?.[discordId];
  if (!entry) {
    return new Set();
  }
  const fields = new Set();
  for (const date of Object.values(entry.dates ?? {})) {
    for (const field of Object.keys(date.fields ?? {})) {
      fields.add(field);
    }
  }
  return fields;
}

function playerHistoryHref(discordId, statKey, showEstimated, range = PLAYER_HISTORY_DEFAULT_RANGE) {
  return hashRoute(`player/${encodeURIComponent(discordId)}/${statKey}`, {
    estimated: showEstimated ? 1 : null,
    range
  });
}

function playerRangeSelectHtml(range) {
  return `<label class="sparkline-range-select">
    <select id="player-range-select" aria-label="Player history date range">${SPARKLINE_RANGES.map(
      (option) => `<option value="${option.value}" ${option.value === range ? "selected" : ""}>${option.label}</option>`
    ).join("")}</select>
  </label>`;
}

function playerHref(discordId) {
  return `#/player/${encodeURIComponent(discordId)}`;
}

function hashRoute(route, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      query.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }
  const suffix = query.toString();
  return `#/${route}${suffix ? `?${suffix}` : ""}`;
}

function parsedHashRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const question = raw.indexOf("?");
  const path = question >= 0 ? raw.slice(0, question) : raw;
  const query = question >= 0 ? raw.slice(question + 1) : "";
  return {
    parts: path.split("/").filter(Boolean),
    params: new URLSearchParams(query)
  };
}

function replaceHashAndRender(hash, { preserveScroll = true } = {}) {
  const scrollY = window.scrollY;
  history.replaceState(null, "", hash);
  render();
  if (preserveScroll) {
    window.scrollTo(0, scrollY);
  }
}

function shareButtonHtml() {
  return `<button class="share-button" type="button">Share</button>`;
}

async function copyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (copied) {
    return;
  }
  await navigator.clipboard.writeText(text);
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

function authoritativeHistoryIndexes(statKey = null, memberIds = Object.keys(state.history.members ?? {})) {
  return state.history.dates
    .map((date, index) =>
      memberIds.some((discordId) => {
        const values = state.history.members?.[discordId]?.values ?? {};
        const statKeys = statKey ? [statKey] : Object.keys(values);
        return statKeys.some((key) => Number.isFinite(values[key]?.[index]) && !historyProvenance(discordId, date, key));
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
function rangeWindowText(range) {
  if (range === "all") {
    return "all snapshots";
  }
  if (range === 1) {
    return "the previous day";
  }
  return `the last ${range} days`;
}

function movementHtml(prevRank, currentRank, windowText = "the previous day") {
  if (prevRank == null) {
    return `<span class="movement flat" title="New to this leaderboard">NEW</span>`;
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

function statTabsHtml(activeKey, hrefFor) {
  return `<div class="stat-tabs">${state.meta.stats
    .map(
      (stat) =>
        `<button class="${stat.key === activeKey ? "active" : ""}" data-stat="${stat.key}" data-href="${hrefFor ? hrefFor(stat.key) : ""}">${esc(stat.title)}</button>`
    )
    .join("")}</div>`;
}

function wireStatTabs(onSelect) {
  for (const button of app.querySelectorAll(".stat-tabs button")) {
    button.addEventListener("click", () => {
      const href = button.dataset.href;
      if (href) {
        location.hash = href;
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

function sparklineRangeSelectHtml() {
  return `<label class="sparkline-range-select">
    <select id="sparkline-range-select" aria-label="Sparkline date range">${SPARKLINE_RANGES.map(
      (range) => `<option value="${range.value}" ${range.value === leaderboardSparklineRange ? "selected" : ""}>${range.label}</option>`
    ).join("")}</select>
  </label>`;
}

function wireSparklineRange() {
  const select = document.getElementById("sparkline-range-select");
  select?.addEventListener("change", () => {
    leaderboardSparklineRange = select.value === "all" ? "all" : Number(select.value);
    const scrollY = window.scrollY;
    render();
    window.scrollTo(0, scrollY);
  });
}

const CHART_COLORS = ["#f26522", "#60a5fa", "#4ade80", "#c084fc", "#facc15", "#22d3ee", "#fb7185", "#a3e635"];

function chartBase() {
  Chart.defaults.color = "#9aa3ad";
  Chart.defaults.borderColor = "rgba(42, 48, 56, 0.6)";
  Chart.defaults.font.family = "'Inter', 'Segoe UI', sans-serif";
}

function lineChart(canvas, labels, datasets, stat) {
  chartBase();
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: datasets.map((dataset, index) => {
        const color = CHART_COLORS[index % CHART_COLORS.length];
        return {
          ...dataset,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: labels.length > 45 ? 0 : 2.5,
          pointHoverRadius: 4,
          pointBackgroundColor: dataset.estimated?.map((estimated) => estimated ? "#facc15" : color),
          pointBorderColor: dataset.estimated?.map((estimated) => estimated ? "#facc15" : color),
          segment: {
            borderColor: (ctx) => dataset.estimated?.[ctx.p0DataIndex] || dataset.estimated?.[ctx.p1DataIndex]
              ? "#facc15"
              : color
          },
          spanGaps: true,
          tension: 0.25
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
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}${ctx.dataset.estimated?.[ctx.dataIndex] ? " (estimated)" : ""}: ${fmtStat(stat, ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { ticks: { callback: (value) => fmtStat(stat, value) } }
      }
    }
  });
  charts.push(chart);
  return chart;
}

/* ---------- views ---------- */

function renderLeaderboard(statKey) {
  const stat = statByKey(statKey) ?? state.meta.stats[0];
  const ranking = latestRanking(stat.key);
  const memberIds = Object.keys(state.history.members ?? {});
  const authoritativeIndexes = authoritativeHistoryIndexes(stat.key, memberIds);
  const lastIndex = authoritativeIndexes.at(-1) ?? -1;
  // A one-day view means yesterday-to-today, so it needs two snapshot points.
  const sparkPointCount = leaderboardSparklineRange === 1 ? 2 : leaderboardSparklineRange;
  const sparkIndexes =
    sparkPointCount === "all" ? authoritativeIndexes : authoritativeIndexes.slice(-sparkPointCount);
  const sparkStart = sparkIndexes[0] ?? lastIndex;
  // Movement and deltas compare the current standings against the start of the
  // same window the sparkline covers, so the selected range drives both.
  const windowText = rangeWindowText(leaderboardSparklineRange);
  const baselineIndex = sparkStart;
  const prevRanking =
    baselineIndex >= 0 && baselineIndex < lastIndex
      ? authoritativeBaselineRankingAt(stat.key, baselineIndex, lastIndex, memberIds)
      : [];
  const prevRankById = new Map(prevRanking.map((row, index) => [row.discordId, index + 1]));
  const prevValueById = new Map(prevRanking.map((row) => [row.discordId, row.value]));

  const podium = ranking.slice(0, 3);
  const podiumHtml = podium.length
    ? `<div class="podium">${podium
        .map((row, index) => {
          const delta = fmtDelta(stat, row.value - (prevValueById.get(row.discordId) ?? NaN));
          return `<div class="podium-card p${index + 1}">
            <div class="podium-rank">#${index + 1}${index === 0 ? " · TOP DOG" : ""}</div>
            <div class="podium-name"><a class="player-link" href="${playerHref(row.discordId)}">${esc(memberName(row.discordId))}</a></div>
            <div class="podium-value">${fmtStat(stat, row.value)} <span class="podium-stat-label">${esc(stat.title)}</span></div>
            <div class="podium-delta">${delta ? `${delta} vs ${windowText}` : "&nbsp;"}</div>
          </div>`;
        })
        .join("")}</div>`
    : "";

  const rows = ranking
    .map((row, index) => {
      const rank = index + 1;
      const prevRank = prevRankById.get(row.discordId) ?? null;
      const prevValue = prevValueById.get(row.discordId);
      const delta = fmtDelta(stat, row.value - (prevValue ?? NaN));
      const deltaClass = delta ? (row.value > prevValue ? "up" : "down") : "flat";
      const values = series(row.discordId, stat.key);
      const spark = sparkIndexes.map((historyIndex) =>
        historyProvenance(row.discordId, state.history.dates[historyIndex], stat.key) ? null : values[historyIndex]
      );
      const cached = row.member?.cachedStats ? cachedMarkerHtml() : "";
      return `<tr class="r${rank}">
        <td class="rank-cell">${rank}</td>
        <td>${movementHtml(prevRank, rank, windowText)}</td>
        <td><a class="player-link" href="${playerHref(row.discordId)}">${esc(memberName(row.discordId))}</a>${cached}</td>
        <td class="num value-cell">${fmtStat(stat, row.value)}</td>
        <td class="num"><span class="delta ${deltaClass}">${delta ?? "–"}</span></td>
        <td>${sparklineSvg(spark)}</td>
      </tr>`;
    })
    .join("");

  app.innerHTML = `
    <h1 class="page-title">${esc(stat.title)} Leaderboard</h1>
    <p class="page-sub">Movement, deltas, and sparkline reflect ${sparklineRangeSelectHtml()} · comparing to ${windowText}</p>
    ${statTabsHtml(stat.key, (key) => `/board/${key}`)}
    ${podiumHtml}
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Δ</th><th>Player</th><th class="num">${esc(stat.title)}</th><th class="num">Change</th><th>Trend</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">No stats yet.</td></tr>`}</tbody>
      </table>
    </div>
    ${cachedFootnoteHtml(ranking.some((row) => row.member?.cachedStats))}`;
  wireStatTabs();
  wireSparklineRange();
}

function renderPlayers() {
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

  app.innerHTML = `
    <div class="players-toolbar"><div>
    <h1 class="page-title">Players</h1>
    <p class="page-sub">${sorted.length} linked member(s) · click a player for full history</p>
      </div>
      <label class="player-search"><span class="sr-only">Search players</span><input id="player-search" type="search" placeholder="Search players" autocomplete="off"></label>
    </div>
    <div class="player-grid">${sorted
      .map(
        (member) => `<a class="player-card" data-player-search="${esc(playerSearchText(member))}" href="${playerHref(member.discordId)}">
          <div class="player-card-name"><span title="${esc(member.displayName ?? member.discordId)}">${esc(member.displayName ?? member.discordId)}</span>${platformIconHtml(member.platform)}${
            member.cachedStats ? cachedMarkerHtml() : ""
          }</div>
          <div class="player-card-sub">${esc(member.profileName ?? member.eaName ?? "")}</div>
          <div class="player-card-stats">
            <div class="mini-stat"><div class="k">${esc(kd.label)}</div><div class="v">${fmtStat(kd, member.stats[kd.key])}</div></div>
            ${playerKpm ? `<div class="mini-stat"><div class="k">Player KPM</div><div class="v">${fmtStat(playerKpm, member.stats[playerKpm.key])}</div></div>` : ""}
            ${kills ? `<div class="mini-stat"><div class="k">${esc(kills.label)}</div><div class="v">${fmtStat(kills, member.stats[kills.key])}</div></div>` : ""}
          </div>
        </a>`
      )
      .join("")}</div>
    <p id="player-search-empty" class="empty" hidden>No players match that search.</p>
    ${cachedFootnoteHtml(sorted.some((member) => member.cachedStats))}`;

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
  const historyRange = normalizedRange(params?.get("range"), PLAYER_HISTORY_DEFAULT_RANGE);
  const backfillFields = memberBackfillFields(discordId);
  const pointCount = historyRange === 1 ? 2 : historyRange;
  const rangeStart = pointCount === "all" ? 0 : Math.max(0, dates.length - pointCount);
  const deltaRangeLabel = historyRange === "all" ? "all" : `${historyRange}d`;

  const baselineForRange = (statKeyToRead) => {
    const values = series(discordId, statKeyToRead);
    for (let index = rangeStart; index < lastIndex; index += 1) {
      const estimated = Boolean(historyProvenance(discordId, dates[index], statKeyToRead));
      if (Number.isFinite(values[index]) && (showEstimated || !estimated)) {
        return values[index];
      }
    }
    return null;
  };

  const summaries = state.meta.stats
    .map((candidate) => {
      const current = member ? member.stats[candidate.key] : valueAt(discordId, candidate.key, lastIndex);
      const ranking = latestRanking(candidate.key);
      const rankIndex = ranking.findIndex((row) => row.discordId === discordId);
      const baseline = baselineForRange(candidate.key);
      const delta = Number.isFinite(current) && Number.isFinite(baseline) ? fmtDelta(candidate, current - baseline) : null;
      const deltaClass = delta ? (current > baseline ? "up" : "down") : "flat";
      const hasBackfill = backfillFields.has(candidate.key);
      return `<div class="stat-summary ${candidate.key === stat.key ? "active" : ""}" data-stat="${candidate.key}">
        <div class="stat-summary-head"><div class="k">${esc(candidate.title)}</div>${showEstimated && hasBackfill ? backfillMarkerHtml() : ""}</div>
        <div class="v">${fmtStat(candidate, current)}</div>
        <div class="m">${rankIndex >= 0 ? `Rank #${rankIndex + 1} of ${ranking.length}` : "Unranked"}${
          delta ? ` · <span class="delta ${deltaClass}">${delta}</span> ${deltaRangeLabel}` : ""
        }</div>
      </div>`;
    })
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
  const profileSubParts = [
    member?.profileName ? `Profile <strong>${esc(member.profileName)}</strong>` : "",
    member?.eaName ? `EA <span class="mono">${esc(member.eaName)}</span>` : "",
    platformLabel(member?.platform) ? `Platform <strong>${esc(platformLabel(member.platform))}</strong>` : "",
    member?.personaId ? `Persona ID <span class="mono">${esc(member.personaId)}</span>` : "",
    member?.nucleusId ? `Nucleus ID <span class="mono">${esc(member.nucleusId)}</span>` : "",
    member?.gameToolsUrl ? `<a href="${esc(member.gameToolsUrl)}" target="_blank" rel="noopener">GameTools profile ↗</a>` : "",
    trackerUrl ? `<a href="${esc(trackerUrl)}" target="_blank" rel="noopener noreferrer">Tracker.gg profile ↗</a>` : "",
    !member ? `<span class="badge unlinked">no longer linked</span>` : ""
  ].filter(Boolean);

  app.innerHTML = `
    <div class="player-profile-top">
      <div class="player-profile-identity">
        <div class="profile-head">
          <h1 class="page-title">${esc(name)}</h1>
          ${member?.cachedStats ? cachedMarkerHtml() : ""}
        </div>
        <p class="profile-sub">${profileSubParts.join(" · ")}</p>
      </div>
      <div class="player-history-controls">
        <span class="player-history-controls-label">Chart range</span>
        ${playerRangeSelectHtml(historyRange)}
        ${backfillFields.size > 0 ? `<button class="tracker-history-toggle ${showEstimated ? "active" : ""}" id="tracker-history-toggle" type="button" aria-pressed="${showEstimated}">${showEstimated ? "Hide Backfill" : "Show Backfill"}</button>` : ""}
      </div>
    </div>
    ${showEstimated ? estimatedHistoryNoticeHtml(discordId) : ""}
    <div class="stat-summary-grid">${summaries}</div>
    <div class="chart-card">
      <h3>${esc(stat.title)} over time</h3>
      <div class="chart-box"><canvas id="player-chart"></canvas></div>
    </div>
    ${auditHtml}
    ${cachedFootnoteHtml(Boolean(member?.cachedStats))}`;

  for (const card of app.querySelectorAll(".stat-summary")) {
    card.addEventListener("click", () => {
      location.hash = playerHistoryHref(discordId, card.dataset.stat, showEstimated, historyRange);
    });
  }

  document.getElementById("player-range-select")?.addEventListener("change", (event) => {
    replaceHashAndRender(playerHistoryHref(discordId, stat.key, showEstimated, normalizedRange(event.target.value, PLAYER_HISTORY_DEFAULT_RANGE)));
  });
  document.getElementById("tracker-history-toggle")?.addEventListener("click", () => {
    replaceHashAndRender(playerHistoryHref(discordId, stat.key, !showEstimated, historyRange));
  });

  if (dates.length > 0) {
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
    const chartDates = dates.slice(firstVisible);
    const chartData = fullSeries
      .slice(firstVisible)
      .map((value, index) => (showEstimated || !historyProvenance(discordId, chartDates[index], stat.key) ? value : null));
    lineChart(
      document.getElementById("player-chart"),
      chartDates,
      [{ label: name, data: chartData, estimated: chartDates.map((date) => showEstimated && Boolean(historyProvenance(discordId, date, stat.key))) }],
      stat
    );
  }
}

const compareState = { selected: [], statKey: null, selectionMode: "default", range: 14 };

function normalizedRange(value, fallback = 14) {
  if (value === "all") {
    return "all";
  }
  const numeric = Number(value);
  return SPARKLINE_RANGES.some((range) => range.value === numeric) ? numeric : fallback;
}

function compareHref(statKey = compareState.statKey, selected = compareState.selected, range = compareState.range) {
  return hashRoute("compare", { stat: statKey, players: selected, range });
}

function loadCompareState(params) {
  const stat = statByKey(params.get("stat")) ?? state.meta.stats[0];
  const candidateIds = new Set(state.latest.members.map((member) => member.discordId));
  compareState.statKey = stat.key;
  compareState.range = normalizedRange(params.get("range"), 14);
  if (params.has("players")) {
    compareState.selectionMode = "manual";
    compareState.selected = [...new Set((params.get("players") ?? "").split(",").filter((id) => candidateIds.has(id)))];
  } else {
    compareState.selectionMode = "default";
    compareState.selected = latestRanking(stat.key).slice(0, 2).map((row) => row.discordId);
  }
}

function compareRangeSelectHtml() {
  return `<label class="sparkline-range-select">
    <select id="compare-range-select" aria-label="Comparison date range">${SPARKLINE_RANGES.map(
      (range) => `<option value="${range.value}" ${range.value === compareState.range ? "selected" : ""}>${range.label}</option>`
    ).join("")}</select>
  </label>`;
}

function compareHistoryWindow(statKey) {
  const dates = state.history.dates;
  const hasDataAt = (index) =>
    compareState.selected.some(
      (id) => Number.isFinite(series(id, statKey)[index]) && !historyProvenance(id, dates[index], statKey)
    );
  const firstDataIndex = dates.findIndex((_, index) => hasDataAt(index));
  if (firstDataIndex < 0) {
    return { labels: [], start: 0, end: 0 };
  }

  let lastDataIndex = dates.length - 1;
  while (lastDataIndex > firstDataIndex && !hasDataAt(lastDataIndex)) {
    lastDataIndex -= 1;
  }

  const pointCount = compareState.range === 1 ? 2 : compareState.range;
  const start = pointCount === "all" ? firstDataIndex : Math.max(firstDataIndex, lastDataIndex - pointCount + 1);
  const end = lastDataIndex + 1;
  return {
    labels: dates.slice(start, end),
    start,
    end
  };
}

function renderCompare() {
  const stat = statByKey(compareState.statKey) ?? state.meta.stats[0];
  compareState.statKey = stat.key;

  const candidates = [...state.latest.members].sort((a, b) =>
    String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""))
  );
  if (compareState.selectionMode === "default") {
    compareState.selected = latestRanking(stat.key)
      .slice(0, 2)
      .map((row) => row.discordId);
  }
  history.replaceState(null, "", compareHref());

  app.innerHTML = `
    <div class="page-heading-row"><h1 class="page-title">Head to Head</h1>${shareButtonHtml()}</div>
    <p class="page-sub">Pick players and a stat to overlay their daily history · showing ${compareRangeSelectHtml()} · comparing to ${rangeWindowText(compareState.range)}</p>
    <div class="group-label">Stat</div>
    ${statTabsHtml(stat.key)}
    <div class="group-label compare-players-label"><span>Players</span><button class="compare-clear" type="button" ${compareState.selected.length === 0 ? "disabled" : ""}>Unselect all</button></div>
    <div class="chip-row">${candidates
      .map(
        (member) =>
          `<button class="chip ${compareState.selected.includes(member.discordId) ? "active" : ""}" data-id="${member.discordId}">${esc(member.displayName ?? member.discordId)}</button>`
      )
      .join("")}</div>
    <div class="chart-card">
      <h3>${esc(stat.title)}</h3>
      <div class="chart-box"><canvas id="compare-chart"></canvas></div>
    </div>`;

  wireStatTabs((key) => replaceHashAndRender(compareHref(key)));
  const rangeSelect = document.getElementById("compare-range-select");
  rangeSelect?.addEventListener("change", () => {
    compareState.range = normalizedRange(rangeSelect.value, 14);
    replaceHashAndRender(compareHref());
  });
  app.querySelector(".compare-clear")?.addEventListener("click", () => {
    compareState.selectionMode = "manual";
    compareState.selected = [];
    replaceHashAndRender(compareHref());
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

  if (state.history.dates.length > 0 && compareState.selected.length > 0) {
    const window = compareHistoryWindow(stat.key);
    lineChart(
      document.getElementById("compare-chart"),
      window.labels,
      compareState.selected.map((id) => ({
        label: memberName(id),
        data: series(id, stat.key)
          .slice(window.start, window.end)
          .map((value, index) => (historyProvenance(id, window.labels[index], stat.key) ? null : value))
      })),
      stat
    );
  }
  wireShareButton();
}

const timeMachineState = { index: null, statKey: null };

function timeMachineHref(statKey = timeMachineState.statKey, index = timeMachineState.index) {
  const snapshotIndexes = authoritativeHistoryIndexes();
  return hashRoute("history", { stat: statKey, date: state.history.dates[snapshotIndexes[index]] });
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

  const memberIds = Object.keys(state.history.members ?? {});
  const ranking = authoritativeRankingAt(stat.key, historyIndex, memberIds);

  app.innerHTML = `
    <div class="page-heading-row"><h1 class="page-title">Time Machine</h1>${shareButtonHtml()}</div>
    <p class="page-sub">The ${esc(stat.title)} leaderboard as it stood on any snapshot day</p>
    ${statTabsHtml(stat.key)}
    <div class="date-control">
      <span class="date-label">${fmtDate(`${date}T12:00:00`)}</span>
      <input type="range" min="0" max="${snapshotIndexes.length - 1}" value="${index}" id="date-slider" />
      <span class="mono">${index + 1}/${snapshotIndexes.length} snapshots</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Player</th><th class="num">${esc(stat.title)}</th></tr></thead>
        <tbody>${ranking
          .map(
            (row, rankIndex) => `<tr class="r${rankIndex + 1}">
              <td class="rank-cell">${rankIndex + 1}</td>
              <td><a class="player-link" href="${playerHref(row.discordId)}">${esc(memberName(row.discordId))}</a></td>
              <td class="num value-cell">${fmtStat(stat, row.value)}</td>
            </tr>`
          )
          .join("") || `<tr><td colspan="3" class="empty">No data on this day.</td></tr>`}</tbody>
      </table>
    </div>`;

  wireStatTabs((key) => replaceHashAndRender(timeMachineHref(key, index)));
  document.getElementById("date-slider").addEventListener("input", (event) => {
    timeMachineState.index = Number(event.target.value);
    replaceHashAndRender(timeMachineHref(stat.key, timeMachineState.index));
  });
  wireShareButton();
}

function overtakeText(event) {
  const stat = statByKey(event.statKey);
  const compare = stat
    ? `<a class="feed-action" href="${compareHref(stat.key, [event.overtakerId, event.overtakenId], 14)}">Compare</a>`
    : "";
  return `<span class="feed-text"><span class="badge overtake">overtake</span>
    <a class="who player-link" href="${playerHref(event.overtakerId)}">${esc(memberName(event.overtakerId))}</a>
    passed
    <a class="who player-link" href="${playerHref(event.overtakenId)}">${esc(memberName(event.overtakenId))}</a>
    in <strong>${esc(stat?.title ?? event.statKey)}</strong>${compare}</span>`;
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
  const items = (state.notifications.events ?? [])
    .map((event) => ({ at: event.at, html: overtakeText(event) }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 120);

  app.innerHTML = `
    <h1 class="page-title">Activity</h1>
    <p class="page-sub">Recent leaderboard overtakes</p>
    ${
      items.length
        ? `<div class="feed">${items
            .map((item) => `<div class="feed-item"><span class="feed-date">${fmtDateTime(item.at)}</span>${item.html}</div>`)
            .join("")}</div>`
        : `<div class="empty">No overtakes yet — this feed records leaderboard changes only.</div>`
    }`;
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
  overlay.setAttribute("aria-hidden", "true");
  const cloneTable = table.cloneNode(false);
  cloneTable.append(sourceHead.cloneNode(true));
  overlay.append(cloneTable);
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
    const headerBottom = siteHeader.getBoundingClientRect().bottom;
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
  floatingHeaderCleanups.push(() => {
    window.removeEventListener("scroll", scheduleUpdate);
    wrapper.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", handleResize);
    overlay.remove();
  });
}

// Keep column labels visible on every long table (Leaderboard, Time Machine,
// Audit Log): pin a fixed clone of each table's header row just below the
// sticky site header while the real header is scrolled out of view.
function wireFloatingTableHeaders() {
  for (const wrapper of app.querySelectorAll(".table-wrap")) {
    wireFloatingTableHeader(wrapper);
  }
}

function renderAudit() {
  const events = [...(state.audit.events ?? [])].reverse();
  const text = auditFilterState.text.toLowerCase();
  const filtered = events.filter((event) => {
    if (auditFilterState.action !== "all" && event.action !== auditFilterState.action) {
      return false;
    }
    if (auditFilterState.outcome !== "all" && auditOutcome(event) !== auditFilterState.outcome) {
      return false;
    }
    if (!text) {
      return true;
    }
    return [
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
      .some((field) => String(field).toLowerCase().includes(text));
  });

  app.innerHTML = `
    <h1 class="page-title">Audit Log</h1>
    <p class="page-sub">Completed profile changes, imported Tracker mappings, and failed link attempts</p>
    <div class="filter-row">
      <input type="search" id="audit-search" placeholder="Filter by name, EA account, player, nucleus, or Tracker ID…" value="${esc(auditFilterState.text)}" />
      <select id="audit-action">
        ${["all", "linked", "relinked", "unlinked", "tracker_linked", "tracker_updated", "tracker_unlinked", "link_attempt", "relink_attempt"]
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
        <thead><tr><th>When</th><th>Action</th><th>Result</th><th>Discord member</th><th>EA account</th><th>Persona / Player ID</th><th>User / Nucleus ID</th><th>Platform</th><th>Tracker ID</th></tr></thead>
        <tbody>${filtered
          .map(
            (event) => `<tr>
              <td>${fmtDateTime(event.at)}</td>
              <td><span class="badge ${esc(event.action)}">${esc(auditActionLabel(event.action))}</span></td>
              <td><span class="badge ${esc(auditOutcome(event))}">${esc(auditOutcome(event))}</span>${
                event.failureReason ? ` <span class="muted">(${esc(auditFailureLabel(event.failureReason))})</span>` : ""
              }</td>
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
          .join("") || `<tr><td colspan="9" class="empty">No matching events.</td></tr>`}</tbody>
      </table>
    </div>`;

  const search = document.getElementById("audit-search");
  search.addEventListener("input", () => {
    auditFilterState.text = search.value;
    render();
    const restored = document.getElementById("audit-search");
    restored.focus();
    restored.setSelectionRange(restored.value.length, restored.value.length);
  });
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
  const scoreLine = key === "trident"
    ? `CEI = ${row.pillars.combat.toFixed(1)}<sup>0.40</sup> &times; ${row.pillars.objective.toFixed(1)}<sup>0.30</sup> &times; ${row.pillars.teamwork.toFixed(1)}<sup>0.30</sup> = <strong>${row.scores.trident.toFixed(1)}</strong>`
    : key === "sortino"
      ? `RAIS<sub>raw</sub> = ${row.sortinoUpside.toFixed(1)} &divide; ${row.sortinoDownside.toFixed(3)} = ${row.sortinoRaw.toFixed(1)} &rarr; <strong>${row.scores.sortino.toFixed(1)} percentile</strong>`
      : `WRR = ${row.smoothedWinPercent.toFixed(1)}% &minus; ${row.expectedWinPercent.toFixed(1)}% = <strong>${effectivenessScoreText("alpha", row.scores.alpha)}</strong>`;
  const seasonHtml = key === "alpha"
    ? `<div class="breakdown-season-grid">${Object.entries({ Season1: "Season 1 · 20%", Season2: "Season 2 · 35%", Season3: "Season 3 · 45%" }).map(([seasonId, label]) => {
        const season = row.seasonWinRates[seasonId];
        return season
          ? breakdownStatHtml(label, `${(season.rawRate * 100).toFixed(1)}%`, `${season.wins}-${season.losses} · stabilized ${(season.smoothedRate * 100).toFixed(1)}%`)
          : breakdownStatHtml(label, "No record");
      }).join("")}</div>`
    : "";
  return `<div class="score-breakdown">
    <div class="breakdown-equation"><span>Score calculation</span><div>${scoreLine}</div></div>
    <div class="breakdown-pillar-grid">
      ${breakdownStatHtml("Combat pillar", row.pillars.combat.toFixed(1), "40% CEI / RAIS input")}
      ${breakdownStatHtml("Balanced Combat", row.combatGeometric.toFixed(1), "70% of Combat · geometric mean")}
      ${breakdownStatHtml("Additive Combat", row.combatArithmetic.toFixed(1), "30% of Combat · arithmetic mean")}
      ${breakdownStatHtml("Objective pillar", row.pillars.objective.toFixed(1), "30% CEI / RAIS input")}
      ${breakdownStatHtml("Teamwork pillar", row.pillars.teamwork.toFixed(1), `30% · ${row.bestSupportLanes.join(" + ")}`)}
      ${key === "sortino" ? breakdownStatHtml("Deaths / hour", row.adjusted.deathsPerHour.toFixed(1), `clan median ${state.effectiveness.constants.medianDeathsPerHour.toFixed(1)}`) : ""}
    </div>
    ${seasonHtml}
    <div class="breakdown-subhead">Combat inputs</div>
    <div class="breakdown-input-grid">
      ${breakdownStatHtml("Player K/D", row.raw.infantryKd.toFixed(2), `${p.infantryKd.toFixed(0)}th percentile · 30% of Combat`)}
      ${breakdownStatHtml("Player Kills / Min", row.raw.infantryKpm.toFixed(2), `${p.infantryKpm.toFixed(0)}th percentile · 30%`)}
      ${breakdownStatHtml("Player Kills / match", row.raw.playerKillsPerMatch.toFixed(1), `${p.playerKillsPerMatch.toFixed(0)}th percentile · 10%`)}
      ${breakdownStatHtml("Assists / hour", row.raw.assistsPerHour.toFixed(1), `${p.assistsPerHour.toFixed(0)}th percentile · 10%`)}
      ${breakdownStatHtml("Accuracy, weapon-adjusted", `${row.raw.accuracy.toFixed(1)}%`, `expected ${row.expectedAccuracy.toFixed(1)}% · ${p.accuracyResidual.toFixed(0)}th percentile · 10%`)}
      ${breakdownStatHtml("Headshots, weapon-adjusted", `${row.raw.headshotPercent.toFixed(1)}%`, `expected ${row.expectedHeadshotPercent.toFixed(1)}% · ${p.headshotResidual.toFixed(0)}th percentile · 10%`)}
    </div>
    <p class="breakdown-note">Weapon-adjusted aim is included inside the Combat pillar; it is not a separate CEI component.</p>
  </div>`;
}

function effectivenessTableHtml(key, ranking) {
  const header = key === "alpha"
    ? `<th class="num">Residual</th><th class="num">Win%</th><th class="num">Expected</th>`
    : key === "sortino"
      ? `<th class="num">Score</th><th class="num">Upside</th><th class="num">Deaths/hr</th>`
      : `<th class="num">Score</th><th>Support lanes</th>`;
  const columnCount = key === "trident" ? 7 : 8;
  const rows = ranking.map((row, index) => {
    const detail = key === "alpha"
      ? `<td class="num value-cell ${row.scores.alpha >= 0 ? "positive-score" : "negative-score"}">${effectivenessScoreText(key, row.scores.alpha)}</td><td class="num">${row.smoothedWinPercent.toFixed(1)}%</td><td class="num">${row.expectedWinPercent.toFixed(1)}%</td>`
      : key === "sortino"
        ? `<td class="num value-cell">${row.scores.sortino.toFixed(1)}</td><td class="num">${row.sortinoUpside.toFixed(1)}</td><td class="num">${row.adjusted.deathsPerHour.toFixed(1)}</td>`
        : `<td class="num value-cell">${row.scores.trident.toFixed(1)}</td><td>${row.bestSupportLanes.map((lane) => lane[0].toUpperCase() + lane.slice(1)).join(" + ")}</td>`;
    const detailId = `score-detail-${key}-${row.discordId}`;
    return `<tr class="r${index + 1}"><td class="rank-cell">${index + 1}</td><td><div class="ranking-player-cell"><a class="player-link" href="${playerHref(row.discordId)}">${esc(row.name)}</a>${row.cachedStats ? cachedMarkerHtml() : ""}<button class="rank-detail-toggle" type="button" aria-expanded="false" aria-controls="${detailId}" data-detail-id="${detailId}">Breakdown</button></div></td>${detail}<td class="num pillar-score">${row.pillars.combat.toFixed(1)}</td><td class="num pillar-score">${row.pillars.objective.toFixed(1)}</td><td class="num pillar-score">${row.pillars.teamwork.toFixed(1)}</td></tr>
      <tr class="rank-detail-row" id="${detailId}" hidden><td colspan="${columnCount}">${effectivenessBreakdownHtml(key, row)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap effectiveness-table"><table><thead><tr><th>#</th><th>Player</th>${header}<th class="num">Combat</th><th class="num">Objective</th><th class="num">Teamwork</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
  const calculation = state.effectiveness;
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
}

/* ---------- router ---------- */

function render() {
  destroyCharts();
  for (const cleanup of floatingHeaderCleanups) {
    cleanup();
  }
  floatingHeaderCleanups = [];
  const { parts, params } = parsedHashRoute();
  const [route] = parts;

  let nav = "board";
  if (!route || route === "board") {
    renderLeaderboard(parts[1] ?? state.meta.stats[0].key);
  } else if (route === "players") {
    nav = "players";
    renderPlayers();
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
    renderLeaderboard(state.meta.stats[0].key);
  }

  for (const link of document.querySelectorAll("#site-nav a")) {
    link.classList.toggle("active", link.dataset.nav === nav);
  }
  wireFloatingTableHeaders();
  window.scrollTo(0, 0);
}

/* ---------- boot ---------- */

async function fetchJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) {
      return fallback;
    }
    return await response.json();
  } catch {
    return fallback;
  }
}

async function boot() {
  const [meta, latest, history, historyProvenanceData, audit, notifications, effectivenessHistory] = await Promise.all([
    fetchJson("data/meta.json", null),
    fetchJson("data/latest.json", { members: [] }),
    fetchJson("data/history.json", { dates: [], members: {} }),
    fetchJson("data/history-provenance.json", null),
    fetchJson("data/audit.json", { events: [] }),
    fetchJson("data/notifications.json", { events: [] }),
    fetchJson("data/effectiveness-history.json", null)
  ]);

  if (!meta) {
    app.innerHTML = `<div class="error-box"><strong>No data published yet.</strong><br />
      The daily update hasn't pushed its first snapshot. Check back soon.</div>`;
    return;
  }

  const compatibleEffectiveness =
    effectivenessHistory?.version === 1 && Number.isInteger(effectivenessHistory?.modelVersion)
      ? effectivenessHistory
      : null;
  const effectiveness = compatibleEffectiveness?.current ?? null;
  Object.assign(state, {
    meta,
    latest,
    history,
    historyProvenance: historyProvenanceData,
    audit,
    notifications,
    effectiveness,
    effectivenessHistory: compatibleEffectiveness
  });

  const updated = document.getElementById("footer-updated");
  updated.textContent = `Last updated ${fmtDateTime(meta.updatedAt)}`;

  window.addEventListener("hashchange", render);
  render();
}

boot();
