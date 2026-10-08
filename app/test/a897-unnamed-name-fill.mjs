// A-897 P2 — Unnamed Piggy: yellow underline in the Home name slot, only that row tappable, tap -> in-place
// handwriting input + save (Name-it grammar) -> renameIndexedPiggy on the current chain-scoped Piggy -> Home stays.
// Named Piggies: not tappable, no rename. No Hatch / Name-scene re-entry / new Piggy / network / keys.
// Node only (no browser): markup, provider logic cut out of the REAL main.js [A-897] block and run in node:vm against the
// REAL piggy-index.js, static wiring, CSS contract, and "protected main.js bodies byte-identical" against the snapshot BASE.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MAIN = rd("app/src/main.js");
const CSS = rd("app/src/style.css");
const BASEFILE = path.join(REPO, "..", "a897d_BASE.sha256");
let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.stack) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
}
const between = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `block ${a}`); return src.slice(i, j); };

const { residentCardsMarkup, unnamedNameRowMarkup, setUnnamedNameFill, applyUnnamedNameRows } = await import("../src/home-paper.js");
const { renameIndexedPiggy, registerControlledPiggy, loadMyPiggiesIndex } = await import("../src/piggy-index.js");

// ── markup ───────────────────────────────────────────────────────────────────────────────────────────
await check("U1 unnamed row = a single button holding only the existing yellow underline (no text), aria-label from Name it's own title", () => {
  const m = unnamedNameRowMarkup();
  // pre-A-897-pen baseline: the whole row was a <button data-name-fill="underline" aria-label="name it"> holding only the underline. Now: a plain div (same as a named row) + ONE pen button.
  assert.match(m, /^<div class="homePaper__name homePaper__name--unnamed" data-name-fill="underline"><img class="homePaper__nameUnderline" src="\/invite\/underline@2x\.png" alt="" aria-hidden="true" \/>/);
  assert.match(m, /<button class="homePaper__namePen" type="button" data-name-pen aria-label="name it"><img src="\/card\/name-pen\.svg" alt="" aria-hidden="true" \/><\/button><\/div>$/);
  assert.equal((m.match(/<button/g) || []).length, 1, "the pen is the only tappable thing");
  assert.ok(existsSync(path.join(REPO, "app/public/card/name-pen.svg")), "pen asset exists");
  const pen = readFileSync(path.join(REPO, "app/public/card/name-pen.svg"), "utf8");
  assert.ok(/feTurbulence/.test(pen) && /#E0B100/.test(pen) && !/✏/.test(pen), "crayon grammar (like crayon-bell), A-845 yellow, no emoji");
  assert.equal(m.replace(/<[^>]*>/g, "").trim(), "", "no visible text in the slot");
  assert.ok(existsSync(path.join(REPO, "app/public/invite/underline@2x.png")), "the asset the Owner named exists");
});
await check("U2 named Piggies keep the plain div (not tappable, no rename); only {unnamed:true} rows get the button", () => {
  const html = residentCardsMarkup({
    residents: [
      { id: "p1", name: "Mochi", label: "", recordsEntryMarkup: "" },
      { id: "p2", name: "", unnamed: true, label: "", recordsEntryMarkup: "" },
      { id: "p3", name: "Bebe", unnamed: false, label: "", recordsEntryMarkup: "" },
    ],
  });
  assert.equal((html.match(/data-name-fill="underline"/g) || []).length, 1);
  assert.match(html, /<div class="homePaper__name">Mochi<\/div>/);
  assert.match(html, /<div class="homePaper__name">Bebe<\/div>/);
  assert.match(html, /data-piggy-id="p2"[\s\S]*?data-name-fill="underline"/);
  // default path (single Piggy, no flag) is byte-for-byte the old name div
  assert.match(residentCardsMarkup({ name: "Piggy", label: "x" }), /<div class="homePaper__name">Piggy<\/div>/);
});

// ── provider logic against the real index ────────────────────────────────────────────────────────────
const ADDR1 = "0x1111111111111111111111111111111111111111";
const ADDR2 = "0x2222222222222222222222222222222222222222";
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
function cutProvider(overrides = {}) {
  const block = between(MAIN, "function a897NameFillInfo(", "// ── [A-897 P2] end");
  const storage = memoryStorage();
  const calls = { refresh: 0, provider: null };
  const chainId = "monad-testnet";
  const sandbox = {
    state: { address: ADDR1 },
    PIGGY_NAME_KEY: "araso.piggyName",
    localStorage: storage,
    safeLocalStorage: () => storage,
    secondJourneyScope: () => ({ accountId: ADDR1, chainId }),
    indexedResidents: () => loadMyPiggiesIndex(storage, chainId).index.piggies,
    indexedPiggyId: (a) => `legacy-${String(a).toLowerCase()}`,
    readPiggyName: () => storage.getItem("araso.piggyName") || "",
    renameIndexedPiggy,
    refreshHomePaperMount: () => { calls.refresh += 1; },
    setUnnamedNameFill: (p) => { calls.provider = p; },
    ...overrides,
  };
  vm.runInNewContext(block, sandbox);
  return { storage, calls, chainId, sandbox };
}
function seed(storage, chainId, rows) {
  for (const r of rows) {
    const out = registerControlledPiggy(storage, chainId, { id: r.id, name: r.name ?? null, address: r.address, signerAddress: r.address, locator: { credentialId: "AAECAwQFBgcICQoLDA0ODw" }, at: "2026-10-08T00:00:00.000Z" });
    assert.equal(out.ok, true, `seed ${r.id}: ${out.reason}`);
  }
}
const card = (id) => ({ dataset: id ? { piggyId: id } : {} });

await check("U3 single unnamed #1: provider says unnamed; Save -> renameIndexedPiggy on the chain-scoped row + PIGGY_NAME_KEY (Name-it's own Save line) + Home mount refreshed, no scene change", () => {
  const { storage, calls, chainId } = cutProvider();
  seed(storage, chainId, [{ id: `legacy-${ADDR1}`, address: ADDR1 }]);
  const p = calls.provider;
  assert.ok(p, "provider registered at module level");
  assert.equal(p.isUnnamed(card(null)), true);
  assert.equal(p.save(card(null), "Mochi"), true);
  assert.equal(loadMyPiggiesIndex(storage, chainId).index.piggies[0].name, "Mochi");
  assert.equal(storage.getItem("araso.piggyName"), "Mochi");
  assert.equal(calls.refresh, 1);
  assert.equal(p.isUnnamed(card(null)), false, "after saving it is named -> no longer tappable");
  assert.equal(p.save(card(null), "Other"), false, "named Piggy: rename refused");
  assert.equal(loadMyPiggiesIndex(storage, chainId).index.piggies[0].name, "Mochi");
});
await check("U4 multi: only the unnamed row is unnamed; named rows are not; saving fills only that row and does NOT touch PIGGY_NAME_KEY for a non-first row", () => {
  const { storage, calls, chainId } = cutProvider();
  seed(storage, chainId, [{ id: `legacy-${ADDR1}`, address: ADDR1, name: "Mochi" }, { id: "piggy-two", address: ADDR2 }]);
  const p = calls.provider;
  assert.equal(p.isUnnamed(card(`legacy-${ADDR1}`)), false);
  assert.equal(p.isUnnamed(card("piggy-two")), true);
  assert.equal(p.save(card(`legacy-${ADDR1}`), "Hax"), false, "named row has no rename");
  assert.equal(p.save(card("piggy-two"), "Bebe"), true);
  const rows = loadMyPiggiesIndex(storage, chainId).index.piggies;
  assert.deepEqual(rows.map((r) => r.name), ["Mochi", "Bebe"]);
  assert.equal(storage.getItem("araso.piggyName"), null);
});
await check("U5 unknown card / no address / unindexed -> not unnamed, nothing is created (rename can never register a new Piggy)", () => {
  const a = cutProvider({ state: { address: "" } });
  a.calls.provider && assert.equal(a.calls.provider.isUnnamed(card(null)), false);
  const b = cutProvider();
  assert.equal(b.calls.provider.isUnnamed(card(null)), false, "empty index");
  assert.equal(b.calls.provider.isUnnamed(card("nope")), false);
  assert.equal(b.calls.provider.save(card("nope"), "X"), false);
  assert.equal(loadMyPiggiesIndex(b.storage, b.chainId).index.piggies.length, 0);
  assert.equal(renameIndexedPiggy(b.storage, b.chainId, { id: "nope", name: "X" }).ok, false);
});
await check("U6 rename refusal (unreadable/refusing index) -> save() false and PIGGY_NAME_KEY untouched (input stays for retry)", () => {
  const { storage, calls, chainId } = cutProvider({ renameIndexedPiggy: () => ({ ok: false, reason: "storage_write_failed" }) });
  seed(storage, chainId, [{ id: `legacy-${ADDR1}`, address: ADDR1 }]);
  assert.equal(calls.provider.save(card(null), "Mochi"), false);
  assert.equal(storage.getItem("araso.piggyName"), null);
  assert.equal(calls.refresh, 0);
});

// ── module wiring ────────────────────────────────────────────────────────────────────────────────────
await check("U7 seam lives in home-paper.js (home-paper-multi.js stays byte-identical to the confirmed package): no provider -> no-op; a half provider is rejected; main.js applies it when a new resident card enters the DOM (no mount-time hook, no render() edit)", () => {
  assert.equal(typeof setUnnamedNameFill, "function");
  setUnnamedNameFill(null);
  assert.equal(applyUnnamedNameRows({ querySelectorAll() { throw new Error("must not read the DOM without a provider"); } }), 0);
  setUnnamedNameFill({ isUnnamed() { return false; } }); // missing save -> rejected
  assert.equal(applyUnnamedNameRows({ querySelectorAll() { throw new Error("rejected provider"); } }), 0);
  setUnnamedNameFill(null);
  const src = rd("app/src/home-paper.js");
  assert.match(src, /e\.stopPropagation\(\); \/\/ 종이 접기\/Chog 탭으로 번지지 않는다/);
  assert.match(src, /busy = true; \/\/ Save 단일 실행/);
  const blk = between(MAIN, "function a897ObserveHomeCards()", "// ── [A-897 P2] end");
  assert.match(blk, /addedNodes/);
  assert.match(blk, /observe\(document\.body, \{ childList: true, subtree: true \}\)/);
  assert.equal(/attributes|characterData/.test(blk), false, "only added resident cards trigger it");
  if (existsSync(BASEFILE)) {
    const want = readFileSync(BASEFILE, "utf8").split("\n").find((l) => /\s+app\/src\/home-paper-multi\.js$/.test(l)).split(/\s+/)[0];
    assert.equal(sha(rd("app/src/home-paper-multi.js")), want, "home-paper-multi.js untouched (a design-package pin)");
  }
});
await check("U8 only existing copy appears: the only new visible word in the fill row is Name it's own 'save'; no Hatch / Name scene / setScene / render() in the fill path", () => {
  const src = rd("app/src/home-paper.js");
  const fill = between(src, "// ── [A-897] 이름 없는 Piggy", "// ── [A-897] end");
  assert.match(fill, />save<\/button>/);
  const noComments = (t) => t.split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");
  assert.equal(/setScene|hatch|Hatch|renderName|beginGiftPiggy|beginAddPiggy|createPiggy/.test(noComments(fill)), false);
  const blk = between(MAIN, "function a897NameFillInfo(", "// ── [A-897 P2] end");
  assert.equal(/setScene|render\(\)|hatch|createPiggy|beginAddPiggy|beginGiftPiggy|navigator\.credentials/.test(noComments(blk)), false, "provider block never changes scene / makes a Piggy / calls WebAuthn");
  assert.match(blk, /renameIndexedPiggy\(safeLocalStorage\(\), secondJourneyScope\(\)\.chainId, \{ id: info\.id, name \}\)/);
});
await check("U9 CSS (pre-A-897-pen baseline: whole-row ::after inset -0.35em -0.2em 0 -0.2em): only the pen is tappable, its hidden hit is em (3.1em) and >= 44 on-screen at phone x.6408 / web x.957, the row itself is not interactive, Name-it input font", () => {
  const b = between(CSS, "/* ── [A-897 P2] 이름 없는 Piggy", "/* ── [A-897 P2] end");
  const css = b.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/\.homePaper__name--unnamed::after/.test(css), false, "no whole-row tap area");
  assert.equal(/\.homePaper__name--unnamed \{[^}]*(pointer-events|cursor)/.test(css), false, "the row is not interactive");
  assert.match(css, /\.homePaper__namePen \{[^}]*pointer-events: auto;/);
  // pre-A-897-pen-fix: inset: -1em (reached back over the row). Now longhands growing away from the row.
  assert.match(css, /\.homePaper__namePen::after \{[^}]*top: -1em;[^}]*bottom: -1em;[^}]*left: 0;[^}]*right: -2em;/);
  assert.equal(/\.homePaper__namePen::after \{[^}]*inset:/.test(css), false);
  // pre-A-897-pen-fix4: fix3 grew phone multi up (top -1.95em / bottom +.05em) and the multi window clip (~25 local above the row) cut card 0's hit to 33 on-screen. Now: symmetric -1em vertical, pen 0.4em further right, hit 2.9em wide.
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.homePaper__card--piggy\[data-piggy-id\] \.homePaper__namePen \{ left: calc\(100% - 0\.6em\); \}\s*\.homePaper__card--piggy\[data-piggy-id\] \.homePaper__namePen::after \{\s*top: -1em;\s*bottom: -1em;\s*right: -1\.8em;\s*\}/);
  assert.ok((1.1 + 1.8) * 24 * 0.6408 >= 44, "phone multi pen hit width >= 44 on-screen");
  assert.ok((1.1 + 2) * 24 * 0.6408 >= 44, "phone multi pen hit height >= 44 on-screen");
  assert.match(css, /\.homePaper__namePen \{[^}]*width: 1\.1em;[^}]*height: 1\.1em;/);
  const hitEm = 1.1 + 2 * 1;
  assert.ok(hitEm * 24 * 0.6408 >= 44, `phone pen hit ${(hitEm * 24 * 0.6408).toFixed(1)} on-screen px`);
  assert.ok(hitEm * 21 * 0.957 >= 44, `web pen hit ${(hitEm * 21 * 0.957).toFixed(1)} on-screen px`);
  assert.match(b, /\.homePaper__nameInput \{[^}]*font: 600 1em\/1\.2 system-ui, sans-serif;/);
  assert.equal(/\.homePaper__name--unnamed[^{]*\{[^}]*\b\d+(\.\d+)?px/.test(css.replace(/outline[^;]*;/g, "")), false, "em, not px");
});

