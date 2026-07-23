import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_ACTIVE_SECONDS_TO_RANK,
  memberDailySeries,
  memberFirstObservedIndex,
  memberPeriodDeltas,
  memberPeriodStat,
  minActiveSecondsForWindow,
  periodRanking,
  periodSupported,
  resolveRange,
  windowDaySpan
} from "../assets/period.js";

// Column helper: build one member's aligned counter arrays from per-day
// cumulative tuples [playerKills, kills, deaths, activeSeconds, score]
// (null = member missing from that day's snapshot).
function member(name, days) {
  const keys = ["playerKills", "kills", "deaths", "activeSeconds", "score"];
  const values = Object.fromEntries(keys.map((key) => [key, []]));
  for (const day of days) {
    keys.forEach((key, i) => values[key].push(day == null ? null : day[i]));
  }
  values.headShots = days.map((day) => (day == null ? null : Math.round((day[1] ?? 0) * 0.2)));
  return { name, values };
}

function counters({ dates, members, settled = true }) {
  return {
    version: 1,
    formulaVersion: 1,
    timezone: "America/New_York",
    generatedAt: "2026-07-17T20:00:00.000Z",
    current: { date: dates.at(-1), settled, asOf: "2026-07-17T20:00:00.000Z" },
    dates,
    members
  };
}

const DATES_8 = ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];

function fixture(settled = true) {
  return counters({
    dates: DATES_8,
    settled,
    members: {
      steady: member("Steady", [
        [1000, 1100, 500, 60_000, 900_000],
        [1100, 1210, 540, 66_000, 990_000],
        [1200, 1320, 580, 72_000, 1_080_000],
        [1300, 1430, 620, 78_000, 1_170_000],
        [1400, 1540, 660, 84_000, 1_260_000],
        [1500, 1650, 700, 90_000, 1_350_000],
        [1600, 1760, 740, 96_000, 1_440_000],
        [1700, 1870, 780, 102_000, 1_530_000]
      ]),
      idle: member("Idle", [
        [500, 550, 250, 30_000, 450_000],
        [500, 550, 250, 30_000, 450_000],
        [500, 550, 250, 30_000, 450_000],
        [500, 550, 250, 30_000, 450_000],
        [500, 550, 250, 30_000, 450_000],
        [500, 550, 250, 30_000, 450_000],
        [500, 550, 250, 30_000, 450_000],
        [500, 550, 250, 30_000, 450_000]
      ]),
      gappy: member("Gappy", [
        [200, 220, 100, 12_000, 180_000],
        null,
        null,
        [230, 253, 110, 13_200, 198_000],
        [230, 253, 110, 13_200, 198_000],
        null,
        [260, 286, 120, 14_400, 216_000],
        [290, 319, 130, 15_600, 234_000]
      ]),
      latecomer: member("Latecomer", [
        null,
        null,
        null,
        null,
        null,
        [50, 55, 20, 3_000, 45_000],
        [150, 165, 45, 7_500, 135_000],
        [250, 275, 70, 12_000, 225_000]
      ]),
      reset: member("Reset", [
        [900, 990, 400, 50_000, 800_000],
        [910, 1001, 405, 50_500, 808_000],
        [920, 1012, 410, 51_000, 816_000],
        [100, 110, 50, 6_000, 90_000],
        [110, 121, 55, 6_500, 98_000],
        [120, 132, 60, 7_000, 106_000],
        [130, 143, 65, 7_500, 114_000],
        [140, 154, 70, 8_000, 122_000]
      ])
    }
  });
}

/* ---------- range resolution ---------- */

test("preset ranges snap to snapshots and clamp to tracked history instead of failing", () => {
  const c = fixture();
  for (const [key, expectedStart, expectClamped] of [
    ["3d", "2026-07-14", false],
    ["7d", "2026-07-10", false],
    ["14d", "2026-07-10", true],
    ["30d", "2026-07-10", true]
  ]) {
    const window = resolveRange(c, key);
    assert.equal(window.startDate, expectedStart, key);
    assert.equal(window.endDate, "2026-07-17", key);
    assert.equal(Boolean(window.clamped), expectClamped, `${key} clamped flag`);
  }
  // Truly unavailable only with a single snapshot column.
  const single = counters({ dates: ["2026-07-17"], members: {} });
  assert.equal(resolveRange(single, "14d").reason, "not_enough_history");
});

test("custom ranges starting before tracking clamp with the flag set", () => {
  const window = resolveRange(fixture(), "custom", "2026-06-01..2026-07-16");
  assert.deepEqual([window.startDate, window.endDate, window.clamped], ["2026-07-10", "2026-07-16", true]);
});

