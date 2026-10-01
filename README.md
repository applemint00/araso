# Araso

Araso is a consumer wallet experience where your money is a small character — a Piggy — that you
send out to do one job on Monad and that comes home with a receipt saying what it earned, what it
cost, and what it could not find out.

**[Live demo — arasoo.vercel.app](https://arasoo.vercel.app/)** · Monad Testnet ·
Consumer Products & Payments (Metropolis)

**Why Monad?** Araso turns an on-chain action into a small, understandable journey. Monad's
EVM environment lets passkey-derived accounts use existing contracts through `viem`: the
current demo's First Journey deposits MON into shMON and redeems it on return. The character
animation accompanies a transaction; it is not evidence that one succeeded.

**What to explore:** hatch and name a Piggy, arrive Home with Chog, send the Piggy on its first
job, then follow Away → Return → Receipt → HISTORY. Chog stays home; Piggy comes and goes.
The receipt makes the outcome, costs and unknowns visible.

## Current status

As of **1 October 2026**, the live demo runs the application release
[`082d410`](https://github.com/applemint00/araso/commit/082d410566c67f22bea5fde160fe5a8f8509daa3).
That release was confirmed on GitHub `main` and deployed to production; subsequent README-only
commits do not represent a new application feature release. The hosted demo is publicly
reachable; the GitHub repository is currently private.

| Area | Implemented / demonstrated | Boundary |
|---|---|---|
| First Journey | Monad Testnet shMON execution path, including a recorded successful deposit → redeem → reopened Receipt round trip | Real testnet transactions, not mainnet execution or a reliability guarantee |
| Passkey UX | Mera account creation/sign-in, existing-passkey lookup and session controls | Final real-iPhone Face ID and installed-PWA validation is still pending |
| Home and records | Multi-Piggy presentation, Name/Hatch → Home continuity, responsive HISTORY | Browser/UI proof does not establish independent financial execution for every displayed Piggy |
| Second Journey | UI/state, readiness, permission and amount handling, Away/Return flow and receipt-bridge modules | Actual production execution adapter is still planned; DEV/mock flows and module tests are not live transactions |
| Mainnet | Explicit chain profiles and a local, fork-only Aave USDC lane | No live mainnet execution, deployment or funding; `mainnet-job-lane` is not connected to the production app's live path |

**Release validation:** 101/101 app and relayer regression suites passed, with security and
visual reviews and production browser smoke checks passing. The production JavaScript matched
the validated build. Browser smoke used isolated synthetic UI state without real credentials,
signing or transactions; it does not replace the pending device checks or constitute a security audit.

**Recorded First Journey evidence:** on Monad Testnet (chain ID `10143`), both legs mined with
status `0x1`, followed by reopening the same receipt:

| Leg | Transaction (abbreviated) | Block |
|---|---|---|
| deposit | `0x2cdf…6648` | 64272690 |
| redeem | `0xadb1…1831` | 64272695 |

This was one successful, prefunded run without the gas grant. It does not establish repeated
reliability or coverage of every failure branch. These abbreviated hashes are identifiers,
not explorer links.

The gas-grant endpoint is **disabled by default in code** unless the server explicitly enables
it; the deployed environment's enablement is not asserted here. A demo video is not linked yet,
and a repository license still needs to be added.

---

## Architecture

```
browser (app/)                       Monad Testnet (chain id 10143)
┌──────────────────────────┐         ┌──────────────────────────────┐
│ vanilla-JS scene engine  │         │ ShMonad  0x282BdDFF…8745C9   │
│  main.js = scenes, state │─viem──▶ │   deposit() / redeem()       │
│  job-feed / job-selector │         │                              │
│  rule-decision           │         │                              │
│  piggy-depart / -return  │         │                              │
│  receipt-paper, records  │         └──────────────────────────────┘
│                          │
│ mera passkey account     │
│  PRF → viem account      │
└───────────┬──────────────┘
            │ POST /api/grant {address} (local: /grant)
            ▼
┌──────────────────────────┐
│ api/grant.js (serverless)│  fixed 0.1 MON native transfer
│ relayer/ (local dev twin)│  shares relayer/src/policy.mjs
└──────────────────────────┘
```

- **No custom contracts were written for this build.** The app reads and writes existing deployed
  contracts; the grant path is a plain native transfer, not a contract call and not a meta-tx.
- Home can display multiple Piggies. This presentation is separate from the demonstrated First
  Journey execution path; it is not proof of simultaneous multi-account execution.
- First Journey transaction receipts are stored client-side with transaction hashes. Second
  Journey decision/preview records may describe no action or a simulation; they are not proof
  of a completed on-chain journey.
- `chain-profile.js` defaults to Monad Testnet (`10143`). Mainnet (`143`) requires the exact
  `monad-mainnet` configuration; invalid profiles block execution. The fork-only mainnet lane
  is separate from the production entry point.

## Security model and trust boundaries

```
Mera passkey (rpId-bound, device/iCloud/Google PM)
        │  PRF
        ▼
in-memory signing session  ──── the real attack surface
        │  (key lives in page memory; no prompt per signature until the session ends)
        ▼
the app (app/src, served from one origin)
        │  viem
        ▼
Monad Testnet RPC + contracts        ◀── no server of ours sits in this path

              ── separate boundary ──
POST /api/grant  (api/grant.js, server-side key)  → native MON transfer only
```

What each boundary does and does not hold:

- **Passkey / Mera root.** The private key is derived from a WebAuthn PRF output. No seed phrase,
  no server custody of the user signing key. The credential is bound to an rpId — see "Passkey loss" below.
- **Signing session.** The key is in page memory while the signing session is open, with a
  five-minute absolute expiry. App activity does not extend that signing window. Within it,
  signatures do not each require another biometric prompt; action permission is a separate check.
  This is the sharpest edge in the design: anything that can run script
  in our origin during an open session can sign. That is why the deployed CSP forbids inline and
  `eval`'d script and pins `connect-src` to this origin plus the Monad RPC (`vercel.json`).
- **The relayer / grant function.** It never holds a user key and cannot move user funds. It can
  only send a fixed 0.1 MON native transfer from its own wallet, and it can censor or delay.
  Policy values (chain id, amount, gas, body schema) are server-owned in `relayer/src/policy.mjs`
  and cannot be overridden by the request body — the body carries one field, `address`.
- **Test harness.** The local WebAuthn test hook is gated three ways (a non-default Vite mode,
  an explicit `VITE_ARASO_LOCAL_DEV_ENTRY=1`, and the isolated harness rpId
  `araso-harness.local.test`), so the "Harness Piggy" is a separate identity from any production
  account and has no path into the production boundary. The production build must not contain
  the isolated harness identity. After `npm run build`,
  `grep -R "araso-harness" dist` should print no matches (grep exit code 1).

### Grant boundary: honest status

- **Disabled by default.** Without `ARASO_GRANT_ENABLED`, `/api/grant` returns `503`
  before parsing a body, before loading the key, and before any RPC call or transaction.
- **When explicitly enabled.** Vercel functions share no disk and no process, so the
  local relayer's reserve→confirm ledger does not apply. The stateless substitute is a recipient
  balance threshold. Two concurrent requests cannot see each other's effect, so a **double-spend
  window remains**. This is not exact-once and is not claimed to be. The hard ceiling is the
  relayer wallet balance.

### Passkey lookup, loss and domain moves

- A Mera account is derived from a passkey, and **a credential created under one rpId cannot be
  used under another**. Moving the app to a different domain therefore produces *different
  accounts*, not the same account on a new host.
- **Losing every usable copy of the passkey can make its account inaccessible.** The on-chain
  account is not deleted, but this app has no alternate key-recovery method for that case.
- Existing-passkey lookup is implemented, including lookup before creating a new Piggy on a
  fresh device. Finding a synced credential is different from recovering a lost credential.
- Treat accounts created against this demo as testnet-only. Existing-passkey lookup is not
  a backup for losing all copies of a credential.
- Passkey sync (iCloud Keychain, Google Password Manager) makes the account portable across a
  vendor's devices and, by the same token, makes that vendor account part of the wallet's security.
  Availability across devices depends on access to the same credential; do not assume an
  unrelated credential or another sync ecosystem recovers the same account.

## Technology stack

| Layer | What |
|---|---|
| Frontend | Vanilla JavaScript modules, no framework; Vite 7 dev server and build |
| Chain client | `viem` ^2.56 |
| Accounts | `@category-labs/mera` 0.2 — passkey + WebAuthn PRF, `toViemAccount` bridge |
| Gas grant | Node serverless function (`api/grant.js`) on Vercel; `relayer/src/server.mjs` for local dev |
| Tests | Node scripts and browser harnesses under `app/test/` and `relayer/test/`; offline boundary tests are listed below |
| Hosting config | `vercel.json` (build to `dist/`, function bundles the shared policy module) |

## Monad integration

Only values already confirmed in this repository are listed. Nothing here is invented.

| Item | Value |
|---|---|
| Network | Monad Testnet |
| Chain id | `10143` |
| RPC | `https://testnet-rpc.monad.xyz` (`MONAD_RPC_URL` overrides the relayer/serverless RPC only) |
| ShMonad (shMON) | `0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9` — `deposit` / `redeem` |

The First Journey calls the existing shMON contract using a passkey-derived account and records
transaction results. The broader Second Journey rule/readiness system is implemented in part,
but live rule-driven execution is not claimed. Testnet remains the production demo's network;
a configured mainnet profile or a successful local fork test does not enable live mainnet jobs.

## Setup

Requires Node.js **20.19+ on the 20.x line, or 22.12+**, matching Vite 7 requirements.

```bash
npm ci          # honours package-lock.json; `npm install` may float within semver ranges

# frontend dev server
npm run dev

# production build (outputs to dist/)
npm run build

# local gas-grant relayer (needs RELAYER_PRIVATE_KEY; grants need ARASO_GRANT_ALLOWLIST)
npm run relayer

# offline relayer smoke test — no network, no real key
npm run relayer:test

# offline security-boundary tests — grant launch gate + deployment headers
npm run test:security
```

Environment variables:

| Name | Where | Purpose |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | relayer / serverless function | Funds the fixed 0.1 MON gas grant. Load through a protected, untracked local `.env` or server environment; never commit it. The local server requires it. |
| `ARASO_GRANT_ENABLED` | serverless function (server-side only) | Launch gate for `/api/grant`. Accepts `1` or `true`; anything else, including unset, keeps the endpoint closed (`503`) before any transaction. Deliberately **not** `VITE_`-prefixed — a `VITE_` name would be baked into the client bundle. |
| `ARASO_GRANT_ALLOWLIST` | local relayer only | Comma-separated permitted recipient addresses; missing/invalid means grants are rejected. The durable local ledger caps total grants at one 0.1 MON transfer. This policy is not a serverless guarantee. |
| `MONAD_RPC_URL` | relayer / serverless function | Optional RPC override; defaults to the public Monad testnet RPC. |
| `VITE_RELAYER_URL` | frontend | Point the app at a local relayer (e.g. `http://localhost:8787`). Unset, the app calls `/api`. |

App-side test scripts are run directly, e.g. `node app/test/rule-decision.mjs`. There is no
aggregate test command for those yet; `npm run test:security` covers only the two boundary suites
in `relayer/test/`.

Deployment headers (CSP, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`) are
declared in `vercel.json` and asserted by `relayer/test/deploy-headers.mjs`. The CSP was written
from the built bundle rather than from assumption; `style-src` still needs `'unsafe-inline'`
because the app writes inline `style` attributes through `innerHTML`. `COOP`, `COEP` and `HSTS`
are deliberately **not** set: their interaction with WebAuthn and with Vercel's own domain
handling has not been measured here, and the header test fails if they appear without that work.

The live demo is hosted on Vercel at [arasoo.vercel.app](https://arasoo.vercel.app/).
`vercel.json` defines the install/build commands, `dist/` output and grant function. Production
authentication is bound to `arasoo.vercel.app`; localhost is for UI development, not a substitute
for testing a production passkey. Do not move an existing credential to another domain.

## Prior work reused

Character and surface art comes from our earlier project (gift-piggy), reused as files:

- Egg — SVG set of 6 frames (idle · squash · stretch · bulge · react · crack)
- Chog — idle vector, and the v3 walk cycle (10 frames)
- Notebook paper texture used behind every scene

Also reused from gift-piggy: the **GiftPiggy contract already deployed on Monad Testnet**
(`0xfe7668db…`) together with its signing and submission logic. The receiving UI and claim
integration in this repository are new. This reuse is
attribution, not a claim that the current production demo has a live mainnet Gift deployment.

Everything else in `app/`, `api/` and `relayer/` was written for this build.

## Third-party libraries and assets

- `@category-labs/mera` — passkey accounts (MIT-style npm dependency; see its own license).
- `viem`, `vite` — see their respective licenses.
- Font: Delicious Handrawn, under the SIL Open Font License — license text shipped at
  `app/public/card/DeliciousHandrawn-OFL.txt`.

## AI coding tools disclosure

AI coding assistants were used extensively throughout this build. Claude (via Claude Code) and
OpenAI Codex were used for implementation, refactoring, test writing, review and documentation,
including the drafting of this README. All output was directed, reviewed and accepted by the
author, who is responsible for the submitted code.

## Open source license

**Not yet added.** No repository license is granted by this README. Choosing and adding a
license remains a project-owner decision.

## Attribution

- Built by **applemint00** (``).
- Art and the GiftPiggy contract originate in the author's earlier **gift-piggy** project, as
  described under "Prior work reused".
- Fonts and libraries are attributed under "Third-party libraries and assets".
