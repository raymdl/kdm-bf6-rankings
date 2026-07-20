import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("index.html and all module imports share one ?v= version", async () => {
  const indexHtml = await read("index.html");
  const appTag = indexHtml.match(/src="assets\/app\.js\?v=([^"]+)"/);
  assert.ok(appTag, "index.html must load assets/app.js with a ?v= version");
  const version = appTag[1];

  const appJs = await read("assets/app.js");
  const imports = [...appJs.matchAll(/from\s+"(\.\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(imports.length >= 3, `expected module imports in app.js, found ${imports.length}`);
  for (const specifier of imports) {
    const versioned = specifier.match(/\?v=(.+)$/);
    assert.ok(versioned, `unversioned module import in app.js: ${specifier}`);
    assert.equal(versioned[1], version, `version mismatch for ${specifier} (index.html has ${version})`);
  }
});

test("style.css is loaded with a cache-busting version", async () => {
  const indexHtml = await read("index.html");
  assert.match(indexHtml, /href="assets\/style\.css\?v=[^"]+"/);
});

test("the Chart.js CDN script is pinned with subresource integrity", async () => {
  const indexHtml = await read("index.html");
  const tag = indexHtml.match(/<script[^>]+cdn\.jsdelivr\.net[^>]+>/s);
  assert.ok(tag, "Chart.js script tag not found");
  assert.match(tag[0], /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(tag[0], /crossorigin="anonymous"/);
});
