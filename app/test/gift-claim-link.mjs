// [A-495 Lane G] Gift claim-link 계약 — 네트워크 0 · 체인 0 · tx 0.
//   node app/test/gift-claim-link.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLAIM_RESULT,
  CLAIM_STATUS,
  GIFT_LINK_VERSION,
  PROOF_LEVEL,
  TRANSFER_STATUS,
  attachTransferReceipt,
  buildClaimUrl,
  claimParties,
  claimStatement,
  createClaimLink,
  hashClaimToken,
  isStorableLinkRecord,
  mintClaimToken,
  openClaimLink,
  parseClaimUrl,
  proofLevel,
  revokeClaimLink,
  sealClaimLink,
  settleClaim,
} from "../src/gift-piggy-claim-link.js";

const SRC = readFileSync(new URL("../src/gift-piggy-claim-link.js", import.meta.url), "utf8");

const SENDER = "0x00000000000000000000000000000000000000a1";
const RECIPIENT = "0x00000000000000000000000000000000000000b2";
const STRANGER = "0x00000000000000000000000000000000000000c3";
const CHAIN = "143";
const T0 = "2026-09-21T09:00:00Z";
const T1 = "2026-09-21T10:00:00Z";
const T_LATE = "2026-09-30T00:00:00Z";

let pass = 0;
const results = [];
function test(name, fn) { results.push([name, fn]); }
async function run() {
  for (const [name, fn] of results) {
    try { await fn(); pass += 1; console.log(`PASS  ${name}`); }
    catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
  }
  console.log(`\n${pass}/${results.length} PASS`);
}

async function freshLink(overrides = {}) {
  const made = createClaimLink({
    giftId: "g-001", senderAddress: SENDER, chainId: CHAIN, createdAt: T0, note: "for you", ...overrides,
  });
  assert.equal(made.ok, true, made.reason);
  const record = await sealClaimLink(made.record, made.token);
  return { token: made.token, record };
}

// ── 링크 만들기 ────────────────────────────────────────────────────────────────
test("a link needs a real sender address", () => {
  assert.equal(createClaimLink({ giftId: "g", senderAddress: "0xnope", chainId: CHAIN, createdAt: T0 }).reason, "bad_sender_address");
});

