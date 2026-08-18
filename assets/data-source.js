/* Centralized data-URL resolution.

   Generated JSON is published to Cloudflare R2 and served by a thin Worker.
   Every data path in the app goes through dataUrl() so the base URL lives in
   exactly one place - do not inline it in route loaders.

   The pointer is read once per page session and the whole session is pinned to
   that release. A publish landing mid-session cannot produce a page showing
   half one refresh and half the next. */

// ROLLBACK: set to "pages" to serve every data file from this repository again,
// as published to GitHub Pages. Git publication still runs, so the data under
// data/ stays current and this is a complete rollback on its own. Change this
// constant, bump CACHE_VERSION in index.html, and deploy.
const DATA_SOURCE = "r2";

const R2_BASE = "https://kdm-bf6-data.kdm-analytics.workers.dev";
const POINTER_URL = `${R2_BASE}/current.json`;

// The published schedule's largest gap is 02:45 -> 09:00 ET, so anything past
// eight hours means a refresh was missed rather than merely being between runs.
const STALE_AFTER_MS = 8 * 60 * 60 * 1000;

let release = null;
let status = "uninitialized";
let failureReason = null;

function validatePointer(pointer) {
  if (!pointer || typeof pointer !== "object") throw new Error("pointer is not an object");
  if (pointer.version !== 1) throw new Error(`unsupported pointer version ${pointer.version}`);
  for (const field of ["refreshId", "observedAt", "releasePrefix"]) {
    if (typeof pointer[field] !== "string" || !pointer[field]) throw new Error(`pointer is missing ${field}`);
  }
  // Guards against a pointer that names one refresh but points at another
  // release's bytes, which would silently serve mismatched data.
  if (!pointer.releasePrefix.startsWith(`releases/${pointer.refreshId}/`)) {
    throw new Error("pointer releasePrefix does not belong to its refreshId");
  }
  if (!pointer.releasePrefix.endsWith("/")) throw new Error("pointer releasePrefix is not a prefix");
  if (Number.isNaN(Date.parse(pointer.observedAt))) throw new Error("pointer observedAt is not a date");
  return pointer;
}

export async function initDataSource() {
  if (DATA_SOURCE !== "r2") {
    status = "pages";
    return null;
  }
  try {
    const response = await fetch(POINTER_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pointer = validatePointer(await response.json());
    release = { refreshId: pointer.refreshId, observedAt: pointer.observedAt, releasePrefix: pointer.releasePrefix };
    status = "ready";
    return release;
  } catch (error) {
    status = "failed";
    failureReason = error.message;
    return null;
  }
}

/* Resolve a repository-relative data path to wherever that file actually lives.

   Fails closed rather than returning the repository path: falling back to Pages
   without saying so is what produced the 2026-08-18 publication divergence, and
   once the frontend reads R2 the same silence would serve stale data instead of
   a visible error. */
export function dataUrl(path) {
  if (DATA_SOURCE !== "r2") return path;
  if (status !== "ready") throw new Error(`data source unavailable: ${failureReason ?? status}`);
  if (!path.startsWith("data/")) return path;
  return `${R2_BASE}/${release.releasePrefix}${path.slice("data/".length)}`;
}

/* Release files are immutable, so the browser may cache them freely. Only the
   pointer needs revalidation, and it is never fetched through here. */
export function dataFetchOptions() {
  return DATA_SOURCE === "r2" ? {} : { cache: "no-cache" };
}

export function dataSourceStatus() {
  return { source: DATA_SOURCE, status, failureReason, release };
}

/* Freshness is the one check that survives every cause: an R2 outage, a stuck
   publisher, a bad pointer, or a Worker misconfiguration all surface here. */
export function dataAge(now = Date.now()) {
  const observedAt = release?.observedAt ?? null;
  if (!observedAt) return { known: false, stale: false };
  const ageMs = now - Date.parse(observedAt);
  return { known: true, ageMs, stale: ageMs > STALE_AFTER_MS, observedAt, refreshId: release.refreshId };
}
