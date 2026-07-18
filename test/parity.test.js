import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { memberPeriodStat, resolveRange, validCounters } from "../assets/period.js";

// Cross-implementation parity: the published counters artifact (written by the
// bot publisher) must reproduce the same Period values as an independent
// recomputation straight from the raw archive files. Runs only when both real
// data sources are present in this checkout; skips cleanly otherwise (e.g. a
// bare clone before the first artifact publish).

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

async function loadJson(relative) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, relative), "utf8"));
  } catch {
    return null;
  }
}

function rawPath(stats, dotted) {
  let value = stats;
  for (const part of dotted.split(".")) value = value?.[part];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

test("counters artifact matches independent recomputation from raw archives", async (t) => {
  const counters = await loadJson("counters.json");
  let archiveDates = [];
  try {
    archiveDates = (await readdir(path.join(dataDir, "archive")))
      .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
      .filter(Boolean)
      .sort();
  } catch {
    archiveDates = [];
  }
  if (!validCounters(counters) || archiveDates.length < 2) {
    t.skip("real counters.json and archives not present in this checkout");
    return;
  }

  const window = resolveRange(counters, "7d");
  assert.ok(!window.unavailable, "7d window must resolve on real data");
  const startArchive = await loadJson(`archive/${window.startDate}.json`);
  const endArchive = await loadJson(`archive/${window.endDate}.json`);
  assert.ok(startArchive && endArchive, "endpoint archives must exist");

  let compared = 0;
  for (const [discordId, endMember] of Object.entries(endArchive.members)) {
    const startMember = startArchive.members[discordId];
    if (!startMember || compared >= 5) continue;
    const dPlayerKills = rawPath(endMember.stats, "dividedKills.human") - rawPath(startMember.stats, "dividedKills.human");
    const dDeaths = rawPath(endMember.stats, "deaths") - rawPath(startMember.stats, "deaths");
    const dActive = rawPath(endMember.stats, "classes.kit.secondsPlayed") - rawPath(startMember.stats, "classes.kit.secondsPlayed");
    if (![dPlayerKills, dDeaths, dActive].every(Number.isFinite) || dActive <= 0) continue;

    const kd = memberPeriodStat(counters, discordId, "infantryKillDeath", window);
    const kpm = memberPeriodStat(counters, discordId, "playerKillsPerMinute", window);
    const kills = memberPeriodStat(counters, discordId, "kills", window);
    if (kd.invalid || kd.provenance.startCarried || kd.provenance.endCarried) continue;

    assert.equal(kills.value, dPlayerKills, `${endMember.name}: playerKills parity`);
    if (dDeaths > 0) {
      assert.ok(Math.abs(kd.value - dPlayerKills / dDeaths) < 1e-9, `${endMember.name}: Player K/D parity`);
    }
    assert.ok(Math.abs(kpm.value - dPlayerKills / (dActive / 60)) < 1e-9, `${endMember.name}: Player KPM parity`);
    compared += 1;
  }
  assert.ok(compared >= 3, `expected at least 3 fully comparable members, got ${compared}`);
});