test("an expiry before creation is refused rather than silently fixed", () => {
  const r = createClaimLink({ giftId: "g", senderAddress: SENDER, chainId: CHAIN, createdAt: T1, expiresAt: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad_expiry");
});

test("the raw token is returned once and never lives in the record", async () => {
  const { token, record } = await freshLink();
  assert.match(token, /^[A-Za-z0-9_-]{22,86}$/);
  assert.equal(JSON.stringify(record).includes(token), false);
  assert.equal(record.claimTokenHash, await hashClaimToken(token));
});

test("two minted tokens are not the same", () => {
  assert.notEqual(mintClaimToken(), mintClaimToken());
});

test("an unsealed record cannot be stored", async () => {
  const made = createClaimLink({ giftId: "g", senderAddress: SENDER, chainId: CHAIN, createdAt: T0 });
  assert.equal(isStorableLinkRecord(made.record), false);
  assert.equal(isStorableLinkRecord(await sealClaimLink(made.record, made.token)), true);
});

test("a record carrying a secret-like field is refused storage", async () => {
  const { record } = await freshLink();
  assert.equal(isStorableLinkRecord({ ...record, prfOutput: "x" }), false);
  assert.equal(isStorableLinkRecord({ ...record, claimProof: { sessionKey: "x" } }), false);
});

// ── URL ────────────────────────────────────────────────────────────────────────
test("the token rides in the fragment, never the query", async () => {
  const { token } = await freshLink();
  const url = buildClaimUrl("https://araso.app/", { giftId: "g-001", token });
  assert.ok(url.includes("#"));
  assert.equal(url.slice(0, url.indexOf("#")).includes(token), false);
  assert.ok(url.indexOf(token) > url.indexOf("#"));
});

test("a round trip through the URL recovers the one capability token", async () => {
  const { token } = await freshLink();
  const parsed = parseClaimUrl(buildClaimUrl("https://araso.app", { giftId: "g-001", token }));
  assert.deepEqual(parsed, { ok: true, token });
});

test("display metadata never rides in the short Gift fragment", async () => {
  const { token } = await freshLink();
  const note = "02\nDana\nfor you\nSam";
  const parsed = parseClaimUrl(buildClaimUrl("https://araso.app", { giftId: "g-001", token, note, amountUsd: 20 }));
  assert.deepEqual(parsed, { ok: true, token });
  const url = buildClaimUrl("https://araso.app", { giftId: "g-001", token, note, amountUsd: 20 });
  assert.equal(url.includes("&n="), false);
  assert.equal(url.includes("&a="), false);
  assert.match(url, /\/gift#t=/);
});

test("a link with no fragment or a wrong version is not guessed at", () => {
  assert.equal(parseClaimUrl("https://araso.app/claim").reason, "no_fragment");
  assert.equal(parseClaimUrl(`https://araso.app/claim#g=a&t=${"A".repeat(43)}&v=99`).reason, "version_mismatch");
  assert.equal(parseClaimUrl("https://araso.app/claim#g=a&t=short&v=1").reason, "bad_token");
});

// ── 여는 단계 ──────────────────────────────────────────────────────────────────
test("the right token opens the link and says plainly that no money moved", async () => {
  const { token, record } = await freshLink();
  const opened = await openClaimLink(record, token, { now: T1 });
  assert.equal(opened.result, CLAIM_RESULT.OK);
  assert.equal(opened.senderAddress, SENDER);
  assert.equal(opened.transfer.status, TRANSFER_STATUS.NOT_ATTEMPTED);
});

test("a wrong token does not open the link", async () => {
  const { record } = await freshLink();
  const other = mintClaimToken();
  assert.equal((await openClaimLink(record, other, { now: T1 })).result, CLAIM_RESULT.BAD_TOKEN);
});

test("an expired link is expired, not claimable", async () => {
  const { token, record } = await freshLink({ expiresAt: T1 });
  assert.equal((await openClaimLink(record, token, { now: T_LATE })).result, CLAIM_RESULT.EXPIRED);
  assert.equal((await settleClaim(record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT, claimedAt: T_LATE, now: T_LATE,
  })).result, CLAIM_RESULT.EXPIRED);
});

test("a revoked link stops working, and a claimed one cannot be revoked", async () => {
  const { token, record } = await freshLink();
  const revoked = revokeClaimLink(record);
  assert.equal(revoked.ok, true);
  assert.equal((await openClaimLink(revoked.record, token, { now: T1 })).result, CLAIM_RESULT.REVOKED);
  const claimed = await settleClaim(record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT, claimedAt: T1, now: T1,
  });
  assert.equal(revokeClaimLink(claimed.record).reason, "already_claimed");
});

// ── 소유 증명 ──────────────────────────────────────────────────────────────────
test("impersonation is refused: the signer must be the recipient", async () => {
  const { token, record } = await freshLink();
  const r = await settleClaim(record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: STRANGER, claimedAt: T1, now: T1,
  });
  assert.equal(r.result, CLAIM_RESULT.NOT_PROVEN_BY_SIGNATURE);
  assert.equal(r.record.status, CLAIM_STATUS.UNCLAIMED);
});

test("a claim with no recipient identity at all is refused", async () => {
  const { token, record } = await freshLink();
  const r = await settleClaim(record, { token, recipientAddress: "", verifiedSignerAddress: "", claimedAt: T1, now: T1 });
  assert.equal(r.result, CLAIM_RESULT.NO_RECIPIENT_IDENTITY);
});

test("the sender cannot claim their own gift", async () => {
  const { token, record } = await freshLink();
  const r = await settleClaim(record, {
    token, recipientAddress: SENDER, verifiedSignerAddress: SENDER, claimedAt: T1, now: T1,
  });
  assert.equal(r.result, CLAIM_RESULT.SENDER_IS_RECIPIENT);
});

test("the statement binds gift, chain, both addresses and the link", () => {
  const s = claimStatement({
    giftId: "g-001", chainId: CHAIN, senderAddress: SENDER, recipientAddress: RECIPIENT,
    claimTokenHash: "a".repeat(64), claimedAt: T1,
  });
  for (const part of ["gift:g-001", `chain:${CHAIN}`, `from:${SENDER}`, `to:${RECIPIENT}`, `link:${"a".repeat(64)}`, `at:${T1}`]) {
    assert.ok(s.includes(part), part);
  }
  assert.equal(claimStatement({ giftId: "g", chainId: CHAIN, senderAddress: SENDER, recipientAddress: "0x1", claimTokenHash: "a".repeat(64), claimedAt: T1 }), null);
});

