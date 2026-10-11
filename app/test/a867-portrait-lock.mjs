// A-867 portrait lock: static node-only check of the web app manifest and its link.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { PRIVATE_RE } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const APP = new URL("..", import.meta.url).pathname;
let fails = 0;
const check = (name, fn) => {
  try { fn(); console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "-", e.message.split("\n")[0]); }
};

const HTML = readFileSync(join(APP, "index.html"), "utf8");
const mpath = join(APP, "public/manifest.webmanifest");
let M = {};
check("manifest is valid JSON", () => { M = JSON.parse(readFileSync(mpath, "utf8")); });
check("orientation portrait", () => assert.equal(M.orientation, "portrait"));
check("display standalone", () => assert.equal(M.display, "standalone"));
check("start_url /", () => assert.equal(M.start_url, "/"));
check("name and short_name match <title>", () => {
  const t = (HTML.match(/<title>([^<]*)<\/title>/) || [])[1];
  assert.equal(M.name, t); assert.equal(M.short_name, t);
});
check("colours are hex and match --paper", () => {
  const css = readFileSync(join(APP, "src/style.css"), "utf8");
  const paper = (css.match(/--paper\s*:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  assert.equal(M.background_color.toLowerCase(), paper.toLowerCase());
  assert.equal(M.theme_color.toLowerCase(), paper.toLowerCase());
});
check("referenced icons exist (if any)", () => {
  for (const ic of M.icons || []) assert.ok(existsSync(join(APP, "public", ic.src.replace(/^\//, ""))), ic.src);
});
check("index.html links the manifest exactly once", () => {
  const links = HTML.match(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/?>/g) || [];
  assert.equal(links.length, 1, "found " + links.length);
});
check("hygiene: no private dir / A-number / local path", () => {
  const raw = readFileSync(mpath, "utf8");
  assert.ok(!(PRIVATE_RE.test(raw) || /\bA-\d+|\/Users\/|\.env/.test(raw)));
});
console.log(fails ? `FAIL ${fails}` : "ALL PASS");
process.exit(fails ? 1 : 0);
