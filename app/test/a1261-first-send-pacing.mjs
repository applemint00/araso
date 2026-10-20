// First Home pacing [A-1433 A1–A3 · newest-wins over FIRST_JOURNEY_PACING_20261015]: sit → 2 s → Chog's three lines one at a time → card at the
// later of sit + 20 s · the lines said + 1 s · the grant → Send can be pressed 2 s after the card. pre-A-1433: card at sit + 10 s, then the two job lines,
// then Send 1 s after the last job line.
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
assert.match(MAIN, /const PACE_HOME_TO_CARD_MIN_MS = 20000;/); // [A-1433 A2] pre: 10000
assert.match(MAIN, /const PACE_GRANT_SETTLE_MS = 25000;/);
assert.match(MAIN, /const PACE_SEND_ARM_MS = 2000;/); // [A-1433 A3] card → Send · pre: 1000 after the last job line
assert.match(MAIN, /const PACE_BREATH_MS = 1000;/);
assert.match(MAIN, /const HOME_FIRST_JOURNEY_CARD_MS = 1200;/);
assert.match(MAIN, /const POST_FILE_QUIET_HOME_MS = 8000;/);
// [A-1281] no dash in Chog speech: the job is two lines said one at a time; pre-A-1281: "… to work — your money does the job."
assert.match(cue, /const FIRST_SEND_CUE_LINE = "work's coming!\\nlet's send Piggy to work~\\nyour money does the job ♪";/); // [A-1433 A1] pre: "work's coming! let's send Piggy to work\\nyour money does the job."
assert.doesNotMatch(cue, /!state\.sendCardVisible/);
assert.match(settle, /const announceFirstSend = \(\) => \{[\s\S]*sayFirstSendCue\(\);\s*revealSendCard\(\);[\s\S]*sceneTimeout\(announceFirstSend, PACE_SEAT_BREATH_MS\);/); // [A-1433 A1] the three lines, then the card's own wait
assert.match(settle, /const minAt = Math\.max\(arrivedAt \+ PACE_HOME_TO_CARD_MIN_MS, cueEndAt \? cueEndAt \+ PACE_BREATH_MS : 0\);[^\n]*\n\s*const readyAt = firstGrantReadyAt === null \? \(Date\.now\(\) >= minAt \? minAt : Infinity\) : Math\.max\(minAt, firstGrantReadyAt\);/);
assert.match(settle, /state\.sendCardVisible = true;\s*render\(\);\s*sayFirstSendCue\(\);[^\n]*\n\s*sceneTimeout\(armSend, PACE_SEND_ARM_MS\);/); // [A-1433 A3] lines kept over the card · Send at card + 2 s
// [A-1441] the first Send tap hides CG-01 (not now shows it again, allow clears it) · pre-A-1441: the tap removed it
assert.match(cue, /document\.querySelector\("#sendButton"\)\?\.addEventListener\("click",[\s\S]*if \(cue\) cue\.hidden = true;[\s\S]*\{ once: true \}/);

let click = null;
let removed = false;
const cueEl = { hidden: false, remove: () => { removed = true; } };
const state = { appLock: null, scene: "sendstay", sendCardVisible: false };
// [A-1326] the cue reads the day's wording through chogMoodLines (identity here: this pins the Send listener timing)
const [say, showAgain, clear] = new Function("state", "sendBusy", "insertChogCueLine", "document", "chogMoodLines", `${cue}\nreturn [sayFirstSendCue, showFirstSendCueAgain, clearFirstSendCue];`)(
  state,
  () => false,
  () => true,
  { querySelector: (selector) => selector === "#sendButton"
    ? { addEventListener: (_type, handler) => { click = handler; } }
    : cueEl },
  (l) => [...l],
);
assert.equal(say(), true);
assert.equal(click, null, "pre-card cue has no Send listener yet");
state.sendCardVisible = true;
assert.equal(say(), true);
assert.equal(typeof click, "function");
click();
assert.equal(cueEl.hidden, true, "first Send tap hides CG-01 while the sheet is up"); // [A-1441] pre-A-1441: removed
assert.equal(removed, false, "…and keeps it for not now");
click = null;
showAgain();
assert.equal(cueEl.hidden, false, "not now shows the same lines again");
assert.equal(typeof click, "function", "…and the next Send tap hides them again");
clear();
assert.equal(removed, true, "allow clears CG-01");
// [A-1441] in the first Send: not now → shown again; allow → cleared (before grant / sign)
assert.match(MAIN, /if \(typeof showFirstSendCueAgain === "function"\) showFirstSendCueAgain\(\);[^\n]*\n\s*return;\n\s*\}\n\s*if \(typeof clearFirstSendCue === "function"\) clearFirstSendCue\(\);/);
// [A-1265] the Send card is never gated on the cue line being inserted
assert.doesNotMatch(settle, /if \(!sayFirstSendCue\(\)\) return;/);
// [A-1326 RE-PIN · FIRST_JOURNEY_PACING_20261015.md:31–41] the beat reads the day's wording · pre-A-1326: chogSpeakMs(FIRST_SEND_CUE_PARTS[0])
const sequenceContract = /sayFirstSendCue\(\);\s*revealSendCard\(\);/; // [A-1433] pre: sayFirstSendCue("coming") → revealSendCard after the first line
assert.equal(sequenceContract.test(settle.replace("sayFirstSendCue();\n        revealSendCard();", "revealSendCard();")), false, "dropping the cue fails the sequence pin");
assert.equal(/const PACE_HOME_TO_CARD_MIN_MS = 20000;/.test(MAIN.replace("const PACE_HOME_TO_CARD_MIN_MS = 20000;", "const PACE_HOME_TO_CARD_MIN_MS = 10000;")), false, "reverting the Home → card time fails its pin");

console.log("A1261 PASS");
