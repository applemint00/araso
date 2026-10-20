// A-1131 render pin: defer Invite auth presentation before teardown; auth/money bodies unchanged.
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
import { restorePreA1051 } from "./helpers/a1051-restore.mjs"; // [A-1051 RE-PIN] protected-body pins compare pre-A-1051 text

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
function fnBody(name, src = MAIN) { // [A-1051] src param (default = MAIN, unchanged for every other check)
  const m = src.match(new RegExp(`(?:async )?function ${name}\\(`));
  if (!m) throw new Error(`함수 없음: ${name}`);
  const start = m.index;
  let depth = 0;
  for (let i = src.indexOf("{", src.indexOf(")", start)); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
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
  // [A-667 re-pin] the failed card's single retry is #unlockRetryButton → unlockApp (was #checkButton → unlockApp;
  // Owner: reentry failure shows only "Try again", wired directly to the same identity-unlock path).
  assert.ok(body.includes('document.querySelector("#unlockRetryButton")?.addEventListener("click", unlockApp);'));
  assert.equal(body.includes("#checkButton"), false, "no Check Piggy on the reentry failure card");
  assert.equal((body.match(/mountInviteChog\(\)/g) || []).length, 1, "one existing Chog mount (blink = BLINK_KEYS)");
});

check("V2 loginCheckingMarkup: the tap target is the big Chog face button built from existing parts; existing copy only", () => {
  const body = fnBody("loginCheckingMarkup");
  assert.ok(body.includes('<button class="loginCheck__face" id="loginChogButton" type="button" aria-label="Passkey">${chogInviteMarkup()}</button>'));
  assert.ok(body.includes("${arasoBrandMarkup()}"), "Araso = the existing brand markup (once)");
  assert.equal((body.match(/arasoBrandMarkup\(\)/g) || []).length, 1);
  assert.ok(body.includes('data-scene="birth" data-app-lock="${phase}"'), "same scene/lock markers the harness and body background use");
  // visible text = exactly the A-633 strings (no new copy)
  const tpl = body.slice(body.indexOf("return `") + 8, body.lastIndexOf("`;"));
  const text = tpl.replace(/\$\{isDevDebugOptIn\(\)[^}]*\}/, " ").replace(/\$\{[^}]*\}/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(text, "Checking… Passkey may appear once.");
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
  // [A-666 re-pin, named reason] a THIRD `.stage--loginCheck .loginCheck__body {` occurrence
  // now exists (the A-666 global mobile type-scale ≤640px override, font-size only) — find the
  // SECOND occurrence specifically (the base geometry/font rule this check is about), not
  // whichever happens to be last.
  const firstBodyAt = CSS.indexOf(".stage--loginCheck .loginCheck__body {");
  const secondBodyAt = CSS.indexOf(".stage--loginCheck .loginCheck__body {", firstBodyAt + 1);
  assert.ok(secondBodyAt > firstBodyAt, "the base geometry rule (2nd occurrence) must exist");
  const sub = cssRule(".stage--loginCheck .loginCheck__body", secondBodyAt);
  assert.equal(decl(sub, "top"), "420px");
  assert.equal(decl(sub, "font-size"), "12px", "base/source value stays 12px — unchanged by A-666 (which only adds a ≤640px cascading override, below)");
  // passkey-sheet-safe: everything sits above 844 - 380 = 464 at 390
  assert.ok(420 + 12 * 1.5 <= 464 && 132.5 + 243.2 <= 464);
  // [A-666] the mobile type-scale override itself (≈1.15×, TYPOGRAPHY_SCALE.md) — additive,
  // ≤640px only, does not touch the base rule above.
  assert.match(CSS, /@media \(max-width: 640px\) \{[^]*?\.stage--loginCheck \.loginCheck__body \{ font-size: 14px; \}/);
});

// ─── Away restore line ─────────────────────────────────────────────────────────────────────────
const HOME_SCALE = Function(`return ${CHOG_HOME.match(/export const HOME_SCALE = ([^;]+);/)[1]}`)();
const HOME_BOARD_W = Number(MAIN.match(/const HOME_BOARD_W = (\d+);/)[1]);

