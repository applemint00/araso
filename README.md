# Araso

Araso is a consumer wallet experience where your money is a small character — a Piggy — that you
send out to do one job on Monad and that comes home with a receipt saying what it earned, what it
cost, and what it could not find out.

Hackathon track: **Consumer Products & Payments** (Metropolis).

---

## Status (honest)

This section is deliberately first, because parts of the product are not finished.

**Working**

- Passkey-backed account creation and sign-in (`@category-labs/mera`, PRF-derived key, no seed phrase).
- The full narrative flow in the browser: birth → job feed → job selection → rule/condition check →
  send → away → return → receipt → records, plus the second-journey flow.
- A gas-grant path: a one-time 0.1 MON native transfer per address, served by the serverless
  function `api/grant.js` in production, or by `relayer/` locally. Both share one policy module.
- Offline test suites under `app/test/` and `relayer/test/` (run with plain `node`, no network,
  no real keys).
- **A first real testnet round trip has succeeded once.** On Monad Testnet
  (chain id `10143`), a shMON `deposit` and the matching `redeem` were both mined with
  status `0x1`:

  | Leg | Transaction | Block |
  |---|---|---|
  | deposit | `0x2cdf…6648` | 64272690 |
  | redeem | `0xadb1…1831` | 64272695 |

  Read this narrowly: it is **one** successful run of the two on-chain legs, recorded as evidence
  and nothing more. It is not a measure of reliability, it does not cover the grant path or the
  failure branches, and it has not been repeated. The hashes are truncated here exactly as they
  are in the run record; the full hashes live in the run log, not in this document.

**Not working / not done**

- **The production gas grant is off by default.** `/api/grant` refuses every request unless the
  server-side env var `ARASO_GRANT_ENABLED` is explicitly set (see "Security model"). Deploying
  the app does not, by itself, put funds at risk — but it also means the grant does not work until
  someone turns it on deliberately.
- **There is no public deployment.** No hosted URL is published as part of this submission yet.
- **No demo video yet.**
- **No `LICENSE` file yet** (see "Open source license" below).
- Whether this repository is currently public has **not been verified** at the time of writing.

Anything not listed under "Working" above should be read as unproven.

---

## Architecture

```
browser (app/)                       Monad Testnet (chain id 10143)
┌──────────────────────────┐         ┌──────────────────────────────┐
│ vanilla-JS scene engine  │         │ ShMonad  0x282BdDFF…8745C9   │
│  main.js = scenes, state │─viem──▶ │   deposit() / redeem()       │
│  job-feed / job-selector │         │                              │
│  rule-decision           │         │ GiftPiggy 0xfe7668db…        │
│  piggy-depart / -return  │         │   (gift links)               │
│  receipt-paper, records  │         └──────────────────────────────┘
│                          │
│ mera passkey account     │
│  PRF → viem account      │
└───────────┬──────────────┘
            │ POST /grant {address}
            ▼
┌──────────────────────────┐
│ api/grant.js (serverless)│  one-time 0.1 MON native transfer
│ relayer/ (local dev twin)│  shares relayer/src/policy.mjs
└──────────────────────────┘
```

- **No custom contracts were written for this build.** The app reads and writes existing deployed
  contracts; the grant path is a plain native transfer, not a contract call and not a meta-tx.
- The app holds a single live Piggy plus status cards; on-chain activity belongs to that one Piggy.
- Receipts are stored client-side and keyed on the real transaction hash, so a receipt without a
  tx hash is never presented as a completed journey.

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
  no custody, no backend. The credential is bound to an rpId — see "Passkey loss" below.
- **Signing session.** While a session is open the key is in page memory and signatures need no
  further biometric prompt. This is the sharpest edge in the design: anything that can run script
  in our origin during an open session can sign. That is why the deployed CSP forbids inline and
  `eval`'d script and pins `connect-src` to this origin plus the Monad RPC (`vercel.json`).
- **The relayer / grant function.** It never holds a user key and cannot move user funds. It can
  only send a fixed 0.1 MON native transfer from its own wallet, and it can censor or delay.
  Policy values (chain id, amount, gas, body schema) are server-owned in `relayer/src/policy.mjs`
  and cannot be overridden by the request body — the body carries one field, `address`.
- **Test harness.** The local WebAuthn test hook is gated three ways (a non-default Vite mode,
  an explicit `VITE_ARASO_LOCAL_DEV_ENTRY=1`, and the isolated harness rpId
  `araso-harness.local.test`), so the "Harness Piggy" is a separate identity from any production
  account and has no path into the production boundary. The build is checked to contain none of
  those markers: `npm run build && grep -R "araso-harness" dist` returns nothing.

### Grant boundary: honest status

- **Disabled: `HARDENED_DEFAULT`.** Without `ARASO_GRANT_ENABLED`, `/api/grant` returns `503`
  before parsing a body, before loading the key, and before any RPC call or transaction.
