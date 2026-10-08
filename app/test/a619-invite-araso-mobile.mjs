// [A-619 + A-625] Contract test for the Invite-only mobile Araso position override —
// source-contract pattern (network 0, browser 0), same style as
// app/test/home-character-scale-floor.mjs.
// Card A-619 (INVITE ARASO POSITION CLOSE) + A-625 (INVITE MOBILE ARASO Y CLOSE),
// Owner-confirmed split:
//   - web (>640px) Araso stays at the A-616 exception anchor (left:140px, top:32px) — untouched.
//   - mobile common rule (`.arasoBrand` under @media max-width:640px, left: var(--mobile-inset),
//     top: var(--mobile-top-safe)) stays untouched for Auth/Hatch/Name/Home.
//   - ONLY Invite mobile gets a higher-specificity override (`.stage--invite .arasoBrand`)
//     inside the SAME ≤640px block: A-619 set `left: 60px` (right of hole rail, left of tape);
//     A-625 added `top: 62px` on the SAME rule (moves the glyph from the dark band above the
//     notebook paper into the paper itself, x unchanged). No other property changes.
//   node app/test/a619-invite-araso-mobile.mjs
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { console.log(`PASS  ${label}`); pass += 1; }
  else { console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); fail += 1; }
}

// ── 1. base web rule (outside any @media) unchanged — A-616 exception anchor ───────────────
const baseRule = (() => {
  const start = CSS.indexOf(".arasoBrand {");
  const end = CSS.indexOf("}", start);
  if (start < 0) throw new Error("style.css 에서 base .arasoBrand 못 찾음");
  return CSS.slice(start, end);
})();
check("base (web, >640px) .arasoBrand rule still left:140px (A-616 anchor, not touched by A-619)",
  /left:\s*140px;/.test(baseRule), true);
check("base (web) .arasoBrand rule still top: var(--grid-5) (unchanged)",
  /top:\s*var\(--grid-5\);/.test(baseRule), true);

// ── 2. the ≤640px block that carries both the common mobile rule and the new Invite-only one ──
const mediaMarker = "@media (max-width: 640px) {\n  .arasoBrand {";
const mediaStart = CSS.indexOf(mediaMarker);
if (mediaStart < 0) throw new Error("style.css 에서 narrow .arasoBrand 미디어 블록 못 찾음");
// close of the whole @media block = the line "}" right before the next top-level comment.
const mediaEnd = CSS.indexOf("\n}\n\n/* 제목", mediaStart);
if (mediaEnd < 0) throw new Error("style.css 에서 narrow .arasoBrand 미디어 블록의 끝을 못 찾음");
const mediaBlock = CSS.slice(mediaStart, mediaEnd + 2); // include the block's own closing "}"

check("the common mobile .arasoBrand rule (left: var(--mobile-inset)) is still present, unchanged, inside this block",
  /\.arasoBrand \{[^}]*left:\s*var\(--mobile-inset\);[^}]*top:\s*var\(--mobile-top-safe\);/.test(mediaBlock), true);

// pre-A-839 baseline (A-619 / A-625): inside the SAME <=640px block a compound `.stage--invite .arasoBrand` override set `left: 60px` (right of the hole rail) and `top: 62px` (inside the old
// notebook paper), exactly two declarations, declared after the common mobile rule, top not the --mobile-top-safe token. A-839 (A-835 items 6 + 8): the notebook is full-bleed and ARASO is on
// the left margin line in every scene, so the Invite exception is gone from the media block and replaced by the shared rail rule (all widths).
check("the <=640px block no longer carries an Invite-only ARASO override (the comment may name it; no live rule)",
  /\n\s*\.stage--invite \.arasoBrand \{/.test(mediaBlock.replace(/\/\*[\s\S]*?\*\//g, "")), false);
const railMatch = CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.stage--invite \.arasoBrand \{([^}]*)\}/);
check("a shared .stage--invite .arasoBrand rail rule exists outside the media block (all widths)", !!railMatch, true);
const railBody = railMatch ? railMatch[1] : "";
check("Invite ARASO: left = the side margin line (--hlM), top = 2 x font (--hlAsTop + safe-area), font = card width x .064 (--hlAsFont)",
  /left:\s*var\(--hlM, 140px\);/.test(railBody) && /top:\s*calc\(var\(--hlAsTop, 32px\) \+ var\(--hk-safe-top, 0px\)\);/.test(railBody) && /font-size:\s*var\(--hlAsFont, 12px\);/.test(railBody), true);
check("the old fixed Invite offsets left:60px / top:62px are gone", /left:\s*60px;|top:\s*62px;/.test(railBody), false);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