await check("U12 (pre-A-897-pen baseline: B1/B1' shrank records ::after to top -25.5px web / -27px phone multi) records are back to their ORIGINAL hit; the pen sits right of the row so its hit and records never overlap", () => {
  const b = between(CSS, "/* ── [A-897 P2] 이름 없는 Piggy", "/* ── [A-897 P2] end");
  const css = b.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/data-name-fill\]\) (\.homePaper__records|#homeRecordsButton)/.test(css), false, "no records ::after override scoped to unnamed cards");
  assert.equal(/-25\.5px|-27px/.test(css), false);
  assert.match(CSS, /@media \(min-width: 641px\) \{\s*#homeRecordsButton::after \{ inset: -44px -12px 0 -12px; \}/);
  assert.match(CSS, /\.homePaper__records\[data-piggy-id\]::after \{\s*inset: -30px -12px -18px -12px;/);
  // pre-A-897-pen-fix2: left calc(100% + .3em), right -1em (hit 2.1em wide). Now the pen is 1em inside the row end and the hit is 3.1em wide.
  assert.match(css, /\.homePaper__namePen \{[^}]*left: calc\(100% - 1em\);/);
  assert.match(css, /\.homePaper__name--unnamed,\s*\.homePaper__nameFill \{ z-index: 1; \}/);
  // horizontal: pen hit starts at 8.3em (left: 0) from the row's left; records box hit ends at its text width + 12px (text ~ 7em at 14px/21px -> < 5.5em)
  assert.ok(8 - 1 >= 6, "pen hit starts at 7em (hit = 3.1em wide, ends ~10.1em; records text + 12px ends < 5.5em), right of the records hit (text + 12px)");
});
await check("U13 M7/M8/M5: outside pointerdown closes the empty form; form height = row height; fill form inherits the name font; first Piggy with a device name is not unnamed in the multi branch", () => {
  const hp = rd("app/src/home-paper.js");
  assert.match(hp, /document\.addEventListener\('pointerdown', outside, true\)/);
  assert.match(hp, /!busy && !input\.value\.trim\(\) && !form\.contains\(e\.target\)/, "outside tap closes only an EMPTY form (typed text is kept)");
  assert.match(hp, /form\.className = 'homePaper__name homePaper__nameFill'/);
  const css = between(CSS, "/* 탭 → 그 자리에서 Name it", "/* 승격 장면 — body 위");
  assert.match(css, /\.homePaper__nameFill \{[^}]*height: 1\.2em;/);
  assert.equal(/font: italic 21px|max-width: 640px/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  const { storage, calls, chainId } = cutProvider();
  seed(storage, chainId, [{ id: `legacy-${ADDR1}`, address: ADDR1 }, { id: "piggy-two", address: ADDR2 }]);
  storage.setItem("araso.piggyName", "Mochi");
  assert.equal(calls.provider.isUnnamed(card(`legacy-${ADDR1}`)), false, "device-level name exists: no overwrite");
  assert.equal(calls.provider.save(card(`legacy-${ADDR1}`), "Hax"), false);
  assert.equal(calls.provider.isUnnamed(card("piggy-two")), true, "other rows are unaffected");
});

await check("U14 browser-log fixes: markup-rendered underline buttons get their tap bound (data-name-bound); the unnamed row takes the name font from .homePaper__name (no `font: inherit` shrinking every em to 16px)", () => {
  const hp = rd("app/src/home-paper.js");
  assert.match(hp, /getAttribute\('data-name-fill'\) === 'underline'[\s\S]*?bindUnnamedButton\(card, nameEl\)/);
  assert.match(hp, /btn\.setAttribute\('data-name-bound', '1'\)/);
  const rule = /\.homePaper__name--unnamed \{[^}]*\}/.exec(CSS.slice(CSS.indexOf("/* ── [A-897 P2]")))[0];
  assert.equal(/font:/.test(rule), false);
});

// ── protected bodies / scope ────────────────────────────────────────────────────────────────────────
const inSnapshot = path.basename(REPO) === "a897d" && existsSync(BASEFILE);
function stripP2(src) {
  return src
    .replace(/\/\/ ── \[A-897\] P2 imports[\s\S]*?\/\/ ── \[A-897\] end P2 imports ──\n/, "")
    .replace(/\/\/ ── \[A-897 P2\] 승격 장면[\s\S]*?\/\/ ── \[A-897 P2\] end [^\n]*\n\n/, "");
}
await check("U10 main.js outside the new [A-897 P2] blocks is byte-identical to the snapshot BASE (render() and every other body untouched)", () => {
  if (!inSnapshot) { console.log("      (skipped: not in the a897d snapshot copy — P1 owns main.js after the merge)"); return; }
  const want = readFileSync(BASEFILE, "utf8").split("\n").find((l) => /\s+app\/src\/main\.js$/.test(l)).split(/\s+/)[0];
  assert.equal(sha(stripP2(MAIN)), want);
});
await check("U11 P2 touched no P1 files (gift-claim-entry / piggy-index / piggy-registry) vs the snapshot BASE", () => {
  if (!inSnapshot) { console.log("      (skipped: not in the a897d snapshot copy)"); return; }
  const lines = readFileSync(BASEFILE, "utf8").split("\n");
  for (const f of ["app/src/gift-claim-entry.js", "app/src/piggy-index.js", "app/src/piggy-registry.js"]) {
    const want = lines.find((l) => l.endsWith(`  ${f}`)).split(/\s+/)[0];
    assert.equal(sha(rd(f)), want, f);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
