// [A-974] Fork app entry — Explore opens on the fork after the entry server's yes · + Piggy issuance on the fork scope · MY MONEY native
// balance through a read-only fork RPC client. Node only, network 0 (fetch = in-process stubs), no tx, no signer.
// Rows: the main.js [A-974] block (one contiguous block; outside it main.js == the pre-card copy) · the fork Explore body pinned to
// openSecondJourneyExplore · the block run with stubs on testnet / mainnet / blocked / fork, level 1 / 2 (old-vs-new: off the fork nothing is
// replaced) · the read-only reader (method allow-list, RPC judge, no write) · issuance gate old-vs-new (only "monad-fork" changes; 143 refuses).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, custom, defineChain } from "viem";
import { CHAIN_PROFILE_ID, RPC_DEV_BUILD, blockedChainProfile, issuanceAuthorityRequiredForScope, resolveChainProfile, rpcUrlAllowed } from "../src/chain-profile.js";
import { FORK_CHAIN_ID } from "../src/funding-context.js";
import { journeyFeatureOpen } from "../src/release-gate.js";
import { admitModelAPiggy, markBornPiggyIssuance, registerControlledPiggy } from "../src/piggy-index.js";
import { ISSUANCE_REFUSAL } from "../src/issuance-authority.js";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-974 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String((e && e.message) || e).split("\n").slice(0, 4).join("\n      ")}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const MAIN = readFileSync(path.join(REPO, "app/src/main.js"), "utf8");
// [A-977 RE-PIN] the later [A-977] Job 10 fork block is cut before the preservation compares (pre-A-977: MAIN as is)
const A977_CUT = (s) => s.replace(/^\/\/ ── \[A-977\] Job 10 on the shared fork[\s\S]*?^\/\/ ── \[A-977\] end Job 10 on the shared fork ──\n/m, "");
// [A-1023 RE-PIN] (Owner 10-11 14:1x: only the approved post-ee4fa91 hunks are cut; no whole-card exclusion) receipts/A1023_pin_attribution/ATTRIBUTION.md.
// The delimited [A-979 ④] badge block is cut by its markers; every other approved hunk (A-979 ④ import · A-995 ①②③ · A-995-b) is restored to its
// exact ee4fa91 text and only when it occurs exactly once — anything else stays in place, so any other main.js change still fails this pin.
const A1023_RESTORES = [["A-1051 dev-only reset button hunk 1 (Owner 10-11 21:3x)", "        <div class=\"cardAnchor__fit\">${cardMarkup}</div>\n      </div>\n    </section>\n  `;", "        <div class=\"cardAnchor__fit\">${cardMarkup}</div>\n      </div>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>\n  `;"],["A-1051 dev-only reset button hunk 2 (Owner 10-11 21:3x)", "      ${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}\n    </section>", "      ${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 3 (Owner 10-11 21:3x)", "    devExtra: hasRealReceipt\n      ? \"\"\n      : `${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}`,\n  });", "    devExtra: hasRealReceipt\n      ? (isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\")\n      : `${/* [A-912] preview tag: DEV preview only (0 in the product build) */ (typeof A912_PRODUCT_BUILD !== \"undefined\" && A912_PRODUCT_BUILD) ? \"\" : `<p class=\"secondJourney__mockTag\">UI preview — no transaction</p>`}${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}`,\n  });"],["A-1051 dev-only reset button hunk 4 (Owner 10-11 21:3x)", "        </div>\n      </div>\n    </section>\n  `;", "        </div>\n      </div>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>\n  `;"],["A-1051 dev-only reset button hunk 5 (Owner 10-11 21:3x)", "      <p class=\"loginCheck__body\">Face ID may appear once.</p>\n    </section>", "      <p class=\"loginCheck__body\">Face ID may appear once.</p>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 6 (Owner 10-11 21:3x)", "      <button class=\"tiny skip\" id=\"skipHatchButton\" type=\"button\">skip</button>\n    </section>", "      <button class=\"tiny skip\" id=\"skipHatchButton\" type=\"button\">skip</button>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 7 (Owner 10-11 21:3x)", "      <div class=\"nameScene__chog\" aria-hidden=\"true\">${chogInviteMarkup()}</div>\n    </section>", "      <div class=\"nameScene__chog\" aria-hidden=\"true\">${chogInviteMarkup()}</div>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 8 (Owner 10-11 21:3x)", "      ${recordsCardMarkup()}\n    </section>", "      ${recordsCardMarkup()}\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 9 (Owner 10-11 21:3x)", "      }\n    </section>", "      }\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1051 dev-only reset button hunk 10 (Owner 10-11 21:3x)", "    homeChogMarkup: chogHomeMarkupForReturn(\"return\"),\n    devExtra: \"\",\n  });", "    homeChogMarkup: chogHomeMarkupForReturn(\"return\"),\n    devExtra: isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\",\n  });"],["A-1051 dev-only reset button hunk 11 (Owner 10-11 21:3x)", "      <button class=\"tiny home\" id=\"fileboxHomeButton\" type=\"button\">home</button>\n    </section>", "      <button class=\"tiny home\" id=\"fileboxHomeButton\" type=\"button\">home</button>\n      ${isDevDebugOptIn() ? `<button class=\"tiny\" id=\"resetButton\">reset local test</button>` : \"\"}\n    </section>"],["A-1043 second-return mock row (Owner 10-11 20:5x)", "    // [A-1043 · Owner 10-11 20:5x] the mock path drops its \"> mock · <status>\" row (the fork/mock marker already shows at every send); the real-receipt path,\n    // every other row and the paper position are unchanged. pre-A-1043: receiptRowsMarkup: receiptPaperMarkup(hasRealReceipt ? receiptPaperFields(…) : secondJourneyReceiptFields(…)),\n    receiptRowsMarkup: ((rows) => (hasRealReceipt || typeof rows !== \"string\" ? rows : rows.replace(/\\n\\s*<div class=\"receiptPaper__status\">[^<]*<\\/div>/, \"\")))(receiptPaperMarkup(\n      hasRealReceipt\n        ? receiptPaperFields({ receipt: actual, name: displayPiggyName() })\n        : secondJourneyReceiptFields(state.secondJourney.mockReceipt, displayPiggyName()),\n    )),\n", "    receiptRowsMarkup: receiptPaperMarkup(\n      hasRealReceipt\n        ? receiptPaperFields({ receipt: actual, name: displayPiggyName() })\n        : secondJourneyReceiptFields(state.secondJourney.mockReceipt, displayPiggyName()),\n    ),\n"],["A-995 ②③ / A-995-b imports","import { registerA995InlineFace, syncA995GiftEyes } from \"./a995-eye-look.js\";\nimport { mountA995bLoadingPiggy } from \"./a995b-loading-piggy.js\";\n",""],["A-979 ④ import","import { mountForkVirtualMoneyBadge } from \"./fork-virtual-money-badge.js\";\n",""],["A-995 ① breath comment","// [A-995 ①] persistent breath: Owner-selected Sleep strength (x .0091 / y .026) on the existing 4.4 s loop, scaled about the\n","// [A-841 UI-27] persistent subtle breath: the first-arrival values (HOME_T_BREATHE sx 1-.008, sy 1+.014) on a slow loop, scaled about the\n"],["A-995 ① breath coefficients","  el.style.transform = `scale(${(1 - 0.0091 * b).toFixed(5)}, ${(1 + 0.026 * b).toFixed(5)})`;\n","  el.style.transform = `scale(${(1 - 0.008 * b).toFixed(5)}, ${(1 + 0.014 * b).toFixed(5)})`;\n"],["A-995 ② gift eyes (unchanged render)","  if (root && s.html === html) { a911Layout(); void syncA995GiftEyes(root); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n","  if (root && s.html === html) { a911Layout(); return; } // nothing changed: leave the DOM (focus, scroll, running transitions) alone\n"],["A-995 ② gift eyes (sync)","  void syncA995GiftEyes(a911Root() || document);\n",""],["A-995 ③ tester intro face","  const face = el.querySelector(\".testerIntro__face\");\n  registerA995InlineFace(face);\n",""],["A-995 ③ tester intro blink","    setTimeout(() => el.classList.remove(\"is-closed\"), TESTER_INTRO_BLINK_MS - 120),\n",""],["A-995-b loading bridge","// [A-995-b] Same-turn PWA splash -> loading bridge. The browser cannot paint the first render\n// before this module task ends, so the approved 3.6 s overlay remains the first visible surface.\nmountA995bLoadingPiggy();\n",""]]; // [A-1043 RE-PIN] + the A-1043 hunk (exact, restored only when it occurs once). pre-A-1043: the list without its first entry // [A-1051 RE-PIN] + 11 exact hunks of the dev-only 'reset local test' button removal (listed first: restored before A-1043/A-1023). pre-A-1051: the list without them
const A1023_CUT = (s) => { s = s.replace(/^\/\/ ── \[A-979 ④\] Fork virtual-money badge\.[\s\S]*?^\/\/ ── \[A-979 ④\] end ──\n/m, ""); for (const [, from, to] of A1023_RESTORES) if (s.split(from).length === 2) s = s.replace(from, () => to); return s; };
const PRE = privatePath("wt/a974d/pre");

