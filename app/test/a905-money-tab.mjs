// [A-905] Money tab: rows, in/out switch, 1-vs-2+ Piggy branches, Away not selectable, Gift pay step, copy. Node only, no network.
// pre-A-911 baseline: money-tab.js and the a905Gate() call sites pinned here are unchanged. [A-911] reassigns a905Gate / a905EffectiveMode / a905BodyMarkup / a905OpenMoneyTab at runtime (the Money tab is its own screen, also on secondAway); see a911-own-screens.mjs G1.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("A-905 test: network forbidden"); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => readFileSync(path.join(HERE, "..", "src", f), "utf8");
const T = await import("../src/money-tab.js");
let pass = 0, fail = 0;
const check = async (n, fn) => { try { await fn(); pass++; console.log(`PASS  ${n}`); } catch (e) { fail++; console.log(`FAIL  ${n}\n      ${String(e.message).split("\n")[0]}`); } };
const A1 = "0x" + "1".repeat(40), A2 = "0x" + "2".repeat(40), DEST = "0x" + "9".repeat(40);
const home = { id: "p1", name: "Honeybun", address: A1, location: "home", assets: [{ symbol: "USDC", quantity: "20", decimals: 6 }], valuation: { usd: "20.00" } };
const home2 = { id: "p3", name: "Bean", address: "0x" + "3".repeat(40), location: "home", assets: [{ symbol: "USDC", quantity: "5", decimals: 6 }], valuation: { usd: "5.00" } };
const away = { id: "p2", name: "Rover", address: A2, location: "away", assets: [{ symbol: "MON", quantity: "4.1", decimals: 18 }], valuation: { usd: "12.40" } };

