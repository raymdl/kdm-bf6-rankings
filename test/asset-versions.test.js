import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The site has no build step, so cache busting is manual `?v=` query strings.
// A forgotten bump can pair a stale cached module with a fresh one, which
// fails in ways that are hard to reproduce. This test pins the convention:
// index.html's app.js version and every versioned module import inside
// assets/*.js must carry the same version string, and every relative module
// import must be versioned at all.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("static deployment assets share a cache version and Chart.js keeps its integrity contract", async () => {
  const indexHtml = await read("index.html");
  const appTag = indexHtml.match(/src="assets\/app\.js\?v=([^"]+)"/);
  assert.ok(appTag, "index.html must load assets/app.js with a ?v= version");
  const version = appTag[1];

  const appJs = await read("assets/app.js");
  for (const file of (await readdir(path.join(root, "assets"))).filter((file) => file.endsWith(".js"))) {
    const source = await read(`assets/${file}`);
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.\.?\/[^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of imports) {
      const versioned = specifier.match(/\?v=(.+)$/);
      assert.ok(versioned, `unversioned module import in ${file}: ${specifier}`);
      assert.equal(versioned[1], version, `version mismatch for ${specifier} (index.html has ${version})`);
    }
  }
  assert.match(indexHtml, /href="assets\/style\.css\?v=[^"]+"/);
  assert.match(appJs, /CHART_JS_URL\s*=\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@\d+\.\d+\.\d+\/dist\/chart\.umd\.min\.js"/);
  assert.match(appJs, /CHART_JS_INTEGRITY\s*=\s*"sha384-[A-Za-z0-9+/=]+"/);
  assert.match(appJs, /script\.integrity\s*=\s*CHART_JS_INTEGRITY/);
  assert.match(appJs, /script\.crossOrigin\s*=\s*"anonymous"/);
  assert.doesNotMatch(indexHtml, /cdn\.jsdelivr\.net\/npm\/chart\.js/, "Chart.js must not load on every route");
});
