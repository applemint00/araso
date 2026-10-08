# Araso

Your money, as a small character. Send a Piggy to do one job on Monad; it comes
home with a receipt showing the result, costs and what remains unknown.

**[Try the live demo](https://arasoo.vercel.app/)** · Monad Testnet ·
Consumer Products & Payments (Metropolis)

Hatch → Name → Home → Send → Away → Return → Receipt → HISTORY.
Chog stays home. Piggy comes and goes.

**Why Monad?** Its EVM environment lets Araso connect passkey-based accounts to
existing contracts through `viem`. The demo's First Journey performs real shMON
`deposit` and `redeem` transactions on Monad Testnet.

## Status and evidence

Each row says how strong its evidence is. The labels mean:

- **LIVE (testnet)**: real transactions recorded on Monad Testnet, sent by the app source in a local harness run (a local build, not the deployed site).
- **LOCAL**: present in this source tree and covered by local tests. Not shown to be deployed.
- **FORK-ONLY**: proven on a local mainnet fork run. Not a mainnet transaction.
- **NOT LIVE**: switched off in code.

| Area | Current scope | Evidence |
|---|---|---|
| First Journey | A real testnet deposit → redeem → reopened Receipt round trip has succeeded. | LIVE (testnet), one recorded run |
| Passkey & Home | Passkey creation/sign-in, existing-passkey lookup, multi-Piggy presentation and responsive HISTORY. Real-iPhone Face ID/PWA validation is still pending. | LOCAL |
| Second Journey | UI/state, readiness, permission, amount, Away/Return, the execution adapter and the receipt bridge. Every chain profile ships with `liveExecution: false`. DEV/mock flows are not live transactions. | LOCAL · NOT LIVE |
| Mainnet jobs | Chain profiles plus Aave v3 USDC, Kintsu sMON, Neverland USDC, Curvance USDC and aBIL spot job models. Each model is limited to what one fork run proved. No live mainnet execution, deployment or funding. | FORK-ONLY · NOT LIVE |
| Gift | Gift claim on the existing testnet GiftPiggy contract (prior work, see Credits). A gift-gas ledger/service in `relayer/` and a client adapter (not wired to the UI). | LOCAL |
| Gas grant | Disabled unless `ARASO_GRANT_ENABLED` is `1`/`true`. When enabled, it still refuses (503) without a durable grant store, and no durable store backend exists in this tree. | LOCAL · NOT LIVE in this tree |
| Receipt evidence | A local transaction-evidence store/reader (browser storage only, no indexer). | LOCAL |
| Add Money funding rail | Quote/validate/plan code for a cross-chain funding rail, wired only as plan data: no screen calls it, it fetches nothing, and it never signs or sends. | LOCAL prototype · NOT LIVE |

**Deployed build: UNKNOWN.** This repository does not record which commit the live
demo serves, and the deployed grant configuration is not asserted here. A release
checkpoint was recorded on 1 October 2026 at
[`082d410`](https://github.com/applemint00/araso/commit/082d410566c67f22bea5fde160fe5a8f8509daa3)
(101/101 regression suites at that time, with production browser smoke checks that
used synthetic UI state). Work after that checkpoint is LOCAL unless a row above says otherwise.
None of this is a security audit or final device validation.

<details>
<summary>Recorded testnet round trip</summary>

| Leg | Transaction (abbreviated) | Block |
|---|---|---|
| deposit | `0x2cdf…6648` | 64272690 |
| redeem | `0xadb1…1831` | 64272695 |

Both mined with status `0x1`. This was one prefunded run without the gas grant,
not a reliability guarantee. The full hashes are not recorded in this repository,
so they are not explorer links.

</details>

## Setup

Node.js **20.19+ on 20.x, or 22.12+**.

```bash
npm ci
npm run dev            # local UI development (Vite, app/)
npm run build          # production output: dist/
```

## Tests

```bash
npm test               # every app/test suite, each in its own process; prints PASS / SKIP / FAIL per file
npm test -- receipt    # only suites whose file name contains "receipt"
node app/test/<file>.mjs   # run one suite directly
npm run test:security  # offline grant and deployment-header checks
npm run relayer:test   # relayer smoke test (binds a local port)
```

- By default `npm test` runs the node suites. Suites that need headless Chrome and a local
  Vite server are listed as SKIP. To run them as well:
  `ARASO_TEST_BROWSER=1 npm test` (needs Chrome and local port binding).
- Some suites compare against the maintainer's local design canon, pre-change copies or browser
  harness, which are not part of this repository. In a public clone those checks print
  `SKIP … (public checkout)` and the rest of the suite still runs. In the default (node-mode) `npm test`,
  a missing private file is never a FAIL. Browser mode (`ARASO_TEST_BROWSER=1`) has not been verified in a public clone.
- `ARASO_TEST_TIMEOUT_MS` overrides the per-suite timeout.

## Relayer (local development only)

The production app calls the same-origin serverless function `api/grant.js`. The
`relayer/` server is for local development, policy checks and smoke tests.

```bash
# .env in the repository root (mode 600, never committed; already ignored by .gitignore)
#   RELAYER_PRIVATE_KEY=<testnet-only key>
#   ARASO_GRANT_ALLOWLIST=<comma-separated addresses>   # missing/invalid: every /grant is refused
npm run relayer        # node --env-file=.env relayer/src/server.mjs
```

| Variable | Used by | Meaning |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | `api/grant.js`, `relayer/` | Server-side only. Never use a `VITE_` prefix (that is baked into the client bundle). |
| `ARASO_GRANT_ENABLED` | `api/grant.js` | Only `1`/`true` enables the grant. Anything else returns 503 before any transaction. |
| `ARASO_GRANT_STORE` | `api/grant.js` | Durable grant store backend name. No backend is registered in this tree, so an enabled grant still returns 503. |
| `ARASO_GRANT_ALLOWLIST` | `relayer/` | Addresses the local relayer may grant to. |
| `MONAD_RPC_URL` | `relayer/` | Default `https://testnet-rpc.monad.xyz`. |
| `PORT`, `GRANT_LEDGER` | `relayer/` | Default `8787` and `.grant-ledger.json`. |
| `VITE_RELAYER_URL` | app | Point the app at a local relayer, e.g. `http://localhost:8787`. Default `/api`. |
| `VITE_ARASO_CHAIN_PROFILE`, `VITE_ARASO_LOCAL_DEV_ENTRY`, `VITE_ARASO_LOCAL_DEV_RP_ID` | app (build time) | Build-time options: chain profile (default testnet; a mainnet profile still has `liveExecution: false`) and the local-only dev entry / passkey rpId (read only in the `a172-local` dev mode). Not needed for the default build. |

## Architecture

**Stack:** vanilla JavaScript + Vite, Mera passkeys, `viem`, Vercel.
The browser signs and submits to Monad directly; the optional server-side gas-grant
function is separate and never holds user keys. Receipts are stored client-side.

**Network:** Monad Testnet (`10143`), RPC `https://testnet-rpc.monad.xyz`.
First Journey uses shMON at `0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9`.
Testnet is the default; selecting a mainnet profile does not enable live jobs.

## Before using it

- **Testnet only.** Production passkeys are bound to `arasoo.vercel.app`;
  localhost cannot use those credentials. Losing all copies of a passkey can
  make its account inaccessible; existing-passkey lookup is not lost-key recovery.
- Signing keys remain in page memory for a session capped at five minutes.
  Signatures within that session do not each require another biometric prompt.
- The gas grant is off by default (see the table above). Turning it on without a
  durable store does not pay out; it returns 503.

## Credits & license

Code: **MIT**, see [LICENSE](LICENSE). Third-party fonts, libraries and reused
artwork keep their own licenses.

Built by **applemint00**. Prior work reused from **gift-piggy**: Egg/Chog artwork,
notebook texture, the existing testnet GiftPiggy contract and its signing/submission
logic. The receiving UI and claim integration are new to this build; reuse does
not imply a live mainnet Gift deployment.

- Fonts: **Playfair Display** (Copyright 2017 The Playfair Display Project Authors) and
  **Delicious Handrawn** (Copyright 2022 The Delicious Handrawn Project Authors), both under the
  SIL Open Font License 1.1: [app/public/fonts/OFL.txt](app/public/fonts/OFL.txt),
  [app/public/card/DeliciousHandrawn-OFL.txt](app/public/card/DeliciousHandrawn-OFL.txt).
- Libraries: Mera, viem and Vite retain their respective licenses.

**AI assistance:** Claude Code and OpenAI Codex assisted implementation, testing, review
and documentation; the author is responsible for the submitted code.

Demo video not yet linked.
