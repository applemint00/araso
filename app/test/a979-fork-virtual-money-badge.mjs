import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_VIRTUAL_MONEY_BADGE_TEXT, forkVirtualMoneySurface, mountForkVirtualMoneyBadge } from "../src/fork-virtual-money-badge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAIN = readFileSync(path.join(ROOT, "app/src/main.js"), "utf8");
const CSS = readFileSync(path.join(ROOT, "app/src/style.css"), "utf8");
let pass = 0;
const check = (name, fn) => { try { fn(); pass += 1; console.log(`PASS  ${name}`); } catch (e) { console.error(`FAIL  ${name}: ${e.message}`); process.exitCode = 1; } };

check("fork-only surfaces: Money, Move in, Gift send/back, Job approval", () => {
  assert.equal(forkVirtualMoneySurface({ fork: true, ownKind: "money" }), "money");
  assert.equal(forkVirtualMoneySurface({ fork: true, ownKind: "move", moveDir: "in", moveStep: "pick" }), "move-in-pick");
  assert.equal(forkVirtualMoneySurface({ fork: true, ownKind: "move", moveDir: "in", moveStep: "split" }), "move-in-split");
  assert.equal(forkVirtualMoneySurface({ fork: true, ownKind: "move", moveDir: "in", moveStep: "crypto" }), "move-in-crypto");
  assert.equal(forkVirtualMoneySurface({ fork: true, ownKind: "gift", ownStage: "pick" }), "gift-amount-send");
  assert.equal(forkVirtualMoneySurface({ fork: true, ownKind: "gift", ownStage: "pick", giftBack: true }), "gift-back-send");
  assert.equal(forkVirtualMoneySurface({ fork: true, jobApproval: true }), "job-send");
});
check("excluded surfaces: testnet, Home, Gift picker/link, Move out, receipt", () => {
  for (const x of [{ fork: false, ownKind: "money" }, { fork: true }, { fork: true, ownKind: "gift", ownStage: "fan" }, { fork: true, ownKind: "gift", ownStage: "done" }, { fork: true, ownKind: "move", moveDir: "out" }]) assert.equal(forkVirtualMoneySurface(x), null, JSON.stringify(x));
});
check("integration observes the first pointer without cancelling the original tap", () => {
  assert.equal(FORK_VIRTUAL_MONEY_BADGE_TEXT, "virtual money · fork");
  assert.match(MAIN, /mountForkVirtualMoneyBadge/);
  assert.match(MAIN, /A977_FORK === true/);
  const mod = readFileSync(path.join(ROOT, "app/src/fork-virtual-money-badge.js"), "utf8");
  assert.match(mod, /pointerdown/);
  assert.match(mod, /capture: true, passive: true/);
  assert.doesNotMatch(mod, /preventDefault|stopPropagation/);
});
check("design canon uses existing tokens and no new color or shadow", () => {
  const block = CSS.match(/\/\* \[A-979 ④\][\s\S]*?\n}\n/)?.[0] || "";
  for (const token of ["var(--mobile-top-safe)", "var(--ink)", "var(--paper)", "var(--ts-detail)", "var(--font-hand)", "pointer-events: none", "position: fixed"]) assert.ok(block.includes(token), token);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}|rgba?\(|box-shadow|text-shadow/i);
});
check("Move in dismissal resets on crypto entry but persists within the same step", () => {
  const listeners = new Map();
  const badge = () => ({
    className: "",
    dataset: {},
    textContent: "",
    setAttribute() {},
    remove() { document.badge = null; },
  });
  const move = { dataset: { a905Dir: "in", a905Step: "pick" } };
  const own = {
    dataset: { a911: "move", a911Stage: "in-pick" },
    querySelector(selector) { return selector === '[data-a905-view="move"]' ? move : null; },
  };
  const document = {
    badge: null,
    body: { appendChild(node) { document.badge = node; } },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    createElement() { return badge(); },
    querySelector(selector) {
      if (selector === ".a911-screen") return own;
      if (selector === ".a979-forkBadge") return document.badge;
      return null;
    },
  };
  const mounted = mountForkVirtualMoneyBadge({ document, isFork: true });
  mounted.sync();
  assert.equal(document.badge?.dataset.a979Surface, "move-in-pick");
  listeners.get("pointerdown")();
  mounted.sync();
  assert.equal(document.badge, null, "same-step sync stays dismissed");
  move.dataset.a905Step = "crypto";
  own.dataset.a911Stage = "in-crypto";
  mounted.sync();
  assert.equal(document.badge?.dataset.a979Surface, "move-in-crypto", "crypto entry resets dismissal");
  listeners.get("pointerdown")();
  mounted.sync();
  assert.equal(document.badge, null, "same crypto step stays dismissed");
  mounted.destroy();
});
console.log(`\nA-979 fork virtual money badge: ${pass}/5 PASS`);
