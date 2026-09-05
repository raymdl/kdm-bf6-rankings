import test from "node:test";
import assert from "node:assert/strict";
import { checkForNewRelease, dataAge, dataSourceStatus, dataUrl, initDataSource } from "../assets/data-source.js";

// Without initDataSource() there is no release pointer, which is exactly the
// state the "pages" rollback runs in. The fallback timestamp is then the only
// freshness signal the site has, and a rolled-back site is the case most likely
// to be serving stale data — so the marker has to work without a pointer.

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-08-19T12:00:00Z");

test("data age falls back to the published observation when there is no release pointer", () => {
  const fresh = dataAge(now, new Date(now - 1 * HOUR).toISOString());
  assert.equal(fresh.known, true);
  assert.equal(fresh.stale, false);
  // Pages mode has no refresh id to name, and the caller's tooltip depends on
  // this being null rather than undefined or a crash.
  assert.equal(fresh.refreshId, null);
});

test("data older than the largest scheduled gap is marked stale", () => {
  // The published schedule's widest gap is 02:45 -> 09:00 ET, so eight hours is
  // the threshold at which a refresh has been missed rather than merely awaited.
  const stale = dataAge(now, new Date(now - 9 * HOUR).toISOString());
  assert.equal(stale.known, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.refreshId, null);

  const justInside = dataAge(now, new Date(now - 7 * HOUR).toISOString());
  assert.equal(justInside.stale, false);
});

test("age is unknown when neither a pointer nor a published observation exists", () => {
  assert.deepEqual(dataAge(now, null), { known: false, stale: false });
  assert.deepEqual(dataAge(now), { known: false, stale: false });
});

test("freshness checks detect new data without changing the pinned release, including on failure", async (t) => {
  const pointer = { version: 1, refreshId: "first", observedAt: "2026-09-04T12:00:00Z", releasePrefix: "releases/first/data/" };
  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => pointer }));
  await initDataSource();
  const pinnedUrl = dataUrl("data/history.json");
  assert.deepEqual(await checkForNewRelease(), { available: false });
  fetchMock.mock.mockImplementation(async (_url, options) => {
    assert.equal(options.cache, "no-cache");
    return { ok: true, json: async () => ({ ...pointer, refreshId: "second", releasePrefix: "releases/second/data/" }) };
  });
  assert.deepEqual(await checkForNewRelease(), { available: true });
  assert.equal(dataUrl("data/history.json"), pinnedUrl);
  for (const response of [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => ({ ...pointer, releasePrefix: "releases/wrong/data/" }) })
  ]) {
    fetchMock.mock.mockImplementation(response);
    assert.deepEqual(await checkForNewRelease(), { available: false, failed: true });
    assert.equal(dataUrl("data/history.json"), pinnedUrl);
    assert.equal(dataSourceStatus().status, "ready");
  }
});
