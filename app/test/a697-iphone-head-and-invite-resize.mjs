// [A-697] A-670 local iPhone polish — node-only, deterministic (no browser/network/tx).
//   node app/test/a697-iphone-head-and-invite-resize.mjs
// 1) index.html head: viewport-fit=cover added WITHOUT zoom limits; apple-mobile-web-app-capable present.
// 2) main.js: the Invite "resize" listener is debounced via debouncedHomeResizeListener (real width/orientation
//    change = synchronous; toolbar-sized height delta = trailing 160ms), and a wide<->mobile switch still render()s.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { responsiveFrame } from "../src/responsive-layout.js";
import { layoutOracle } from "./helpers/a831-sweep.mjs";
const CSS = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); } else { fail += 1; console.log(`FAIL  ${name}${extra ? ` (${extra})` : ""}`); }
}
function cutFn(name) {
  const start = MAIN.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  return MAIN.slice(start, MAIN.indexOf("\n}\n", start) + 2);
}

// ---- head
const vp = (HTML.match(/<meta\s+name="viewport"\s+content="([^"]*)"/) || [])[1] || "";
const toks = vp.split(",").map((t) => t.trim());
check("viewport has width=device-width", toks.includes("width=device-width"));
check("viewport has initial-scale=1.0", toks.includes("initial-scale=1.0"));
check("viewport has viewport-fit=cover", toks.includes("viewport-fit=cover"), vp);
check("viewport has NO zoom limits", !/maximum-scale|minimum-scale|user-scalable/.test(vp), vp);
check("apple-mobile-web-app-capable meta present", /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/?>/.test(HTML));
check("exactly one viewport meta", (HTML.match(/name="viewport"/g) || []).length === 1);

// ---- wiring
check("Invite resize listener is the debounced wrapper", /window\.addEventListener\("resize",\s*debouncedHomeResizeListener\(fitInvite\)\)/.test(MAIN));
check("no raw resize->fitInvite listener remains", !/addEventListener\("resize",\s*fitInvite\)/.test(MAIN));


// ---- 2px/30px Invite fix is media-scoped below the 1280 artboard (A-724 widened it from <=640 to <=1279; 1440 stays frozen)
const colsRules = [...CSS.matchAll(/([^{}]*)\{([^{}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)[^{}]*)\}/g)].filter((m) => /\.stage--invite\s*$/.test(m[1].trim()));
check("exactly one .stage--invite minmax(0,1fr) rule", colsRules.length === 1, String(colsRules.length));
const idx = colsRules[0] ? colsRules[0].index : -1;
const before = CSS.slice(0, idx);
const mediaOpen = before.lastIndexOf("@media");
const mediaHead = mediaOpen >= 0 ? before.slice(mediaOpen, before.indexOf("{", mediaOpen)) : "";
const between = mediaOpen >= 0 ? before.slice(before.indexOf("{", mediaOpen) + 1) : "";
// [A-724] named reason: the pin was widened from <=640 to <=1279 to fix the A-722 B1 wide-Invite (900..1279)
// off-centre/right-clip — same grid-track cause. Not weakened: it still must be a media-scoped pin that never
// reaches the >=1280 canonical artboard (1440 frozen), and the base rule below must still carry no columns.
check("that rule sits inside @media (max-width: 1279px) (A-724: covers mobile + wide-Invite tablet band, not >=1280)", /@media\s*\(max-width:\s*1279px\)\s*$/.test(mediaHead.trim()), mediaHead);
check("media block is still open at the rule (no closing brace between)", !/}/.test(between.replace(/\/\*[\s\S]*?\*\//g, "")), "closed early");
const baseRule = CSS.match(/\n\.stage--invite\s*\{[^}]*\}/);
check("base .stage--invite rule has no grid-template-columns (>=1280 untouched)", !!baseRule && !/grid-template-columns/.test(baseRule[0]));

// ---- behavior (real functions in a vm with fake timers)
const timers = [];
const win = { innerWidth: 390, innerHeight: 844 };
let renders = 0, transform = "";
const ctx = vm.createContext({
  responsiveFrame, homeKeyframeLayout: layoutOracle(MAIN), hkClamp: (v,a,b) => Math.min(b,Math.max(a,v)),
  window: win, INVITE_WIDE_MIN: 900, inviteKind: "mobile",
  // [A-839] fitInvite also reads the A-831 layout (syncDesktopFormatVars) and writes the --invS/--invVw/--invVh vars; pre-A-839 baseline: style had only the `transform` setter.
  syncDesktopFormatVars: () => ({ L: { cardW: 376.5, M: 120, asTop: 48, asFont: 24 } }),
  document: { querySelector: () => ({ dataset: { kind: ctx_kind() }, style: { set transform(v) { transform = v; }, setProperty() {} } }) },
  render() { renders += 1; },
  onSceneTeardown() {},
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearTimeout: (id) => { if (id && timers[id - 1]) timers[id - 1].dead = true; },
  Number, Math,
});
function ctx_kind() { return win.innerWidth >= 900 ? "wide" : "mobile"; }
vm.runInContext(
  `/* [A-920 RE-PIN] the vm also needs hkKey + the three A-920 keyframe consts (inviteGroupScale reads them). pre-A-920 baseline: no such lines */const HOME_TOOLBAR_RESIZE_DELTA_PX = 150;\n${MAIN.match(/const INVITE_WIDE_ART_SCALE = [^;]+;/)[0]}\n${MAIN.match(/const INVITE_PHONE_ART_SCALE = [^;]+;/)[0]}\n${MAIN.match(/const INVITE_CONTENT_W = [^;]+;/)[0]}\n${MAIN.match(/const INVITE_CONTENT_H = [^;]+;/)[0]}\n${MAIN.match(/const INVITE_GROUP_K = [^;]+;/)[0]}\n${MAIN.match(/const INVITE_OFFSET_X = [^;]+;/)[0]}\n${MAIN.match(/const INVITE_OFFSET_Y = [^;]+;/)[0]}\n${cutFn("hkKey")}\n${cutFn("inviteGroupScale")}\n${cutFn("inviteHolePhase")}\n${cutFn("isToolbarOnlyResizeDelta")}\n${cutFn("debouncedHomeResizeListener")}\n${cutFn("wantedInviteKind")}\n${cutFn("fitInvite")}\nglobalThis.onResize = debouncedHomeResizeListener(fitInvite);`,
  ctx,
);
const live = () => timers.filter((t) => !t.dead);

win.innerHeight = 750; ctx.onResize();            // toolbar-sized: coalesced
check("toolbar-sized height delta does not fit synchronously", transform === "" && live().length === 1 && live()[0].ms === 160);
ctx.onResize(); ctx.onResize();
check("burst collapses to ONE pending trailing call", live().length === 1);
{ const t = live()[0]; t.dead = true; t.fn(); }
check("trailing call recomputes scale", /scale\(/.test(transform), transform);
transform = "";
win.innerWidth = 1280; win.innerHeight = 800; ctx.onResize();   // real width change crossing INVITE_WIDE_MIN
check("real width change recomputes synchronously", renders === 1, `renders=${renders}`);   // kind mobile->wide => render()
check("real change leaves no pending timer", live().length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
