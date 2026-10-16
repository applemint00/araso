// [A-946] F0 fork foundation. Node only, network 0. One build: the chain profile is picked once at boot from the page path
// ("/j2" + release level ≥ 2 = the shared-fork profile), the 7 chain seams know the fork's own id, the 3 Second keys are per chain scope,
// the A-897 promotion runs on Monad mainnet only. Cases (a)–(g) are the card's; the rest pins the literals and the 143 paths.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_CHAIN_ID, FORK_SCOPE, FUNDING_CONTEXT_TOKEN_ALLOWLIST, scopeForChainId } from "../src/funding-context.js";
import { CHAIN_PROFILE_ID, isProfileActive, legacyTestnetPathOpen, profileScope, resolveChainProfile } from "../src/chain-profile.js";
import { FORK_BOOT_PATH, PROMOTION_TARGET_SCOPE, scopedSecondKey, selectBootProfile } from "../src/boot-profile.js";
import { SIGN_GUARD, SIGN_GUARD_FORK_CHAIN_ID, SIGN_GUARD_SPONSOR_CHAIN_ID, preparedSignProblem } from "../src/money-executor.js";
import { GIFT_SPONSOR_CHAINS } from "../src/gift-sponsor-7702.js";
import { planGiftGasDeposit } from "../src/gift-create-plan.js";
import { GIFT_GAS_BUDGET_STATUS, GIFT_SPONSOR_GAS_STEPS } from "../src/gift-value-spec.js";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { secondJourneyStorageKey } from "../src/second-journey-state.js";
import { myPiggiesIndexKey } from "../src/piggy-index.js";
import { piggyRegistryKey } from "../src/piggy-registry.js";

