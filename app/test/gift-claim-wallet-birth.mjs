// [A-495 Lane G] **Gift claim 루프 증명** — 격리 하네스.
//   node app/test/gift-claim-wallet-birth.mjs
//
// 증명하려는 것:
//   1) 보내는 사람의 Piggy 가 **격리 rpId 안에서** 실제 passkey/PRF 로 태어난다(A-493 스택 그대로).
//   2) 받는 사람이 claim 링크를 열면 **자기만의 새 Piggy 정체성/주소**가 생긴다.
//   3) 받는 사람이 그 주소로 **실제로 서명**한다 — 서명이 소유 증명이다.
//   4) 그 서명을 **viem 으로 검증**한 뒤에야 claim 이 닫힌다. 가장은 거부된다.
//   5) 보낸 주소와 받은 주소가 **서로 다르고 조회 가능하다**.
//
// 증명하지 **않는** 것(이 카드에서 허락되지 않았다):
//   · 실제 자금 이동. tx 0 · real funding 0 · RPC 0 · GiftPiggy 컨트랙트 호출 0.
//   · 그래서 최종 proof level 은 `identity_claimed_no_value_moved` 에서 멈춘다. 그 위는 UNPROVEN.
//
// 지키는 것: production rpId 0 · anvil 가장 0 · 비밀/PRF/개인키 출력 0(지문만).
// 이 스크립트가 만든 비밀은 메모리 안에서만 살고 어디에도 저장되지 않는다.
//
// 위치: 이 루프 증명은 공개 테스트로 `app/test/` 에 둔다(A-493 하네스는 로컬 전용).
import crypto from "node:crypto";
import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getEvmAddress } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { verifyMessage, recoverMessageAddress } from "viem";
import {
  CLAIM_RESULT,
  PROOF_LEVEL,
  TRANSFER_STATUS,
  buildClaimUrl,
  claimParties,
  claimStatement,
  createClaimLink,
  parseClaimUrl,
  openClaimLink,
  proofLevel,
  sealClaimLink,
  settleClaim,
} from "../src/gift-piggy-claim-link.js";

const HARNESS_RP_ID = "araso-harness.local.test";
const PRODUCTION_RP_ID = "araso.app";
if (HARNESS_RP_ID === PRODUCTION_RP_ID) { console.error("STOP: production rpId"); process.exit(2); }

const CHAIN_ID = "143"; // 표기만 한다. 이 하네스는 체인에 **접속하지 않는다**.
const PRF_SALT = new Uint8Array(32).fill(7);

// A-493 harness 와 같은 방식: 한 Piggy = 한 자격증명 = 한 비밀.
function makePiggyWebAuthnClient(secret, rpId, piggyLabel) {
  const hmac = (label, extra) => {
    const h = crypto.createHmac("sha256", secret).update(label).update("|").update(rpId).update("|").update(piggyLabel);
    if (extra) h.update("|").update(Buffer.from(extra));
    return new Uint8Array(h.digest());
  };
  const credentialId = hmac("araso-harness/credential-id/v1");
  const prfFor = (salt) => hmac("araso-harness/prf/v1", salt);
  return {
    credentialId,
    prfSalt: PRF_SALT,
    async createCredential(req) {
      if (!(req?.prfSalt instanceof Uint8Array) || req.prfSalt.length !== 32) throw new Error("prfSalt must be 32 bytes");
      return { credentialId, transports: ["internal"], prfEnabled: true, prfOutput: prfFor(req.prfSalt) };
    },
    async getCredential(req) {
      if (!(req?.prfSalt instanceof Uint8Array) || req.prfSalt.length !== 32) throw new Error("prfSalt must be 32 bytes");
      return { credentialId, prfOutput: prfFor(req.prfSalt) };
    },
  };
}

const fingerprint = (bytes) => crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex").slice(0, 16);

