import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { memberPeriodStat, resolveRange, validCounters } from "../assets/period.js";

// Cross-implementation parity: the published counters artifact (written by the
// bot publisher) must reproduce the same Period values as an independent
// recomputation straight from the raw archive files.
//
// The raw archives moved to a private repository on 2026-07-26, so this
// checkout retains only the newest day and cannot supply the two endpoints the
// comparison needs. Point BF6_PARITY_ARCHIVE_DIR at a private archive checkout
// (its archive/bf6 directory) to run the real comparison:
//
//   BF6_PARITY_ARCHIVE_DIR=../.bf6-archive-repo/archive/bf6 npm test
//
// Without it the test skips rather than fails, because a bare clone before the
// first artifact publish legitimately has neither input.

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const archiveDir = process.env.BF6_PARITY_ARCHIVE_DIR?.trim()
  ? path.resolve(process.env.BF6_PARITY_ARCHIVE_DIR.trim())
  : path.join(dataDir, "archive");

async function loadJson(relative) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, relative), "utf8"));
  } catch {
    return null;
  }
}

async function loadArchive(date) {
  try {
    return JSON.parse(await readFile(path.join(archiveDir, `${date}.json`), "utf8"));
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
    archiveDates = (await readdir(archiveDir))
      .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
      .filter(Boolean)
      .sort();
  } catch {
    archiveDates = [];
  }
  if (!validCounters(counters)) {
    t.skip("no real counters.json in this checkout");
    return;
  }
  // Distinguish "the archives live elsewhere now" from "nothing has been
  // published yet" -- the first is the normal state of this repo and is fixed
  // by setting BF6_PARITY_ARCHIVE_DIR, the second is a genuinely bare clone.
  if (archiveDates.length < 2) {
    t.skip(
      process.env.BF6_PARITY_ARCHIVE_DIR?.trim()
        ? `BF6_PARITY_ARCHIVE_DIR=${archiveDir} has ${archiveDates.length} archive date(s); 2 are needed`
        : `only ${archiveDates.length} archive date(s) here since the raw archives moved to the private repo; set BF6_PARITY_ARCHIVE_DIR to run this`
    );
    return;
  }

  const window = resolveRange(counters, "7d");
  assert.ok(!window.unavailable, "7d window must resolve on real data");
  const startArchive = await loadArchive(window.startDate);
  const endArchive = await loadArchive(window.endDate);
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
