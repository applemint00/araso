# Araso relayer (로컬 개발용)

가스 grant 릴레이어. 사용자 주소당 0.1 MON(`policy.mjs` `GRANT_WEI`)을 1회만 밀어준다(Monad Testnet).
tx 는 단순 native transfer — 컨트랙트 호출도, 사용자 tx 대납도 아니다.

**배포 경로는 이 서버가 아니다.** 프로덕션에서 앱이 부르는 것은 같은 origin 의 서버리스
`api/grant.js` 이고, 이 디렉터리는 로컬 개발·정책 검증(`policy.mjs`)·smoke 테스트용으로 남긴다.
두 경로는 `relayer/src/policy.mjs` 를 공유하지만, 서버리스에는 원장 파일이 없다(무상태 판정으로 대체 —
`api/grant.js` 머리말 참조).

## 엔드포인트

- `GET /health` → `{"ok":true}`
- `POST /grant` `{"address":"0x..."}` → `{"ok":true,"txHash":"0x..."}` 또는 `{"ok":false,"error":"..."}`

## 실행

```
RELAYER_PRIVATE_KEY=<placeholder> PORT=8787 node relayer/src/server.mjs
```

키는 환경변수로만 넘긴다(`--env-file` 등). 파일로 만들지 않는다. 없으면 기동을 거부한다.
앱을 이 로컬 서버에 붙이려면 `VITE_RELAYER_URL=http://localhost:8787` — 안 주면 앱은 `/api` 를 쓴다.

## 테스트

```
node relayer/test/smoke.mjs
```

네트워크·실키 접촉 없이 가짜 submitter 로 서버 로직만 검증한다.

## Gift sponsor (A-906 / A-913) — Vercel serverless + KV ledger + Cron recovery, Monad 143

`POST /api/gift-sponsor` lets a 0-MON Piggy claim a Gift: the sponsor wallet submits install → `commitClaim` (via `redeemDelegations`) → revoke → plain `claim()`.
**Default OFF.** Nothing runs unless `GIFT_SPONSOR_PRIVATE_KEY` is set (and every other value below is valid); the answer is `503 unavailable_not_sent` before any chain call.
The sponsor never chooses a recipient, never signs for a user, never sends MON to the Piggy (every sponsor tx has `value 0`), and the sponsor wallet is refilled by the
**sender's gas deposit** (G10) — no Owner float.

### Hosting shape (card G, Owner "일번가자")
- **Same-origin Vercel function** `api/gift-sponsor.js` runs the service in-process (`relayer/src/gift-sponsor-service.mjs`). No always-on process, no shared-secret hop.
- **Ledger = Vercel KV** (Upstash REST; `api/_lib/gift-sponsor-kv-store.js`) behind the `GiftSponsorStore` interface (documented in `gift-sponsor-service.mjs`). The file ledger
  (`openGiftSponsorLedger`) is the same interface for local runs and tests. Serverless instances share no disk or process, so exclusivity comes from conditional atomic writes:
  `SET NX` reserve (one entry per giftId, one deposit tx per giftId) and ONE **sponsor lease** (`SET NX PX`, renewed before every send, released after) held by whichever
  driver (request or Cron pass) is working — this also serializes the sponsor wallet's nonce. A busy lease answers `503 unavailable_not_sent` and reserves nothing.
- **Recovery = Vercel Cron** `api/gift-sponsor-reconcile.js` (`vercel.json` `crons`, every minute) runs the reconcile pass below under the same lease. A function that dies
  mid-flow leaves an `inflight` marker and a lease that expires on its own; the next Cron pass continues from chain truth.
- `vercel.json`: `maxDuration` 60 for both functions (the lease must be longer than that), `includeFiles: relayer/src/**`.

