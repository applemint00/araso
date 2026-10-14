# Araso

Your money, as a small character. Send a Piggy to do one job on Monad; it comes
home with a receipt showing the result, costs and what remains unknown.

**[Try the live demo](https://arasoo.vercel.app/)** (deployed build identity: see Status) · Monad Testnet ·
Consumer Products & Payments (Metropolis)

**Videos:** [Teaser](https://youtu.be/HKfLbYbIMXE) · [Pitch](https://youtu.be/gz7ChpaHaHY) · [Demo](https://youtu.be/vKx5G4YHH0U)

Hatch → Name → Home → Send → Away → Return → Receipt → HISTORY.
Chog stays home. Piggy comes and goes.

## Who it's for

Araso is for people who want to start managing their money but feel overwhelmed by complicated account setup and financial product choices.

**Next 100 users.** We'll invite people who complete their first Journey to explore financial Jobs, then grow through Piggy gifting — letting each participant introduce Araso to someone new.

## Why Mera

A passkey derives the wallet through Mera PRF.
No seed phrase or wallet extension is needed.
Face ID unlocks the passkey for signing.

## Two journeys

- **Journey 1 — Monad Testnet.** The live demo. One real shMON `deposit` → `redeem`
  round trip on Monad Testnet has been recorded and reopened as the same Receipt
  (see [Recorded testnet round trip](#recorded-testnet-round-trip)).
- **Journey 2 — Mainnet-fork practice.** The same Piggy address continues on a hosted
  fork of Monad mainnet (chain id `31337143`) with practice funds. Entry and a Job send
  have run on the live site; nothing in Journey 2 touches a public network or real funds.

**Why Monad?** Its EVM environment lets Araso connect passkey-based accounts to
existing contracts through `viem`. Journey 1 performs real shMON
`deposit` and `redeem` transactions on Monad Testnet.

## Status and evidence

| Area | Current scope | Evidence |
|---|---|---|
| Journey 1 | One prefunded testnet deposit → redeem → reopened Receipt round trip succeeded without the gas grant. | LIVE (testnet), one recorded run |
| Passkey & Home | Passkey creation/sign-in, existing-passkey lookup, multi-Piggy presentation and responsive HISTORY; early testers created Piggies on real iPhones (Safari, Face ID) on 14 Oct 2026. | Live site |
| Journey 2 entry | The same Piggy address enters Journey 2 with a signed single-use, 2-minute challenge and a server Journey 1 check before one-time fork funds (MON, USDC, WETH, AUSD); production screens require release level ≥2 and the fork chain profile (`app/src/release-gate.js`). | FORK-ONLY · LOCAL |
| Mainnet jobs | Chain profiles cover Aave v3 USDC, Kintsu sMON, Neverland USDC, Curvance USDC and aBIL spot job models; executors for Euler, Upshift, Kuru (swap, limit place → cancel), shMON and USDC revoke ran on a lab fork but are not wired into Explore, with fork Job permission only requested and every profile set to `liveExecution: false`. | FORK-ONLY · NOT LIVE |
| Gift | Existing testnet GiftPiggy claim uses prior work (see Credits); fork create → link → new-device claim with sponsored gas ran through the local product UI, while mainnet Gift (chain 143) remains off. | LOCAL · FORK-ONLY · NOT LIVE (mainnet) |
| Gas grant | New Piggies get a one-time testnet gas grant: through invite links, and open entry from 12:00 KST on 14 Oct 2026 (server cap). | first live grant confirmed 14 Oct 2026 |
| Receipt evidence | A local transaction-evidence store/reader uses browser storage only, with no indexer. | LOCAL |
| Add Money funding rail | Cross-chain quote/validate/plan data remains a prototype with no calling screen, fetching, signing or sending. | LOCAL prototype · NOT LIVE |

**Evidence labels:** LIVE (testnet) means a real testnet transaction from a local harness build; Live site identifies deployed-site evidence; LOCAL means source/local tests without a deployment claim; FORK-ONLY means local fork evidence, not public-mainnet execution, deployment or funding; NOT LIVE means switched off; Journey 2 entry and fork Gift tests used a virtual authenticator (entry also mocked the Journey 1 read), and recorded runs are not a reliability guarantee, security audit or final device validation.

Live build: `8156bfb` (14 Oct 2026).

### Recorded testnet round trip

| Leg | Transaction | Block |
|---|---|---|
| deposit | [`0x2cdff53b226f546cd5db932552ab4c64ef04e4b29108b49547bd4b96f2ab6648`](https://testnet.monadscan.com/tx/0x2cdff53b226f546cd5db932552ab4c64ef04e4b29108b49547bd4b96f2ab6648) | 64272690 |
| redeem | [`0xadb14ada8b13527a4c1b11639c01b7d58aec645cf69b8c3fe6d4c74c27271831`](https://testnet.monadscan.com/tx/0xadb14ada8b13527a4c1b11639c01b7d58aec645cf69b8c3fe6d4c74c27271831) | 64272695 |

Both mined with status `0x1` on Monad Testnet (shMON at
`0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9`). This was one prefunded run from a local
harness build without the gas grant.

## Try it

Early testers created Piggies on real iPhones (Safari, Face ID) on 14 Oct 2026.

**1. Mobile (iPhone Safari)**

1. Open [arasoo.vercel.app](https://arasoo.vercel.app/) in Safari on your phone (or your invite link).
2. Create your Piggy with Face ID. This makes a passkey for `arasoo.vercel.app`.
3. Optional: Share → **Add to Home Screen**.

New Piggies get a one-time testnet gas grant: through invite links, and open entry from 12:00 KST on 14 Oct 2026 (server cap).

**2. Desktop**

Open the same link in a desktop browser and confirm with Touch ID or Windows Hello,
or scan the QR code with your phone to use the passkey on your phone.

## Before using it

- **Testnet only.** Production passkeys are bound to `arasoo.vercel.app`;
  localhost cannot use those credentials. Losing all copies of a passkey can
  make its account inaccessible; existing-passkey lookup is not lost-key recovery.
- Signing keys remain in page memory for a session capped at five minutes.
  Signatures within that session do not each require another biometric prompt.
- New Piggies get a one-time testnet gas grant: through invite links, and open entry from 12:00 KST on 14 Oct 2026 (server cap). Without `ARASO_GRANT_ENABLED`, the `upstash` store
  and its env pair, it returns 503.

## Credits & license

Code: **MIT**, see [LICENSE](LICENSE).
© 2026 applemint. The Araso name, characters (Piggy, Chog) and artwork are not covered by the MIT License and may not be reproduced, modified or used without prior written permission.
Third-party fonts, libraries and reused
artwork keep their own licenses.

Built by **applemint00**.

**Prior work (before the hackathon, 1 September 2026).** Prior work reused from **gift-piggy**: Egg/Chog artwork,
notebook texture, the existing testnet GiftPiggy contract and its signing/submission
logic. Reuse does not imply a live mainnet Gift deployment.

**Built during the hackathon (from 1 September 2026).** The code in `app/`, `api/` and
`relayer/` apart from the reuse above, including Journey 1, Journey 2, the Gift receiving
UI and claim integration, the grant and invite functions and the tests. The repository's
first commit is dated 2 September 2026.

- Fonts: **Playfair Display** (Copyright 2017 The Playfair Display Project Authors) and
  **Delicious Handrawn** (Copyright 2022 The Delicious Handrawn Project Authors), both under the
  SIL Open Font License 1.1: [app/public/fonts/OFL.txt](app/public/fonts/OFL.txt),
  [app/public/card/DeliciousHandrawn-OFL.txt](app/public/card/DeliciousHandrawn-OFL.txt).
- Libraries: Mera, viem and Vite retain their respective licenses.

**AI tools:** Claude Code and OpenAI Codex assisted implementation, testing, review
and documentation; the author is responsible for the submitted code.

## Developer notes

**3. Developer (local)**

Node.js **20.19+ on 20.x, or 22.12+**.

```bash
npm ci
npm run dev            # local UI development (Vite, app/)
npm run build          # production output: dist/
```

Production passkeys are bound to `arasoo.vercel.app`; localhost cannot use those
credentials, so a local run creates separate passkeys. A clone runs Journey 1 only:
Journey 2 needs the fork operations server, which is not in this repository (see
[What is public](#what-is-public)).

### Tests

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

### Relayer (local development only)

The production app calls the same-origin serverless function `api/grant.js`. The
`relayer/` server is for local development, policy checks and smoke tests.
Grant and invite stores are Upstash-backed (`api/_lib/`).

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
| `ARASO_GRANT_STORE` | `api/grant.js` | Durable grant store backend name. The only registered backend is `upstash`; anything else returns 503. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | `api/grant.js` | Upstash REST pair for the grant and invite stores. Without a complete pair the grant returns 503. |
| `ARASO_GRANT_ALLOWLIST` | `relayer/` | Addresses the local relayer may grant to. |
| `MONAD_RPC_URL` | `relayer/` | Default `https://testnet-rpc.monad.xyz`. |
| `PORT`, `GRANT_LEDGER` | `relayer/` | Default `8787` and `.grant-ledger.json`. |
| `VITE_RELAYER_URL` | app | Point the app at a local relayer, e.g. `http://localhost:8787`. Default `/api`. |
| `VITE_ARASO_CHAIN_PROFILE`, `VITE_ARASO_LOCAL_DEV_ENTRY`, `VITE_ARASO_LOCAL_DEV_RP_ID` | app (build time) | Build-time options: chain profile (default testnet; a mainnet profile still has `liveExecution: false`) and the local-only dev entry / passkey rpId (read only in the `a172-local` dev mode). Not needed for the default build. |

### Architecture

**Stack:** vanilla JavaScript + Vite, Mera passkeys, `viem`, Vercel.
The browser signs and submits to Monad directly; the optional server-side gas-grant
function is separate and never holds user keys. Receipts are stored client-side.

**Network:** Monad Testnet (`10143`), RPC `https://testnet-rpc.monad.xyz`.
Journey 1 uses shMON at `0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9`.
Testnet is the default; selecting a mainnet profile does not enable live jobs.
Journey 2 uses a local fork of Monad mainnet (chain id `31337143`).

### What is public

This repository holds the product source: `app/` (client and its tests), `api/`
(serverless functions) and `relayer/`. Internal operations tooling (the maintainer's run
harness and fork-server operations scripts) and all secrets are not included. The Journey 2
operations server (the guarded fork RPC and its admin tooling) is not public.

### Release checkpoint

A release checkpoint was recorded on 1 October 2026 at
[`082d410`](https://github.com/applemint00/araso/commit/082d410566c67f22bea5fde160fe5a8f8509daa3)
(101/101 regression suites at that time, with production browser smoke checks that
used synthetic UI state). Work after that checkpoint is LOCAL unless a row above says otherwise.
