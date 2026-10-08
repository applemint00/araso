// [A-909] Relay residual hardening. 0 network (fake fetch only), made-up sentinel key.
//  N4: duplicate JSON key never reaches upstream (proxy NORMALIZES: forwards JSON.stringify of the validated, allowlisted object).
//  R1: orderData.output (chainId / payments[].recipient / currency) and inputs[].payment.chainId bound to our request.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const realFetch = globalThis.fetch;
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error("network forbidden in a909"); };
const P = await import("../../api/relay-quote.js");
const RR = await import("../src/funding-rail-relay.js");

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };
const KEY = "TEST_SENTINEL_not_a_real_key_0123456789";
const mkRes = () => { const r = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, end(b) { r.body = b ?? ""; } }; return r; };
const call = async (body) => {
  const rec = []; const res = mkRes();
  const fetchImpl = async (url, init) => { rec.push({ url, init }); return { status: 200, headers: {}, text: async () => "{}" }; };
  await P.createRelayQuoteHandler({ fetchImpl, env: { RELAY_API_KEY: KEY } })({ method: "POST", url: P.PROXY_PATH, body, headers: { host: "app.example" } }, res);
  return { res, rec };
};
const MUSDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const U = "0x" + "11".repeat(20), R = "0x" + "22".repeat(20);
const mk = (o = {}) => ({ user: U, recipient: R, refundTo: U, originChainId: 8453, originCurrency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", destinationChainId: 143, destinationCurrency: MUSDC, tradeType: "EXACT_INPUT", amount: "20000000", topupGas: false, includeProtocolData: true, ...o });
const count = (s, k) => s.split(`"${k}"`).length - 1;

// ── N4 ──
{
  const good = JSON.stringify(mk());
  // first dest is 1 (forbidden), last is 143 (allowed): JSON.parse takes the last, validation passes; upstream must see ONE destinationChainId
  const dup1 = good.replace('"destinationChainId":143', '"destinationChainId":1,"destinationChainId":143');
  t("fixture really has a duplicate key", count(dup1, "destinationChainId") === 2);
  const a = await call(dup1);
  t("N4 dup destinationChainId (1 then 143): upstream sees exactly one key, value 143, raw text NOT forwarded", a.rec.length === 1 && a.rec[0].init.body !== dup1 && count(a.rec[0].init.body, "destinationChainId") === 1 && JSON.parse(a.rec[0].init.body).destinationChainId === 143 && !a.rec[0].init.body.includes('"destinationChainId":1,'));
  const dup2 = good.replace('"amount":"20000000"', '"amount":"1","amount":"20000000"');
  const b = await call(dup2);
  t("N4 dup amount (1 then 20000000): single amount key forwarded", b.rec.length === 1 && count(b.rec[0].init.body, "amount") === 1 && JSON.parse(b.rec[0].init.body).amount === "20000000");
  const dup3 = good.replace('"recipient":"' + R + '"', '"recipient":"' + R + '","recipient":"' + "ee".repeat(20).padStart(42, "0x") + '"');
  const c = await call(dup3.replace('"recipient":"0x' + "ee".repeat(20) + '"', '"recipient":"0x' + "33".repeat(20) + '"'));
  t("N4 dup recipient: last value wins, exactly one recipient key forwarded", c.rec.length === 1 && count(c.rec[0].init.body, "recipient") === 1 && JSON.parse(c.rec[0].init.body).recipient === "0x" + "33".repeat(20));
  const d = await call(good.replace('"destinationChainId":143', '"destinationChainId":143,"destinationChainId":1'));
  t("N4 dup (143 then 1): last value 1 -> 400 body_not_allowed, 0 upstream calls", d.res.statusCode === 400 && d.rec.length === 0);
  const ws = await call(JSON.stringify(mk(), null, 2));
  t("N4 whitespace/pretty body is forwarded compact (re-serialized), not raw", ws.rec.length === 1 && ws.rec[0].init.body === JSON.stringify(mk()));
  const e = await call(good.replace('"tradeType"', '"__proto__":{"x":1},"tradeType"'));
  t("N4 __proto__ key still 400 with 0 upstream calls", e.res.statusCode === 400 && e.rec.length === 0);
  t("N4 key never forwarded in body nor echoed", !a.rec[0].init.body.includes(KEY) && !a.res.body.includes(KEY) && a.rec[0].init.headers["x-api-key"] === KEY);
}

// ── R1 ──
const LIVE_PATH = path.join(ROOT, "_private/ops/receipts/A901_relay_proxy/live/live-quote-response.json");
const L_USER = "0x1df681813a210ee1c57c68f608fbab7fcd42d3ac", L_RECIP = "0x054dcf6978026f5a94a40a84b62652f2a084a916";
const L_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const EVIL = "0x" + "ee".repeat(20);
const L_NOW = 1792029861000 - 3600000;
if (!existsSync(LIVE_PATH)) {
  console.log("a909: live fixture absent (private receipt, public clone) -> R1 live cases skipped");
} else {
  const LIVE = JSON.parse(readFileSync(LIVE_PATH, "utf8"));
  const lv = (mut, o = {}) => { const q = JSON.parse(JSON.stringify(LIVE)); mut(q); return RR.verifyRelayDepositBinding(q, { originChainId: 8453, payer: L_USER, refundTo: L_USER, sourceToken: L_USDC, inputAmountUnits: 5000000n, nowMs: L_NOW, ...o }); };
  const rej = (r, reason) => r.ok === false && r.reasons.includes(reason);
  const out = (q) => q.protocol.v2.orderData.output;
  t("R1 live fixture still passes", lv(() => {}).ok === true);
  t("R1 output.payments[0].recipient = EVIL -> rejected", rej(lv((q) => { out(q).payments[0].recipient = EVIL; }), "order_output_recipient_mismatch"));
  t("R1 output.payments[0].recipient malformed -> rejected", rej(lv((q) => { out(q).payments[0].recipient = "nope"; }), "order_output_recipient_mismatch"));
  t("R1 recipient bound to ctx.recipient when given (differs from quote) -> rejected", rej(lv(() => {}, { recipient: EVIL }), "order_output_recipient_mismatch"));
  t("R1 extra payment leg to EVIL -> rejected", rej(lv((q) => { out(q).payments.push({ recipient: EVIL, currency: L_USDC.toLowerCase() }); }), "order_output_recipient_mismatch"));
  t("R1 output.chainId = arbitrum -> rejected", rej(lv((q) => { out(q).chainId = "arbitrum"; }), "order_output_chain_mismatch"));
  t("R1 output.chainId numeric 143 (label expected) -> rejected", rej(lv((q) => { out(q).chainId = 143; }), "order_output_chain_mismatch"));
  t("R1 output.chainId missing -> rejected", rej(lv((q) => { delete out(q).chainId; }), "order_output_chain_mismatch"));
  t("R1 output currency = Base USDC -> rejected", rej(lv((q) => { out(q).payments[0].currency = L_USDC.toLowerCase(); }), "order_output_currency_mismatch"));
  t("R1 output currency missing -> rejected", rej(lv((q) => { delete out(q).payments[0].currency; }), "order_output_currency_mismatch"));
  t("R1 output.payments empty -> rejected", rej(lv((q) => { out(q).payments = []; }), "order_output_missing"));
  t("R1 output.payments missing -> rejected", rej(lv((q) => { delete out(q).payments; }), "order_output_missing"));
  t("R1 output.payments[0] not an object -> rejected", rej(lv((q) => { out(q).payments = ["x"]; }), "order_output_missing"));
  t("R1 output present but not an object -> rejected", rej(lv((q) => { q.protocol.v2.orderData.output = "monad"; }), "order_output_missing"));
  t("R1 inputs[0].payment.chainId = arbitrum -> rejected", rej(lv((q) => { q.protocol.v2.orderData.inputs[0].payment.chainId = "arbitrum"; }), "order_input_chain_mismatch"));
  t("R1 inputs[0].payment.chainId numeric 8453 -> rejected", rej(lv((q) => { q.protocol.v2.orderData.inputs[0].payment.chainId = 8453; }), "order_input_chain_mismatch"));
  t("R1 inputs[0].payment missing -> rejected", rej(lv((q) => { delete q.protocol.v2.orderData.inputs[0].payment; }), "order_input_chain_mismatch"));
  t("R1 inputs missing while output present -> rejected", rej(lv((q) => { delete q.protocol.v2.orderData.inputs; }), "order_input_chain_mismatch"));
  t("R1 inputs empty -> rejected", rej(lv((q) => { q.protocol.v2.orderData.inputs = []; }), "order_input_chain_mismatch"));
  t("R1 second input with wrong chain -> rejected", rej(lv((q) => { const i = q.protocol.v2.orderData.inputs; i.push({ payment: { chainId: "arbitrum" }, refunds: JSON.parse(JSON.stringify(i[0].refunds)) }); }), "order_input_chain_mismatch"));
  t("R1 prototype-polluted output.chainId cannot fill a missing field", (() => { Object.prototype.chainId = "monad"; try { return rej(lv((q) => { delete out(q).chainId; }), "order_output_chain_mismatch"); } finally { delete Object.prototype.chainId; } })());
  t("R1 mixed-case recipient/currency still accepted (address compare, not string)", lv((q) => { out(q).payments[0].recipient = L_RECIP.toUpperCase().replace("0X", "0x"); out(q).payments[0].currency = MUSDC; }).ok === true);
  // end to end through requestRelayQuote (fake fetch): EVIL output is refused
  const bad = JSON.parse(JSON.stringify(LIVE)); bad.protocol.v2.orderData.output.payments[0].recipient = EVIL;
  const r = await RR.requestRelayQuote({ user: L_USER, recipient: L_RECIP, refundTo: L_USER, originChainId: 8453, originCurrency: L_USDC, amount: "5000000" }, { fetchImpl: async () => ({ ok: true, json: async () => bad }), validate: { nowMs: L_NOW } });
  t("R1 end-to-end requestRelayQuote with EVIL output recipient -> not ok, no plan", r.ok === false && r.plan === null && r.reasons.includes("order_output_recipient_mismatch"));
  // Cowork (a): a missing orderData.output is REFUSED (pre-A-909 baseline: legacy flat-deadline shape was accepted, then pinned as a residual).
  const noOut = lv((q) => { delete q.protocol.v2.orderData.output; });
  t("R1 orderData.output absent -> rejected (order_output_missing)", rej(noOut, "order_output_missing"));
  t("R1 legacy flat-deadline shape (no output, no inputs) -> rejected", rej(lv((q) => { const od = q.protocol.v2.orderData; delete od.output; delete od.inputs; od.deadline = 1792029861; }), "order_output_missing"));
  t("R1 orderData absent entirely -> rejected", lv((q) => { delete q.protocol.v2.orderData; }).ok === false);
  t("R1 output absent end-to-end requestRelayQuote -> not ok, no plan", await (async () => { const q = JSON.parse(JSON.stringify(LIVE)); delete q.protocol.v2.orderData.output; const r = await RR.requestRelayQuote({ user: L_USER, recipient: L_RECIP, refundTo: L_USER, originChainId: 8453, originCurrency: L_USDC, amount: "5000000" }, { fetchImpl: async () => ({ ok: true, json: async () => q }), validate: { nowMs: L_NOW } }); return r.ok === false && r.plan === null && r.reasons.includes("order_output_missing"); })());
}

globalThis.fetch = realFetch;
t("0 network calls", netCalls === 0);
console.log(`a909: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