test("today requires an unsettled current column and uses the prior column as baseline", () => {
  const unavailable = resolveRange(fixture(true), "today");
  assert.deepEqual([unavailable.unavailable, unavailable.reason], [true, "no_refresh_today"]);
  const window = resolveRange(fixture(false), "today");
  assert.equal(window.startDate, "2026-07-16");
  assert.equal(window.endDate, "2026-07-17");
  assert.equal(window.partialEnd, true);
  assert.equal(window.asOf, "2026-07-17T20:00:00.000Z");
});

test("custom ranges validate ordering and snap both endpoints", () => {
  const c = fixture();
  const window = resolveRange(c, "custom", "2026-07-12..2026-07-16");
  assert.deepEqual([window.startDate, window.endDate], ["2026-07-12", "2026-07-16"]);
  assert.equal(resolveRange(c, "custom", "2026-07-16..2026-07-12").reason, "invalid_custom_range");
  assert.equal(resolveRange(c, "custom", "garbage").reason, "invalid_custom_range");
  const snapped = resolveRange(c, "custom", "2026-07-12..2026-09-01");
  assert.equal(snapped.endDate, "2026-07-17", "future end snaps to the latest snapshot");
});

test("all resolves the global window; members get per-member starts", () => {
  const c = fixture();
  const window = resolveRange(c, "all");
  assert.deepEqual([window.startDate, window.endDate], ["2026-07-10", "2026-07-17"]);
  const late = memberPeriodStat(c, "latecomer", "kills", window);
  assert.equal(late.trackedSince, "2026-07-15", "late joiner ranks from their own first column");
  assert.equal(late.value, 200, "250 − 50 since their own start");
  assert.equal(memberFirstObservedIndex(c, "latecomer"), 5);
});

/* ---------- formulas and guards ---------- */

test("period ratios derive from full-window deltas with exact formulas", () => {
  const c = fixture();
  const window = resolveRange(c, "7d");
  const kd = memberPeriodStat(c, "steady", "infantryKillDeath", window);
  assert.equal(kd.value, (1700 - 1000) / (780 - 500), "ΔplayerKills / Δdeaths = 2.5");
  const kpm = memberPeriodStat(c, "steady", "playerKillsPerMinute", window);
  assert.equal(kpm.value, 700 / ((102_000 - 60_000) / 60), "uses activeSeconds");
  const spm = memberPeriodStat(c, "steady", "scorePerMinute", window);
  assert.equal(spm.value, (1_530_000 - 900_000) / 700);
  const hours = memberPeriodStat(c, "steady", "timePlayedHours", window);
  assert.equal(hours.value, 42_000 / 3600);
  const kills = memberPeriodStat(c, "steady", "kills", window);
  assert.equal(kills.value, 700);
});

test("zero-denominator windows are null, never Infinity, and idle members report no gameplay", () => {
  const c = fixture();
  const window = resolveRange(c, "7d");
  const kd = memberPeriodStat(c, "idle", "infantryKillDeath", window);
  assert.equal(kd.value, null, "0 deaths → null");
  const kpm = memberPeriodStat(c, "idle", "playerKillsPerMinute", window);
  assert.equal(kpm.value, null, "0 active time → null");
  const kills = memberPeriodStat(c, "idle", "kills", window);
  assert.equal(kills.value, 0, "a confirmed zero-gameplay count is an observed 0");
  assert.equal(kills.activeSeconds, 0);
});

test("missing member endpoints carry the last observed column with provenance", () => {
  const c = fixture();
  const window = resolveRange(c, "custom", "2026-07-11..2026-07-15");
  const stat = memberPeriodStat(c, "gappy", "kills", window);
  // Start snaps to gappy's 07-10 value (carried), end to 07-14's (carried).
  assert.equal(stat.value, 30);
  assert.deepEqual(stat.provenance, { startCarried: true, endCarried: true });
});

test("negative counter deltas invalidate the member window with a machine-readable reason", () => {
  const c = fixture();
  const window = resolveRange(c, "7d");
  const stat = memberPeriodStat(c, "reset", "kills", window);
  assert.equal(stat.invalid, true);
  assert.equal(stat.reason, "negative_delta");
});

test("player rank is career-only", () => {
  assert.equal(periodSupported("playerRank"), false);
  const stat = memberPeriodStat(fixture(), "steady", "playerRank", resolveRange(fixture(), "7d"));
  assert.deepEqual([stat.invalid, stat.reason], [true, "career_only"]);
});

/* ---------- daily series and no-averaging proof ---------- */

test("daily series derives independent daily points with idle gaps and carried-day marking", () => {
  const c = fixture();
  const window = resolveRange(c, "7d");
  const kdDaily = memberDailySeries(c, "idle", "infantryKillDeath", window);
  assert.equal(kdDaily.length, 7);
  assert.ok(kdDaily.every((point) => point.value === null), "idle ratio days are gaps, not zeros");
  const killsDaily = memberDailySeries(c, "idle", "kills", window);
  assert.ok(killsDaily.every((point) => point.value === 0), "idle count days are observed zeros");
  const gappyDaily = memberDailySeries(c, "gappy", "kills", window);
  const carried = gappyDaily.filter((point) => !point.observedEnd);
  assert.ok(carried.length >= 2, "days where the member was missing are marked as carried");
});

