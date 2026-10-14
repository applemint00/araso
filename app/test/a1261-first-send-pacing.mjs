// [A-1261] First Home pacing: 4500 ms quiet → CG-01 → 2500 ms → existing Send card.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const cut = (start, end) => {
  const a = MAIN.indexOf(start);
  const b = MAIN.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing source block: ${start}`);
  return MAIN.slice(a, b);
};

const settle = cut("  const settle = ({ keepPose = false } = {}) => {", "\n  const startRect = state.homeStartRect;");
const cue = cut("const FIRST_SEND_CUE_LINE", "\n// CG-02");

assert.match(MAIN, /const FIRST_SEND_QUIET_MS = 4500;/);
assert.match(MAIN, /const FIRST_SEND_CUE_LEAD_MS = 2500;/);
assert.match(MAIN, /const HOME_FIRST_JOURNEY_CARD_MS = 1200;/);
assert.match(MAIN, /const POST_FILE_QUIET_HOME_MS = 8000;/);
assert.match(cue, /const FIRST_SEND_CUE_LINE = "work's coming! let's send Piggy to work — your money does the job\.";/);
assert.doesNotMatch(cue, /!state\.sendCardVisible/);
assert.match(settle, /const announceFirstSend = \(\) => \{[\s\S]*sayFirstSendCue\(\); \/\/ \[A-1265\][^\n]*[\s\S]*sceneTimeout\(revealSendCard, FIRST_SEND_CUE_LEAD_MS\);[\s\S]*sceneTimeout\(announceFirstSend, FIRST_SEND_QUIET_MS\);/);
assert.match(settle, /state\.sendCardVisible = true;\s*render\(\);\s*sayFirstSendCue\(\);/);
assert.match(cue, /document\.querySelector\("#sendButton"\)\?\.addEventListener\("click",[\s\S]*document\.querySelector\("#firstSendChogCue"\)\?\.remove\(\);[\s\S]*\{ once: true \}/);

let click = null;
let removed = false;
const state = { appLock: null, scene: "sendstay", sendCardVisible: false };
const say = new Function("state", "sendBusy", "insertChogCueLine", "document", `${cue}\nreturn sayFirstSendCue;`)(
  state,
  () => false,
  () => true,
  { querySelector: (selector) => selector === "#sendButton"
    ? { addEventListener: (_type, handler) => { click = handler; } }
    : { remove: () => { removed = true; } } },
);
assert.equal(say(), true);
assert.equal(click, null, "pre-card cue has no Send listener yet");
state.sendCardVisible = true;
assert.equal(say(), true);
assert.equal(typeof click, "function");
click();
assert.equal(removed, true, "first Send tap removes CG-01");
// [A-1265] the Send card is never gated on the cue line being inserted
assert.doesNotMatch(settle, /if \(!sayFirstSendCue\(\)\) return;/);
const sequenceContract = /sayFirstSendCue\(\); \/\/ \[A-1265\][^\n]*[\s\S]*sceneTimeout\(revealSendCard, FIRST_SEND_CUE_LEAD_MS\);/;
assert.equal(sequenceContract.test(settle.replace(/sayFirstSendCue\(\); \/\/ \[A-1265\][^\n]*/, "")), false, "dropping the cue fails the sequence pin");
assert.equal(/const FIRST_SEND_QUIET_MS = 4500;/.test(MAIN.replace("const FIRST_SEND_QUIET_MS = 4500;", "const FIRST_SEND_QUIET_MS = 1200;")), false, "reverting the quiet beat fails its pin");

console.log("A1261 17/17 PASS");
