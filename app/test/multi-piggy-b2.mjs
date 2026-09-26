// [A-522 Stream B2a] MY PIGGIES 색인 읽기 + 다중 Piggy 투영 + `+ Piggy` 탭 — 네트워크 0 · 실제 Face ID 0.
//   node app/test/multi-piggy-b2.mjs
//
// main.js 의 A-522 구간을 **실제 소스 그대로** 잘라 node:vm 에서 돌린다(h-multi-piggy-reopen.mjs 와 같은 방식).
// 의존성(색인·레지스트리 모듈)은 진짜 모듈을 넣고, 부수효과(setScene 등)는 기록만 하는 대역을 넣는다.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { admitModelAPiggy, admitSequencedPiggy, loadMyPiggiesIndex, myPiggiesIndexKey, registerControlledPiggy, renameIndexedPiggy } from "../src/piggy-index.js";
import { createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry } from "../src/piggy-registry.js";
import { createMemoryStorage } from "../src/second-journey-state.js";
import { homePaperMarkup, residentCardsMarkup } from "../src/home-paper.js";
import { switchSelection, authRequestForPiggy, bindSigner } from "../src/piggy-session.js";

const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CHAIN = "monad-testnet";
const HONEY = "0x00000000000000000000000000000000000000c3";
const MOCHI = "0x00000000000000000000000000000000000000d4";
const AT = "2026-09-22T05:00:00.000Z";

const start = MAIN.indexOf("// [A-522 B2a] MY PIGGIES 색인 = **제품 읽기 원천**");
const end = MAIN.indexOf("function homePadMarkup(scene) {");
assert.ok(start > 0 && end > start, "A-522 구간 마커");
const SLICE = MAIN.slice(start, end);

