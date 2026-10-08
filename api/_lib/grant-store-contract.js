// [A-870] Provider-neutral durable grant store contract + conformance harness.
// 벤더 선택·연결·env·키·네트워크 없음. api/grant.js 는 건드리지 않는다(A-792 reserve/settle 모양과 호환되는 상위집합).
//
// 호환: A-792 의 GRANT_STORE_CONTRACT("araso.grant-store/v1") reserve({identity, globalCap}) / settle(...) 그대로 위에
//   - epoch  (명시적 test epoch. 주소당 1회 / epoch 당 1회. 자동 TTL 재지급 없음. 다음 epoch 는 operator 가 명시적으로 연다)
//   - release / reconcile (선택이 아니라 이 계약의 필수 — 아래 규칙)
// 를 더한다. 기존 v1 호출(epoch 없음)은 DEFAULT_EPOCH 한 칸으로 취급 = 기존 의미 그대로.
//
// 규칙(Owner TECHNICAL OWNER ANSWERS II §1):
//   1. reserve 는 (중복 판정 + cap 판정 + 삽입) 단일 원자 연산. 인스턴스 간(cross-instance)에도 성립해야 한다.
//   2. cap 은 epoch 별. 기본 cap = 그 epoch allowlist 의 유효 엔트리 수(defaultGlobalCap). 임의 숫자 금지.
//   3. 예약은 해제되지 않는 한 cap 에 센다. settle 은 기록 전용이며 슬롯을 풀지 않는다.
//   4. release 는 **마지막 settle outcome 이 aborted_before_send 이고 송출 증거(txHash/broadcast/nonce)가 없을 때만** 가능.
//      broadcast 시도 · nonce 소비 · UNKNOWN(send_failed/unconfirmed/reverted/confirmed/미settle) 은 자동 release 금지.
//      그 경우의 유일한 길 = reconcile(증거로 outcome 을 확정 기록) 또는 operator rearm(새 epoch).
//   5. in-memory / no-store fallback 금지(production). 이 파일의 synthetic adapter 는 testOnly 이다.

export const GRANT_STORE_CONTRACT_V1 = "araso.grant-store/v1";
export const DEFAULT_EPOCH = "default";

export const GRANT_SETTLE_OUTCOMES = Object.freeze([
  "aborted_before_send",
  "send_failed",
  "reverted",
  "unconfirmed",
  "confirmed",
]);

/** release 가 허용되는 유일한 outcome. */
export const RELEASABLE_OUTCOMES = Object.freeze(["aborted_before_send"]);

export const RESERVE_REASONS = Object.freeze(["duplicate", "cap_reached"]);
export const RELEASE_REASONS = Object.freeze(["not_found", "not_aborted_before_send", "broadcast_evidence", "unknown_state"]);

const IDENTITY_RE = /^0x[0-9a-f]{40}$/;
const EPOCH_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export function isValidIdentity(x) { return typeof x === "string" && IDENTITY_RE.test(x); }
export function isValidEpoch(x) { return typeof x === "string" && EPOCH_RE.test(x); }

/** 기본 cap = allowlist 유효 엔트리 수(소문자 0x+40hex, 중복 제거). 잘못된 항목 하나라도 있으면 null(fail-closed). 빈 목록 → 0(= 전원 거부). */
export function defaultGlobalCap(allowlist) {
  if (!Array.isArray(allowlist)) return null;
  const set = new Set();
  for (const a of allowlist) {
    if (typeof a !== "string") return null;
    const l = a.toLowerCase();
    if (!IDENTITY_RE.test(l)) return null;
    set.add(l);
  }
  return set.size;
}

/** 요청 정규화. 잘못되면 null. globalCap 은 정수 >= 1(A-792 와 동일). epoch 생략 = DEFAULT_EPOCH. */
export function normalizeReserveRequest(req) {
  if (!req || typeof req !== "object") return null;
  const epoch = req.epoch === undefined ? DEFAULT_EPOCH : req.epoch;
  if (!isValidIdentity(req.identity) || !isValidEpoch(epoch)) return null;
  if (!Number.isSafeInteger(req.globalCap) || req.globalCap < 1) return null;
  return { identity: req.identity, epoch, globalCap: req.globalCap };
}

/** 구현체가 가져야 할 모양. contract 값 + reserve/settle/release/reconcile. */
export function isGrantStore(store) {
  return !!store && store.contract === GRANT_STORE_CONTRACT_V1 &&
    ["reserve", "settle", "release", "reconcile"].every((m) => typeof store[m] === "function");
}

