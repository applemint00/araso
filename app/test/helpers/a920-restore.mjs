// [A-920] Older main.js pins (a845 N8, a897 S1 ...) compare main.js with pre-card copies. A-920 (Cowork 20:42 / 20:55) edits main.js in exactly four functions + eight const lines:
// restorePreA920(src) puts the pre-A-920 text of those back so the older pins keep their exact meaning; the A-920 scope itself is pinned by a920-main-js-scope.mjs.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "./private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
export const A920_PRE = privatePath("ops/receipts/A920_screens_back_to_mock/pre/app_src_main.js");
export const A920_FUNCS = ["nameSceneLayout", "fitNameScene", "inviteGroupScale", "returnLayout"];
export const A920_CONSTS = ["NAME_TOP_K", "NAME_PEEK_DX_K", "NAME_CHOG_DROP_K", "NAME_CHOG_DX_K", "INVITE_OFFSET_X", "INVITE_OFFSET_Y", "INVITE_GROUP_K", "RET_RCX_SHIFT"];
const span = (src, name) => { const i = src.indexOf(`function ${name}(`); if (i < 0) throw new Error(`${name} missing`); let d = 0, st = false; for (let j = src.indexOf("{", i); j < src.length; j += 1) { if (src[j] === "{") { d += 1; st = true; } else if (src[j] === "}") { d -= 1; if (st && d === 0) return [i, j + 1]; } } throw new Error(`${name} unterminated`); };
export const hasPre = () => existsSync(A920_PRE);
const A920_AWAY_MARK = /^  \/\/ \[A-920 item 9 · A-924\][^\n]*\n/m;
const A924_OUT_NEW = 'choices: v.choices.map((c) => ({ id: c.value, label: c.label, selected: c.value === v.amount })), canOk: v.canNext }; // [A-924] "custom" kept (it focuses the amount field). pre-A-924 baseline: .filter((c) => c.value !== "custom")';
const A924_OUT_OLD = 'choices: v.choices.filter((c) => c.value !== "custom").map((c) => ({ id: c.value, label: c.label, selected: c.value === v.amount })), canOk: v.canNext };';
const A920_AWAY_ARASO = /(<section class="stage" data-scene="away">\n)      \$\{arasoBrandMarkup\(\)\}\n/;
export function restorePreA920(src) {
  const pre = readFileSync(A920_PRE, "utf8");
  let out = src;
  out = out.replace(/^\/\/ ── \[A-956\] Journey 2 entry[\s\S]*?^\/\/ ── \[A-956\] end Journey 2 entry ──\n/m, ""); // [A-956] the one Journey 2 entry block: removed so the older pins keep their meaning.
  // [A-948] journey switch: the extra import line, the disposer line, the journey arg on the boot line and the 4 journeyFeatureOpen calls → the pre-A-948 text.
  out = out.replace(/^import \{ storedJourney \} from "\.\/boot-profile\.js";[^\n]*\n/m, "").replace(/^registerJourneySessionDisposer\(endActiveSession\);[^\n]*\n/m, "")
    .replace(/, journey: storedJourney\(\) \}\); \/\/ \[A-948\][^\n]*/, " });")
    .replace(/journeyFeatureOpen\("([A-Za-z]+)", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\)/g, 'releaseAllows("$1")')
    .replace(/(releaseAllows\("(?:second|afterSecond|gift)"\)[^\n]*?) \/\/ \[A-948\][^\n]*/g, "$1");
  for (const n of A920_FUNCS) { const [a, b] = span(out, n); const [pa, pb] = span(pre, n); out = out.slice(0, a) + pre.slice(pa, pb) + out.slice(b); }
  for (const k of A920_CONSTS) out = out.replace(new RegExp(`^const ${k} = [^\\n]*\\n`, "m"), "");
  // [A-924 · A-920 Part 2 item 9] the two renderAway lines (marker comment + ARASO) are A-920 too: removed here so the older pins keep their meaning.
  out = out.replace(A920_AWAY_MARK, "").replace(A920_AWAY_ARASO, "$1");
  // [A-924 · Owner 06:4x ③] the one a911MoveView line that keeps the "custom" choice (Move out typed amount): put the pre-A-924 filter back too.
  out = out.split(A924_OUT_NEW).join(A924_OUT_OLD);
  // [A-931] the two `status: receipt.status, // [A-931] …` lines in settleConfirmedFundingEvidence (Cowork 08:0x): removed so the older pins keep their meaning.
  out = out.replace(/^    status: receipt\.status, \/\/ \[A-931\][^\n]*\n/gm, "");
  // [A-943] the release-gate import line and the two [A-943] blocks (boot with the blank line before it · Second entries): removed so the older pins keep their meaning.
  out = out.replace(/^import \{ releaseAllows \} from "\.\/release-gate\.js";[^\n]*\n/m, "").replace(/\n\n\/\/ ── \[A-943\] Release gate · boot[\s\S]*?\/\/ ── \[A-943\] end boot ──\n/, "\n").replace(/^\/\/ ── \[A-943\] Release gate · Second entries[\s\S]*?\/\/ ── \[A-943\] end Second entries ──\n/m, "");
  // [A-938] the two readSecondCurrent calls get rpcUrl + fetch + clock: the pre-A-938 call text is put back so the older pins keep their meaning.
  out = out.split(', rpcUrl: CHAIN_PROFILE.rpcUrl, fetchImpl: fetch, now: () => new Date().toISOString() }); // [A-938] read-only; no rpcUrl on testnet/blocked = no_rpc (pre-A-938: profile + piggyAddress only)').join(" });").split(', rpcUrl: CHAIN_PROFILE.rpcUrl, fetchImpl: fetch, now: () => new Date().toISOString() }), agreedRules: {} }; // [A-938] same as above').join(" }), agreedRules: {} };");
  // [A-946] boot-profile import line · the CHAIN_PROFILE boot line (+2 comment lines) · the three chain-scoped Second keys · the A-897 target check: pre-A-946 text put back.
  out = out.replace(/^import \{ PROMOTION_TARGET_SCOPE, scopedSecondKey, selectBootProfile \} from "\.\/boot-profile\.js";[^\n]*\n/m, "")
    .replace(/^\/\/ \[A-946\] chosen once at boot[^\n]*\n\/\/ pre-A-946: [^\n]*\nconst CHAIN_PROFILE = selectBootProfile\([^\n]*\n/m, "const CHAIN_PROFILE = resolveChainProfile(import.meta.env.VITE_ARASO_CHAIN_PROFILE);\n")
    .replace(/= scopedSecondKey\("(araso\.[A-Za-z]+)", RUNTIME_CHAIN_SCOPE\); \/\/ \[A-946\][^\n]*/g, '= "$1";')
    .replace(/const A897_TARGET_SCOPE = PROMOTION_TARGET_SCOPE;[^\n]*\nfunction a897TargetScopeActive\(\) \{\n[^\n]*\n  return RUNTIME_CHAIN_SCOPE === A897_TARGET_SCOPE;\n\}/, 'function a897TargetScopeActive() {\n  return typeof RUNTIME_CHAIN_SCOPE === "string" && RUNTIME_CHAIN_SCOPE !== "" && RUNTIME_CHAIN_SCOPE !== A897_SOURCE_SCOPE;\n}');
  return out;
}
