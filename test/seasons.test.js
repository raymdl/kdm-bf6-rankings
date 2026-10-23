import test from "node:test";
import assert from "node:assert/strict";
import { SEASONS, currentSeason, seasonBaselineDate } from "../assets/seasons.js";

test("season calendar is contiguous and the current season resolves by date", () => {
  for (let index = 1; index < SEASONS.length; index += 1) {
    const previous = SEASONS[index - 1];
    assert.equal(seasonBaselineDate(SEASONS[index]), previous.lastDate, `${previous.label} must end the day before ${SEASONS[index].label}`);
  }
  assert.equal(SEASONS.at(-1).lastDate, null);
  assert.equal(currentSeason("2026-10-12").label, "Season 4");
  assert.equal(currentSeason("2026-10-13").label, "Season 5");
  assert.equal(currentSeason("2025-10-01"), null);
});
