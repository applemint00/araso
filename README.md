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

## What works today

| Area | Current scope |
|---|---|
| First Journey | A real testnet deposit → redeem → reopened Receipt round trip has succeeded. |
| Passkey & Home | Passkey creation/sign-in, existing-passkey lookup, multi-Piggy presentation and responsive HISTORY. Final real-iPhone Face ID/PWA validation is pending. |
| Second Journey | UI/state, readiness, permission, amount, Away/Return and receipt-bridge modules are implemented. The production execution adapter is still planned; DEV/mock flows are not live transactions. |
| Mainnet | Explicit chain profiles and a local, fork-only Aave USDC lane. No live mainnet execution, deployment or funding; this lane is not a production app path. |

Released **1 October 2026**:
[`082d410`](https://github.com/applemint00/araso/commit/082d410566c67f22bea5fde160fe5a8f8509daa3).
**101/101 regression suites**, security/visual reviews and production browser smoke
checks passed. The deployed JavaScript matched the validated build. Browser smoke
used synthetic UI state, without real credentials or transactions; it is not a
security audit or final device validation. The demo is public; the repository is private.

<details>
<summary>Recorded testnet round trip</summary>

| Leg | Transaction (abbreviated) | Block |
|---|---|---|
| deposit | `0x2cdf…6648` | 64272690 |
| redeem | `0xadb1…1831` | 64272695 |

Both mined with status `0x1`. This was one prefunded run without the gas grant,
not a reliability guarantee. The abbreviated hashes are not explorer links.

</details>

## Build & run

Node.js **20.19+ on 20.x, or 22.12+**.

```bash
npm ci
npm run dev            # local UI development
npm run build          # production output: dist/
npm run test:security  # offline grant and deployment-header checks
```

**Stack:** vanilla JavaScript + Vite, Mera passkeys, `viem`, Vercel.
The browser signs and submits to Monad directly; an optional server-side gas-grant
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
- The gas grant is disabled by default in code. If enabled, its serverless path
  can make duplicate payments under concurrent requests; it is not exact-once.
  The deployed enablement is not asserted here.

## Credits & license

Built by **applemint00**. Prior work reused from **gift-piggy**: Egg/Chog artwork,
notebook texture, the existing testnet GiftPiggy contract and its signing/submission
logic. The receiving UI and claim integration are new to this build; reuse does
not imply a live mainnet Gift deployment.

Mera, viem and Vite retain their respective licenses. Delicious Handrawn is under
[SIL Open Font License](app/public/card/DeliciousHandrawn-OFL.txt).
Claude Code and OpenAI Codex assisted implementation, testing, review and documentation;
the author is responsible for the submitted code.

**Repository license not yet added. Demo video not yet linked.**