let netCalls = 0;
globalThis.fetch = async () => { netCalls += 1; throw new Error("A-946 test: network forbidden"); };
let pass = 0, fail = 0;
const check = async (n, f) => { try { await f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const src = (f) => readFileSync(path.join(REPO, f), "utf8");
const MAIN = src("app/src/main.js");
// function source by name (brace-matched; strings in these files do not hold unbalanced braces)
const fnSrc = (text, name) => {
  const m = new RegExp(`^(export )?(async )?function ${name}\\(`, "m").exec(text); if (!m) return null;
  let p = 0, k = text.indexOf("(", m.index);
  for (; k < text.length; k += 1) { if (text[k] === "(") p += 1; else if (text[k] === ")") { p -= 1; if (p === 0) break; } } // skip the parameter list (it may hold "{ … }")
  let d = 0;
  for (let j = text.indexOf("{", k); j < text.length; j += 1) { if (text[j] === "{") d += 1; else if (text[j] === "}") { d -= 1; if (d === 0) return text.slice(m.index, j + 1); } }
  return null;
};
const fnNames = (text) => [...text.matchAll(/^(?:export )?(?:async )?function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
const sha = (t) => createHash("sha256").update(t).digest("hex");
// [A-983] baseline pins (replace `git show HEAD:` compares, which fail once HEAD holds the fork work: after the release commit / in a clone).
//   Unchanged values retain de8c9c8; the accepted Gift metadata/link changes re-pin only their affected surfaces.
const BASE_RT143_SHA256 = "96da1363170faeb9f465bc66e4b19fef9237188d8ea5e87a0d5bd45e276a64d0"; // accepted Gift runtime prefix, trailing newlines trimmed
const BASE_CREDENTIAL_LINES_SHA256 = "6d9670c91a048a5a2871761dc45f9c9be74d7426a3fad9af7235f46c99d58819"; // main.js @de8c9c8: lines naming araso.passkey / araso.prfSalt / PASSKEY_STORAGE_KEY, joined by \n
const BASE_GIFT_FNS = { // file → [function name, sha256(fnSrc)] in file order; de8c9c8 except accepted Gift changes
  "app/src/gift-create-plan.js": [
    ["isoFromUnixSeconds", "f452f3ab3cc437b99a29d1be5b231b7345bc68f9a2b8cfc3e2276ee8834b4bfc"],
    ["planGiftCreate", "4a448244142031a8ee53d45382defab0f188263c875bdcaedcd64b09cc039b35"],
    ["planGiftGasDeposit", "495c8fbb8b5b9e3315e7396d2246c3aecaf8f739d6db99375fd6c8daed95511e"],
    ["buildGiftCreateStepCalls", "173ab501c43d76ebaffbaf4bb1026af53c974b7c43bc2eb23849ff3ae6598b4a"],
    ["confirmGiftCreateStep", "92da9b92da0e85ed99a28efb4b4217f14898b0a3299521016edfdf3be5a40aba"],
    ["needsGasRegistration", "4c537c40e6c26f0d42986d6c9f638af2067c5f6001c468eaa9d9fe919c1f154f"],
    ["buildGasTxRegistration", "2f6b335cf3713e48324f8f1f9e75b7d06843579a5dc0b40dc81778bd9fe37f94"],
    ["registerGasDeposit", "098bddfd3a9fb5dbe68c9dd451e11cebe24723baab2941bc1c257deadf490cbb"],
    ["giftCreateConfigProblem", "52b412348862d56bb81ad3c0f698e4bc8432923164e656e6f6fce915ae857fb5"],
    ["armGiftCreateStep", "4dcb43b77ed04f364ed949b1f102721f76b66bbf16e1515642bb0b314f6eaf2a"],
    ["disarmAllGiftCreateSteps", "16b59165f70e5e6a68921a27f5c790c3e51d0d5d58425469c720f38825b48a3e"],
    ["giftCreateStepMatch", "e234e22d85bb5ac1e6c55d37daa0e0b0dcf4fbdd3bec6fefcf3223cc0f2dce98"],
  ],
  "app/src/money-executor.js": [
    ["preparedSignProblem", "e396cf302b6e8af29760d9d91096dfcb7996983c413a3c24418bcf559f6dec7f"],
    ["signingCopy", "5eab14946fa13e86b50c6ecdba139105d9ccf20fe20d8b0da735e785e61c3cc0"],
    ["passed", "0020bf8a7647e80aae54058d3d1f3a9bf4e2f0028531dac5d385f5e41d684f63"],
    ["runHook", "f7b3eee1df380ff6aa9c5497273645315533b0ff90a83f637cd57ea1225ee7d6"],
    ["transportProblem", "e09443898a94af5277ca77c3e8ec0dbc7822d2d0c5ae89d94551700aa0b27f75"],
    ["executeMoneyStep", "88573a1297431939ad35f5c90d6d7043f53ef7f33ae721ebc5242ffb9dc8c736"],
  ],
  "app/src/gift-sponsor-7702.js": [
    ["giftSponsorExpiryBefore", "9d7cc7055101b3111806dfbdd0d532ce0526f42f029d52b045c5692ace03fb49"],
    ["giftSponsorNextStep", "113a0dff877d93956ec12db71d394a14960e44b401a3592e08b697912870ee75"],
    ["toSafeInt", "66fbc28c0167bf131eb065983ba29f143439601723ef9517140aac7509e12814"],
    ["toUint256", "910ad5235a7c57cf188b945f1166da080deae1bff16a5f148bd8f86e0a6405f8"],
    ["normalizeGiftSponsorConfig", "63cf9b0de6fc0b11d0d3cf55f547a919b6969546e157163709e8e1eab482859f"],
    ["checkPinnedCode", "d050680ce79020e01772c1b876341c89f724200d7c4c20458720f40d99e25e55"],
    ["normalizeAuthorization", "004eb41eecb255699a4f7700b9b715a7b706c4aeca2a92ecdcf435c5c10e5c06"],
    ["checkAuthorization", "7c688bf6ceda72204a4015c6c62afe5688db683fac7560676dcee5696b48cea9"],
    ["checkRevokeAuthorization", "5167943a7575f68f0dd595b3cb2dfae86f0e09c61cffa876822161e1ce9aa7e8"],
    ["recoverAuthorizationAuthority", "3ac611bffb0a9f200c50b207956e5ae06e0d4b94c51c2b6e2bceaf8f01e3e270"],
    ["buildCommitClaimCalldata", "04399b779ccf42de2e90802c6728a598d222431243ecbb4a0f1c4822bb3146f5"],
    ["buildExactExecutionTerms", "be3ae46116f500b78c3ac9f716987126d55a020ccb5ffa6ab4ae86f822f30cfd"],
    ["buildTimestampTerms", "11a6fe2040c37f91ccd56109bb45cfbc5871c4ee139ff94b0555e221fcd3c6a2"],
    ["checkDelegation", "f776e37a72ce8dcc4f552cf725a4ca2cae84c43075d806150e5bb9e587285322"],
    ["delegationTypedData", "b023b7721c5362301dec10fe56329bb1b6389cb21db57826f3056b1a0315dd21"],
    ["recoverDelegationSigner", "db4c1325a12f145e49dc625e0169ac7117e7ea898b40c76d6bb4fe23e6c8576d"],
    ["sponsorCommitHash", "12545f7758116543ad7354edc7377925cab688827626e39f2ff94877ca561de5"],
    ["checkClaim", "d0352c171a5beee459736323d29561b1b55e132507326bc6529f8958ffa8cc13"],
    ["validateGiftSponsorRequest", "6de5f8ea62a72a360428786acceb0a707a27b817b9e0105ed6d3d45048b8ac9c"],
    ["buildRedeemCalldata", "2340bd92dab79a6d3e0ebd1bcc0d7fe6f0454d6cd42dd37ca368317f1bc70553"],
    ["toExecutorAuthorizationList", "92f329776ba833d7c406e6a404d0261c53fafab0c6034e46e4e416646e23d8b1"],
    ["giftSponsorRedeemData", "283298b77c999a75fb2c6d009ab46520c47c921eaf0149edc4c06875c10326ce"],
    ["isGiftSponsorAuthorizationList", "fc6b0f8359c6dad72c8feec5c913939e41fa694fa32082cd503a927c739b83df"],
    ["createGiftSponsorSession", "77df94747b9effa3ad8e969abb0afe9004b6957addc517c2eced70c573486796"],
    ["defaultSalt", "bc16f6cf53d67bc9df0fa8c463d55ff64f9840c8f8f60c8e9d1c77764ff6781c"],
  ],
};
// [A-966 re-pin] gift-create-plan.js minus the A-966 [gift-fork] hunks (exact text; a drifted hunk leaves its text and the check fails).
function undoGiftForkCreate(t) {
  const swaps = [
    [/\n\/\/ \[gift-fork\] the shared mainnet fork: its scope[\s\S]*?\n}\n/, "\n"],
    [/  const claimUrl0 = typeof origin === "string" && origin\n    \? buildClaimUrl\(origin, \{ token: created\.token \}\)\n    : null;\n  \/\/ \[gift-fork\][^\n]*\n  \/\/[^\n]*\n  const claimUrl = chainScope === FORK_GIFT_SCOPE \? forkClaimUrl\(claimUrl0\) : claimUrl0;\n/,
      '  const claimUrl = typeof origin === "string" && origin\n    ? buildClaimUrl(origin, { token: created.token })\n    : null;\n'],
    [/    \/\/ \[gift-fork\] pre: gasDeposit\.chainId[^\n]*\n    \/\/[^\n]*\n    const armChainId = [^\n]*\n    if \(!plan \|\| plan\.ok !== true \|\| !plan\.gasDeposit \|\| \(armChainId[^\n]*\n    const armScope = [^\n]*\n    if \(plan\.record\?\.chainId !== armScope\)[^\n]*\n/,
      '    if (!plan || plan.ok !== true || !plan.gasDeposit || plan.gasDeposit.chainId !== GIFT_CREATE_CHAIN_ID) return { ok: false, reason: "sponsor_chain_invalid" };\n    if (plan.record?.chainId !== GIFT_CREATE_CHAIN_SCOPE) return { ok: false, reason: "sponsor_chain_invalid" };\n'],
    ["FUNDING_CONTEXT_TOKEN_ALLOWLIST[armScope]?.USDC?.assetId;", "FUNDING_CONTEXT_TOKEN_ALLOWLIST[GIFT_CREATE_CHAIN_SCOPE]?.USDC?.assetId;"],
    ["stepKey(w.to, w.value, w.data, armChainId)", "stepKey(w.to, w.value, w.data)"],
    [/\/\/ \[gift-fork\] the key carries[^\n]*\n\/\/[^\n]*\nconst stepKey = \(to, value, data, chainId = GIFT_CREATE_CHAIN_ID\) => `\$\{chainId\}\|[^\n]*\n\/\/ \[gift-fork\] the sender create step[^\n]*\nconst CREATE_CHAINS = [^\n]*\n/,
      "const stepKey = (to, value, data) => `${GIFT_CREATE_CHAIN_ID}|${String(to).toLowerCase()}|${value.toString(10)}|${String(data).toLowerCase()}`;\n"],
  ];
  return swaps.reduce((acc, [a, b]) => acc.replace(a, b), t);
}
const FORK_ENV = { VITE_ARASO_FORK_RPC_URL: "https://fork-public.invalid/rpc", VITE_ARASO_FORK_INSTANCE_ID: "fork-1" };

// ── boot profile ──
await check("(a) \"/\" at level 1 → testnet, exactly as before", () => {
  const p = selectBootProfile({ pathname: "/", env: {}, releaseLevel: 1 });
  assert.equal(p.id, CHAIN_PROFILE_ID.TESTNET); assert.equal(p.numericChainId, 10143); assert.equal(legacyTestnetPathOpen(p), true);
  assert.deepEqual(selectBootProfile({ pathname: "/", env: { VITE_ARASO_CHAIN_PROFILE: "monad-mainnet" }, releaseLevel: 1 }).id, "monad-mainnet");
});
await check("(b) \"/j2\" at level 1 → testnet (fail closed), even with fork config", () => {
  const p = selectBootProfile({ pathname: FORK_BOOT_PATH, env: { ...FORK_ENV }, releaseLevel: 1 });
  assert.equal(p.id, CHAIN_PROFILE_ID.TESTNET);
});
await check("(c) \"/j2\" at level 2 + fork config → the fork profile (own id, own scope, live off, no legacy path)", () => {
  const p = selectBootProfile({ pathname: "/j2", env: { ...FORK_ENV }, releaseLevel: 2 });
  assert.equal(p.id, "monad-fork"); assert.equal(p.numericChainId, FORK_CHAIN_ID); assert.equal(p.scope, FORK_SCOPE);
  assert.equal(p.liveExecution, false); assert.equal(isProfileActive(p), true); assert.equal(legacyTestnetPathOpen(p), false);
  assert.equal(p.rpcUrl, FORK_ENV.VITE_ARASO_FORK_RPC_URL); assert.equal(p.forkInstanceId, "fork-1");
  assert.notEqual(p.numericChainId, 143); assert.notEqual(p.numericChainId, 10143);
});
await check("fork profile without its config (or with bad values) → BLOCKED, never testnet/mainnet", () => {
  for (const env of [{}, { VITE_ARASO_FORK_RPC_URL: "https://x/rpc" }, { VITE_ARASO_FORK_INSTANCE_ID: "f" }, { ...FORK_ENV, VITE_ARASO_FORK_RPC_URL: "http://x/rpc" }, { ...FORK_ENV, VITE_ARASO_FORK_INSTANCE_ID: "bad id" }]) {
    const p = selectBootProfile({ pathname: "/j2", env, releaseLevel: 2 });
    assert.equal(p.status, "blocked", JSON.stringify(env)); assert.equal(profileScope(p), "");
  }
});
await check("fork id named in the build config outside Gift routes → BLOCKED; /gift is the receiver fork route", () => {
  assert.equal(selectBootProfile({ pathname: "/", env: { VITE_ARASO_CHAIN_PROFILE: "monad-fork", ...FORK_ENV }, releaseLevel: 2 }).status, "blocked");
  assert.equal(resolveChainProfile("monad-fork").status, "blocked");
  for (const pathname of ["/j2/", "/J2", "/claim", "/j2x", ""]) assert.equal(selectBootProfile({ pathname, env: { ...FORK_ENV }, releaseLevel: 2 }).id, CHAIN_PROFILE_ID.TESTNET, pathname);
  assert.equal(selectBootProfile({ pathname: "/gift", env: { ...FORK_ENV }, releaseLevel: 2 }).id, "monad-fork");
});
await check("main.js picks the profile once at boot through selectBootProfile (one line, page path, build env)", () => {
  // [A-948 RE-PIN] + journey: storedJourney(). pre-A-948: ... env: import.meta.env });
  assert.equal([...MAIN.matchAll(/^const CHAIN_PROFILE = selectBootProfile\(\{ pathname: typeof location !== "undefined" \? location\.pathname : "\/", env: import\.meta\.env, journey: storedJourney\(\) \}\);/gm)].length, 1);
  const assigns = [...MAIN.replace(/\/\/[^\n]*/g, "").matchAll(/(^|[^A-Za-z0-9_$.])CHAIN_PROFILE\s*=(?!=)/gm)].length;
  assert.equal(assigns, 1, "assigned exactly once (the const line)");
});

// ── (d) namespaces ──
await check("(d) fork scope: index / registry / Second state / the 3 Second keys all separate from testnet and mainnet", () => {
  const A = "0x" + "a".repeat(40);
  for (const scope of ["monad-testnet", "monad-mainnet"]) {
    assert.notEqual(myPiggiesIndexKey(FORK_SCOPE), myPiggiesIndexKey(scope));
    assert.notEqual(piggyRegistryKey({ chainId: FORK_SCOPE, accountId: A }), piggyRegistryKey({ chainId: scope, accountId: A }));
    assert.notEqual(secondJourneyStorageKey({ chainId: FORK_SCOPE, accountId: A }), secondJourneyStorageKey({ chainId: scope, accountId: A }));
  }
  for (const base of ["araso.secondJourneyClosed", "araso.secondJourneyPicks", "araso.secondIntroSeen"]) {
    assert.equal(scopedSecondKey(base, "monad-testnet"), base, "testnet = the old key (existing values stay readable)");
    assert.equal(scopedSecondKey(base, FORK_SCOPE), `${base}.monad-fork`);
    assert.equal(scopedSecondKey(base, "monad-mainnet"), `${base}.monad-mainnet`);
    assert.equal(scopedSecondKey(base, ""), `${base}.blocked`);
  }
  for (const [k, base] of [["SECOND_JOURNEY_CLOSED_KEY", "araso.secondJourneyClosed"], ["SECOND_PICK_LOG_KEY", "araso.secondJourneyPicks"], ["SECOND_INTRO_SEEN_KEY", "araso.secondIntroSeen"]]) {
    assert.match(MAIN, new RegExp(`^const ${k} = scopedSecondKey\\("${base.replace(".", "\\.")}", RUNTIME_CHAIN_SCOPE\\);`, "m"));
  }
});
await check("(d) araso.receipts / araso.tripClosed unchanged and sealed off testnet (LEGACY_TESTNET_PATH)", () => {
  assert.match(MAIN, /^const RECEIPTS_KEY = "araso\.receipts";$/m); assert.match(MAIN, /^const TRIP_CLOSED_KEY = "araso\.tripClosed";$/m);
  assert.match(MAIN, /receipts: LEGACY_TESTNET_PATH \? readReceipts\(\) : \[\],/);
  const fork = selectBootProfile({ pathname: "/j2", env: { ...FORK_ENV }, releaseLevel: 2 });
  assert.equal(legacyTestnetPathOpen(fork), false);
});
await check("(d) behaviour on the fork profile: the real rememberReceipt + sendPiggy + state-init lines touch no storage (read / write / reset 0)", async () => {
  const LEGACY = legacyTestnetPathOpen(selectBootProfile({ pathname: "/j2", env: { ...FORK_ENV }, releaseLevel: 2 }));
  const touched = [];
  const storage = { getItem: (k) => { touched.push(["get", k]); return null; }, setItem: (k) => touched.push(["set", k]), removeItem: (k) => touched.push(["remove", k]) };
  const scenes = [];
  let readCalls = 0;
  const ctx = vm.createContext({ LEGACY_TESTNET_PATH: LEGACY, localStorage: storage, state: { receipts: [], receiptIndex: 0 }, receiptIdentityKey: () => null, sendInFlight: false, setScene: (...a) => scenes.push(a), readSendPending: () => { touched.push(["readSendPending"]); return null; }, readReceipts: () => { readCalls += 1; return [{ x: 1 }]; }, computeTripClosed: () => { readCalls += 1; return true; } });
  vm.runInContext(`${fnSrc(MAIN, "rememberReceipt")}\n${fnSrc(MAIN, "sendPiggy")}`, ctx);
  assert.equal(vm.runInContext(`rememberReceipt({ txHash: "0x" + "1".repeat(64) })`, ctx), true);
  await vm.runInContext("sendPiggy()", ctx);
  assert.deepEqual(scenes, [["sendstay", "Piggy can't go out yet.", ""]]);
  // the state-init lines for receipts / mark / txHash, evaluated as written
  for (const line of MAIN.split("\n").filter((l) => /^  (receipts|mark|txHash): LEGACY_TESTNET_PATH \?/.test(l))) vm.runInContext(`(${line.trim().replace(/,$/, "").replace(/^[a-zA-Z]+: /, "")})`, ctx);
  assert.deepEqual(touched, []); assert.equal(readCalls, 0);
});

// ── 7 seams ──
await check("fork id literals equal FORK_CHAIN_ID everywhere (money-executor · gift-sponsor-7702 · receipt-evidence-second · api runtime)", async () => {
  assert.equal(FORK_CHAIN_ID, 31337143);
  assert.equal(SIGN_GUARD_FORK_CHAIN_ID, FORK_CHAIN_ID);
  assert.ok(GIFT_SPONSOR_CHAINS.includes(FORK_CHAIN_ID));
  assert.match(src("app/src/receipt-evidence-second.js"), /"monad-fork": "31337143"/);
  assert.match(src("api/_lib/gift-sponsor-runtime.js"), /export const GIFT_SPONSOR_FORK_CHAIN_ID = 31337143;/);
  assert.equal(scopeForChainId(FORK_CHAIN_ID), FORK_SCOPE); assert.equal(scopeForChainId(143), "monad-mainnet"); assert.equal(scopeForChainId(10143), "monad-testnet");
});
await check("asset identity: fork USDC registered under the fork scope only (143 entry unchanged)", () => {
  assert.deepEqual(Object.keys(FUNDING_CONTEXT_TOKEN_ALLOWLIST).sort(), ["monad-fork", "monad-mainnet", "monad-testnet"]);
  assert.equal(FUNDING_CONTEXT_TOKEN_ALLOWLIST["monad-mainnet"].USDC.assetId, "0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
  assert.notEqual(FUNDING_CONTEXT_TOKEN_ALLOWLIST["monad-fork"], FUNDING_CONTEXT_TOKEN_ALLOWLIST["monad-mainnet"]);
});
const tx = (chainId, extra = {}) => ({ chainId, type: "eip1559", to: "0x" + "b".repeat(40), data: "0x", nonce: 0, gas: 21000n, maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 1n, value: 0n, ...extra });
await check("SIGN_GUARD: plain tx on testnet and on the fork id pass; plain tx on 143 still refused; other ids refused; SIGN_GUARD object unchanged", () => {
  assert.equal(preparedSignProblem(tx(10143)), null);
  assert.equal(preparedSignProblem(tx(FORK_CHAIN_ID)), null);
  assert.equal(preparedSignProblem(tx(143)), "chain_id_mismatch");
  for (const id of [1, 31337, 0, "31337143", 31337144]) assert.equal(preparedSignProblem(tx(id)), "chain_id_mismatch", String(id));
  assert.deepEqual({ ...SIGN_GUARD }, { chainId: 10143, type: "eip1559", maxGas: 2_000_000n, maxFeePerGas: 1_000_000_000_000n, maxTxFeeWei: 100_000_000_000_000_000n });
  assert.equal(SIGN_GUARD_SPONSOR_CHAIN_ID, 143);
});
await check("SIGN_GUARD on the fork keeps every other refusal (fee caps, forbidden fields, authorizationList without brand)", () => {
  assert.equal(preparedSignProblem(tx(FORK_CHAIN_ID, { gas: 3_000_000n })), "gas_out_of_bounds");
  assert.equal(preparedSignProblem(tx(FORK_CHAIN_ID, { gasPrice: 1n })), "unexpected_field");
  assert.equal(preparedSignProblem(tx(FORK_CHAIN_ID, { authorizationList: [] })), "authorization_list_present");
  assert.equal(preparedSignProblem(tx(FORK_CHAIN_ID, { type: "eip7702", authorizationList: [{ chainId: FORK_CHAIN_ID }] })), "tx_type_unexpected");
});
await check("Gift create gas deposit: fork id accepted, 143 / 10143 unchanged, others refused", () => {
  const budget = { status: GIFT_GAS_BUDGET_STATUS.ESTIMATE, costWei: 7n, gasUnitsByStep: Object.fromEntries(GIFT_SPONSOR_GAS_STEPS.map((k) => [k, 1n])) };
  const S = "0x" + "c".repeat(40);
  for (const id of [143, 10143, FORK_CHAIN_ID]) {
    const r = planGiftGasDeposit({ gasBudget: budget, sponsorAddress: S, chainId: id });
    assert.equal(r.ok, true, `${id}: ${r.reason}`); assert.equal(r.deposit.chainId, id); assert.equal(r.deposit.value, 7n);
  }
  for (const id of [1, 31337, 0, 143143]) assert.equal(planGiftGasDeposit({ gasBudget: budget, sponsorAddress: S, chainId: id }).reason, "sponsor_chain_invalid", String(id));
});
await check("api: fork Gift policy is a separate object with the fork id; 143 runtime function text unchanged vs the pre-fork baseline (de8c9c8, sha256)", async () => {
  const m = await import(path.join(REPO, "api/_lib/gift-sponsor-runtime.js"));
  assert.equal(m.giftSponsorForkChainDef("https://fork-admin.invalid").id, FORK_CHAIN_ID);
  assert.deepEqual(Object.keys(m.GIFT_SPONSOR_FORK_PINS.hashes), [String(FORK_CHAIN_ID)]);
  const now = src("api/_lib/gift-sponsor-runtime.js");
  const fork = now.indexOf("// ── [A-946] Shared mainnet fork");
  assert.ok(fork > 0);
  // [A-983 re-pin] HEAD text → its sha256 at de8c9c8 (same text, same trim). pre-A-983: if (head !== null) assert.equal(now.slice(0, fork).replace(/\n+$/, ""), head.replace(/\n+$/, ""), …) with head = git show HEAD:api/_lib/gift-sponsor-runtime.js
  assert.equal(sha(now.slice(0, fork).replace(/\n+$/, "")), BASE_RT143_SHA256, "(e) everything before the fork block matches the accepted Gift baseline");
});

// ── (e) 143 Gift path, (f) session, (g) passkey keys ──
await check("(e) 143 Gift client paths unchanged: SIGN_GUARD_SPONSOR_CHAIN_ID 143 + the create-step 143 match line untouched", () => {
  const me = src("app/src/money-executor.js");
  assert.match(me, /const createStep = !sponsorList && prepared\.chainId === SIGN_GUARD_SPONSOR_CHAIN_ID \? giftCreateStepMatch\(prepared\) : null;/);
  assert.match(me, /!\(sponsorList && prepared\.chainId === SIGN_GUARD_SPONSOR_CHAIN_ID\)/);
  assert.match(src("app/src/gift-create-plan.js"), /^export const GIFT_CREATE_CHAIN_ID = 143;$/m);
});
await check("(e) Gift client paths vs the pre-fork baseline (de8c9c8): every function in gift-sponsor-7702 / gift-create-plan / money-executor is byte-identical, except the one chain line in planGiftGasDeposit and preparedSignProblem (sha256 recorded)", () => {
  const changed = { "app/src/gift-create-plan.js": { planGiftGasDeposit: ['  if (chainId !== 143 && chainId !== 10143) return { ok: false, reason: "sponsor_chain_invalid" };', /^  if \(chainId !== 143 && chainId !== 10143 && chainId !== FORK_CHAIN_ID\) return \{ ok: false, reason: "sponsor_chain_invalid" \}; \/\/ \[A-946\][^\n]*$/m] },
    "app/src/money-executor.js": { preparedSignProblem: ['    if (prepared.chainId !== SIGN_GUARD.chainId && !(sponsorList && prepared.chainId === SIGN_GUARD_SPONSOR_CHAIN_ID) && !createStep) return "chain_id_mismatch";', /^    if \(prepared\.chainId !== SIGN_GUARD\.chainId && prepared\.chainId !== SIGN_GUARD_FORK_CHAIN_ID && [^\n]*$/m] },
    "app/src/gift-sponsor-7702.js": {} };
  const out = [];
  for (const [f, allow] of Object.entries(changed)) {
    // [A-983 re-pin] HEAD function text → its per-function sha256 at de8c9c8 (BASE_GIFT_FNS). pre-A-983: const head = gitHead(f); if (head === null) skip;
    const base = BASE_GIFT_FNS[f];
    // [A-966 re-pin] the fork Gift create lines (tag [gift-fork]: fork arm path + fork link path + the new forkClaimUrl helper) are undone first;
    // every other function must still equal HEAD byte for byte. pre-A-966: const now = src(f);
    const now = f === "app/src/gift-create-plan.js" ? undoGiftForkCreate(src(f)) : src(f);
    assert.deepEqual(fnNames(now), base.map(([n]) => n), `${f}: same functions`); // pre-A-983: fnNames(head)
    for (const [n, baseSha] of base) {
      let a = fnSrc(now, n);
      if (allow[n]) { assert.match(a, allow[n][1], `${f} ${n}: the A-946 line`); a = a.replace(allow[n][1], allow[n][0]); }
      assert.equal(sha(a), baseSha, `${f} ${n}`); // pre-A-983: assert.equal(a, fnSrc(head, n))
      out.push(`${f}#${n} ${baseSha.slice(0, 12)}`);
    }
  }
  assert.ok(out.length > 20);
});
await check("A-897 promotion runs on Monad mainnet only (fork / any other scope never)", () => {
  assert.equal(PROMOTION_TARGET_SCOPE, "monad-mainnet");
  assert.match(MAIN, /const A897_TARGET_SCOPE = PROMOTION_TARGET_SCOPE;[^\n]*\nfunction a897TargetScopeActive\(\) \{\n[^\n]*\n  return RUNTIME_CHAIN_SCOPE === A897_TARGET_SCOPE;\n\}/);
  const decl = MAIN.match(/^const A897_TARGET_SCOPE = PROMOTION_TARGET_SCOPE;[^\n]*$/m)[0];
  const run = (scope) => vm.runInContext(`${decl}\n${fnSrc(MAIN, "a897TargetScopeActive")}\na897TargetScopeActive()`, vm.createContext({ RUNTIME_CHAIN_SCOPE: scope, PROMOTION_TARGET_SCOPE }));
  for (const [scope, want] of [[FORK_SCOPE, false], ["monad-testnet", false], ["", false], [undefined, false], ["monad-mainnet", true]]) assert.equal(run(scope), want, String(scope));
});
await check("(f) moving between \"/\" and \"/j2\" is a page load: boot selection holds no state, and the signing session is memory-only (never stored)", () => {
  const bp = src("app/src/boot-profile.js").replace(/\/\/[^\n]*/g, "");
  assert.equal(/\b(let|var)\s/.test(bp), false, "boot-profile.js keeps no mutable module state");
  // [A-948 RE-PIN] boot-profile.js now READS the stored journey (getItem only); it still writes nothing. pre-A-948: no storage word at all
  assert.equal(/setItem|removeItem|clear\(|sessionStorage|indexedDB/.test(bp), false, "boot-profile.js writes no storage");
  const seq = ["/", "/j2", "/", "/j2"].map((pathname) => selectBootProfile({ pathname, env: { ...FORK_ENV }, releaseLevel: 2 }).id);
  assert.deepEqual(seq, ["monad-testnet", "monad-fork", "monad-testnet", "monad-fork"], "each page load decides alone");
  // (a browser walk from "/" to "/j2" is not run here: full page loads are the browser's; this pins that nothing in the app carries a session across them)
  assert.match(MAIN, /^let activeSession = null;$/m);
  assert.equal(/(localStorage|sessionStorage)\.setItem\([^)]*(activeSession|prfOutput|privateKey)/.test(MAIN), false);
  assert.equal(/sessionStorage\.setItem\([^)]*(activeSession|prfOutput|privateKey|activeAccount)/.test(MAIN), false);
});
await check("(g) passkey credential + PRF salt storage keys unchanged (araso.passkey · araso.prfSalt read paths = pre-fork baseline de8c9c8)", () => {
  assert.match(MAIN, /^const PASSKEY_STORAGE_KEY = "araso\.passkey";$/m);
  const lines = (t) => t.split("\n").filter((l) => /araso\.passkey|araso\.prfSalt|PASSKEY_STORAGE_KEY/.test(l));
  // [A-983 re-pin] HEAD lines → sha256 of the same lines at de8c9c8. pre-A-983: if (head !== null) assert.deepEqual(lines(MAIN), lines(head)) with head = git show HEAD:app/src/main.js
  assert.equal(sha(lines(MAIN).join("\n")), BASE_CREDENTIAL_LINES_SHA256);
});
await check("vercel.json: /gift has its OG entry page; /claim and /j2 stay routed", () => {
  const v = JSON.parse(src("vercel.json"));
  assert.deepEqual(v.rewrites, [{ source: "/gift", destination: "/gift.html" }, { source: "/claim", destination: "/index.html" }, { source: "/j2", destination: "/index.html" }]);
  assert.equal(v.buildCommand, "npm run build");
});
await check("no fork RPC value / admin URL in shipped source (build env only)", () => {
  for (const f of ["app/src/chain-profile.js", "app/src/boot-profile.js", "app/src/main.js", "app/src/funding-context.js"]) assert.equal(/fork[^\n]{0,40}https:\/\//i.test(src(f).replace(/\/\/[^\n]*/g, "")), false, f);
});
await check("network 0", () => { assert.equal(netCalls, 0); });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
