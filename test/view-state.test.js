import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizedViewRange,
  parseHashRoute,
  playerProfileRoute,
  resolveCareerWindow,
  validateCustomRange,
  viewRangeParams
} from "../assets/view-state.js";

const dates = ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];
const indexes = dates.map((_, index) => index);

test("default route state is Career over 7 days", () => {
  assert.deepEqual(normalizedViewRange(new URLSearchParams()), { view: "career", range: "7d", custom: null });
  assert.deepEqual(viewRangeParams({ view: "career", range: "7d", custom: null }), { view: null, range: null });
});

test("leaderboard stat, Period view, and range survive a player link", () => {
  const source = parseHashRoute("#/board/kills?view=period&range=7d");
  const viewRange = normalizedViewRange(source.params);
  assert.deepEqual(source.parts, ["board", "kills"]);
  assert.equal(
    playerProfileRoute("211731212480282624", "kills", viewRange),
    "#/player/211731212480282624/kills?view=period&range=7d"
  );
});

test("custom view/range state round trips through a player route", () => {
  const href = playerProfileRoute("42", "kills", {
    view: "period",
    range: "custom",
    custom: "2026-07-11..2026-07-15"
  });
  const parsed = parseHashRoute(href);
  assert.deepEqual(parsed.parts, ["player", "42", "kills"]);
  assert.deepEqual(normalizedViewRange(parsed.params), {
    view: "period",
    range: "custom",
    custom: "2026-07-11..2026-07-15"
  });
});

test("Career Today compares the latest snapshot with the prior daily snapshot", () => {
  const window = resolveCareerWindow(dates, indexes, "today");
  assert.deepEqual([window.startDate, window.endDate], ["2026-07-16", "2026-07-17"]);
  assert.deepEqual(window.indexes, [6, 7]);
});

test("Career presets use elapsed calendar-day endpoints", () => {
  const threeDays = resolveCareerWindow(dates, indexes, "3d");
  const sevenDays = resolveCareerWindow(dates, indexes, "7d");
  assert.deepEqual([threeDays.startDate, threeDays.endDate], ["2026-07-14", "2026-07-17"]);
  assert.deepEqual([sevenDays.startDate, sevenDays.endDate], ["2026-07-10", "2026-07-17"]);
});

test("Career presets clamp honestly to tracked history", () => {
  const window = resolveCareerWindow(dates, indexes, "30d");
  assert.equal(window.clamped, true);
  assert.deepEqual([window.startDate, window.endDate], ["2026-07-10", "2026-07-17"]);
});

test("Career custom ranges resolve both historical endpoints", () => {
  const window = resolveCareerWindow(dates, indexes, "custom", "2026-07-12..2026-07-15");
  assert.deepEqual([window.startDate, window.endDate], ["2026-07-12", "2026-07-15"]);
  assert.deepEqual(window.indexes, [2, 3, 4, 5]);
});

test("custom validation blocks incomplete, reversed, and out-of-coverage ranges", () => {
  assert.equal(validateCustomRange("2026-07-12", null, dates[0], dates.at(-1)).valid, false);
  assert.equal(validateCustomRange("2026-07-15", "2026-07-15", dates[0], dates.at(-1)).valid, false);
  assert.equal(validateCustomRange("2026-07-16", "2026-07-15", dates[0], dates.at(-1)).valid, false);
  assert.equal(validateCustomRange("2026-07-09", "2026-07-15", dates[0], dates.at(-1)).valid, false);
  assert.equal(validateCustomRange("2026-07-12", "2026-07-15", dates[0], dates.at(-1)).valid, true);
});