/** 송출 증거가 있는 settle 인가(release 불가 판단용). */
export function hasBroadcastEvidence(rec) {
  return !!rec && (rec.broadcast === true || rec.nonceConsumed === true || (typeof rec.txHash === "string" && rec.txHash !== ""));
}

/** release/reconcile 판정 순수 함수 — 어떤 adapter 든 같은 규칙을 쓰라고 export. */
export function decideRelease(rec) {
  if (!rec) return { ok: false, reason: "not_found" };
  if (rec.outcome == null) return { ok: false, reason: "unknown_state" };       // 미settle = UNKNOWN
  if (hasBroadcastEvidence(rec)) return { ok: false, reason: "broadcast_evidence" };
  if (!RELEASABLE_OUTCOMES.includes(rec.outcome)) return { ok: false, reason: "not_aborted_before_send" };
  return { ok: true };
}

/** 요청에 증거가 실렸는가. */
export function requestHasEvidence(req) {
  return !!req && (req.broadcast === true || req.nonceConsumed === true || (typeof req.txHash === "string" && req.txHash !== ""));
}

/** settle/reconcile 판정 순수 함수 — provider 공통 규칙. outcome 은 write-once/단조.
 *  - 행 없음/예약ID 불일치 → not_found · released 행 → released · outcome 값이 아니면 invalid_outcome
 *  - 같은 outcome 재기록은 멱등(증거만 덧붙는다)
 *  - 첫 기록(미settle)은 settle 이 가능. reconcile 은 증거가 있어야 한다.
 *  - 다른 outcome 으로 바꾸기: reconcile + 요청에 증거 있어야 하고, aborted_before_send 로는 절대 못 간다. settle 은 불가(write_once). */
export function decideSettle(rec, req) {
  if (!rec) return { ok: false, reason: "not_found" };
  if (rec.released) return { ok: false, reason: "released" };
  if (!req || !GRANT_SETTLE_OUTCOMES.includes(req.outcome)) return { ok: false, reason: "invalid_outcome" };
  const ev = requestHasEvidence(req);
  if (rec.outcome === req.outcome) return { ok: true };
  if (rec.outcome == null) return req.kind === "reconcile" && !ev ? { ok: false, reason: "evidence_required" } : { ok: true };
  if (req.kind !== "reconcile") return { ok: false, reason: "write_once" };
  if (req.outcome === "aborted_before_send") return { ok: false, reason: "never_to_aborted" };
  if (!ev) return { ok: false, reason: "evidence_required" };
  return { ok: true };
}

// ---- synthetic adapter (TEST ONLY) ---------------------------------------------------------------
/** 공유 "원격" 상태 하나 + 여러 인스턴스. 각 호출은 await 로 양보하고, 원격 CAS(`remote.atomic`)만이 원자 구간을 만든다.
 *  원격 쪽 직렬화(promise chain)는 durable store 의 서버측 트랜잭션/CAS 를 모사한다. 로컬 상태는 인스턴스에 두지 않는다. */
export function createSyntheticRemote() {
  const rows = new Map(); // `${epoch}\u0000${identity}` -> record
  let tail = Promise.resolve();
  let seq = 0;
  return {
    rows,
    nextId: () => `r${++seq}`,
    atomic(fn) {
      const run = tail.then(() => fn(rows));
      tail = run.catch(() => {});
      return run;
    },
  };
}