const BLOCK_RE = /^\/\/ ── \[A-974\] Fork app entry[\s\S]*?^\/\/ ── \[A-974\] end fork app entry ──\n/m;
const block = (MAIN.match(BLOCK_RE) || [""])[0];
const FORK_ENV = { rpcUrl: "https://fork-public.invalid/rpc", forkInstanceId: "a974-local" };
const TESTNET = resolveChainProfile(undefined);
const MAINNET = resolveChainProfile(CHAIN_PROFILE_ID.MAINNET);
const FORK = resolveChainProfile(CHAIN_PROFILE_ID.FORK, FORK_ENV);
const BLOCKED = blockedChainProfile("a974_test", "x");

// ── main.js shape ──
await check("main.js: exactly one contiguous [A-974] block, right after the [A-966] block and before the Gift fragment boot read; every [A-974] mark inside", () => {
  assert.ok(block.length > 0);
  assert.equal([...MAIN.matchAll(/\[A-974\]/g)].length, [...block.matchAll(/\[A-974\]/g)].length);
  const at = MAIN.indexOf(block);
  const end966 = "// ── [A-966] end Gift on the shared fork ──\n";
  assert.equal(MAIN.lastIndexOf(end966, at) + end966.length, at);
  assert.ok(at < MAIN.indexOf("const pendingRead = readClaimFragment(location.href);"));
});
await check("main.js outside the [A-974] block is byte-equal to the pre-card copy (private workspace)", () => {
  const pre = path.join(PRE, "main.js");
  if (!existsSync(pre)) { console.log("      (pre-card copy is private-workspace only — skipped)"); return; }
  assert.equal(A1023_CUT(A977_CUT(MAIN)) /* [A-1023 RE-PIN] pre-A-1023: A977_CUT(MAIN) */.replace(BLOCK_RE, ""), readFileSync(pre, "utf8")); // pre-A-977: MAIN.replace(BLOCK_RE, "")
});
const fnBody = (src, head) => { const i = src.indexOf(head); assert.ok(i >= 0, head); const j = src.indexOf("\n}\n", i); return src.slice(i + head.length, j); };
const code = (s) => s.split("\n").filter((l) => !l.trim().startsWith("//")).map((l) => l.replace(/\s*\/\/.*$/, "")).filter((l) => l !== "").join("\n");
await check("fork Explore body == openSecondJourneyExplore after its legacy-receipt check, statement for statement (comments dropped)", () => {
  const orig = fnBody(MAIN, "function openSecondJourneyExplore() {\n");
  const guard = "  if (!state.receipts.some((r) => r && r.txHash) && !(import.meta.env.DEV && state.secondJourney.devPreview)) return;\n";
  assert.ok(orig.startsWith(guard), "the testnet guard is the first statement (unchanged)");
  assert.equal(code(fnBody(block, "function a974OpenForkExplore() {\n")), code(orig.slice(guard.length)));
});
await check("block content: fork-only gate (journeyFeatureOpen \"second\" + the fork chain id) · no storage write · no signer / wallet / send · no new user-facing string · no mainnet id", () => {
  assert.match(block, /^const A974_FORK = journeyFeatureOpen\("second", \{ level: RELEASE_LEVEL, profile: CHAIN_PROFILE \}\) && CHAIN_PROFILE\.numericChainId === a974ForkChainId;$/m);
  assert.equal([...block.matchAll(/journeyFeatureOpen\(/g)].length, 1);
  assert.match(block, /^if \(A974_FORK\) \{$/m);
  const c = code(block);
  for (const bad of [/localStorage|sessionStorage/, /signMessage|signTransaction|createWalletClient|sendRawTransaction|eth_send|writeContract|activeAccount|requestPrf|ISSUANCE_AUTHORITY/, /innerHTML|textContent|createElement|a891ChogSay/, /\b143\b|10143/, /anvil_|\/admin|ARASO_FORK_ADMIN/]) assert.doesNotMatch(c, bad);
  const quoted = [...c.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]).filter((s) => s !== "" && !s.startsWith("./") && s !== "viem");
  const PRE_MAIN = MAIN.replace(BLOCK_RE, "");
  for (const s of new Set(quoted)) assert.ok(PRE_MAIN.includes(`"${s}"`) || /^(eth_chainId|eth_getBalance|fork_read_only|fork_rpc_not_allowed|fork_chain_mismatch|rpc_error|second|POST|application\/json|2\.0|Monad mainnet fork|MON)$/.test(s), `string "${s}" is new user-facing copy`);
  assert.ok(PRE_MAIN.includes('"no saved account to read from yet."'), "the one copy line reused is the existing one");
});

// ── run the block with stubs ──
function loadBlock(E) {
  const body = block.replace(/^import [^\n]*\n/gm, "");
  const lets = ["state", "homeChog", "a891CueChog", "openSecondJourneyExplore", "a891ArmPostFileQuietHome", "fetchHomeMoneyData", "homeMoneyRequestSeq"];
  const consts = ["CHAIN_PROFILE", "RELEASE_LEVEL", "journeyFeatureOpen", "a956ForkMoneyAllowed", "refreshHomePaperMount", "recordSafeError", "createPublicClient",
    "ensureSecondJourneyDomainState", "inferSeedStage", "secondLaneMode", "applySecondDraftIfAny", "recomputeSecondJourneyFlow", "keepSecondLaneDraftIfValid", "setScene", "refreshSecondLaneCandidates",
    "a974DevBuild", "a974RpcAllowed", "a974ForkChainId", "a974Custom", "a974DefineChain"];
  const src = `${lets.map((n) => `let ${n} = E.${n};`).join("\n")}\nconst { ${consts.join(", ")} } = E;\n${body}\nreturn { get: (n) => eval(n) };`;
  return new Function("E", src)(E);
}
const tick = () => new Promise((r) => setTimeout(r, 15));
function harness({ profile = FORK, level = 2, allowed = true, address = "0x" + "ab".repeat(20), scene = "sendstay", chog = true, rpc = null } = {}) {
  const calls = { base: 0, arm: 0, ask: 0, money: 0, scene: [], refresh: 0, errors: 0, rpc: [] };
  const state = { scene, address, receipts: [], secondJourney: {}, secondJourneyCompletedOnce: false, appLock: null, homeQuietForExplore: false, homeMoneyStatus: "idle" };
  const base = () => { calls.base += 1; };
  const arm = () => { calls.arm += 1; };
  const money = async () => { calls.money += 1; };
  globalThis.fetch = rpc ? async (url, init) => { const b = JSON.parse(init.body); calls.rpc.push({ url, method: b.method }); return { json: async () => rpc(b) }; } : globalThis.fetch;
  const B = loadBlock({
    state, homeChog: chog ? {} : null, a891CueChog: "x", openSecondJourneyExplore: base, a891ArmPostFileQuietHome: arm, fetchHomeMoneyData: money, homeMoneyRequestSeq: 0,
    CHAIN_PROFILE: profile, RELEASE_LEVEL: level, journeyFeatureOpen, a956ForkMoneyAllowed: async () => { calls.ask += 1; const v = typeof allowed === "function" ? allowed() : allowed; if (v instanceof Error) throw v; return v; }, // [A-974 r2] allowed may change between asks
    refreshHomePaperMount: () => { calls.refresh += 1; }, recordSafeError: () => { calls.errors += 1; }, createPublicClient,
    ensureSecondJourneyDomainState: () => ({ interests: [] }), inferSeedStage: () => "a", secondLaneMode: () => false, applySecondDraftIfAny: () => {}, recomputeSecondJourneyFlow: () => {}, keepSecondLaneDraftIfValid: () => {},
    setScene: (s) => { calls.scene.push(s); state.scene = s; }, refreshSecondLaneCandidates: async () => {},
    a974DevBuild: RPC_DEV_BUILD, a974RpcAllowed: rpcUrlAllowed, a974ForkChainId: FORK_CHAIN_ID, a974Custom: custom, a974DefineChain: defineChain,
  });
  return { B, calls, state, base, arm, money };
}
await check("old-vs-new: testnet / mainnet / blocked at level 1 and 2, and the fork at level 1 → A974_FORK false, nothing replaced, no server ask, no network", async () => {
  const n0 = netCalls;
  for (const [profile, level] of [[TESTNET, 1], [TESTNET, 2], [MAINNET, 1], [MAINNET, 2], [BLOCKED, 2], [FORK, 1]]) {
    const T = harness({ profile, level });
    await tick();
    assert.equal(T.B.get("A974_FORK"), false, `${profile.id} L${level}`);
    assert.equal(T.B.get("openSecondJourneyExplore"), T.base); assert.equal(T.B.get("a891ArmPostFileQuietHome"), T.arm); assert.equal(T.B.get("fetchHomeMoneyData"), T.money);
    assert.equal(T.calls.ask, 0); assert.equal(T.state.homeQuietForExplore, false); assert.equal(T.B.get("a891CueChog"), "x");
  }
  assert.equal(netCalls, n0);
  // the pre-A-974 gate the testnet Explore keeps: journeyFeatureOpen("second") is false on root testnet at every level (A-948)
  for (const level of [1, 2, 3]) assert.equal(journeyFeatureOpen("second", { level, profile: TESTNET }), false);
});
await check("fork level 2, entry allowed: boot on Home arms the existing cue · Explore opens through the fork body (scene explore) · the post-file cue arms after the server's yes", async () => {
  const T = harness();
  assert.equal(T.B.get("A974_FORK"), true);
  await tick();
  assert.equal(T.calls.ask, 1); assert.equal(T.calls.arm, 1, "boot: Home mounted → the existing arm");
  T.B.get("openSecondJourneyExplore")(); await tick(); // [A-974 r2] the open asks the server first. pre-A-974 r2: opened synchronously from the boot answer
  assert.equal(T.calls.ask, 2); assert.deepEqual(T.calls.scene, ["explore"]); assert.equal(T.calls.base, 0);
  T.state.scene = "sendstay";
  T.B.get("a891ArmPostFileQuietHome")(); assert.equal(T.B.get("a891CueChog"), null); await tick();
  assert.equal(T.calls.ask, 3); assert.equal(T.calls.arm, 2);
  const U = harness({ chog: false }); await tick();
  assert.equal(U.calls.arm, 0); assert.equal(U.state.homeQuietForExplore, true, "Home not mounted yet → the flag mountHome() settle() consumes");
});
await check("fork level 2, no entry (refused / server down / no address / Second done / not on Home): quiet Home stays, Explore = the previous (closed) path, no cue", async () => {
  for (const allowed of [false, new Error("offline")]) {
    const T = harness({ allowed }); await tick();
    assert.equal(T.calls.arm, 0); assert.equal(T.state.homeQuietForExplore, false);
    T.B.get("openSecondJourneyExplore")(); await tick(); assert.equal(T.calls.base, 1); assert.deepEqual(T.calls.scene, []); // [A-974 r2] await the ask
    T.B.get("a891ArmPostFileQuietHome")(); await tick(); assert.equal(T.calls.arm, 0);
  }
  const N = harness({ address: "" }); await tick(); assert.equal(N.calls.ask, 0); assert.equal(N.calls.arm, 0);
  const D = harness(); D.state.secondJourneyCompletedOnce = true; await tick(); assert.equal(D.calls.arm, 0); assert.equal(D.state.homeQuietForExplore, false);
  const A = harness({ scene: "away" }); await tick(); assert.equal(A.calls.arm, 0); assert.equal(A.state.homeQuietForExplore, false);
});
await check("MY MONEY on the fork: native balance read through the fork RPC (eth_getBalance only) → ready · shMON null (not a fork asset) · read failure = the existing error state", async () => {
  const T = harness({ rpc: (b) => (b.method === "eth_getBalance" ? { jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" } : b.method === "eth_chainId" ? { jsonrpc: "2.0", id: 1, result: "0x1de2ab7" } : { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no" } }) }); // [A-974 r2] + eth_chainId
  T.state.homeMoneyShmonWei = 5n;
  await T.B.get("fetchHomeMoneyData")();
  assert.equal(T.calls.money, 0, "the sealed testnet read path is not called");
  assert.equal(T.state.homeMoneyStatus, "ready"); assert.equal(T.state.homeMoneyNativeWei, 10n ** 18n); assert.equal(T.state.homeMoneyShmonWei, null);
  assert.deepEqual(T.calls.rpc.map((r) => [r.url, r.method]), [[FORK_ENV.rpcUrl, "eth_chainId"], [FORK_ENV.rpcUrl, "eth_getBalance"]]); // [A-974 r2] pre-A-974 r2: eth_getBalance only
  const F = harness({ rpc: () => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "down" } }) });
  await F.B.get("fetchHomeMoneyData")();
  assert.equal(F.state.homeMoneyStatus, "error"); assert.equal(F.state.homeMoneyErrorText, null); assert.equal(F.calls.errors, 1);
  const E = harness({ address: "" }); await E.B.get("fetchHomeMoneyData")();
  assert.equal(E.state.homeMoneyStatus, "error"); assert.equal(E.state.homeMoneyErrorText, "no saved account to read from yet.");
});
// ── [A-974 r2] coordinator opus spot CONCERNs: no cached entry verdict for the Explore open · chain id checked before the balance ──
await check("r2: each Explore open asks the fork entry server again (no kept verdict): boot yes → later no = the previous (closed) path; later yes = the fork body; a scene change while asking opens nothing", async () => {
  let answer = true;
  const T = harness({ allowed: () => answer }); await tick();
  assert.equal(T.calls.ask, 1);
  answer = false;
  T.B.get("openSecondJourneyExplore")(); await tick();
  assert.equal(T.calls.ask, 2); assert.equal(T.calls.base, 1); assert.deepEqual(T.calls.scene, []);
  answer = true;
  T.B.get("openSecondJourneyExplore")(); await tick();
  assert.equal(T.calls.ask, 3); assert.deepEqual(T.calls.scene, ["explore"]);
  T.state.scene = "sendstay"; answer = true;
  T.B.get("openSecondJourneyExplore")(); T.state.scene = "away"; await tick();
  assert.equal(T.calls.ask, 4); assert.deepEqual(T.calls.scene, ["explore"]); assert.equal(T.calls.base, 1);
  assert.ok(!/\ba974Entered\b/.test(block), "no module-level entry verdict");
});
await check("r2: MY MONEY reader asks eth_chainId before the balance; a chain id other than 31337143 (0x1de2ab7) = unreadable (existing error state), eth_getBalance never sent, no balance kept; checked once per client", async () => {
  for (const bad of ["0x8f", "0x279f", "0x7a69", null, "garbage"]) {
    const T = harness({ rpc: (b) => (b.method === "eth_chainId" ? { jsonrpc: "2.0", id: 1, result: bad } : { jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }) });
    T.state.homeMoneyNativeWei = null;
    await T.B.get("fetchHomeMoneyData")();
    assert.equal(T.state.homeMoneyStatus, "error", String(bad)); assert.equal(T.state.homeMoneyErrorText, null); assert.equal(T.state.homeMoneyNativeWei, null);
    const ms = T.calls.rpc.map((r) => r.method); assert.ok(ms.length >= 1 && ms.every((m) => m === "eth_chainId"), `${bad}: ${ms}`); // viem's own transport retries may repeat the chain id ask
  }
  const G = harness({ rpc: (b) => ({ jsonrpc: "2.0", id: 1, result: b.method === "eth_chainId" ? "0x1de2ab7" : "0x1" }) });
  await G.B.get("fetchHomeMoneyData")(); await G.B.get("fetchHomeMoneyData")();
  assert.equal(G.state.homeMoneyStatus, "ready"); assert.deepEqual(G.calls.rpc.map((r) => r.method), ["eth_chainId", "eth_getBalance", "eth_getBalance"]);
});
await check("the fork reader is read-only and judged: any method but eth_chainId / eth_getBalance is refused before the network · a URL the RPC judge refuses is never fetched", async () => {
  const T = harness({ rpc: () => ({ jsonrpc: "2.0", id: 1, result: "0x1" }) });
  const reader = T.B.get("a974ForkReader")();
  for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_call", "eth_estimateGas", "anvil_setBalance", "eth_sign"]) {
    await assert.rejects(reader.request({ method: m, params: [] }), /fork_read_only/);
  }
  assert.equal(T.calls.rpc.length, 0);
  for (const bad of ["http://127.0.0.1:8545", "http://localhost:8545", "ftp://x", ""]) {
    const U = harness({ profile: { ...FORK, rpcUrl: bad }, rpc: () => ({ jsonrpc: "2.0", id: 1, result: "0x1" }) });
    await U.B.get("fetchHomeMoneyData")();
    assert.equal(U.calls.rpc.length, 0, bad); assert.equal(U.state.homeMoneyStatus, "error");
  }
});