### Vercel setup (env, all server-side; never `VITE_`)
| env | meaning |
|---|---|
| `GIFT_SPONSOR_PRIVATE_KEY` | sponsor wallet key (env only; never logged, never in the ledger) |
| `MONAD_RPC_URL` | Monad 143 RPC |
| `GIFT_SPONSOR_ESCROW_ADDRESS` | the deployed Gift escrow on 143 (UNKNOWN until the mainnet escrow exists) |
| `GIFT_SPONSOR_GAS_UNITS` | `install,commit,revoke,claim` gas units, e.g. `46429,174887,46382,<fork-measured claim>` (A-814 estimates for the first three; the claim figure is measured on the fork). Missing/invalid => OFF |
| _(reference only)_ | Fork-measured gas units from the A-913 fork e2e, NOT product defaults and never read by the code (the env above stays fail-closed): install 36,844 · redeem (commit) ~211k · revoke 36,800 · claim ~88k (83,987–88,787). A-814 testnet estimates were install 46,429 / redeem 174,887 / revoke 46,382. |
| `GIFT_SPONSOR_GAS_BUFFER_BPS` | safety buffer in basis points (0..5000; keep it equal to the app's `giftGasBudget` buffer). Missing => OFF |
| `GIFT_SPONSOR_LEASE_SECONDS` | sponsor lease length; must be greater than the function `maxDuration` (60). Missing => OFF |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | set by the Vercel KV / Upstash integration (production ledger) |
| `CRON_SECRET` | Vercel Cron sends it as `Authorization: Bearer`; the reconcile route accepts nothing else (unset or < 16 chars => 401 for everything) |
| `GIFT_SPONSOR_REVOKE_MAX_FAILURES`, `GIFT_SPONSOR_REVOKE_BACKOFF_SECONDS` | optional, UNKNOWN numbers. A MINED revoke that leaves the Piggy dirty is a counted failure; the next try waits base × 2^(failures-1). Both unset => the first mined failure is final (`revokeStatus: exhausted`, `needsHuman`, no more sends; claim is never blocked). The cap only applies together with a backoff base |
| `GIFT_SPONSOR_RATE_PER_IP`, `GIFT_SPONSOR_RATE_PER_GIFT`, `GIFT_SPONSOR_RATE_WINDOW_SECONDS` | optional fixed-window limits on `/api/gift-sponsor` (KV counter). Unset => no limiter; a limit without a window (or the reverse) => OFF; a store that cannot count => 503 |
| `GIFT_SPONSOR_INFLIGHT_GRACE_SECONDS` | optional; default 300 (= the 300 s expiry cap reused, pending Owner confirmation) |
| `GIFT_SPONSOR_LEDGER_DIR` | local runs only (file ledger); not for serverless |

`vercel.json` cron `* * * * *` needs a plan that allows per-minute crons — UNKNOWN for this account; a slower schedule only slows recovery, never correctness.
Max expiry is the code constant 300 (the A-556 5-minute cap), not an env value.

### Requests (both `POST /api/gift-sponsor`, strict)
1. **Register** (sender's app, right after create): `{ action: "register_gas_tx", giftId, gasTx }`. The service reads the deposit receipt and records giftId → gasTx in the store only if status success,
   `from` = the Gift's sender Piggy, `to` = the pinned sponsor, `data` = giftId, `value ≥` the computed minimum. Same giftId + same hash = no-op (200, `already:true`); a different hash for the giftId, or a
   hash already registered for another giftId = 409. Record-and-read only: no send, no signing, no new relayer authority.
2. **Claim** (recipient): `{ giftId, authorization, revokeAuthorization, delegation, claim }` (+ optional `gasTx`, accepted only if equal to the registered hash). The relayer looks the deposit up in the store and
   re-checks the receipt right before claim; nothing registered => `409 gas_deposit_tx_missing` (fail closed).
- `authorization` — Piggy-signed type-4 install tuple, `address` = pinned StatelessDeleGator, `nonce` = the Piggy's chain nonce `n`.
- `revokeAuthorization` — Piggy-signed type-4 tuple, same chainId, `address` = `0x0000…0000`, `nonce` = `n + 1`, signer = the same Piggy (A-814 D). Validated like the install authorization.

### Guards (all before the first send)
G1–G9 (chainId, pinned impl, pinned code hashes, authorization/delegation signers, caveat set, ExactExecution terms, LimitedCalls 1, Timestamp `before ∈ (now, now+300]` and `≤ Gift expiry`,
`after = 0`), the revoke-authorization checks, G10 escrow state **and the gas deposit**, G11 one request per giftId.

**G10 gas deposit.** The registered `gasTx` must be a mined plain tx with receipt status success, `from` = the Gift's sender (the Piggy that created it), `to` = the pinned sponsor, `data` = giftId, `value ≥` the
**computed** minimum = `(install + commit + revoke + claim gas units) × current fee-per-gas × (1 + buffer)`. No fee input => refuse (never a default price). One deposit tx funds one giftId.
Unused gas handling stays UNDECIDED (no refund logic exists here).

### Sender and transport hardening
- **Sponsor sends are signed locally and sent raw** (`createViemGiftSponsorSender`): explicit gas limit (policy units for the kind × (1 + buffer) — Monad bills the limit), explicit fees (2 × current gas price cap, priority 0) and the sponsor's pending nonce, so a Piggy-signed authorization reaches the network only inside `eth_sendRawTransaction`, never in `eth_fillTransaction` / `eth_estimateGas` / `eth_call` (A-814 REVIEW F2). Tested with a recording transport.
- `/api/gift-sponsor` requires `Content-Type: application/json` (else 415).
- KV `reserve` and `registerGasTx` are single atomic `EVAL`s (entry + deposit ownership + index together).
- A revoke "sent but unsure" keeps its own in-flight marker (`revokeInflight`) so it survives the claim that follows; reconcile holds only revoke-needing steps while it may be pending.

### Code-hash preflight (F)
Before the guards of every request and before every send (and on each Cron pass): `eth_getCode` (read-only) for StatelessDeleGator impl · DelegationManager · ExactExecutionEnforcer · LimitedCallsEnforcer · TimestampEnforcer,
`keccak256(code)` compared with the pin table. Mismatch, empty code or RPC error => `503 unavailable_not_sent` (checked first, so a swapped contract is a 503, never a 409 guard refusal), target names logged (never code bytes). Coordinator's one-shot live read:
`node relayer/scripts/live_getcode_batch.mjs` (read-only: `eth_chainId` + `eth_getCode` ×5, no key, no tx; writes `relayer/scripts/raw/live_getcode_143.json`).

### Flow and ledger states (D)
`RESERVED → INSTALLED → COMMITTED → REVOKED → CLAIMED` (+ `UNKNOWN`). The install tx is always sent (re-delegating to the same impl is harmless) so the Piggy nonce is `n+1` for the revoke.
COMMITTED only after the commit tx has receipt `success` **and** the escrow `Committed` log **and** `commits(giftId, Piggy) == commitHash`.
**Revoke** = a type-4 tx `{to: Piggy, authorizationList: [revokeAuthorization]}` submitted by the sponsor right after the commit is confirmed and BEFORE `claim()` (the claim needs no delegation).
A failed/reverted/unsure revoke **never blocks claim**; `revokeStatus` stays `failed|unsure` and the Cron pass retries with the **same stored signature** (the relayer never re-signs).
The signed authorization is never sent to `eth_estimateGas` / `eth_call` (A-814 REVIEW F2); the only simulation is the redeem with a local state override.
"Revoked" on chain = the Piggy code is clean (`0x`).

### Reconcile runbook (E)
For each giftId that is not finished: read chain truth (code at the Piggy · `commits(giftId, Piggy)` · `gifts(giftId).claimed` · chain time · Piggy nonce · sponsor nonces · the recorded tx receipt)
and take **only the next certain step**. "Sent but unsure" = read the receipt / chain effect first; **never resend** while a tx may be pending.

| row | installed | commit | claimed | delegation | window | next step |
|---|---|---|---|---|---|---|
| R1 | no | no | no | – | open | INSTALL (stored plan; commit on the next round) |
| R1x | no | no | no | – | expired / Piggy nonce moved | ARCHIVE (nothing on chain; a fresh Face ID request may start) |
| R2 | yes | no | no | enabled (designator present) | open | COMMIT |
| R3 | yes | no | no | enabled | expired | REVOKE (stored signature, best effort) + ARCHIVE, wait for a NEW Face ID |
| R4 | yes | yes | no | enabled | – | REVOKE (never blocks) then plain claim() |
| R5 | yes | yes | no | revoked (Piggy code clean) | – | claim() |
| R6 | yes | yes | yes | enabled | – | REVOKE cleanup, ledger CLAIMED |
| R7 | yes | yes | yes | revoked | – | DONE (ledger CLAIMED, revokeStatus done) |
| R8 | ? | ? | ? | ? | – | WAIT: tx sent but unsure. Receipt absent / sponsor pending nonce > latest / marker younger than the grace => do nothing |
| H | foreign code at the Piggy, foreign commit hash, receipt success without effect | – | – | – | – | UNKNOWN + `needsHuman` in the ledger; operator decides, reconcile never acts |

The table lives in code as `RECONCILE_TABLE` (`gift-sponsor-reconcile.mjs`) and the tests assert every row. Local commands (same code the Cron route runs; needs the sponsor env + a store):
```
node relayer/tools/gift-gas-reconcile.mjs --sponsor            # PLAN: read-only RPC reads, prints the next step per owed giftId, no key needed
node relayer/tools/gift-gas-reconcile.mjs --sponsor --apply    # execute those steps (needs GIFT_SPONSOR_PRIVATE_KEY); takes the sponsor lease
```

### Tests (no network, no real key, no port)
```
node relayer/test/gift-sponsor-service.mjs   node relayer/test/gift-sponsor-reconcile.mjs   node relayer/test/gift-sponsor-preflight.mjs   node relayer/test/gift-sponsor-vercel.mjs
```
