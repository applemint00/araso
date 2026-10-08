// [A-904] One-time honey-jar guide after Second (static contract; browser run = a904-post-second-guide-browser.mjs).
// Card target changed by the Owner HOLD release note (2026-10-08): the guide points at the jar, not the house stamp; no Chog "tap me!", no new copy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");

const a = JS.indexOf("// ── [A-904] One-time guide");
const b = JS.indexOf("// ── [/A-904]");
assert.ok(a > 0 && b > a, "A-904 main.js block present");
const jsAll = JS.slice(a, b);
const js = jsAll.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
assert.equal(JS.split("// ── [A-904] One-time guide").length, 2, "exactly one A-904 block");
// gate: Second complete, a quiet sendstay Home only (Away / secondAway / Return never arm)
assert.match(js, /state\.scene !== "sendstay" \|\| state\.secondJourneyCompletedOnce !== true \|\| state\.sendCardVisible/);
// same quiet beat as A-891, no new number
assert.match(js, /POST_FILE_QUIET_HOME_MS/);
assert.ok(!/\b\d{4,}\b/.test(js.replace(/20\d\d-\d\d-\d\d/g, "")), "no new ms number");
// once-only persistence: max 3 entries, done on the first jar tap, storage failure = no guide
assert.match(js, /g\.entries >= 3/);
assert.match(js, /a904Write\("done"\)/);
assert.match(js, /catch \{ return \{ done: true, entries: 3 \}; \}/);
// the tap is a delegated click on the existing jar; A-905 jar code is not touched
assert.match(js, /closest\?\.\("#a905Jar"\)/);
// no new copy: the block has no string literal with letters except ids / keys / attribute values
const lits = [...js.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]).filter((s) => /[A-Za-z]{3}/.test(s));
const allowed = new Set(["araso.a904JarGuide", "done", "#a905Jar", "data-a904", "twinkle", "drop", "sendstay", "undefined", "click", "ARASO"]);
for (const s of lits) assert.ok(allowed.has(s) || /^[#.a-zA-Z0-9_-]+$/.test(s), `unexpected literal in A-904 block: ${s}`);
// Chog "tap me!" is not used by this guide, the house stamp gets no cue
assert.ok(!/startTapCue|tap me|homePaper__stamp/.test(js), "no Chog cue / house-stamp cue");
// line comments only
assert.ok(!/\/\*/.test(jsAll), "line comments only in main.js block");

const c = CSS.indexOf("[A-904] one-time jar guide");
const d = CSS.indexOf("── [A-904] end ──");
assert.ok(c > 0 && d > c, "A-904 css block present");
const css = CSS.slice(c, d);
assert.match(css, /burst@2x\.png/, "existing burst art only");
assert.match(css, /pointer-events: none/, "burst takes no pointer");
assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*a904Twinkle 1\.5s/, "motion only under no-preference");
const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*$/, "");
assert.ok(!/animation/.test(outside.replace(/\/\*[\s\S]*?\*\//g, "")), "no animation outside no-preference");
assert.ok(!/animation:\s*none|transition:\s*none/.test(css), "no none-text");
assert.ok(!/prefers-reduced-motion: reduce/.test(css), "no new reduce block (a735 A6)");
console.log("a904 post-second jar guide: PASS");