// 제품과 **같은 경로**로 지갑을 연다: passkey → PRF → signing session → viem account.
async function birthPiggy(secret, piggyLabel) {
  const client = makePiggyWebAuthnClient(secret, HARNESS_RP_ID, piggyLabel);
  const created = await createPasskeyWithPrfOutput({
    rp: { id: HARNESS_RP_ID, name: "Araso harness" },
    user: { name: piggyLabel, displayName: piggyLabel },
    prfSalt: client.prfSalt,
    webAuthnClient: client,
  });
  const session = createSecp256k1SigningSession({ privateKey: created.prfOutput });
  const address = getEvmAddress(session.publicKey);
  return { address, account: toViemAccount(session), credentialFingerprint: fingerprint(created.credentialId) };
}

const out = {
  card: "A-495 lane G",
  rpId: HARNESS_RP_ID,
  productionRpIdUsed: false,
  realTx: 0,
  realFunding: 0,
  rpcCalls: 0,
  contractCalls: 0,
  steps: [],
  checks: {},
};

// 이 실행에서만 쓰는 비밀 — **저장하지 않고 출력하지 않는다**.
const ephemeralSecret = crypto.randomBytes(32);

// ── 1. 보내는 사람의 Piggy 가 태어난다 ─────────────────────────────────────────
const sender = await birthPiggy(ephemeralSecret, "gift:sender-home");
out.steps.push({ step: "sender_wallet_birth", address: sender.address, credentialFingerprint: sender.credentialFingerprint });

// ── 2. 보내는 사람이 claim 링크를 만든다 ───────────────────────────────────────
const createdAt = "2026-09-21T09:00:00Z";
const made = createClaimLink({
  giftId: "gift-lane-g-001",
  senderAddress: sender.address,
  chainId: CHAIN_ID,
  createdAt,
  expiresAt: "2026-10-21T09:00:00Z",
  note: "a little something",
});
if (!made.ok) { console.error("STOP: could not create claim link:", made.reason); process.exit(2); }
let record = await sealClaimLink(made.record, made.token);
const url = buildClaimUrl("https://araso-harness.local.test", { giftId: record.giftId, token: made.token });
out.steps.push({
  step: "claim_link_created",
  urlShape: url.replace(made.token, "<token-in-fragment>"),
  tokenInStoredRecord: JSON.stringify(record).includes(made.token),
  proofLevel: proofLevel(record),
});
out.checks.tokenNeverStored = !JSON.stringify(record).includes(made.token);
out.checks.tokenOnlyInFragment = url.slice(0, url.indexOf("#")).indexOf(made.token) === -1;

// ── 3. 받는 사람이 링크를 연다 ─────────────────────────────────────────────────
const parsed = parseClaimUrl(url);
out.checks.recipientCanParseLink = parsed.ok && parsed.token === made.token;
const opened = await openClaimLink(record, parsed.token, { now: "2026-09-21T10:00:00Z" });
out.checks.linkOpens = opened.result === CLAIM_RESULT.OK;
out.checks.openSaysNoMoneyMovedYet = opened.transfer?.status === TRANSFER_STATUS.NOT_ATTEMPTED;

// ── 4. 링크를 연 사람이 **자기 Piggy** 를 얻는다 (새 정체성, 새 주소) ──────────
// 받는 사람은 보내는 사람과 **다른 비밀**을 가진다 — 다른 기기, 다른 사람이니까.
const recipientSecret = crypto.randomBytes(32);
const recipient = await birthPiggy(recipientSecret, "gift:recipient-home");
out.steps.push({ step: "recipient_wallet_birth_on_open", address: recipient.address, credentialFingerprint: recipient.credentialFingerprint });
out.checks.recipientGotOwnAddress = /^0x[0-9a-fA-F]{40}$/.test(recipient.address);
out.checks.addressesDistinct = recipient.address.toLowerCase() !== sender.address.toLowerCase();

// ── 5. 받는 사람이 claim 문장에 **실제로 서명**한다 ────────────────────────────
const claimedAt = "2026-09-21T10:00:05Z";
const statement = claimStatement({
  giftId: record.giftId,
  chainId: record.chainId,
  senderAddress: record.senderAddress,
  recipientAddress: recipient.address,
  claimTokenHash: record.claimTokenHash,
  claimedAt,
});
const signature = await recipient.account.signMessage({ message: statement });
const recovered = await recoverMessageAddress({ message: statement, signature });
const verified = await verifyMessage({ address: recipient.address, message: statement, signature });
out.checks.recipientSignatureVerifies = verified && recovered.toLowerCase() === recipient.address.toLowerCase();
out.steps.push({ step: "recipient_signed_claim", signatureLength: signature.length, verified: out.checks.recipientSignatureVerifies });