export function createSyntheticStoreInstance(remote, { yieldMs = 0 } = {}) {
  const key = (e, i) => `${e}\u0000${i}`;
  const apply = async (kind, { identity, epoch = DEFAULT_EPOCH, reservationId, outcome, txHash, broadcast, nonceConsumed }) => {
    await hop();
    return remote.atomic((rows) => {
      const r = rows.get(key(epoch, identity));
      const ev = { txHash, broadcast, nonceConsumed };
      const d = decideSettle(r && r.reservationId === reservationId ? r : null, { kind, outcome, ...ev });
      if (!d.ok) throw new Error(`${kind} refused: ${d.reason}`);
      r.outcome = outcome; // released 는 건드리지 않는다
      if (txHash) r.txHash = txHash;
      if (broadcast) r.broadcast = true;
      if (nonceConsumed) r.nonceConsumed = true;
    });
  };
  const hop = () => new Promise((r) => setTimeout(r, yieldMs));
  const countEpoch = (rows, epoch) => { let n = 0; for (const r of rows.values()) if (r.epoch === epoch && !r.released) n++; return n; };
  return {
    contract: GRANT_STORE_CONTRACT_V1,
    testOnly: true,
    async reserve(req) {
      const n = normalizeReserveRequest(req);
      if (!n) throw new Error("invalid reserve request"); // 판정 불가 = 예외(핸들러 503)
      await hop();
      return remote.atomic((rows) => {
        const k = key(n.epoch, n.identity);
        const ex = rows.get(k);
        if (ex && !ex.released) return { ok: false, reason: "duplicate" };
        if (ex && ex.released) return { ok: false, reason: "duplicate" }; // epoch 당 1회: release 후에도 같은 epoch 재예약 불가(다음 epoch 만)
        if (countEpoch(rows, n.epoch) >= n.globalCap) return { ok: false, reason: "cap_reached" };
        const reservationId = remote.nextId();
        rows.set(k, { epoch: n.epoch, identity: n.identity, reservationId, outcome: null, released: false });
        return { ok: true, reservationId };
      });
    },
    async settle(req) { return apply("settle", req); },
    /** operator/증명 경로 전용. decideRelease 가 허용할 때만. 실패해도 슬롯은 그대로. */
    async release({ identity, epoch = DEFAULT_EPOCH, reservationId }) {
      await hop();
      return remote.atomic((rows) => {
        const r = rows.get(key(epoch, identity));
        if (!r || r.reservationId !== reservationId) return { ok: false, reason: "not_found" };
        const d = decideRelease(r);
        if (!d.ok) return d;
        r.released = true;
        return { ok: true };
      });
    },
    /** UNKNOWN 행에 증거로 outcome 을 확정 기록. 슬롯은 풀지 않는다. 증거 없는 변경·aborted_before_send 로의 이동은 decideSettle 이 거부. */
    async reconcile(req) { return apply("reconcile", req); },
  };
}

// ---- conformance harness -------------------------------------------------------------------------
const addr = (n) => "0x" + n.toString(16).padStart(40, "0");

/** makeInstances() => [storeA, storeB, ...] 가 **같은 durable 백엔드**를 보는 독립 인스턴스들을 돌려줘야 한다.
 *  (각 호출은 새 백엔드 = 깨끗한 상태.) 모든 단언은 { name, pass, detail } 로 모아 돌려준다. */
