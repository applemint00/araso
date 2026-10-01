// 주소 단위 grant 원장 (파일 durable). 회계 단위 = 주소, 1주소 1회.
//
// fail-closed 규율
//  - 파일 없음        = 첫 실행. 빈 원장으로 시작(정상, 에러 아님).
//  - 파싱/읽기 실패   = throw LEDGER_CORRUPT. 호출자가 fail-closed 로 처리한다
//                       (server.mjs: 원장을 못 읽으면 /grant 는 전부 거부, 사유를 응답에 담는다).
//  - [relayer safety] 스키마 검증 = entries 는 객체(배열 거부), 각 항목의 주소·금액·상태·txHash 형식을 본다.
//                       하나라도 틀리면 throw LEDGER_SCHEMA — 재시작 뒤 dedup·상한이 조용히 풀리지 않게.
//  - [relayer safety] 단일 writer = `<path>.lock` 을 O_EXCL(wx) 로 만든다. 이미 있으면 throw LEDGER_LOCKED —
//                       같은 원장을 두 프로세스가 쓰지 못한다. 남은 lock 을 자동으로 지우지 않는다
//                       (stale 여부는 사람이 확인). 자기 lock 은 close() 로만 푼다.
//  - reserve() 는 tx 전송 **전에** 기록한다. 전송 후 크래시해도 중복 지급이 안 된다.
//  - 이미 entry 가 있으면(PENDING/CONFIRMED/FAILED 무엇이든) 그 주소는 막힌다.
//    자동 재시도 없음 — FAILED 도 사람이 원장을 손으로 정리해야 재시도 가능.

import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, writeSync, unlinkSync } from "node:fs";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const STATUSES = new Set(["PENDING", "CONFIRMED", "FAILED"]);

function validateEntries(entries, path) {
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    throw new Error(`LEDGER_SCHEMA: entries must be an object: ${path}`);
  }
  for (const [k, e] of Object.entries(entries)) {
    const bad = (why) => { throw new Error(`LEDGER_SCHEMA: ${why} (${k}): ${path}`); };
    if (!ADDR.test(k) || k !== k.toLowerCase()) bad("key must be a lowercase address");
    if (typeof e !== "object" || e === null || Array.isArray(e)) bad("entry must be an object");
    if (typeof e.address !== "string" || !ADDR.test(e.address) || e.address.toLowerCase() !== k) bad("address mismatch");
    if (typeof e.amountWei !== "string" || !/^[0-9]+$/.test(e.amountWei) || BigInt(e.amountWei) <= 0n) bad("amountWei invalid");
    if (!STATUSES.has(e.status)) bad("status invalid");
    if (!(e.txHash === null || (typeof e.txHash === "string" && TX_HASH.test(e.txHash)))) bad("txHash invalid");
    if (e.status === "CONFIRMED" && e.txHash === null) bad("CONFIRMED without txHash");
  }
}

function acquireWriterLock(path) {
  const lockPath = `${path}.lock`;
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (e) {
    if (e && e.code === "EEXIST") throw new Error(`LEDGER_LOCKED: another writer holds ${lockPath} (not removed automatically)`);
    throw new Error(`LEDGER_LOCK_FAILED: ${lockPath}`);
  }
  writeSync(fd, `${process.pid}\n`);
  closeSync(fd);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    try { unlinkSync(lockPath); } catch { /* 이미 없으면 그대로 */ }
  };
}

export function openLedger(path) {
  const release = acquireWriterLock(path);
  let data;
  try {
    if (!existsSync(path)) {
      data = { version: 1, entries: {} };
    } else {
      let raw;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        throw new Error(`LEDGER_UNREADABLE: ${path}`);
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`LEDGER_CORRUPT: ${path}`);
      }
      if (parsed?.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
        throw new Error(`LEDGER_UNKNOWN_VERSION: ${path}`);
      }
      validateEntries(parsed.entries, path);
      data = parsed;
    }
  } catch (e) {
    release(); // 열지 못했으면 이 프로세스가 만든 lock 만 푼다
    throw e;
  }

  const flush = () => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path); // 같은 파일시스템 내 rename = 원자적 교체, 부분 기록 없음
  };

  const key = (addr) => addr.toLowerCase();

  const has = (addr) => Object.prototype.hasOwnProperty.call(data.entries, key(addr));
  const get = (addr) => data.entries[key(addr)] ?? null;
  /** [relayer safety] 원장 전체 지급 건수·금액 — 상태와 무관하게 예약된 것은 모두 센다(FAILED 도 불확실 broadcast 일 수 있다). */
  const count = () => Object.keys(data.entries).length;
  const totalWei = () => Object.values(data.entries).reduce((s, e) => s + BigInt(e.amountWei), 0n);

  /** tx 전송 전 예약. amountWei 는 BigInt. */
  const reserve = (addr, amountWei) => {
    data.entries[key(addr)] = {
      address: addr,
      amountWei: amountWei.toString(),
      txHash: null,
      status: "PENDING",
      at: new Date().toISOString(),
    };
    flush(); // 전송 전 durable — 이 write 가 실패하면 throw 되어 tx 자체가 안 나간다
  };

  const settle = (addr, status, txHash) => {
    const entry = data.entries[key(addr)];
    if (!entry) throw new Error("LEDGER_ENTRY_MISSING");
    entry.status = status;
    entry.txHash = txHash ?? null;
    entry.at = new Date().toISOString();
    flush();
  };

  return {
    has,
    get,
    count,
    totalWei,
    reserve,
    confirm: (addr, txHash) => settle(addr, "CONFIRMED", txHash),
    fail: (addr) => settle(addr, "FAILED", null),
    close: release,
  };
}

/** 단일 프로세스 내 직렬화 — read→check→reserve 사이에 다른 요청이 끼어들지 못하게 한다.
 *  프로세스 사이 안전은 이 lock 이 아니라 openLedger 의 파일 writer lock 이 맡는다. */
export function createLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}