- **Enabled: `STILL_PARTIAL_WHEN_ENABLED`.** Vercel functions share no disk and no process, so the
  local relayer's reserve→confirm ledger does not apply. The stateless substitute is a recipient
  balance threshold. Two concurrent requests cannot see each other's effect, so a **double-spend
  window remains**. This is not exact-once and is not claimed to be. The hard ceiling is the
  relayer wallet balance.

### Passkey loss and domain moves — no recovery is implemented

- A Mera account is derived from a passkey, and **a credential created under one rpId cannot be
  used under another**. Moving the app to a different domain therefore produces *different
  accounts*, not the same account on a new host.
- **Deleting the passkey destroys the account.** This has been observed directly during
  development: removing the Araso entries from a device keychain left the derived address
  permanently unreachable, along with the funds on it.
- **This repository implements no recovery for that case.** Mera documents a secret-vault feature,
  but it is not wired up here, and in any case a vault that can only be decrypted by the same
  passkey is not a remedy for losing that passkey. Treat any account created against this build as
  disposable testnet material.
- Passkey sync (iCloud Keychain, Google Password Manager) makes the account portable across a
  vendor's devices and, by the same token, makes that vendor account part of the wallet's security.
  Different sync ecosystems yield different addresses.

## Technology stack

| Layer | What |
|---|---|
| Frontend | Vanilla JavaScript modules, no framework; Vite 7 dev server and build |
| Chain client | `viem` ^2.56 |
| Accounts | `@category-labs/mera` 0.2 — passkey + WebAuthn PRF, `toViemAccount` bridge |
| Gas grant | Node serverless function (`api/grant.js`) on Vercel; `relayer/src/server.mjs` for local dev |
| Tests | Plain `node` scripts under `app/test/` and `relayer/test/` (no test framework, no network) |
| Hosting config | `vercel.json` (build to `dist/`, function bundles the shared policy module) |

## Monad integration

Only values already confirmed in this repository are listed. Nothing here is invented.

| Item | Value |
|---|---|
| Network | Monad Testnet |
| Chain id | `10143` |
| RPC | `https://testnet-rpc.monad.xyz` (overridable via `MONAD_RPC_URL`) |
| ShMonad (shMON) | `0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9` — `deposit` / `redeem` |
| GiftPiggy | `0xfe7668db…` (chain 10143) — deployed in our earlier gift-piggy project and reused |

Notes:

- The GiftPiggy address is recorded in our build notes in truncated form. The **full checksummed
  address is UNKNOWN in this document** and must be filled in from the deployment record before
  submission rather than guessed.
- How the project leverages Monad: user accounts are passkey-derived EOAs on Monad Testnet; the
  Piggy's "job" is an actual shMON `deposit` (and, on return, `redeem`); the condition check that
  decides whether the Piggy works or comes home empty-handed is meant to compare the user's stated
  rule against a value read from chain at a specific block, and the receipt carries the tx hash and
  block number. See "Status" for how much of that path has actually executed on testnet.

## Setup

Requires Node.js with `--env-file` support (Node 20+).

```bash
npm ci          # honours package-lock.json; `npm install` may float within semver ranges

# frontend dev server
npm run dev

# production build (outputs to dist/)
npm run build

# local gas-grant relayer (needs RELAYER_PRIVATE_KEY in .env)
npm run relayer

# offline relayer smoke test — no network, no real key
npm run relayer:test

# offline security-boundary tests — grant launch gate + deployment headers
npm run test:security
```

Environment variables:

| Name | Where | Purpose |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | relayer / serverless function | Funds the one-time gas grant. Passed via environment only — never written to a file. The server refuses to start without it. |
| `ARASO_GRANT_ENABLED` | serverless function (server-side only) | Launch gate for `/api/grant`. Accepts `1` or `true`; anything else, including unset, keeps the endpoint closed (`503`) before any transaction. Deliberately **not** `VITE_`-prefixed — a `VITE_` name would be baked into the client bundle. |
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

Deployment instructions: **not written yet** — no public deployment exists (see "Status").

## Prior work reused

Character and surface art comes from our earlier project (gift-piggy), reused as files:

- Egg — SVG set of 6 frames (idle · squash · stretch · bulge · react · crack)
- Chog — idle vector, and the v3 walk cycle (10 frames)
- Notebook paper texture used behind every scene

Also reused from gift-piggy: the **GiftPiggy contract already deployed on Monad Testnet**
(`0xfe7668db…`) together with its signing and submission logic. The claim endpoint and the
receiving UI in this repository are new — gift-piggy had no frontend for them.

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

**Not yet added.** The hackathon rules require an open source license (MIT, Apache 2.0, GPL, or
similar) in the submitted repository. Choosing and adding that file is an outstanding decision for
the project owner; this document does not pick one on their behalf.

## Attribution

- Built by **applemint00** (``).
- Art and the GiftPiggy contract originate in the author's earlier **gift-piggy** project, as
  described under "Prior work reused".
- Fonts and libraries are attributed under "Third-party libraries and assets".
