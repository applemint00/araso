// [A-898 F] Gift card front pick states (sender side): lift -> flip -> re-pick. Node only, no network.
// The RECEIVE side (card as first screen, branch by address state) is NOT built in this pass; the front id has no link channel
// (createClaimLink carries only `note`) -> UNKNOWN + ask. This file therefore pins the sender states and records the gap.
//   node app/test/a898-gift-card-pick-receive.mjs
// pre-A-911 baseline: pick / flip logic and markup pinned here are unchanged; the A-911 screen reuses the same reducer (tap_front) without the A-898 auto-flip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => readFileSync(path.join(HERE, "..", "src", f), "utf8");
const G = await import("../src/gift-send-paper.js");

let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { fail += 1; console.log(`FAIL  ${name}\n      ${String(e.message).split("\n")[0]}`); } };

const PAYER = { id: "p-1", name: "Honeybun", address: "0x1111111111111111111111111111111111111111" };
const fresh = () => G.openGiftSend({ piggy: PAYER, selected: PAYER, chainScope: "monad-testnet", nowMs: 1 }).draft;
const view = (d) => G.giftSendView(d, G.giftSendEvaluate(d, { holdings: { usdc: "50", mon: null } }));
const html = (d) => G.giftSendPaperMarkup(view(d));
const card = (h, id) => (h.match(new RegExp(`<div class="(a898-card[^"]*)" data-a898-front="${id}"`)) || [])[1] || "";

await check("P1 initial: fan of three, nothing picked or flipped", () => {
  const d = fresh(); const v = view(d); const h = html(d);
  assert.deepEqual(v.fronts.map((f) => [f.id, f.selected]), [["01", false], ["02", false], ["04", false]]);
  assert.equal(v.picked, null); assert.equal(v.flipped, false);
  for (const id of ["01", "02", "04"]) assert.equal(card(h, id), "a898-card");
  assert.equal(h.includes("gift-repick"), false);
});
await check("P2 step 1 (lift): the tapped card is picked, the others move aside, NOT flipped", () => {
  const d = G.giftSendReduce(fresh(), { type: "tap_front", front: "02" });
  const h = html(d); const v = view(d);
  assert.equal(v.picked, "02"); assert.equal(v.flipped, false);
  assert.equal(card(h, "02"), "a898-card is-picked");
  assert.equal(card(h, "01"), "a898-card is-away"); assert.equal(card(h, "04"), "a898-card is-away");
  assert.ok(h.includes("gift-repick"));
});
await check("P3 step 2 (flip): the lifted card flips to the letter; tapping it again flips back", () => {
  let d = G.giftSendReduce(fresh(), { type: "pick_front", front: "04" });
  d = G.giftSendReduce(d, { type: "flip_front" });
  assert.equal(card(html(d), "04"), "a898-card is-picked is-flipped");
  assert.equal(view(d).flipped, true);
  d = G.giftSendReduce(d, { type: "tap_front", front: "04" });
  assert.equal(card(html(d), "04"), "a898-card is-picked"); assert.equal(view(d).flipped, false);
  d = G.giftSendReduce(d, { type: "tap_front", front: "04" });
  assert.equal(view(d).flipped, true);
});
await check("P4 flip needs a lifted card; flip_back / unpick need a pick (no-ops otherwise)", () => {
  const d = fresh();
  assert.equal(G.giftSendReduce(d, { type: "flip_front" }).flipped, false);
  assert.equal(G.giftSendReduce(d, { type: "flip_back" }).flipped, false);
  assert.equal(G.giftSendReduce(d, { type: "unpick" }).front, null);
});
await check("P5 re-pick: another card switches (lift again, unflipped); unpick returns to the fan; the letter text survives", () => {
  let d = G.giftSendReduce(G.giftSendReduce(fresh(), { type: "tap_front", front: "01" }), { type: "flip_front" });
  d = G.giftSendReduce(G.giftSendReduce(d, { type: "set_to", value: "Dana" }), { type: "set_message", value: "hi" });
  const other = G.giftSendReduce(d, { type: "tap_front", front: "02" });
  assert.equal(other.front, "02"); assert.equal(other.flipped, false); assert.equal(other.to, "Dana"); assert.equal(other.message, "hi");
  const fan = G.giftSendReduce(d, { type: "unpick" });
  assert.equal(fan.front, null); assert.equal(fan.flipped, false); assert.equal(fan.to, "Dana"); assert.equal(fan.message, "hi");
  assert.equal(card(html(fan), "01"), "a898-card");
});
await check("P6 only 01 / 02 / 04; no default; Face ID waits for a pick", () => {
  assert.equal(G.giftSendReduce(fresh(), { type: "tap_front", front: "03" }).front, null);
  assert.equal(G.giftSendReduce(fresh(), { type: "pick_front", front: 1 }).front, null);
  let d = G.giftSendReduce(fresh(), { type: "set_preset", preset: 20 });
  const gas = { gasUnits: { commitClaim: 1n, claim: 1n, fundingTransfer: 1n }, feeInputs: { maxFeePerGasWei: 1n, source: "t" }, safety: { bufferBps: 0 } };
  const mk = (x) => G.giftSendEvaluate(x, { holdings: { usdc: "50" }, market: { monUsd: "3", receivedAtMs: 1, expiresAtMs: 2 }, gas, nowMs: 1.5 });
  assert.equal(mk(d).canFaceId, false); assert.equal(mk(d).blockedReason, "front_required");
  d = G.giftSendReduce(d, { type: "tap_front", front: "01" });
  assert.equal(mk(d).canFaceId, true);
});
await check("P7 main.js: pick / flip / re-pick patch the existing card nodes (no innerHTML rebuild), flip waits for the lift", () => {
  const MAIN = SRC("main.js");
  const patch = MAIN.slice(MAIN.indexOf("function a898PatchGiftStage"), MAIN.indexOf("function a898AutoFlip"));
  assert.ok(patch.includes("className = ") && !/(mount|oldStage|oc\[i\])\.innerHTML/.test(patch), "same nodes, class change only");
  const auto = MAIN.slice(MAIN.indexOf("function a898AutoFlip"), MAIN.indexOf("async function a898FundingArrival"));
  assert.ok(auto.includes("transitionend") && auto.includes("transitionDuration") && auto.includes('"flip_front"'));
  const act = MAIN.slice(MAIN.indexOf("async function a898Act("), MAIN.indexOf("// ── [A-898] end ──"));
  assert.ok(act.includes("a898PatchGiftStage()") && act.includes('"gift-repick"') && act.includes("if (!patched) refreshHomePaperMount()"));
});
await check("P8 receive side carries the selected front in display-only fragment metadata and renders card-first", () => {
  const link = SRC("gift-piggy-claim-link.js");
  const plan = SRC("gift-create-plan.js");
  const screen = SRC("a911-screens.js");
  const main = SRC("main.js");
  assert.ok(link.includes('note = ""') && link.includes("amountUsd = null"));
  assert.ok(plan.includes("buildClaimUrl(origin, { giftId, token: created.token, note, amountUsd: Number(presetLabel) })"));
  assert.ok(screen.includes("export function a911GiftReceiveMarkup") && screen.includes('data-gift-receive="open"'));
  assert.ok(main.includes("unpackGiftNote(pendingGiftClaim.note)") && main.includes("giftReceiveFlipped") && main.includes("handleGiftOpenActivate"));
});

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
