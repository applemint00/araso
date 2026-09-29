// [A-618 → SUPERSEDED BY A-621, 2026-09-28] This file used to lock the A-618 mobile HOME+HISTORY
// side-by-side two-paper group-fit (computeMobileSafeFrame/computeTwoPaperGroupFit/rectsOverlap/
// fitMobileTwoPaperGroup/restoreMobileTwoPaperGroup, the runtime `.homeTwoPaperFrame` proxy, the
// mobile `.recordsCard` 285×364 box + `--recordsShrink` group-fit shrink). A-620 measured that
// composition unusable at phone scale (text 4.5–7.8px, close ~15×8px); the Owner selected the
// stacked Candidate B, implemented by A-621 (main.js stackMobileRecordsOverHome()). A-618 stays
// FAILURE HISTORY (receipts A618_mobile_two_paper_restore/, A620_mobile_home_responsive/), not
// current canon. The old formula/wiring assertions were removed with the code; this file now only
// guards that the superseded mechanism does not come back. Current contract:
// app/test/a621-mobile-records-stack.mjs.
//   node app/test/a618-mobile-two-paper-fit.mjs
import { readFileSync } from "node:fs";

// line comments stripped: the supersession history is still (correctly) mentioned in comments.
const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}

for (const name of ["computeMobileSafeFrame", "computeTwoPaperGroupFit", "rectsOverlap", "fitMobileTwoPaperGroup", "restoreMobileTwoPaperGroup"]) {
  check(`[superseded] main.js no longer defines or calls ${name}()`, new RegExp(`\\b${name}\\(`).test(SRC), false);
}
check("[superseded] no TWO_PAPER_UNIT_W/H or HOME_PAPER_NATIVE_W/H constants remain",
  /const (TWO_PAPER_UNIT_[WH]|HOME_PAPER_NATIVE_[WH]) =/.test(SRC), false);
check("[superseded] main.js never creates the `.homeTwoPaperFrame` proxy (HOME #homePaper is never re-parented/re-scaled)",
  /className = "homeTwoPaperFrame"/.test(SRC), false);
check("[superseded] main.js never sets --recordsShrink (HISTORY is not group-fit shrunk)",
  /setProperty\("--recordsShrink"/.test(SRC), false);
check("[superseded] style.css no longer gives mobile .recordsCard a fixed 285×364 box",
  /@media \(max-width: 640px\) \{\s*\n\s*\.recordsCard \{\s*\n\s*inset:\s*auto;/.test(CSS), false);
check("[kept from A-618] the ≤640px peek override that flipped the rear paper to display:block stays gone (no third paper)",
  /@media \(max-width: 640px\) \{\s*\n\s*\.recordsCardAnchor__peek \{\s*\n\s*display:\s*block;/.test(CSS), false);

console.log(`${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