function openApp(storage, { address = HONEY, secondClosed = false, registryPiggies = [] } = {}) {
  const calls = { setScene: [], session: 0, permission: 0 };
  const state = { address, secondJourneyCompletedOnce: secondClosed, addPiggy: null, pendingNamePiggyId: null };
  const ctx = {
    state, console, Map, String, Array, Date,
    loadMyPiggiesIndex, registerControlledPiggy, normalizePiggy, projectRegistryTotals,
    // [A-531] 모델 A 흐름이 쓰는 진짜 모듈들 — 인증/세션만 대역
    admitModelAPiggy, loadRegistry, createPiggy, saveRegistry, migrateSinglePiggy,
    readCredential: () => null, requestPrf: async () => { throw new Error("no auth in this test"); },
    endActiveSession: () => {}, globalThis: {},
    safeLocalStorage: () => storage,
    secondJourneyScope: () => ({ accountId: state.address, chainId: CHAIN }),
    secondPiggyRegistrySnapshot: () => ({ piggies: registryPiggies, totals: projectRegistryTotals({ piggies: registryPiggies }) }),
    setScene: (...a) => calls.setScene.push(a),
    // 이 구간이 부르면 안 되는 것들 — 불리면 센다
    activateSigningSession: () => { calls.session += 1; },
    issuePermission: () => { calls.permission += 1; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${SLICE}\nthis.api = { indexedResidents, moneyPiggiesSnapshot, homeResidents, showAddPiggyTab, beginAddPiggy, admitAddedPiggy };`, ctx);
  // vm realm 의 배열/객체를 이쪽 realm 값으로 복제 — deepStrictEqual 이 prototype 을 비교하므로.
  const J = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const wrap = (fn) => (...args) => { const r = fn(...args); return r && typeof r.then === "function" ? r.then(J) : J(r); };
  const api = Object.fromEntries(Object.entries(ctx.api).map(([k, fn]) => [k, wrap(fn)]));
  return { ...api, state, calls };
}

const seed = (storage) => {
  registerControlledPiggy(storage, CHAIN, { id: `legacy-${HONEY}`, name: "Honeybun", address: HONEY, signerAddress: HONEY, locator: { credentialId: "aG9uZXk" }, at: AT });
  registerControlledPiggy(storage, CHAIN, { id: `piggy-${MOCHI}`, name: "Mochi", address: MOCHI, signerAddress: MOCHI, locator: { credentialId: "bW9jaGk", prfSalt: "07".repeat(32) }, at: AT });
};

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

await check("1. index load shows 2+ controlled identities with no authority side effects", () => {
  const s = createMemoryStorage(); seed(s);
  const app = openApp(s);
  const snap = app.moneyPiggiesSnapshot();
  assert.deepEqual(snap.piggies.map((p) => p.name), ["Honeybun", "Mochi"]);
  assert.equal(snap.piggies.every((p) => p.valuation === null), true);   // 돈은 색인에서 오지 않는다 = 모름
  assert.equal(snap.totals.totalUsd, null);                               // 가짜 $0 합계 0
  assert.deepEqual([app.calls.session, app.calls.permission, app.calls.setScene.length], [0, 0, 0]);
  const residents = app.homeResidents("still in home");
  assert.deepEqual(residents.map((r) => [r.name, r.label]), [["Honeybun", "still in home"], ["Mochi", ""]]); // 상태를 지어내지 않는다
});

await check("2. corrupt / unproven rows never surface as owned", () => {
  const key = myPiggiesIndexKey(CHAIN);
  const s = createMemoryStorage({ [key]: JSON.stringify({ version: 1, chainId: CHAIN, piggies: [
    { id: "x", address: MOCHI, locator: { credentialId: "bW9jaGk" }, createdAt: AT },                       // 증명 없음
    { id: "y", address: HONEY, locator: { credentialId: "aG9uZXk" }, createdAt: AT, lastControlProofAt: AT, assets: [] }, // 금융 필드
  ] }) });
  const app = openApp(s);
  assert.equal(app.indexedResidents().length, 0);
  assert.equal(app.homeResidents("still in home"), null);
  assert.equal(openApp(createMemoryStorage({ [key]: "{bad" })).indexedResidents().length, 0);
});

await check("3. switching selection invalidates the stale signer / permission (Gate C path reused)", () => {
  const s = createMemoryStorage(); seed(s);
  const [honey, mochi] = openApp(s).moneyPiggiesSnapshot().piggies;
  const held = { nonce: "honey-envelope" };
  const first = switchSelection(null, honey);
  const out = switchSelection(first.selection, mochi, { heldEnvelope: held });
  assert.equal(out.invalidate, true);
  assert.equal(out.revokeNonce, "honey-envelope");
  // main.js 는 행 선택을 이 병합 목록 + applyPiggySelection 으로 한다
  assert.match(MAIN, /applyPiggySelection\(moneyPiggiesSnapshot\(\)\.piggies\.find/);
});

await check("4. reopening an indexed Piggy uses that row's locator and binds signer == address", () => {
  const s = createMemoryStorage(); seed(s);
  const mochi = openApp(s).moneyPiggiesSnapshot().piggies[1];
  const req = authRequestForPiggy(mochi).request;
  assert.equal(req.credential.credentialId, "bW9jaGk");
  assert.equal(req.prfSalt.length, 32);
  const sel = switchSelection(null, mochi).selection;
  assert.equal(bindSigner(sel, HONEY).reason, "signer_mismatch");
  assert.equal(bindSigner(sel, MOCHI).ok, true);
  assert.match(MAIN, /return moneyPiggiesSnapshot\(\)\.piggies\.find\(\(p\) => p\.id === sel\.id\)/); // selectedRegistryPiggy
});

// [A-540] `+ Piggy` 탭은 더 이상 home-paper.js 의 정적 markup 이 만들지 않는다 —
// home-peek.js(mountPlusPiggyTab)/home-paper-multi.js(mountResidentPaper) 가 렌더 뒤
// DOM 에 직접 붙인다. showAddPiggyTab() 의 product 게이트 자체는 그대로(main.js 가 mount
// 후 그 탭 DOM 을 떼는 데 그대로 쓴다, §mountHomeResidentModule) — 여기서는 그 함수 계약과,
// 마크업 쪽에서 옛 addPiggy 껍데기가 완전히 사라졌음을 확인한다.
await check("5. showAddPiggyTab() gate is unchanged; homePaperMarkup never emits the retired addPiggy shell", () => {
  const s = createMemoryStorage();
  assert.equal(openApp(s, { secondClosed: false }).showAddPiggyTab("sendstay", "home"), false);
  const after = openApp(s, { secondClosed: true });
  assert.equal(after.showAddPiggyTab("sendstay", "home"), true);
  assert.equal(after.showAddPiggyTab("sendstay", "money"), false);
  assert.equal(after.showAddPiggyTab("away", "home"), false);
  const first = homePaperMarkup({ name: "Honeybun", label: "still in home" });
  assert.equal(first.includes("homeAddPiggy"), false);
  assert.equal(first.includes("homePaper__addPiggy"), false);   // retired A-522/A-533 shell class, entirely
  const multi = homePaperMarkup({ residents: [{ id: "a", name: "Honeybun", label: "" }, { id: "b", name: "Mochi", label: "" }] });
  assert.equal(multi.includes("homeAddPiggy"), false);
  assert.equal(multi.includes("homePaper__addPiggy"), false);
});

// [A-540 cleanup boundary] Paper 목록에는 무대 max3 상한을 빌려오지 않는다 — indexedResidents()
// 가 준 모든 행을 그대로 카드로 찍는다. compact 납작 카드(A-533)도 완전히 사라졌어야 한다.
await check("6. residentCardsMarkup renders every resident uncapped, each with its own data-piggy-id, and no compact leftovers", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Piggy${i}`, label: i === 0 ? "still in home" : "" }));
  const html = residentCardsMarkup({ residents: eight });
  const cardCount = (html.match(/homePaper__card--piggy/g) || []).length;
  assert.equal(cardCount, 8, "all 8 residents render — no RESIDENTS_VISIBLE_MAX(3) cap");
  for (const r of eight) {
    assert.match(html, new RegExp(`data-piggy-id="${r.id}"`), `card ${r.id} carries its own data-piggy-id`);
  }
  assert.equal(html.includes("homePaper__card--compact"), false, "no compact card class");
  assert.equal(html.includes("homeAddPiggy"), false, "tab markup retired — module mounts it now");
  // cards render in the exact index order given (A-540 parent decision 4: stable index order).
  const order = eight.map((r) => html.indexOf(`data-piggy-id="${r.id}"`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

// [A-531] 이력: A-522 의 #7 은 "주입된 결과(주소·서명자)" 를 admitAddedPiggy 에 넣었다. A-531 에서 입장은
// admitModelAPiggy(통제 증명 + 순번) 가 하고, admitAddedPiggy 는 **이미 입장한** 색인 행만 받아 $0 투영 + Name it 으로 보낸다.
await check("7. an index-admitted additional Piggy → $0 birth projection → Name it → Save → index name/order → Home projection", async () => {
  const s = createMemoryStorage();
  registerControlledPiggy(s, CHAIN, { id: `legacy-${HONEY}`, name: "Honeybun", address: HONEY, signerAddress: HONEY, locator: { credentialId: "aG9uZXk" }, at: AT });
  const app = openApp(s, { secondClosed: true });
  assert.equal(app.admitAddedPiggy(null).started, false);          // 입장 안 된 것은 Name it 으로 못 간다
  assert.equal(app.calls.setScene.length, 0);
  // [A-579 Lane B] 순번 행은 admitSequencedPiggy(유일한 입장 경로 — salt = modelASalt(n) 을 스스로 계산)로만 들어간다.
  const admitted = await admitSequencedPiggy({ storage: s, chainId: CHAIN, sequence: 1, rootCredential: { credentialId: "aG9uZXk" }, requestPrf: async (c) => ({ credentialId: c.credentialId, prfOutput: new Uint8Array(32) }), deriveAddress: () => MOCHI, now: () => AT });
  assert.equal(admitted.ok, true);
  const ok = app.admitAddedPiggy(admitted.piggy);
  assert.equal(ok.started, true);
  assert.equal(ok.projected, true);                                // $0 탄생 투영 저장됨
  assert.equal(app.state.pendingNamePiggyId, `piggy-${MOCHI}`);
  assert.deepEqual(app.calls.setScene[0].slice(0, 1), ["name"]);  // Hatch 가 아니라 Name it
  renameIndexedPiggy(s, CHAIN, { id: app.state.pendingNamePiggyId, name: "Mochi" });
  const reopened = openApp(createMemoryStorage(s.dump()), { secondClosed: true });
  assert.deepEqual(reopened.homeResidents("still in home").map((r) => r.name), ["Honeybun", "Mochi"]);
  // 레지스트리 투영이 붙었으므로 새 Piggy 는 **알려진 $0** — 첫 Piggy 는 여전히 모름(돈을 지어내지 않음)
  const reg = loadRegistry(createMemoryStorage(s.dump()), { accountId: HONEY, chainId: CHAIN }).registry.piggies;
  assert.equal(reg.find((p) => p.id === `piggy-${MOCHI}`).valuation.usd, "0");
  assert.equal(reg.find((p) => p.id === `legacy-${HONEY.toLowerCase()}`).valuation, null);
  const save = MAIN.slice(MAIN.indexOf("function savePiggyName("), MAIN.indexOf("// 「이름 저장 완료」= 이 한 줄."));
  assert.match(save, /if \(state\.pendingNamePiggyId\) \{/);
  assert.match(save, /renameIndexedPiggy\(safeLocalStorage\(\), secondJourneyScope\(\)\.chainId, \{ id, name \}\)/);
  const saveCode = save.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal(saveCode.includes("PIGGY_NAME_KEY"), false);        // 첫 Piggy 이름을 건드리지 않는다(주석 제외 코드)
});

await check("8. the additional-Piggy path never replays Hatch / Birth", () => {
  assert.equal(SLICE.includes('setScene("hatch"'), false);
  const save = MAIN.slice(MAIN.indexOf("if (state.pendingNamePiggyId) {"), MAIN.indexOf("// 「이름 저장 완료」= 이 한 줄."));
  assert.match(save, /setScene\("sendstay", "", ""\)/);
  assert.equal(/hatch|BIRTH_PLAYED_KEY/.test(save), false);
});

// [A-531] 이력: A-522 의 #9 는 "제공자 = null · credential_model_required" 를 단언했다. 모델 A 결정(A-528) 뒤 제공자가 연결됐다.
await check("9. the + Piggy path never creates a passkey and fails closed without a pinned root credential or lock", async () => {
  const code = SLICE.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const banned of ["createPasskeyWithPrfOutput", "openPiggy(", "requestPrf(null"]) {
    assert.equal(code.includes(banned), false, `+Piggy slice must not call ${banned}`);
  }
  assert.match(code, /requestPrf\(credential, \{ prfSalt \}\)/);           // 고정 credential + 파생 salt 만
  const noRoot = openApp(createMemoryStorage(), { secondClosed: true });
  const out = await noRoot.beginAddPiggy();
  assert.equal(out.reason, "missing_root_credential");
  assert.deepEqual([noRoot.calls.session, noRoot.calls.setScene.length], [0, 0]);
  const notYet = openApp(createMemoryStorage(), { secondClosed: false });
  assert.equal((await notYet.beginAddPiggy()).reason, "second_journey_not_closed");
  // 루트는 있는데 Web Locks 가 없으면 → lock_unsupported (동시성 안전을 조용히 주장하지 않는다)
  const s = createMemoryStorage();
  registerControlledPiggy(s, CHAIN, { id: `legacy-${HONEY}`, name: "Honeybun", address: HONEY, signerAddress: HONEY, locator: { credentialId: "aG9uZXk" }, at: AT });
  const noLock = openApp(s, { secondClosed: true });
  assert.equal((await noLock.beginAddPiggy()).reason, "lock_unsupported");
  assert.equal(loadMyPiggiesIndex(s, CHAIN).index.piggies.length, 1);   // 줄 0 추가
});

console.log(`\n${pass}/${pass} PASS`);
