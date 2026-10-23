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

test("season menu lists started, tracked seasons newest first", async () => {
  const { menuSeasons, seasonForRangeKey } = await import("../assets/seasons.js");
  const choices = menuSeasons("2026-10-23", "2026-07-10");
  assert.deepEqual(choices.map((choice) => [choice.key, choice.partial]), [["season", false], ["season-4", false], ["season-3", true]]);
  assert.equal(seasonForRangeKey("season", "2026-10-23").season.number, 5);
  assert.equal(seasonForRangeKey("season-5", "2026-08-01").reason, "unknown_season");
});