test("multi-day ratios come from window deltas, not averaged daily ratios", () => {
  // Two days with very different volumes: day1 10 kills / 1 death (K/D 10),
  // day2 100 kills / 100 deaths (K/D 1). Average of daily K/Ds = 5.5; the
  // correct 2-day K/D is 110/101.
  const c = counters({
    dates: ["2026-07-15", "2026-07-16", "2026-07-17"],
    members: {
      swing: member("Swing", [
        [0, 0, 0, 0, 0],
        [10, 10, 1, 3_600, 10_000],
        [110, 110, 101, 7_200, 20_000]
      ])
    }
  });
  const window = resolveRange(c, "custom", "2026-07-15..2026-07-17");
  const daily = memberDailySeries(c, "swing", "infantryKillDeath", window);
  assert.deepEqual(daily.map((point) => point.value), [10, 1]);
  const full = memberPeriodStat(c, "swing", "infantryKillDeath", window);
  assert.equal(full.value, 110 / 101);
  const naiveAverage = (10 + 1) / 2;
  assert.notEqual(full.value, naiveAverage);
});

/* ---------- qualification and ranking ---------- */

test("the 15-active-minute rule qualifies rates only, at exactly the threshold", () => {
  const build = (activeSeconds) =>
    counters({
      dates: ["2026-07-16", "2026-07-17"],
      members: { p: member("P", [[0, 0, 0, 0, 0], [30, 33, 10, activeSeconds, 40_000]]) }
    });
  const window14 = resolveRange(build(MIN_ACTIVE_SECONDS_TO_RANK - 60), "custom", "2026-07-16..2026-07-17");
  const under = memberPeriodStat(build(MIN_ACTIVE_SECONDS_TO_RANK - 60), "p", "infantryKillDeath", window14);
  assert.equal(under.qualifies, false, "14 minutes is provisional");
  const at = memberPeriodStat(build(MIN_ACTIVE_SECONDS_TO_RANK), "p", "infantryKillDeath", window14);
  assert.equal(at.qualifies, true, "15 minutes qualifies");
  const count = memberPeriodStat(build(MIN_ACTIVE_SECONDS_TO_RANK - 60), "p", "kills", window14);
  assert.equal(count.qualifies, true, "count stats ignore the playtime threshold");
});

test("the active-playtime floor scales with the window's day span (15 min/day)", () => {
  assert.equal(windowDaySpan({ startDate: "2026-07-14", endDate: "2026-07-17" }), 3);
  assert.equal(minActiveSecondsForWindow({ startDate: "2026-07-14", endDate: "2026-07-17" }), 3 * MIN_ACTIVE_SECONDS_TO_RANK);

  // Over a 3-day window, 20 active minutes is provisional but 45 qualifies.
  const build = (activeSeconds) =>
    counters({
      dates: ["2026-07-14", "2026-07-17"],
      members: { p: member("P", [[0, 0, 0, 0, 0], [90, 99, 30, activeSeconds, 120_000]]) }
    });
  const window3d = resolveRange(build(20 * 60), "custom", "2026-07-14..2026-07-17");
  assert.equal(windowDaySpan(window3d), 3);
  assert.equal(memberPeriodStat(build(20 * 60), "p", "infantryKillDeath", window3d).qualifies, false, "20 min over 3 days is provisional");
  assert.equal(memberPeriodStat(build(44 * 60), "p", "infantryKillDeath", window3d).qualifies, false, "44 min falls just short of the 45 min floor");
  assert.equal(memberPeriodStat(build(45 * 60), "p", "infantryKillDeath", window3d).qualifies, true, "45 min meets the scaled floor");
  // Count stats still ignore the floor entirely, at any span.
  assert.equal(memberPeriodStat(build(20 * 60), "p", "kills", window3d).qualifies, true);
});

test("periodRanking splits qualified, provisional, and invalid rows deterministically", () => {
  const c = fixture();
  const window = resolveRange(c, "7d");
  const { ranked, provisional, invalid } = periodRanking(c, "infantryKillDeath", window);
  // Over this 7-day window the floor is 105 active minutes (15/day). Gappy
  // logged only 60 active minutes across the range, so it drops to provisional
  // rather than topping a week-long leaderboard on an hour of play.
  assert.deepEqual(ranked.map((row) => row.discordId), ["latecomer", "steady"]);
  assert.deepEqual(ranked.map((row) => row.rank), [1, 2]);
  assert.deepEqual(provisional.map((row) => row.discordId), ["gappy"]);
  assert.deepEqual(invalid, [{ discordId: "reset", reason: "negative_delta" }]);
  const kills = periodRanking(c, "kills", window);
  assert.ok(kills.ranked.some((row) => row.discordId === "idle"), "idle's observed 0 kills still ranks in count stats");
});
