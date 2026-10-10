// [A-920] Older main.js pins (a845 N8, a897 S1 ...) compare main.js with pre-card copies. A-920 (Cowork 20:42 / 20:55) edits main.js in exactly four functions + eight const lines:
// restorePreA920(src) puts the pre-A-920 text of those back so the older pins keep their exact meaning; the A-920 scope itself is pinned by a920-main-js-scope.mjs.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
export const A920_PRE = path.join(REPO, "_private/ops/receipts/A920_screens_back_to_mock/pre/app_src_main.js");
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
  return out;
}
