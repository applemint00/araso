// 주소 단위 grant 원장 (파일 durable). 회계 단위 = 주소, 1주소 1회.
//
// fail-closed 규율
//  - 파일 없음        = 첫 실행. 빈 원장으로 시작(정상, 에러 아님).
//  - 파싱/읽기 실패   = throw LEDGER_CORRUPT. 호출자가 fail-closed 로 처리한다
//                       (server.mjs: 원장을 못 읽으면 /grant 는 전부 거부, 사유를 응답에 담는다).
//  - reserve() 는 tx 전송 **전에** 기록한다. 전송 후 크래시해도 중복 지급이 안 된다.
//  - 이미 entry 가 있으면(PENDING/CONFIRMED/FAILED 무엇이든) 그 주소는 막힌다.
//    자동 재시도 없음 — FAILED 도 사람이 원장을 손으로 정리해야 재시도 가능.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

export function openLedger(path) {
  let data;
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
    data = parsed;
  }

  const flush = () => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path); // 같은 파일시스템 내 rename = 원자적 교체, 부분 기록 없음
  };

  const key = (addr) => addr.toLowerCase();

  const has = (addr) => Object.prototype.hasOwnProperty.call(data.entries, key(addr));
  const get = (addr) => data.entries[key(addr)] ?? null;

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
    reserve,
    confirm: (addr, txHash) => settle(addr, "CONFIRMED", txHash),
    fail: (addr) => settle(addr, "FAILED", null),
  };
}

/** 단일 프로세스 내 직렬화 — read→check→reserve 사이에 다른 요청이 끼어들지 못하게 한다. */
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
