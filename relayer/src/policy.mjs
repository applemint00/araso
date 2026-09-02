// 서버 소유 정책값 — 클라이언트 요청으로 덮어쓸 수 없다. 요청 body 의 값은 이 값과 대조만 한다.
// fail-closed: 여기 없는 것은 거부. 확장은 코드 수정으로만.

export const CHAIN_ID = 10143; // Monad testnet
export const RPC_URL = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

/** 1회 grant 액수. 고정값 — 요청 body 에 금액 필드 자체가 없다. */
export const GRANT_WEI = 100_000_000_000_000_000n; // 0.1 MON (발주 3 ②: 1주소 1회)

/** 단순 native transfer 고정 gas. 컨트랙트 호출 아님. */
export const GRANT_GAS = 21_000n;

/** relayer 자체 잔고가 이 밑이면 지급 시도조차 안 한다(부분 실패 방지). */
export const RELAYER_MIN_BALANCE_WEI = GRANT_WEI + 10_000_000_000_000_000n; // grant + 0.01 MON gas 여유

export const MAX_BODY_BYTES = 1024;

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** fail-closed 요청 검증 — 모르면 거부, 부분 수용·확장 필드 없음.
 *  chainId·금액 등은 서버 소유값이라 요청에 애초에 받지 않는다(address 하나뿐). */
export function validateGrantRequest(body) {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body must be an object" };
  if (typeof body.address !== "string" || !ADDR.test(body.address)) return { ok: false, error: "invalid address" };
  const extra = Object.keys(body).filter((k) => k !== "address");
  if (extra.length > 0) return { ok: false, error: "unexpected fields" };
  return { ok: true, address: body.address };
}
