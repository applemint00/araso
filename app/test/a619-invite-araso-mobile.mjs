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

const inviteRuleMatch = mediaBlock.match(/\.stage--invite \.arasoBrand \{([^}]*)\}/);
check("a .stage--invite .arasoBrand override rule exists inside the SAME ≤640px block (not a new @media)",
  !!inviteRuleMatch, true);

const inviteRuleBody = inviteRuleMatch ? inviteRuleMatch[1] : "";
check("Invite-only override sets left:60px (A-619)",
  /left:\s*60px;/.test(inviteRuleBody), true);
check("Invite-only override sets top:62px (A-625 — glyph moved into the notebook paper, x unchanged)",
  /top:\s*62px;/.test(inviteRuleBody), true);

// exactly TWO declarations in the override body (left + top) — nothing else changed
// (transform/font/etc. all keep inheriting from the common mobile rule above via the cascade).
const declCount = inviteRuleBody.split(";").map((s) => s.trim()).filter(Boolean).length;
check("Invite-only override changes exactly two properties (left, top) — no transform/font/etc. added",
  declCount, 2);

// ── 3. selector specificity: .stage--invite .arasoBrand (0,0,2,0) beats .arasoBrand (0,0,1,0) ──
// regardless of source order, so this also guards against someone "simplifying" it back to a
// single class selector that would lose to source order rather than specificity.
check("override selector is compound (two classes) so it wins on specificity, not source order",
  /^\s*\.stage--invite \.arasoBrand \{/m.test(mediaBlock), true);

// ── 4. it lives inside stage--invite's own block-comment scope, not a sibling/global block ──
const inviteRuleIndexInMedia = mediaBlock.indexOf(".stage--invite .arasoBrand {");
const commonRuleIndexInMedia = mediaBlock.indexOf(".arasoBrand {");
check("the Invite override is declared AFTER the common mobile rule inside the same block (order is irrelevant to outcome, but this locks the actual authored layout)",
  inviteRuleIndexInMedia > commonRuleIndexInMedia, true);

// ── 5. [A-625] the override's top must NOT equal the common rule's top token — it is a
// deliberate departure (dark band -> inside paper), not an accidental inherit/typo.
check("Invite-only override's top is a fixed px value, not the shared --mobile-top-safe token (deliberately different from the common rule)",
  !/top:\s*var\(--mobile-top-safe\)/.test(inviteRuleBody), true);

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
