// [A-1063 RE-PIN] Reverse ONLY the approved Railway Gift hunks for older baseline tests.
// No baseline replacement: each current hunk must occur exactly once, otherwise FAIL.
import assert from "node:assert/strict";
const HUNKS = [
  [
    "// \"forkGift\") with a complete fork Gift build config:\n//   · record source  = the configured fork escrow (fork_local_test_only, accepted on the fork profile only), read through the page's\n//                      fork RPC under the one RPC judge (chain-profile.js rpcUrlAllowed); handed to gift-claim-entry.js useForkGiftRecordSource;\n//   · claim          = the base settle still opens the record, checks the signer and signs the claim statement; only its \"no transport\" end goes\n//                      to the 7702 sponsor submitter (POST to this fork Guard's /gift-sponsor);\n//   · create step    = the Gift create executor with a fork config (a915Cfg · pre-Face-ID check · gas + fee line), after the fork entry server says yes\n",
    "// \"forkGift\") with a complete fork Gift build config:\n//   · record source  = the fork escrow (the local-fork escrow address below; fork_local_test_only, accepted on the fork profile only), read through the page's\n//                      fork RPC under the one RPC judge (chain-profile.js rpcUrlAllowed); handed to gift-claim-entry.js useForkGiftRecordSource;\n//   · claim          = the base settle still opens the record, checks the signer and signs the claim statement; only its \"no transport\" end goes\n//                      to the 7702 sponsor submitter (same-origin POST /api/gift-sponsor);\n//   · create step    = the Gift create executor with a fork config (a915Cfg · pre-Face-ID check · gas + fee line), after the fork entry server says yes\n"
  ],
  [
    "// VITE_ARASO_FORK_MON_USD (fork MON has no market: the price the existing fee line uses on the fork; a fork fixture, read nowhere else).\nimport { GIFT_DEPLOYMENT as a966GiftDeployment, RPC_DEV_BUILD as a966DevBuild, resolveGiftEscrowConfig as a966EscrowConfig, rpcUrlAllowed as a966RpcAllowed, resolveForkGiftTransport as a1063GiftTransport } from \"./chain-profile.js\";\nimport { FORK_CHAIN_ID as a966ForkChainId } from \"./funding-context.js\";\n",
    "// VITE_ARASO_FORK_MON_USD (fork MON has no market: the price the existing fee line uses on the fork; a fork fixture, read nowhere else).\nimport { GIFT_DEPLOYMENT as a966GiftDeployment, RPC_DEV_BUILD as a966DevBuild, resolveGiftEscrowConfig as a966EscrowConfig, rpcUrlAllowed as a966RpcAllowed } from \"./chain-profile.js\";\nimport { FORK_CHAIN_ID as a966ForkChainId } from \"./funding-context.js\";\n"
  ],
  [
    "import { custom as a966Custom, defineChain as a966DefineChain } from \"viem\";\nconst A966_FORK_GIFT_EXPIRY_SECONDS = 7 * 24 * 3600; // the fork Gift's deadline from now (wall clock; the escrow checks it on the fork's slower clock)\n",
    "import { custom as a966Custom, defineChain as a966DefineChain } from \"viem\";\nconst A966_FORK_GIFT_ESCROW = \"0xde5e2b28ea7da624e9fdf881714bf3d615485c4d\"; // the 5-arg Gift escrow deployed on the local fork (fork-local only; private receipt)\nconst A966_FORK_GIFT_EXPIRY_SECONDS = 7 * 24 * 3600; // the fork Gift's deadline from now (wall clock; the escrow checks it on the fork's slower clock)\n"
  ],
  [
    "    if (!journeyFeatureOpen(\"forkGift\", { level: RELEASE_LEVEL, profile: CHAIN_PROFILE }) || CHAIN_PROFILE.numericChainId !== a966ForkChainId) return null;\n    const endpoint = a1063GiftTransport(CHAIN_PROFILE, { sponsorUrl: env.VITE_ARASO_FORK_GIFT_SPONSOR_URL, escrow: env.VITE_ARASO_FORK_GIFT_ESCROW });\n    if (!endpoint) return null;\n    const escrow = a966EscrowConfig(CHAIN_PROFILE, { chainScope: CHAIN_PROFILE.scope, contractAddress: endpoint.escrow, deployment: a966GiftDeployment.FORK_LOCAL_TEST_ONLY }, { allowForkLocal: true });\n    const sponsor = String(env.VITE_ARASO_FORK_GIFT_SPONSOR || \"\").trim();\n",
    "    if (!journeyFeatureOpen(\"forkGift\", { level: RELEASE_LEVEL, profile: CHAIN_PROFILE }) || CHAIN_PROFILE.numericChainId !== a966ForkChainId) return null;\n    const escrow = a966EscrowConfig(CHAIN_PROFILE, { chainScope: CHAIN_PROFILE.scope, contractAddress: A966_FORK_GIFT_ESCROW, deployment: a966GiftDeployment.FORK_LOCAL_TEST_ONLY }, { allowForkLocal: true });\n    const sponsor = String(env.VITE_ARASO_FORK_GIFT_SPONSOR || \"\").trim();\n"
  ],
  [
    "    const post = async (body) => {\n      const res = await fetch(endpoint.sponsorUrl, { method: \"POST\", headers: { \"content-type\": \"application/json\" }, body: JSON.stringify({ ...body, forkInstanceId: CHAIN_PROFILE.forkInstanceId, escrowAddress: escrow.config.contractAddress }) });\n      let b = null; try { b = await res.json(); } catch { b = null; }\n",
    "    const post = async (body) => {\n      const res = await fetch(\"/api/gift-sponsor\", { method: \"POST\", headers: { \"content-type\": \"application/json\" }, body: JSON.stringify(body) });\n      let b = null; try { b = await res.json(); } catch { b = null; }\n"
  ],
  [
    "    return Object.freeze({\n      escrow: escrow.config.contractAddress, sponsor, client, chain, transport, submitter, monUsd, bufferBps, post,\n      gasUnits: Object.freeze({ install: BigInt(units[0]), commitClaim: BigInt(units[1]), revoke: BigInt(units[2]), claim: BigInt(units[3]), fundingTransfer: 21000n }),\n",
    "    return Object.freeze({\n      escrow: escrow.config.contractAddress, sponsor, client, chain, transport, submitter, monUsd, bufferBps,\n      gasUnits: Object.freeze({ install: BigInt(units[0]), commitClaim: BigInt(units[1]), revoke: BigInt(units[2]), claim: BigInt(units[3]), fundingTransfer: 21000n }),\n"
  ],
  [
    "    chainId: a966ForkChainId, escrowAddress: F.escrow, sponsorAddress: F.sponsor, gas: () => forkGas(),\n    client: Object.freeze({ register: F.post }),\n    giftExpiryUnix: () => Math.floor(Date.now() / 1000) + A966_FORK_GIFT_EXPIRY_SECONDS, receiptTimeoutMs: 120000,\n",
    "    chainId: a966ForkChainId, escrowAddress: F.escrow, sponsorAddress: F.sponsor, gas: () => forkGas(),\n    giftExpiryUnix: () => Math.floor(Date.now() / 1000) + A966_FORK_GIFT_EXPIRY_SECONDS, receiptTimeoutMs: 120000,\n"
  ]
];
export function restoreA1063ForkGift(s) {
  for (const [current, prior] of HUNKS) {
    assert.equal(s.split(current).length, 2, "A1063 approved hunk must match exactly once");
    s = s.replace(current, () => prior);
  }
  return s;
}