// ── 6. 가장(impersonation)은 거부되는가 ────────────────────────────────────────
// 보내는 사람이 "받는 사람 대신" claim 을 닫으려 한다. 서명자가 다르니 거부되어야 한다.
{
  const impostorSig = await sender.account.signMessage({ message: statement });
  const impostorRecovered = await recoverMessageAddress({ message: statement, signature: impostorSig });
  const attempt = await settleClaim(record, {
    token: parsed.token,
    recipientAddress: recipient.address,
    verifiedSignerAddress: impostorRecovered, // 실제로 검증해서 나온 주소 = sender
    claimedAt,
    now: claimedAt,
  });
  out.checks.impersonationRefused = attempt.result === CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE
    && attempt.record.recipientAddress === null;
  out.steps.push({ step: "impersonation_attempt", result: attempt.result });
}

// ── 7. 진짜 서명으로 claim 이 닫힌다 ───────────────────────────────────────────
const settled = await settleClaim(record, {
  token: parsed.token,
  recipientAddress: recipient.address,
  verifiedSignerAddress: recovered, // **검증으로 얻은** 주소만 넘긴다
  signatureFingerprint: crypto.createHash("sha256").update(signature).digest("hex").slice(0, 16),
  claimedAt,
  now: claimedAt,
});
out.checks.claimClosed = settled.result === CLAIM_RESULT.OK;
record = settled.record;

// ── 8. 두 주소가 서로 다르고 **조회 가능한가** ─────────────────────────────────
const parties = claimParties(record);
out.parties = parties;
out.checks.partiesQueryable = !!parties && parties.senderAddress === sender.address
  && parties.recipientAddress === recipient.address && parties.distinct === true;

// ── 9. 값 이동은 **여전히 시도되지 않았다** ────────────────────────────────────
out.checks.noValueMoved = record.transfer.status === TRANSFER_STATUS.NOT_ATTEMPTED && record.transfer.txHash === null;
out.proofLevel = proofLevel(record);
out.checks.proofLevelHonest = out.proofLevel === PROOF_LEVEL.IDENTITY_CLAIMED_NO_VALUE_MOVED;

// ── 10. 비밀이 새지 않았는가 ───────────────────────────────────────────────────
const serialized = JSON.stringify(out);
const leaks = [ephemeralSecret, recipientSecret]
  .flatMap((s) => [s.toString("hex"), s.toString("base64")])
  .concat([made.token, signature]);
out.checks.noSecretInOutput = leaks.every((s) => !serialized.includes(s))
  && !/privateKey|prfOutput|mnemonic|seed/i.test(serialized);

const required = [
  "tokenNeverStored", "tokenOnlyInFragment", "recipientCanParseLink", "linkOpens",
  "openSaysNoMoneyMovedYet", "recipientGotOwnAddress", "addressesDistinct",
  "recipientSignatureVerifies", "impersonationRefused", "claimClosed",
  "partiesQueryable", "noValueMoved", "proofLevelHonest", "noSecretInOutput",
];
const failed = required.filter((k) => out.checks[k] !== true);
out.verdict = failed.length === 0 ? "PASS_GIFT_CLAIM_LINK_WALLET_BIRTH_HARNESS" : "UNPROVEN";
out.failedChecks = failed;
out.unproven = [
  "실제 자금이 받는 사람 Piggy 에 도착하는 것 — tx 0, 이 카드에서 금지.",
  "배포된 GiftPiggy 컨트랙트와의 실제 상호작용 — 전체 checksummed 주소가 이 저장소에서 UNKNOWN.",
  "링크 레코드를 어디에 두는가(서버/공유 저장소) — 이 하네스는 메모리 한 프로세스 안이다.",
  "실제 브라우저 passkey UX(rpId araso.app) — 격리 rpId 로만 증명했다.",
];
out.note = "격리 rpId 하네스. anvil 가장 0 · 실거래 0 · 실제 자금 0 · RPC 0 · production rpId 0.";
console.log(JSON.stringify(out, null, 2));
if (failed.length) process.exitCode = 1;