export async function runGrantStoreConformance(makeInstances) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, pass: true }); }
    catch (e) { results.push({ name, pass: false, detail: String(e?.message || e) }); }
  };
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${a}, want ${b}`); };

  await check("shape: contract id + methods", async () => {
    const [s] = await makeInstances();
    eq(isGrantStore(s), true, "isGrantStore");
  });
  await check("duplicate: same identity ok once across instances", async () => {
    const [a, b] = await makeInstances();
    const r1 = await a.reserve({ identity: addr(1), globalCap: 5, epoch: "e1" });
    const r2 = await b.reserve({ identity: addr(1), globalCap: 5, epoch: "e1" });
    eq(r1.ok, true, "first"); eq(r2.ok, false, "second"); eq(r2.reason, "duplicate", "reason");
  });
  await check("epoch: same identity ok in a new epoch, once each", async () => {
    const [a, b] = await makeInstances();
    eq((await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" })).ok, true, "e1");
    eq((await b.reserve({ identity: addr(1), globalCap: 1, epoch: "e2" })).ok, true, "e2");
    eq((await b.reserve({ identity: addr(1), globalCap: 1, epoch: "e2" })).reason, "duplicate", "e2 dup");
  });
  await check("cap: per-epoch, cap_reached after cap reservations", async () => {
    const [a, b] = await makeInstances();
    eq((await a.reserve({ identity: addr(1), globalCap: 2, epoch: "e1" })).ok, true, "1");
    eq((await b.reserve({ identity: addr(2), globalCap: 2, epoch: "e1" })).ok, true, "2");
    eq((await a.reserve({ identity: addr(3), globalCap: 2, epoch: "e1" })).reason, "cap_reached", "3");
    eq((await a.reserve({ identity: addr(3), globalCap: 2, epoch: "e2" })).ok, true, "other epoch has own cap");
  });
  await check("default cap = allowlist size (dedup, case-insensitive; invalid => null)", async () => {
    eq(defaultGlobalCap([addr(1), addr(1).toUpperCase().replace("0X", "0x"), addr(2)]), 2, "dedup");
    eq(defaultGlobalCap([]), 0, "empty");
    eq(defaultGlobalCap([addr(1), "nope"]), null, "invalid");
    eq(defaultGlobalCap(null), null, "non-array");
  });
  await check("invalid requests throw (fail-closed, no slot taken)", async () => {
    const [a] = await makeInstances();
    for (const bad of [null, { identity: "0xABC", globalCap: 1 }, { identity: addr(1), globalCap: 0 }, { identity: addr(1), globalCap: 1.5 }, { identity: addr(1), globalCap: 1, epoch: "bad epoch!" }, { identity: addr(1).toUpperCase(), globalCap: 1 }]) {
      let threw = false; try { await a.reserve(bad); } catch { threw = true; }
      eq(threw, true, `throws for ${JSON.stringify(bad)}`);
    }
    eq((await a.reserve({ identity: addr(1), globalCap: 1 })).ok, true, "slot still free; v1 call w/o epoch works");
  });
  await check("race: 40 concurrent same identity across 4 instances => exactly 1 ok", async () => {
    const inst = await makeInstances(4);
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => inst[i % inst.length].reserve({ identity: addr(7), globalCap: 100, epoch: "e1" })));
    eq(rs.filter((r) => r.ok).length, 1, "ok count");
    eq(rs.filter((r) => !r.ok && r.reason === "duplicate").length, 39, "dups");
  });
  await check("race: 60 concurrent distinct identities, cap 5 => exactly 5 ok", async () => {
    const inst = await makeInstances(4);
    const rs = await Promise.all(Array.from({ length: 60 }, (_, i) => inst[i % inst.length].reserve({ identity: addr(100 + i), globalCap: 5, epoch: "e1" })));
    eq(rs.filter((r) => r.ok).length, 5, "ok count");
    eq(rs.filter((r) => !r.ok && r.reason === "cap_reached").length, 55, "cap_reached");
    eq(new Set(rs.filter((r) => r.ok).map((r) => r.reservationId)).size, 5, "unique ids");
  });
  await check("race: mixed duplicate+cap (30 req over 10 ids, cap 4) => exactly 4 ok, <=1 per id", async () => {
    const inst = await makeInstances(3);
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => inst[i % 3].reserve({ identity: addr(200 + (i % 10)), globalCap: 4, epoch: "e1" }).then((r) => ({ ...r, id: i % 10 }))));
    const ok = rs.filter((r) => r.ok);
    eq(ok.length, 4, "ok count");
    eq(new Set(ok.map((r) => r.id)).size, 4, "distinct ids");
  });
  const outcomesNoRelease = ["send_failed", "reverted", "unconfirmed", "confirmed"];
  for (const outcome of outcomesNoRelease) {
    await check(`no release: ${outcome} (settle keeps slot; release refused; no re-grant)`, async () => {
      const [a, b] = await makeInstances();
      const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
      await a.settle({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome });
      const rel = await b.release({ identity: addr(1), epoch: "e1", reservationId: r.reservationId });
      eq(rel.ok, false, "release"); eq(rel.reason, "not_aborted_before_send", "reason");
      eq((await b.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" })).reason, "duplicate", "still held");
      eq((await b.reserve({ identity: addr(2), globalCap: 1, epoch: "e1" })).reason, "cap_reached", "cap still counts it");
    });
  }
  await check("no release: UNKNOWN (reserved, never settled)", async () => {
    const [a, b] = await makeInstances();
    const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    const rel = await b.release({ identity: addr(1), epoch: "e1", reservationId: r.reservationId });
    eq(rel.reason, "unknown_state", "reason");
    eq((await b.reserve({ identity: addr(2), globalCap: 1, epoch: "e1" })).reason, "cap_reached", "slot held");
  });
  for (const ev of [{ txHash: "0xabc" }, { broadcast: true }, { nonceConsumed: true }]) {
    await check(`no release: aborted_before_send with evidence ${Object.keys(ev)[0]}`, async () => {
      const [a] = await makeInstances();
      const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
      await a.settle({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome: "aborted_before_send", ...ev });
      eq((await a.release({ identity: addr(1), epoch: "e1", reservationId: r.reservationId })).reason, "broadcast_evidence", "reason");
    });
  }
  await check("reconcile: records evidence, does not free the slot; later release refused", async () => {
    const [a, b] = await makeInstances();
    const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    await a.settle({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome: "aborted_before_send" }); // 잘못 기록됨
    await b.reconcile({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome: "confirmed", txHash: "0xdead", broadcast: true });
    eq((await a.release({ identity: addr(1), epoch: "e1", reservationId: r.reservationId })).ok, false, "release after reconcile");
    eq((await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" })).reason, "duplicate", "held");
  });
  await check("release: aborted_before_send w/o evidence frees the cap slot (not the identity in that epoch)", async () => {
    const [a, b] = await makeInstances();
    const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    await a.settle({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome: "aborted_before_send" });
    eq((await b.release({ identity: addr(1), epoch: "e1", reservationId: r.reservationId })).ok, true, "release");
    eq((await b.reserve({ identity: addr(2), globalCap: 1, epoch: "e1" })).ok, true, "cap slot reusable by another identity");
    eq((await b.reserve({ identity: addr(1), globalCap: 5, epoch: "e1" })).reason, "duplicate", "same identity same epoch: no auto re-grant");
  });
  await check("release: wrong reservationId refused; double release refused-free", async () => {
    const [a] = await makeInstances();
    const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    await a.settle({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome: "aborted_before_send" });
    eq((await a.release({ identity: addr(1), epoch: "e1", reservationId: "bogus" })).reason, "not_found", "bogus");
  });
  await check("race: concurrent release x10 of one aborted reservation => cap slot freed exactly once", async () => {
    const inst = await makeInstances(3);
    const r = await inst[0].reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    await inst[0].settle({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome: "aborted_before_send" });
    await Promise.all(Array.from({ length: 10 }, (_, i) => inst[i % 3].release({ identity: addr(1), epoch: "e1", reservationId: r.reservationId })));
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => inst[i % 3].reserve({ identity: addr(50 + i), globalCap: 1, epoch: "e1" })));
    eq(rs.filter((x) => x.ok).length, 1, "only one slot");
  });
  for (const first of ["send_failed", "confirmed", "unconfirmed", "reverted"]) {
    await check(`no bypass: ${first} -> aborted_before_send via settle/reconcile keeps release refused and slot held`, async () => {
      const [a, b] = await makeInstances();
      const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
      const base = { identity: addr(1), epoch: "e1", reservationId: r.reservationId };
      await a.settle({ ...base, outcome: first });
      for (const m of ["settle", "reconcile"]) {
        let threw = false; try { await b[m]({ ...base, outcome: "aborted_before_send" }); } catch { threw = true; }
        eq(threw, true, `${m} to aborted_before_send throws`);
      }
      eq((await b.release(base)).ok, false, "release refused");
      eq((await b.reserve({ identity: addr(2), globalCap: 1, epoch: "e1" })).reason, "cap_reached", "freed-slot bypass impossible");
    });
  }
  await check("reconcile to a different outcome needs evidence; settle cannot change outcome", async () => {
    const [a] = await makeInstances();
    const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    const base = { identity: addr(1), epoch: "e1", reservationId: r.reservationId };
    await a.settle({ ...base, outcome: "send_failed" });
    let t1 = false, t2 = false, t3 = false;
    try { await a.settle({ ...base, outcome: "confirmed" }); } catch { t1 = true; }
    try { await a.reconcile({ ...base, outcome: "confirmed" }); } catch { t2 = true; }
    eq(t1 && t2, true, "no-evidence changes refused");
    await a.reconcile({ ...base, outcome: "confirmed", txHash: "0xabc" });
    try { await a.reconcile({ ...base, outcome: "aborted_before_send", txHash: "0xabc" }); } catch { t3 = true; }
    eq(t3, true, "never back to aborted");
  });
  await check("settle/reconcile on a released row throws", async () => {
    const [a] = await makeInstances();
    const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    const base = { identity: addr(1), epoch: "e1", reservationId: r.reservationId };
    await a.settle({ ...base, outcome: "aborted_before_send" });
    eq((await a.release(base)).ok, true, "release");
    for (const m of ["settle", "reconcile"]) {
      let threw = false; try { await a[m]({ ...base, outcome: "confirmed", txHash: "0x1" }); } catch { threw = true; }
      eq(threw, true, `${m} on released`);
    }
  });
  await check("settle: invalid outcome / unknown reservation throws", async () => {
    const [a] = await makeInstances();
    const r = await a.reserve({ identity: addr(1), globalCap: 1, epoch: "e1" });
    let t1 = false, t2 = false;
    try { await a.settle({ identity: addr(1), epoch: "e1", reservationId: r.reservationId, outcome: "weird" }); } catch { t1 = true; }
    try { await a.settle({ identity: addr(1), epoch: "e1", reservationId: "nope", outcome: "confirmed" }); } catch { t2 = true; }
    eq(t1 && t2, true, "throws");
  });
  return results;
}