test("a proven claim closes the link and the two addresses are distinct and queryable", async () => {
  const { token, record } = await freshLink();
  const r = await settleClaim(record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT,
    signatureFingerprint: "deadbeef", claimedAt: T1, now: T1,
  });
  assert.equal(r.result, CLAIM_RESULT.OK);
  assert.equal(r.record.status, CLAIM_STATUS.CLAIMED);
  const parties = claimParties(r.record);
  assert.deepEqual(parties, { senderAddress: SENDER, recipientAddress: RECIPIENT, distinct: true, chainId: CHAIN });
  assert.match(r.record.claimProof.statementHash, /^[0-9a-f]{64}$/);
  assert.equal(isStorableLinkRecord(r.record), true);
});

test("the same recipient re-opening the link is told so, a stranger is told something else", async () => {
  const { token, record } = await freshLink();
  const first = await settleClaim(record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT, claimedAt: T1, now: T1,
  });
  const again = await settleClaim(first.record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT, claimedAt: T1, now: T1,
  });
  assert.equal(again.result, CLAIM_RESULT.ALREADY_CLAIMED_BY_SAME);
  const other = await settleClaim(first.record, {
    token, recipientAddress: STRANGER, verifiedSignerAddress: STRANGER, claimedAt: T1, now: T1,
  });
  assert.equal(other.result, CLAIM_RESULT.ALREADY_CLAIMED_BY_OTHER);
  assert.equal(other.record.recipientAddress, RECIPIENT); // 두 번째 사람이 덮어쓰지 못한다
});

// ── 값 이동은 별개 축 ──────────────────────────────────────────────────────────
test("a closed claim on its own never claims money moved", async () => {
  const { token, record } = await freshLink();
  const r = await settleClaim(record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT, claimedAt: T1, now: T1,
  });
  assert.equal(r.record.transfer.status, TRANSFER_STATUS.NOT_ATTEMPTED);
  assert.equal(r.record.transfer.txHash, null);
  assert.equal(proofLevel(r.record), PROOF_LEVEL.IDENTITY_CLAIMED_NO_VALUE_MOVED);
  assert.equal(proofLevel(record), PROOF_LEVEL.LINK_ONLY);
});

test("a transfer cannot be recorded without a real receipt", async () => {
  const { token, record } = await freshLink();
  const claimed = (await settleClaim(record, {
    token, recipientAddress: RECIPIENT, verifiedSignerAddress: RECIPIENT, claimedAt: T1, now: T1,
  })).record;
  assert.equal(attachTransferReceipt(claimed, {}).reason, "no_real_tx_hash");
  assert.equal(attachTransferReceipt(claimed, { txHash: `0x${"1".repeat(64)}` }).reason, "no_block_number");
  assert.equal(attachTransferReceipt(claimed, { txHash: `0x${"1".repeat(64)}`, blockNumber: 12, status: "reverted" }).reason, "tx_not_successful");
  assert.equal(attachTransferReceipt(record, { txHash: `0x${"1".repeat(64)}`, blockNumber: 12, status: "success" }).reason, "not_claimed");
  const ok = attachTransferReceipt(claimed, { txHash: `0x${"1".repeat(64)}`, blockNumber: 12, status: "success" });
  assert.equal(ok.ok, true);
  assert.equal(proofLevel(ok.record), PROOF_LEVEL.VALUE_TRANSFERRED);
});

// ── 소스 규율 ──────────────────────────────────────────────────────────────────
test("the module never builds or sends a transaction itself", () => {
  for (const banned of ["sendTransaction", "writeContract", "eth_sendRawTransaction", "fetch(", "XMLHttpRequest"]) {
    assert.equal(SRC.includes(banned), false, banned);
  }
});

test("the module never logs anything", () => {
  assert.equal(/console\.(log|warn|error|info)/.test(SRC), false);
});

test("the version is pinned so old links cannot be read as new ones", () => {
  assert.equal(GIFT_LINK_VERSION, 1);
});

await run();
