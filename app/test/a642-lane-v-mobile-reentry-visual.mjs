// A-642 Lane V (absorbs A-640) — mobile reentry visual integration contract.
// Checks, from source only (no browser):
//   V1–V4  LOGIN_CHECKING waiting look = reentry_preview.html §1 mobile composition, built from existing parts
//   V5–V7  Away restore line legible on ≤640 (≈18px at 390) without touching global Home scale / web
//   V8     no logic change: the A-633 auth/session/reconcile code is byte-identical to the A-633 baseline
// Browser evidence (390/430/1440 captures, counters) lives in the verification record outside this repo, not here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = readFileSync(path.join(ROOT, "src/main.js"), "utf8");
const CSS = readFileSync(path.join(ROOT, "src/style.css"), "utf8");
const CHOG_HOME = readFileSync(path.join(ROOT, "src/chog-home.js"), "utf8");

let pass = 0;
let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").join("\n      ")}`); fail += 1; }
}
function fnBody(name) {
  const m = MAIN.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`함수 없음: ${name}`);
  const start = m.index;
  let depth = 0;
  for (let i = MAIN.indexOf("{", MAIN.indexOf(")", start)); i < MAIN.length; i += 1) {
    if (MAIN[i] === "{") depth += 1;
    else if (MAIN[i] === "}") { depth -= 1; if (depth === 0) return MAIN.slice(start, i + 1); }
  }
  throw new Error(`함수 끝 없음: ${name}`);
}
function cut(a, b) {
  const s = MAIN.indexOf(a);
  if (s < 0) throw new Error(`못 찾음: ${a}`);
  const e = MAIN.indexOf(b, s + a.length);
  if (e < 0) throw new Error(`못 찾음: ${b}`);
  return MAIN.slice(s, e);
}
const sha16 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
// CSS rule body for an exact selector line (first match after `from`).
function cssRule(selector, from = 0) {
  const at = CSS.indexOf(`${selector} {`, from);
  if (at < 0) throw new Error(`CSS 규칙 없음: ${selector}`);
  return CSS.slice(at, CSS.indexOf("}", at) + 1);
}
const decl = (rule, prop) => {
  const m = rule.match(new RegExp(`(?:^|[\\s;{])${prop}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};

// ─── LOGIN_CHECKING (§1) ────────────────────────────────────────────────────────────────────────
check("V1 renderAppLock: waiting/checking → loginCheckingMarkup(phase); failed → the existing renderAuthCard failure card", () => {
  const body = stripComments(fnBody("renderAppLock"));
  assert.ok(/app\.innerHTML = failed\s*\?\s*renderAuthCard\(\{/.test(body), "failed branch keeps renderAuthCard");
  assert.ok(/:\s*loginCheckingMarkup\(state\.appLock\.phase\);/.test(body), "waiting branch = loginCheckingMarkup");
  // tap wiring unchanged: the Chog button calls unlockApp directly (no wrapper that could await first)
  assert.ok(body.includes('document.querySelector("#loginChogButton")?.addEventListener("click", unlockApp);'));
  assert.ok(body.includes('document.querySelector("#checkButton")?.addEventListener("click", unlockApp);'));
  assert.equal((body.match(/mountInviteChog\(\)/g) || []).length, 1, "one existing Chog mount (blink = BLINK_KEYS)");
});

check("V2 loginCheckingMarkup: the tap target is the big Chog face button built from existing parts; existing copy only", () => {
  const body = fnBody("loginCheckingMarkup");
  assert.ok(body.includes('<button class="loginCheck__face" id="loginChogButton" type="button" aria-label="Face ID">${chogInviteMarkup()}</button>'));
  assert.ok(body.includes("${arasoBrandMarkup()}"), "Araso = the existing brand markup (once)");
  assert.equal((body.match(/arasoBrandMarkup\(\)/g) || []).length, 1);
  assert.ok(body.includes('data-scene="birth" data-app-lock="${phase}"'), "same scene/lock markers the harness and body background use");
  // visible text = exactly the A-633 strings (no new copy)
  const tpl = body.slice(body.indexOf("return `") + 8, body.lastIndexOf("`;"));
  const text = tpl.replace(/\$\{isDevDebugOptIn\(\)[^}]*\}/, " ").replace(/\$\{[^}]*\}/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(text, "Checking… Face ID may appear once.");
  // no new asset paths
  assert.equal(/src=|url\(|\.png|\.svg/.test(body), false, "no new asset reference");
});

check("V3 loginCheckingMarkup calls no auth / signer / money / Gift / storage", () => {
  const body = stripComments(fnBody("loginCheckingMarkup"));
  for (const bad of ["requestPrf(", "unlockApp(", "settleUnlock(", "activateSigningSession(", "createSecp256k1SigningSession(", "credentials.", "checkPiggy(", "recoverPiggy(", "startPiggyOpen(", "sendTransaction", "requestGrant(", "issuePermission(", "localStorage", "setTimeout(", "await "]) {
    assert.equal(body.includes(bad), false, `loginCheckingMarkup contains ${bad}`);
  }
});

check("V4 §1 geometry in CSS (reentry_preview.html 390: face 94.5/132.5 202.4×243.2 · Araso 340/16 · Checking… 380/28 · Face ID 420/12)", () => {
  const face = cssRule(".stage--loginCheck .loginCheck__face");
  assert.equal(decl(face, "left"), "calc(50% - 100.5px)"); // 390 → 94.5
  assert.equal(decl(face, "top"), "132.5px");
  assert.equal(decl(face, "width"), "202.4px");
  assert.equal(decl(face, "height"), "243.2px");
  assert.ok(Math.abs(202.4 / 243.2 - 1780 / 2140) < 0.001, "face box keeps the chog-invite padded raster ratio 1780/2140");
  const sprite = cssRule(".stage--loginCheck .loginCheck__face .chogInvite");
  assert.equal(decl(sprite, "width"), "100%");
  assert.equal(decl(sprite, "height"), "100%");
  const hide = CSS.slice(CSS.indexOf('.stage--loginCheck .loginCheck__face [data-part="body"]'));
  assert.ok(hide.startsWith('.stage--loginCheck .loginCheck__face [data-part="body"],\n.stage--loginCheck .loginCheck__face [data-part="arm"] {\n  display: none;'), "head + eyes only");
  const brand = cssRule(".stage--loginCheck .arasoBrand");
  assert.equal(decl(brand, "top"), "340px");
  assert.equal(decl(brand, "font-size"), "16px");
  assert.equal(decl(brand, "text-align"), "center");
  assert.equal(decl(brand, "letter-spacing"), "0.08em");
  const title = cssRule(".stage--loginCheck .loginCheck__title");
  assert.equal(decl(title, "top"), "380px");
  assert.equal(decl(title, "font-size"), "28px");
  assert.equal(decl(title, "font-family"), "var(--font-cj)");
  const sub = cssRule(".stage--loginCheck .loginCheck__body", CSS.lastIndexOf(".stage--loginCheck .loginCheck__body {"));
  assert.equal(decl(sub, "top"), "420px");
  assert.equal(decl(sub, "font-size"), "12px");
  // passkey-sheet-safe: everything sits above 844 - 380 = 464 at 390
  assert.ok(420 + 12 * 1.5 <= 464 && 132.5 + 243.2 <= 464);
});

// ─── Away restore line ─────────────────────────────────────────────────────────────────────────
const HOME_SCALE = Function(`return ${CHOG_HOME.match(/export const HOME_SCALE = ([^;]+);/)[1]}`)();
const HOME_BOARD_W = Number(MAIN.match(/const HOME_BOARD_W = (\d+);/)[1]);

check("V5 #awayRestoreLine is enlarged only inside @media (max-width: 640px) and renders ≈18px (preview §3) at 390", () => {
  const at = CSS.indexOf("#awayRestoreLine {");
  assert.ok(at > 0, "rule present");
  assert.equal(CSS.indexOf("#awayRestoreLine", at + 1), -1, "exactly one rule");
  const mq = CSS.lastIndexOf("@media", at);
  assert.equal(CSS.slice(mq, CSS.indexOf("{", mq)).trim(), "@media (max-width: 640px)");
  assert.equal(CSS.slice(mq, at).split("}").length - 1, 0, "the rule is the media block's own child");
  const rule = CSS.slice(at, CSS.indexOf("}", at) + 1);
  const local = parseFloat(decl(rule, "font-size"));
  const s390 = (390 / HOME_BOARD_W) * HOME_SCALE;
  const s430 = (430 / HOME_BOARD_W) * HOME_SCALE;
  assert.ok(Math.abs(local * s390 - 18) < 0.3, `390 rendered ${local * s390}`);
  assert.ok(local * s430 > 18 && local * s430 < 21, `430 rendered ${local * s430}`);
  assert.equal(decl(rule, "max-width"), "none", "centering (translateX(-50%)) is not broken by the 260px cap");
  assert.equal(decl(rule, "top"), "auto");
  assert.ok(/^\d+px$/.test(decl(rule, "bottom")), "anchored above the feet");
});

check("V6 global Home scale + shared .chogCheckLine base + chog-home.js unchanged (web/return alarm/explore untouched)", () => {
  const base = cssRule(".chogCheckLine");
  assert.equal(decl(base, "left"), "450px");
  assert.equal(decl(base, "top"), "236px");
  assert.equal(decl(base, "max-width"), "260px");
  assert.equal(decl(base, "font-size"), "24px");
  assert.equal(HOME_SCALE.toFixed(10), "0.4712400398");
  assert.equal(sha16(fnBody("chogHomeMarkupForAway")), "08905344aad1c51c", "Away markup builder = A-633");
  const cssNoComments = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/#returnArrivalAlarm|#exploreChogSay/.test(cssNoComments), false, "return alarm / explore say keep the shared base rule only");
});

check("V7 LOGIN_CHECKING selectors exist only for lock markup (web 641+ never renders .stage--loginCheck)", () => {
  const uses = [...MAIN.matchAll(/stage--loginCheck|loginCheck__/g)].length;
  const inFn = [...fnBody("loginCheckingMarkup").matchAll(/stage--loginCheck|loginCheck__/g)].length;
  assert.equal(uses - [...MAIN.matchAll(/\/\/[^\n]*(stage--loginCheck|loginCheck__)/g)].length, inFn, "classes appear only in loginCheckingMarkup");
  assert.equal((MAIN.match(/loginCheckingMarkup\(/g) || []).length, 2, "defined once, called once (renderAppLock)");
  assert.ok(stripComments(fnBody("appLockSurface")).includes("window.innerWidth <= 640 && isAllowedPiggyRpId()"));
});

// ─── no logic change vs the A-633 baseline (HEAD 4c51dde) ──────────────────────────────────────
check("V8 A-633 auth/session/reconcile/return code byte-identical to the A-633 baseline", () => {
  const want = {
    requestPrf: "766fc57ed63b6009", unlockApp: "09cd6fb5dd4ee0dc", settleUnlock: "c4c353674bc122b3", appLockSurface: "8c31689ea48cf8aa",
    lockAppAfterIdle: "0083d873b56358ef", touchAppSession: "cd44c821c6781492", endActiveSession: "9cfc316632c9cea8",
    activateSigningSession: "0a3345ebee6d4bd3", reconcileSendPending: "1caf49b6a16b09df", classifySendPending: "2389cf76d2658fd6",
    readSendTxReceipt: "482a1cdc9025ff9f", reconciledSendReceipt: "1de55c29816852f7", commitSendSuccess: "51398edde399ae67",
    finishTrip: "b0ea22dfec3aa006", readSendPending: "ba4e61d4232e4f7f", showAwayRestore: "70ee359576d43fd1",
    awayRestoreLineMarkup: "027535c3b9c99afb", renderAuthCard: "54e902ad818b1b0a", mountInviteChog: "f894db5c8e334665",
    arasoBrandMarkup: "2916af023287cf7f", render: "866133cf60711093",
  };
  const got = Object.fromEntries(Object.keys(want).map((n) => [n, sha16(fnBody(n))]));
  assert.deepEqual(got, want);
  // Boot lock block re-pinned once for the chain-profile seal: the only change is
  // `const bootPending = state.scene === "sendstay" && LEGACY_TESTNET_PATH ? readSendPending() : null;`
  // (was `state.scene === "sendstay" ? ...`). On the default testnet profile LEGACY_TESTNET_PATH is
  // true, so the block behaves exactly as before; off testnet the testnet pending record is not
  // reconciled as this chain's. Previous pin: 83b318186c3ee7bc. The lock condition line is unchanged
  // (a633 A5 still asserts it).
  assert.equal(sha16(cut("// [A-633 A/C] 모바일/app 표면에서 저장된 credential", "// [A-559 PHASE S1] Gift 링크 fragment")), "23694803737b62f4", "boot lock block");
  assert.equal(sha16(cut("// [A-633 C] First Send 미확정 기록", "async function requestGrant(")), "20b3279a70c7c1eb", "reconcile region");
  assert.equal(sha16(cut("let activeSession = null;", "function readCredential()") + cut("function endSignerSession() {", "// --- 씬 정리 (A-292 번호 9)")), "1c2a32a1eb2a752f", "session/timer region");
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