// ── + Piggy issuance gate ──
const PRE_GATE = (scope) => scope !== "monad-testnet"; // the pre-A-974 body (chain-profile.js, private pre copy compared below)
await check("issuance gate old-vs-new: only \"monad-fork\" changes (true → false); testnet false; mainnet / \"143\" / 31337143 / unknown / blocked stay required", () => {
  const scopes = ["monad-testnet", "monad-mainnet", "143", 143, "10143", 10143, "31337143", 31337143, "monad-fork ", "MONAD-FORK", "monad-fork.x", "", undefined, null, "other"];
  for (const s of scopes) assert.equal(issuanceAuthorityRequiredForScope(s), PRE_GATE(s), String(s));
  assert.equal(PRE_GATE("monad-fork"), true); assert.equal(issuanceAuthorityRequiredForScope("monad-fork"), false);
  const pre = path.join(PRE, "chain-profile.js");
  if (existsSync(pre)) assert.match(readFileSync(pre, "utf8"), /export function issuanceAuthorityRequiredForScope\(scope\) \{\n  return scope !== PROFILES\[CHAIN_PROFILE_ID\.TESTNET\]\.scope;\n\}/);
});
function mem() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; }
const locks = { request: async (_n, _o, fn) => fn() };
const ROOT = { credentialId: Buffer.from("root-cred-a974").toString("base64url") };
async function admitOn(chain) {
  const storage = mem();
  const r1 = registerControlledPiggy(storage, chain, { id: "legacy-0x" + "11".repeat(20), name: "Honeybun", address: "0x" + "11".repeat(20), signerAddress: "0x" + "11".repeat(20), locator: { credentialId: ROOT.credentialId }, at: "2026-10-10T00:00:00.000Z" });
  assert.ok(r1.ok, r1.reason);
  assert.equal(markBornPiggyIssuance(storage, chain, { address: "0x" + "11".repeat(20) }).ok, true); // this device = the first Piggy's origin (the a711 seed)
  let prf = 0;
  const out = await admitModelAPiggy({ storage, chainId: chain, locks, rootCredential: ROOT, requestPrf: async (c) => { prf += 1; return { credentialId: c.credentialId, prfOutput: new Uint8Array(32).fill(7) }; }, deriveAddress: () => "0x" + "22".repeat(20), now: () => "2026-10-10T00:00:01.000Z" });
  return { out, prf };
}
await check("+ Piggy on the fork scope with no issuance authority: one passkey assertion, admitted (testnet rule) · mainnet scope: refused UNCONFIGURED before any passkey prompt", async () => {
  const f = await admitOn("monad-fork");
  assert.equal(f.out.ok, true, f.out.reason); assert.equal(f.prf, 1);
  const t = await admitOn("monad-testnet");
  assert.equal(t.out.ok, true); assert.equal(t.prf, 1);
  const m = await admitOn("monad-mainnet");
  assert.equal(m.out.ok, false); assert.equal(m.out.reason, ISSUANCE_REFUSAL.UNCONFIGURED); assert.equal(m.prf, 0);
});
await check("main.js still ships ISSUANCE_AUTHORITY = null (the + Piggy path itself is unchanged)", () => {
  assert.match(MAIN, /^const ISSUANCE_AUTHORITY = null;$/m);
});
await check("network 0", () => { assert.equal(netCalls, 0); });
console.log(`\nA-974 fork app entry: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