await check("T1 tab rows: total, real assets, Move money, Gift a Piggy, per-Piggy amounts; Away greyed with the existing line", () => {
  const v = T.moneyTabView({ piggies: [home, away], totals: { totalUsd: "32.40" } });
  assert.equal(v.total, "$32.40"); assert.equal(v.assets, "20 USDC · 4.1 MON");
  const h = T.moneyTabMarkup(v);
  assert.ok(h.includes("&gt; Move money") && h.includes("&gt; Gift a Piggy") && h.includes('class="a905-money__title"'));
  assert.ok(h.includes('data-away="1"') && h.includes("still out working."));
  assert.equal((h.match(/class="a905-money__piggy"/g) || []).length, 2);
  assert.equal(T.moneyTabMarkup(v, { withTitle: false }).includes("a905-money__title"), false);
});
await check("T2 no fake total (unknown valuation -> unknown), no Piggy-tap actions, no buttons inside the plain Piggy list", () => {
  const v = T.moneyTabView({ piggies: [{ ...home, valuation: null }], totals: { totalUsd: null } });
  assert.equal(v.total, "unknown");
  const h = T.moneyTabMarkup(T.moneyTabView({ piggies: [home, away], totals: { totalUsd: "32.40" } }));
  const list = h.slice(h.indexOf('class="a905-money__piggies"'));
  assert.equal(list.includes("<button"), false);
});
await check("T3 copy: only Gift a Piggy / in / out / Move money are new; Move money is ONE constant", () => {
  assert.equal(T.GIFT_A_PIGGY_LABEL, "Gift a Piggy"); assert.deepEqual({ ...T.MONEY_SWITCH }, { IN: "in", OUT: "out" });
  const s = SRC("money-tab.js"); assert.equal((s.match(/"Move money"/g) || []).length, 1);
  assert.equal(/\bcash\b/i.test(s), false);
});
await check("T4 switch: default in, yellow-underline state is aria-pressed, out toggles", () => {
  assert.ok(/data-dir="in"[^>]*aria-pressed="true"/.test(T.moveSwitchMarkup()) && /data-dir="out"[^>]*aria-pressed="false"/.test(T.moveSwitchMarkup()));
  assert.ok(/data-dir="out"[^>]*aria-pressed="true"/.test(T.moveSwitchMarkup("out")));
  let s = T.moneyTabReduce(T.moneyTabOpen("sendstay"), { type: "move" }); assert.equal(s.dir, "in");
  s = T.moneyTabReduce(s, { type: "dir", dir: "out" }, { piggies: [home, away] }); assert.equal(s.dir, "out"); assert.ok(s.out);
  s = T.moneyTabReduce(s, { type: "dir", dir: "in" }); assert.equal(s.dir, "in"); assert.equal(s.out, null);
  assert.equal(T.moneyTabReduce(T.moneyTabOpen("sendstay"), { type: "dir", dir: "out" }).dir, "in", "switch only exists inside Move money");
});
await check("T5 out: 1 selectable Piggy skips the picker; 2+ asks once; Away never selectable", () => {
  assert.equal(T.outStart([home]).stage, "amount", "one Piggy, selectable: picker skipped");
  assert.equal(T.outStart([home, away]).stage, "pick", "2+ Piggies, one Away: the picker shows so the Away Piggy is seen greyed");
  const o2 = T.outStart([home, home2, away]); assert.equal(o2.stage, "pick");
  assert.equal(T.outReduce(o2, { type: "pick", id: "p2" }, { piggies: [home, home2, away] }).stage, "pick", "Away refused");
  assert.equal(T.outReduce(o2, { type: "pick", id: "p2" }, { piggies: [home, home2, away] }).refusal, "piggy_not_selectable");
  assert.equal(T.outReduce(o2, { type: "pick", id: "p3" }, { piggies: [home, home2, away] }).stage, "amount");
  const m = T.outMarkup(T.outView(o2, [home, home2, away]));
  assert.ok(/data-pick="0"[^>]*aria-disabled/.test(m) && /data-pick="1"/.test(m));
  assert.equal(T.selectablePiggies([away]).length, 0);
});
await check("T6 out flow: amount -> address -> confirm; live seam null => Face ID disabled; nothing is sent", async () => {
  const P = [home]; let o = T.outStart(P); // one Piggy: picker skipped
  o = T.outReduce(o, { type: "next" }, { piggies: P }); assert.equal(o.stage, "amount", "no amount yet");
  o = T.outReduce(o, { type: "amount", value: "50" }, { piggies: P }); o = T.outReduce(o, { type: "next" }, { piggies: P }); assert.equal(o.stage, "amount", "exceeds free balance");
  o = T.outReduce(o, { type: "amount", value: "10" }, { piggies: P }); o = T.outReduce(o, { type: "next" }, { piggies: P }); assert.equal(o.stage, "address");
  o = T.outReduce(o, { type: "address", value: "nope" }, { piggies: P }); assert.equal(T.outReduce(o, { type: "next" }, { piggies: P }).stage, "address");
  o = T.outReduce(o, { type: "address", value: DEST }, { piggies: P }); o = T.outReduce(o, { type: "next" }, { piggies: P }); assert.equal(o.stage, "confirm");
  const v = T.outView(o, P); assert.equal(v.preview.ready, true); assert.equal(v.faceIdEnabled, false);
  assert.equal(T.MONEY_TAB_CONFIG.sendMoney, null); assert.equal(Object.isFrozen(T.MONEY_TAB_CONFIG), true);
  assert.ok(/id="a905OutFaceId"[^>]*disabled/.test(T.outMarkup(v)));
  const v2 = T.outView(o, P, { config: { sendMoney: async () => ({}) } }); assert.equal(v2.faceIdEnabled, true, "enabled only with an injected seam");
  const back = T.moneyTabReduce({ ...T.moneyTabOpen("sendstay"), view: "move", dir: "out", out: T.outStart(P) }, { type: "out", event: { type: "back" } }, { piggies: P });
  assert.equal(back.view, "tab", "first-stage back leaves the flow");
});
await check("T7 Away money is not usable by an out amount (free balance 0) and Gift needs a selectable Piggy", () => {
  const forced = { stage: "amount", piggyId: "p2", amount: "1", address: "", skipped: false, refusal: null };
  assert.equal(T.outReduce(forced, { type: "next" }, { piggies: [away] }).stage, "amount");
  assert.equal(T.moneyTabView({ piggies: [away], totals: null }).canGift, false);
  assert.equal(T.moneyTabView({ piggies: [home, away], totals: null }).canGift, true);
});
await check("T8 Gift pay step: 2+ Piggies pick once (Away visible, not pickable); 1 Piggy auto; new payment = the three Funding rows", () => {
  const two = T.giftPayStepMarkup(T.giftPayStepView({ piggies: [home, home2, away], payerId: "p1" }));
  assert.ok(two.includes('data-a905-pay="piggy"') && /data-pick="0"/.test(two) && two.includes('aria-current="true"'));
  const one = T.giftPayStepMarkup(T.giftPayStepView({ piggies: [home, away], payerId: "p1" }));
  assert.equal(one.includes('data-a905-pay="piggy"'), false);
  for (const h of [two, one]) { for (const l of ["Pay with card", "Bank transfer", "Pay with crypto"]) assert.ok(h.includes(l)); }
});
await check("T9 main wiring: out reduces to SEND_MONEY preview only, no sendMoney seam wired, gift reuses A-898 functions, live calls 0", () => {
  const m = SRC("main.js"); const b = m.slice(m.indexOf("// ── [A-905] Honey jar"), m.indexOf("// ── [A-905] end ──"));
  assert.equal(/sendMoney\s*[:=]\s*(async|function|\()/.test(b), false);
  assert.ok(b.includes("a898OpenGiftSend()") && b.includes("openAddMoney()") && b.includes("giftDraftRestore"));
  assert.equal(/SEND_PIGGY|sendPiggyOnce|sendTransaction|signTransaction/.test(b), false);
  assert.equal(fetchCalls, 0);
});
await check("T10 out confirm uses the existing A-492 line; in-plan Funding rows use the existing labels; main hooks the plan", () => {
  const P = [home, away];
  const o = { stage: "confirm", piggyId: "p1", amount: "10", address: DEST, skipped: true, refusal: null };
  assert.ok(T.outMarkup(T.outView(o, P)).includes("Needs your OK — nothing has been sent yet."));
  const f = T.fundingRowsMarkup("plan-fund");
  for (const l of ["Pay with card", "Bank transfer", "Pay with crypto"]) assert.ok(f.includes(l));
  assert.equal((f.match(/data-a905-act="plan-fund"/g) || []).length, 3);
  const m = SRC("main.js");
  assert.ok(m.includes("a905PlanFundingMarkup(methodsMarkup)") && m.includes('const addMoneyEntry = ""; // [A-905]'));
});
await check("T11 leg sequencing: double tap opens one leg; cancel re-offers it; confirmed legs are done; all-done opens nothing", () => {
  const legs = [{ piggyId: "p1" }, { piggyId: "p3" }];
  let s = T.planLegsInit();
  assert.equal(T.nextPlanLeg(legs, s).piggyId, "p1");
  const a = T.planLegsReduce(s, { type: "open", id: "p1" }, legs);
  assert.equal(a.current, "p1"); assert.equal(T.nextPlanLeg(legs, a), null, "in flight: nothing else opens (double tap)");
  assert.deepEqual(T.planLegsReduce(a, { type: "open", id: "p3" }, legs), a, "cannot skip to leg 2 while leg 1 is open");
  assert.deepEqual(T.planLegsReduce(a, { type: "open", id: "p1" }, legs), a, "second tap on the same leg changes nothing");
  const cancelled = T.planLegsReduce(a, { type: "closed" }, legs);
  assert.deepEqual(cancelled.done, []); assert.equal(T.nextPlanLeg(legs, cancelled).piggyId, "p1", "cancelled leg is offered again");
  let t = T.planLegsReduce(a, { type: "confirmed", id: "p1" }, legs); t = T.planLegsReduce(t, { type: "closed" }, legs);
  assert.deepEqual(t.done, ["p1"]); assert.equal(T.nextPlanLeg(legs, t).piggyId, "p3");
  t = T.planLegsReduce(t, { type: "open", id: "p3" }, legs); t = T.planLegsReduce(t, { type: "confirmed", id: "p3" }, legs); t = T.planLegsReduce(t, { type: "closed" }, legs);
  assert.equal(T.nextPlanLeg(legs, t), null, "all done: a tap opens nothing (never leg 0 again)");
  assert.deepEqual(T.planLegsReduce(t, { type: "confirmed", id: "p9" }, legs), t);
});
await check("T12 out inputs carry existing-word aria-labels, tap floor lives in CSS (no inline 36px), title is MONEY, pay step has no inline sizes", () => {
  assert.equal(T.MONEY_TAB_TITLE, "MONEY");
  const P = [home];
  const m = T.outMarkup(T.outView(T.outStart(P), P));
  assert.ok(m.includes('aria-label="total"'));
  assert.equal(/min-height:36px/.test(SRC("money-tab.js")), false);
  const css = SRC("style.css");
  assert.ok(css.includes("min-height: calc(44px / var(--tsK))") && css.includes('.a905-money__piggy[aria-current="true"]') && css.includes("html .a905-money .a905-field"));
  assert.ok(T.giftPayStepMarkup(T.giftPayStepView({ piggies: [home, home2], payerId: "p1" })).includes('aria-current="true"'));
});
await check("T13 main: pay step only after compose is filled (preset + front); chosen `in` is a no-op; Chog hit missing is guarded", () => {
  const m = SRC("main.js");
  assert.ok(m.includes('gd.stage === "compose" && gd.preset !== null && gd.front !== null'));
  assert.ok(m.includes("if (arg === m.dir) return true;"));
  assert.ok(m.includes("homeChog?.hover?.(1)"));
  assert.ok(m.includes("if (state.a898Paper) return; // a paper is already open"));
});
await check("T14 all Piggies Away: Move money enabled, Gift disabled with the existing line, out shows Away greyed and unpickable", () => {
  const A = [away, { ...away, id: "p4", name: "Pip", address: "0x" + "4".repeat(40) }];
  const v = T.moneyTabView({ piggies: A, totals: null, canAct: false, canMove: true });
  assert.equal(v.allAway, true); assert.equal(v.canMove, true); assert.equal(v.canGift, false);
  const h = T.moneyTabMarkup(v);
  assert.ok(/id="a905MoveMoney"(?![^>]*disabled)/.test(h), "Move money enabled");
  const gift = h.slice(h.indexOf('id="a905GiftPiggy"'), h.indexOf("</button>", h.indexOf('id="a905GiftPiggy"')));
  assert.ok(/disabled/.test(gift) && gift.includes("still out working."), "Gift disabled with the existing line, not hidden");
  const o = T.outStart(A); assert.equal(o.stage, "pick");
  const m = T.outMarkup(T.outView(o, A));
  assert.equal((m.match(/data-pick="0"/g) || []).length, 2); assert.equal(m.includes('data-pick="1"'), false);
  assert.equal((m.match(/still out working\./g) || []).length, 2);
  assert.equal(T.outReduce(o, { type: "pick", id: "p2" }, { piggies: A }).stage, "pick");
  // not all away: Gift stays a normal row without the note
  const mixed = T.moneyTabMarkup(T.moneyTabView({ piggies: [home, away], totals: null, canAct: true }));
  const g2 = mixed.slice(mixed.indexOf('id="a905GiftPiggy"'), mixed.indexOf("</button>", mixed.indexOf('id="a905GiftPiggy"')));
  assert.equal(g2.includes("still out working."), false); assert.equal(/disabled/.test(g2), false);
  assert.ok(SRC("main.js").includes('if (act === "move" && a905Gate())'), "Move money does not need sendstay");
});
await check("T15 the in-place A-898 stage patch yields to a full repaint when the Gift pay step must appear (810 frame: front pick patched, pay step missing)", () => {
  const m = SRC("main.js");
  assert.ok(m.includes("function a905PayStepStale()") && m.includes("a905PayStepShouldShow() !== Boolean(document.querySelector('[data-a905-view=\"gift-pay\"]'))"));
  const patch = m.slice(m.indexOf("function a898PatchGiftStage()"), m.indexOf("function a898PatchGiftStage()") + 700);
  assert.ok(patch.includes('typeof a905PayStepStale === "function" && a905PayStepStale()'));
  assert.ok(patch.indexOf("a905PayStepStale") < patch.indexOf("a898BodyMarkup()"), "checked before the patch is built");
});
await check("T16 N1/N3: a leg is recorded at the confirmed deposit itself; the bump timers are wrapped (no Illegal invocation)", () => {
  const m = SRC("main.js");
  assert.ok(m.includes("a905NoteLegConfirmed(paper.piggy.id); // [A-905]"));
  assert.ok(m.includes("timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) }"));
  assert.equal(/timers: \{ setTimeout, clearTimeout \}/.test(m), false);
  const legs = [{ piggyId: "p1" }, { piggyId: "p3" }];
  let s = T.planLegsReduce(T.planLegsInit(), { type: "open", id: "p1" }, legs);
  s = T.planLegsReduce(s, { type: "confirmed", id: "p1" }, legs); s = T.planLegsReduce(s, { type: "closed" }, legs);
  assert.equal(T.nextPlanLeg(legs, s).piggyId, "p3", "confirmed at the deposit, then closed: not offered again");
});
console.log(`\n${pass}/${pass + fail} PASS`); process.exit(fail ? 1 : 0);