check("V5 #awayRestoreLine is enlarged only inside @media (max-width: 640px) and renders ≈20.6px at 390 (A-666 re-pin, named reason: Owner's global mobile type-scale decision raised this ≈1.15× from the pre-card ≈18px target, same ratio TYPOGRAPHY_SCALE.md applies everywhere else)", () => {
  const at = CSS.indexOf("#awayRestoreLine {");
  assert.ok(at > 0, "rule present");
  // [A-845 RE-PIN] the only other #awayRestoreLine rule is the A-845 stage-scaled text style (A-843 item 6), which supersedes this one's size.
  // pre-A-845 baseline: assert.equal(CSS.indexOf("#awayRestoreLine", at + 1), -1, "exactly one rule");
  const a845At = CSS.indexOf("html #awayRestoreLine { font-size: var(--tsChog); }");
  assert.ok(a845At > at, "A-845 rule after this one");
  assert.equal(CSS.indexOf("#awayRestoreLine", at + 1), a845At + 5, "exactly one rule besides the A-845 text style");
  assert.equal(CSS.indexOf("#awayRestoreLine", a845At + 6), -1, "no third rule");
  const mq = CSS.lastIndexOf("@media", at);
  assert.equal(CSS.slice(mq, CSS.indexOf("{", mq)).trim(), "@media (max-width: 640px)");
  assert.equal(CSS.slice(mq, at).split("}").length - 1, 0, "the rule is the media block's own child");
  const rule = CSS.slice(at, CSS.indexOf("}", at) + 1);
  const local = parseFloat(decl(rule, "font-size"));
  const s390 = (390 / HOME_BOARD_W) * HOME_SCALE;
  const s430 = (430 / HOME_BOARD_W) * HOME_SCALE;
  assert.ok(Math.abs(local * s390 - 20.6) < 0.3, `390 rendered ${local * s390}`);
  assert.ok(local * s430 > 20.6 && local * s430 < 24, `430 rendered ${local * s430}`);
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
  // [A-779 RE-PIN] A-777 §8.2 LOCKED: the "… is coming home" line (#returnArrivalAlarm) gets a size-only legibility bump
  // (font-size, top moved up by the gained line-height so its bottom edge stays, max-width:none for centring). The shared
  // base above stays pinned; the Explore say keeps the base rule only.
  assert.equal(/#exploreChogSay/.test(cssNoComments), false, "explore say keeps the shared base rule only");
  const alarmRules = [...cssNoComments.matchAll(/#returnArrivalAlarm\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
  // [A-845 RE-PIN] + the A-845 stage-scaled Choice style (A-843 item 6; bottom edge kept at 264.8 local). pre-A-845 baseline:
  // ["font-size: 33px; top: 225.2px; max-width: none;", "font-size: 49px; top: 210.8px;"]
  assert.deepEqual(alarmRules.map((r) => r.replace(/\s+/g, " ")), ["font-size: var(--tsChog); top: calc(264.8px - 1.2 * var(--tsChog)); max-width: none;", "font-size: 33px; top: 225.2px; max-width: none;", "font-size: 49px; top: 210.8px;"], "return alarm = A-779 size-only rules + A-845 text style");
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
    // [A-667 re-pin] unlockApp (attempt token + bounded UI wait timer + checking render, all AFTER requestPrf),
    // settleUnlock (stale/timed-out attempt ignored), renderAuthCard (one contextual action per failure card).
    // Previous pins: unlockApp 09cd6fb5dd4ee0dc · settleUnlock c4c353674bc122b3 · renderAuthCard 54e902ad818b1b0a.
    // renderAuthCard re-pinned again (203645318a1fb561 → 6f1694a9613c1890) for the Owner's 2026-10-02 decision:
    // markerless fresh-device failure card = one "Make new" (on the existing #authTryAgainButton → Invite wiring).
    requestPrf: "766fc57ed63b6009", unlockApp: "6ecb373c36ec657f", /* [A-687] re-pinned: capability preflight in unlockApp (d4167d7c8fbf1f82 -> 6ecb373c36ec657f); body-minus-guard == old hash pinned in a687 test */ settleUnlock: "b43e5a32b4bf055d", appLockSurface: "8c31689ea48cf8aa",
    // [A-669 re-pin] lockAppAfterIdle first calls invalidateLiveAuthAttempt() (idle/session end kills a live Check/Open
    // attempt so a late result cannot re-arm the session or navigate over the lock). Previous pin 0083d873b56358ef.
    lockAppAfterIdle: "e4ef41131c978a25", touchAppSession: "cd44c821c6781492", endActiveSession: "9cfc316632c9cea8",
    // [A-699 M2-alpha re-pin] commitSendSuccess (no longer clears pending; non-throwing) 51398edde399ae67 -> 9d3ac854b6df8ff3 ·
    // finishTrip (verified receipt save -> compare-and-clear -> UI) b0ea22dfec3aa006 -> 60edd8708e77d531 ·
    // readSendPending (unreadable store = unconfirmed, not "none") ba4e61d4232e4f7f -> 065bbae2d4bb516e.
    // [A-667 R3 re-pin] activateSigningSession: a throw after the signer exists now ends it (no timer-less signer).
    // Previous pin 0a3345ebee6d4bd3.
    // [A-896 re-pin, named reason: 99e M-L-2 60 s signer margin] activateSigningSession gains one signerSince stamp line. pre-A-896 baseline: activateSigningSession dbd2063392a1068b (A-896 R1: + monotonic stamp line, 1fe6d723428bad6d -> 0bd365c9a1183cb4).
    activateSigningSession: "0bd365c9a1183cb4", reconcileSendPending: "1caf49b6a16b09df", classifySendPending: "2389cf76d2658fd6",
    readSendTxReceipt: "482a1cdc9025ff9f", reconciledSendReceipt: "1de55c29816852f7", commitSendSuccess: "9d3ac854b6df8ff3",
    finishTrip: "60edd8708e77d531", readSendPending: "065bbae2d4bb516e", showAwayRestore: "70ee359576d43fd1",
    // [A-893b re-pin · Owner via Cowork 2026-10-08 "체킹 다음에 나오는걸로", Cowork standing permission INBOX :74201] Away-slot pending wording only.
    // pre-A-893b baseline: awayRestoreLineMarkup 027535c3b9c99afb ("still out.").
    awayRestoreLineMarkup: "960d811270c73c0d", renderAuthCard: "6f1694a9613c1890", mountInviteChog: "f894db5c8e334665",
    arasoBrandMarkup: "2916af023287cf7f", render: "521db6368b3a331d",
  };
  const PRE1051 = restorePreA1051(MAIN); // [A-1051 RE-PIN] pre-A-1051: fnBody(n) on MAIN
  const got = Object.fromEntries(Object.keys(want).map((n) => [n, sha16(fnBody(n, PRE1051))]));
  assert.deepEqual(got, want);
  // Boot lock block re-pinned once for the chain-profile seal: the only change is
  // `const bootPending = state.scene === "sendstay" && LEGACY_TESTNET_PATH ? readSendPending() : null;`
  // (was `state.scene === "sendstay" ? ...`). On the default testnet profile LEGACY_TESTNET_PATH is
  // true, so the block behaves exactly as before; off testnet the testnet pending record is not
  // reconciled as this chain's. Previous pin: 83b318186c3ee7bc. The lock condition line is unchanged
  // (a633 A5 still asserts it).
  assert.equal(sha16(cut("// [A-633 A/C] 모바일/app 표면에서 저장된 credential", "// [A-559 PHASE S1] Gift 링크 fragment")), "23694803737b62f4", "boot lock block");
  // [A-893b re-pin · Owner via Cowork 2026-10-08 "체킹 다음에 나오는걸로", Cowork standing permission INBOX :74201] the region holds awayRestoreLineMarkup
  // (Away-slot pending wording) and its header comment. pre-A-893b baseline: reconcile region 20b3279a70c7c1eb.
  assert.equal(sha16(cut("// [A-633 C] First Send 미확정 기록", "async function requestGrant(")), "123e24419f897220", "reconcile region");
  assert.equal(sha16(cut("let activeSession = null;", "function readCredential()") + cut("function endSignerSession() {", "// --- 씬 정리 (A-292 번호 9)")), "c5ac40bfd65a9713", "session/timer region"); // pre-A-896 baseline: 2e91809fb4741939 (A-896 signerSince/signerMono lines in the session/timer region; standing permission INBOX :74201) // [A-667 R3 re-pin] region contains activateSigningSession (signer ended on throw). Previous 1c2a32a1eb2a752f. [A-669 re-pin] region contains lockAppAfterIdle (+ invalidateLiveAuthAttempt() call). Previous ff01455c69dbbb09.
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
