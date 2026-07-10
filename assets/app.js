/* KDM BF6 Rankings — static SPA reading data/*.json published by the
   kdm-discord-bot daily update. No build step; Chart.js from CDN. */

const app = document.getElementById("app");

const state = {
  meta: null,
  latest: null,
  history: null,
  audit: null,
  notifications: null
};

let charts = [];
let floatingHeaderCleanups = [];

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

function memberName(discordId) {
  const latest = state.latest.members.find((member) => member.discordId === discordId);
  return latest?.displayName ?? state.history.members?.[discordId]?.name ?? `Member ${discordId}`;
}

function playerHref(discordId) {
  return `#/player/${encodeURIComponent(discordId)}`;
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

function rankingAt(statKey, dateIndex, memberIds) {
  return memberIds
    .map((discordId) => ({ discordId, value: valueAt(discordId, statKey, dateIndex) }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

function latestRanking(statKey) {
  return state.latest.members
    .map((member) => ({ discordId: member.discordId, value: member.stats[statKey], member }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

function previousDateIndex() {
  return state.history.dates.length >= 2 ? state.history.dates.length - 2 : -1;
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
  if (points.length < 2) {
    return "";
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

function movementHtml(prevRank, currentRank) {
  if (prevRank == null) {
    return `<span class="movement flat" title="New to this leaderboard">NEW</span>`;
  }
  const diff = prevRank - currentRank;
  if (diff > 0) {
    return `<span class="movement up" title="Up ${diff} since previous snapshot">▲${diff}</span>`;
  }
  if (diff < 0) {
    return `<span class="movement down" title="Down ${-diff} since previous snapshot">▼${-diff}</span>`;
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
      datasets: datasets.map((dataset, index) => ({
        ...dataset,
        borderColor: CHART_COLORS[index % CHART_COLORS.length],
        backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
        borderWidth: 2,
        pointRadius: labels.length > 45 ? 0 : 2.5,
        pointHoverRadius: 4,
        spanGaps: true,
        tension: 0.25
      }))
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
            label: (ctx) => `${ctx.dataset.label}: ${fmtStat(stat, ctx.parsed.y)}`
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
  const prevIndex = previousDateIndex();
  const memberIds = Object.keys(state.history.members ?? {});
  const prevRanking = prevIndex >= 0 ? rankingAt(stat.key, prevIndex, memberIds) : [];
  const prevRankById = new Map(prevRanking.map((row, index) => [row.discordId, index + 1]));
  const prevValueById = new Map(prevRanking.map((row) => [row.discordId, row.value]));
  const lastIndex = state.history.dates.length - 1;
  const sparkStart = Math.max(0, lastIndex - 13);

  const podium = ranking.slice(0, 3);
  const podiumHtml = podium.length
    ? `<div class="podium">${podium
        .map((row, index) => {
          const delta = fmtDelta(stat, row.value - (prevValueById.get(row.discordId) ?? NaN));
          return `<div class="podium-card p${index + 1}">
            <div class="podium-rank">#${index + 1}${index === 0 ? " · TOP DOG" : ""}</div>
            <div class="podium-name"><a class="player-link" href="${playerHref(row.discordId)}">${esc(memberName(row.discordId))}</a></div>
            <div class="podium-value">${fmtStat(stat, row.value)}</div>
            <div class="podium-delta">${delta ? `${delta} since previous snapshot` : "&nbsp;"}</div>
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
      const spark = series(row.discordId, stat.key).slice(sparkStart, lastIndex + 1);
      const cached = row.member?.cachedStats ? ` <span class="badge cached" title="GameTools fetch failed; showing last known stats">cached</span>` : "";
      return `<tr class="r${rank}">
        <td class="rank-cell">${rank}</td>
        <td>${movementHtml(prevRank, rank)}</td>
        <td><a class="player-link" href="${playerHref(row.discordId)}">${esc(memberName(row.discordId))}</a>${cached}</td>
        <td class="num value-cell">${fmtStat(stat, row.value)}</td>
        <td class="num"><span class="delta ${deltaClass}">${delta ?? "–"}</span></td>
        <td>${sparklineSvg(spark)}</td>
      </tr>`;
    })
    .join("");

  app.innerHTML = `
    <h1 class="page-title">${esc(stat.title)} Leaderboard</h1>
    <p class="page-sub">Movement and deltas vs the previous daily snapshot · sparkline shows the last 14 days</p>
    ${statTabsHtml(stat.key, (key) => `/board/${key}`)}
    ${podiumHtml}
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Δ</th><th>Player</th><th class="num">${esc(stat.title)}</th><th class="num">Change</th><th>Trend</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">No stats yet.</td></tr>`}</tbody>
      </table>
    </div>`;
  wireStatTabs();
}

function renderPlayers() {
  const kd = statByKey("infantryKillDeath") ?? state.meta.stats[0];
  const kpm = statByKey("killsPerMinute");
  const kills = statByKey("kills");
  const sorted = [...state.latest.members].sort(
    (a, b) => (b.stats[kd.key] ?? -Infinity) - (a.stats[kd.key] ?? -Infinity)
  );

  app.innerHTML = `
    <h1 class="page-title">Players</h1>
    <p class="page-sub">${sorted.length} linked member(s) · click a player for full history</p>
    <div class="player-grid">${sorted
      .map(
        (member) => `<a class="player-card" href="${playerHref(member.discordId)}">
          <div class="player-card-name">${esc(member.displayName ?? member.discordId)}${
            member.cachedStats ? ` <span class="badge cached">cached</span>` : ""
          }</div>
          <div class="player-card-sub">${esc(member.profileName ?? member.eaName ?? "")}</div>
          <div class="player-card-stats">
            <div class="mini-stat"><div class="k">${esc(kd.label)}</div><div class="v">${fmtStat(kd, member.stats[kd.key])}</div></div>
            ${kpm ? `<div class="mini-stat"><div class="k">${esc(kpm.label)}</div><div class="v">${fmtStat(kpm, member.stats[kpm.key])}</div></div>` : ""}
            ${kills ? `<div class="mini-stat"><div class="k">${esc(kills.label)}</div><div class="v">${fmtStat(kills, member.stats[kills.key])}</div></div>` : ""}
          </div>
        </a>`
      )
      .join("")}</div>`;
}

function renderPlayer(discordId, statKey) {
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
  const weekAgoIndex = lastIndex >= 0 ? indexOnOrBefore(shiftDateString(dates[lastIndex], -7)) : -1;

  const summaries = state.meta.stats
    .map((candidate) => {
      const current = member ? member.stats[candidate.key] : valueAt(discordId, candidate.key, lastIndex);
      const ranking = latestRanking(candidate.key);
      const rankIndex = ranking.findIndex((row) => row.discordId === discordId);
      const weekAgo = weekAgoIndex >= 0 ? valueAt(discordId, candidate.key, weekAgoIndex) : null;
      const delta = Number.isFinite(current) && Number.isFinite(weekAgo) ? fmtDelta(candidate, current - weekAgo) : null;
      const deltaClass = delta ? (current > weekAgo ? "up" : "down") : "flat";
      return `<div class="stat-summary ${candidate.key === stat.key ? "active" : ""}" data-stat="${candidate.key}">
        <div class="k">${esc(candidate.title)}</div>
        <div class="v">${fmtStat(candidate, current)}</div>
        <div class="m">${rankIndex >= 0 ? `Rank #${rankIndex + 1} of ${ranking.length}` : "Unranked"}${
          delta ? ` · <span class="delta ${deltaClass}">${delta}</span> 7d` : ""
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

  app.innerHTML = `
    <div class="profile-head">
      <h1 class="page-title">${esc(name)}</h1>
      ${member?.cachedStats ? `<span class="badge cached" title="GameTools fetch failed; showing last known stats">cached stats</span>` : ""}
    </div>
    <p class="profile-sub">
      ${member?.profileName ? `Profile <strong>${esc(member.profileName)}</strong> · ` : ""}
      ${member?.eaName ? `EA <span class="mono">${esc(member.eaName)}</span> · ` : ""}
      ${member?.gameToolsUrl ? `<a href="${esc(member.gameToolsUrl)}" target="_blank" rel="noopener">GameTools profile ↗</a>` : ""}
      ${!member ? `<span class="badge unlinked">no longer linked</span>` : ""}
    </p>
    <div class="stat-summary-grid">${summaries}</div>
    <div class="chart-card">
      <h3>${esc(stat.title)} over time</h3>
      <div class="chart-box"><canvas id="player-chart"></canvas></div>
    </div>
    ${auditHtml}`;

  for (const card of app.querySelectorAll(".stat-summary")) {
    card.addEventListener("click", () => {
      location.hash = `/player/${encodeURIComponent(discordId)}/${card.dataset.stat}`;
    });
  }

  if (dates.length > 0) {
    lineChart(
      document.getElementById("player-chart"),
      dates,
      [{ label: name, data: series(discordId, stat.key) }],
      stat
    );
  }
}

const compareState = { selected: [], statKey: null, cleared: false };

function renderCompare() {
  const stat = statByKey(compareState.statKey) ?? state.meta.stats[0];
  compareState.statKey = stat.key;

  const candidates = [...state.latest.members].sort((a, b) =>
    String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""))
  );
  if (compareState.selected.length === 0 && !compareState.cleared) {
    compareState.selected = latestRanking(stat.key)
      .slice(0, 2)
      .map((row) => row.discordId);
  }

  app.innerHTML = `
    <h1 class="page-title">Head to Head</h1>
    <p class="page-sub">Pick players and a stat to overlay their daily history</p>
    <div class="group-label">Stat</div>
    ${statTabsHtml(stat.key)}
    <div class="group-label">Players</div>
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

  wireStatTabs((key) => {
    compareState.statKey = key;
    render();
  });
  for (const chip of app.querySelectorAll(".chip[data-id]")) {
    chip.addEventListener("click", () => {
      const id = chip.dataset.id;
      compareState.selected = compareState.selected.includes(id)
        ? compareState.selected.filter((existing) => existing !== id)
        : [...compareState.selected, id];
      // Deliberately emptied selections must not re-seed the top-2 default.
      compareState.cleared = compareState.selected.length === 0;
      render();
    });
  }

  if (state.history.dates.length > 0 && compareState.selected.length > 0) {
    lineChart(
      document.getElementById("compare-chart"),
      state.history.dates,
      compareState.selected.map((id) => ({ label: memberName(id), data: series(id, stat.key) })),
      stat
    );
  }
}

const timeMachineState = { index: null, statKey: null };

function renderTimeMachine() {
  const dates = state.history.dates;
  if (dates.length === 0) {
    app.innerHTML = `<div class="empty">No snapshots yet — check back after the first daily update.</div>`;
    return;
  }

  const stat = statByKey(timeMachineState.statKey) ?? state.meta.stats[0];
  timeMachineState.statKey = stat.key;
  const index = timeMachineState.index ?? dates.length - 1;
  timeMachineState.index = index;

  const memberIds = Object.keys(state.history.members ?? {});
  const ranking = rankingAt(stat.key, index, memberIds);

  app.innerHTML = `
    <h1 class="page-title">Time Machine</h1>
    <p class="page-sub">The ${esc(stat.title)} leaderboard as it stood on any snapshot day</p>
    ${statTabsHtml(stat.key)}
    <div class="date-control">
      <span class="date-label">${fmtDate(`${dates[index]}T12:00:00`)}</span>
      <input type="range" min="0" max="${dates.length - 1}" value="${index}" id="date-slider" />
      <span class="mono">${index + 1}/${dates.length} snapshots</span>
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

  wireStatTabs((key) => {
    timeMachineState.statKey = key;
    render();
  });
  document.getElementById("date-slider").addEventListener("input", (event) => {
    timeMachineState.index = Number(event.target.value);
    render();
  });
}

function overtakeText(event) {
  const stat = statByKey(event.statKey);
  return `<span class="feed-text"><span class="badge overtake">overtake</span>
    <a class="who player-link" href="${playerHref(event.overtakerId)}">${esc(memberName(event.overtakerId))}</a>
    passed
    <a class="who player-link" href="${playerHref(event.overtakenId)}">${esc(memberName(event.overtakenId))}</a>
    in <strong>${esc(stat?.title ?? event.statKey)}</strong></span>`;
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
      event.failureReason
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(text));
  });

  app.innerHTML = `
    <h1 class="page-title">Audit Log</h1>
    <p class="page-sub">Completed profile changes and failed link attempts pulled from the Discord link channel</p>
    <div class="filter-row">
      <input type="search" id="audit-search" placeholder="Filter by name, EA account, player or nucleus ID…" value="${esc(auditFilterState.text)}" />
      <select id="audit-action">
        ${["all", "linked", "relinked", "unlinked", "link_attempt", "relink_attempt"]
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
        <thead><tr><th>When</th><th>Action</th><th>Result</th><th>Discord member</th><th>EA account</th><th>Persona / Player ID</th><th>User / Nucleus ID</th><th>Profile</th></tr></thead>
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
              <td>${esc(event.profileName ?? "—")}</td>
            </tr>`
          )
          .join("") || `<tr><td colspan="8" class="empty">No matching events.</td></tr>`}</tbody>
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

/* ---------- router ---------- */

function render() {
  destroyCharts();
  for (const cleanup of floatingHeaderCleanups) {
    cleanup();
  }
  floatingHeaderCleanups = [];
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route] = parts;

  let nav = "board";
  if (!route || route === "board") {
    renderLeaderboard(parts[1] ?? state.meta.stats[0].key);
  } else if (route === "players") {
    nav = "players";
    renderPlayers();
  } else if (route === "player") {
    nav = "players";
    renderPlayer(decodeURIComponent(parts[1] ?? ""), parts[2]);
  } else if (route === "compare") {
    nav = "compare";
    renderCompare();
  } else if (route === "history") {
    nav = "history";
    renderTimeMachine();
  } else if (route === "activity") {
    nav = "activity";
    renderActivity();
  } else if (route === "audit") {
    nav = "audit";
    renderAudit();
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
  const [meta, latest, history, audit, notifications] = await Promise.all([
    fetchJson("data/meta.json", null),
    fetchJson("data/latest.json", { members: [] }),
    fetchJson("data/history.json", { dates: [], members: {} }),
    fetchJson("data/audit.json", { events: [] }),
    fetchJson("data/notifications.json", { events: [] })
  ]);

  if (!meta) {
    app.innerHTML = `<div class="error-box"><strong>No data published yet.</strong><br />
      The daily update hasn't pushed its first snapshot. Check back soon.</div>`;
    return;
  }

  Object.assign(state, { meta, latest, history, audit, notifications });

  const updated = document.getElementById("footer-updated");
  updated.textContent = `Last updated ${fmtDateTime(meta.updatedAt)}`;

  window.addEventListener("hashchange", render);
  render();
}

boot();
