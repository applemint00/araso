// First Home pacing (canon FIRST_JOURNEY_PACING_20261015): sit → 2 s → "work's coming!" → card at max(arrival + 20 s, grant + 25 s)
// → 1 s → the two job lines → +1 s → Send can be pressed.
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

assert.match(MAIN, /const PACE_SEAT_BREATH_MS = 2000;/);
assert.match(MAIN, /const PACE_HOME_TO_CARD_MIN_MS = 10000;/);
assert.match(MAIN, /const PACE_GRANT_SETTLE_MS = 25000;/);
assert.match(MAIN, /const PACE_SEND_ARM_MS = 1000;/);
assert.match(MAIN, /const PACE_BREATH_MS = 1000;/);
assert.match(MAIN, /const HOME_FIRST_JOURNEY_CARD_MS = 1200;/);
assert.match(MAIN, /const POST_FILE_QUIET_HOME_MS = 8000;/);
// [A-1281] no dash in Chog speech: the job is two lines said one at a time; pre-A-1281: "… to work — your money does the job."
assert.match(cue, /const FIRST_SEND_CUE_LINE = "work's coming! let's send Piggy to work\\nyour money does the job\.";/);
assert.doesNotMatch(cue, /!state\.sendCardVisible/);
assert.match(settle, /const announceFirstSend = \(\) => \{[\s\S]*sayFirstSendCue\("coming"\);\s*sceneTimeout\(revealSendCard, chogSpeakMs\(FIRST_SEND_CUE_PARTS\[0\]\) \+ PACE_BREATH_MS\);[\s\S]*sceneTimeout\(announceFirstSend, PACE_SEAT_BREATH_MS\);/);
assert.match(settle, /const minAt = arrivedAt \+ PACE_HOME_TO_CARD_MIN_MS;\s*const readyAt = firstGrantReadyAt === null \? \(Date\.now\(\) >= minAt \? minAt : Infinity\) : Math\.max\(minAt, firstGrantReadyAt\);/);
assert.match(settle, /state\.sendCardVisible = true;\s*render\(\);\s*sceneTimeout\(\(\) => \{\s*sayFirstSendCue\("job"\);\s*sceneTimeout\(armSend, [^;]*PACE_SEND_ARM_MS\);\s*\}, PACE_BREATH_MS\);/);
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
const sequenceContract = /sayFirstSendCue\("coming"\);\s*sceneTimeout\(revealSendCard, chogSpeakMs\(FIRST_SEND_CUE_PARTS\[0\]\) \+ PACE_BREATH_MS\);/;
assert.equal(sequenceContract.test(settle.replace('sayFirstSendCue("coming");', "")), false, "dropping the cue fails the sequence pin");
assert.equal(/const PACE_HOME_TO_CARD_MIN_MS = 10000;/.test(MAIN.replace("const PACE_HOME_TO_CARD_MIN_MS = 10000;", "const PACE_HOME_TO_CARD_MIN_MS = 7000;")), false, "reverting the Home → card time fails its pin");

console.log("A1261 PASS");
