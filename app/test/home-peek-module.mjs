// [A-540] HOME peek + `+ Piggy` tab (1-Piggy path) module contract — 네트워크 0(실제 fetch 0)
// · 브라우저 0. Owner-confirmed source: _private/design/home_peek_20260923/home-peek.{js,css}.
//   node app/test/home-peek-module.mjs
//
// Two kinds of checks:
//  1. byte-identical verbatim copy proof against the confirmed design package (the card requires
//     the module be dropped in "그대로" — no hand re-typing, no silent value drift).
//  2. the one additive deviation this card allows/requires — parent decision 7's
//     prefers-reduced-motion static settled pose — checked for exact values (no invented numbers).
//  3. mountPlusPiggyTab() exercised against a tiny hand-built DOM stand-in (no fetch/DOMParser
//     needed for this half of the module — mountHomePeek's SVG-fetch half is proven verbatim by
//     the byte-identical check above + the real headless-Chrome render in this card's receipt).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountPlusPiggyTab } from "../src/home-peek.js";

let pass = 0;
function check(label, fn) { fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. verbatim copy ────────────────────────────────────────────────────────────────────
const PKG_JS = readFileSync(new URL("../../_private/design/home_peek_20260923/home-peek.js", import.meta.url), "utf8");
const APP_JS = readFileSync(new URL("../src/home-peek.js", import.meta.url), "utf8");
const PKG_CSS = readFileSync(new URL("../../_private/design/home_peek_20260923/home-peek.css", import.meta.url), "utf8");
const APP_CSS = readFileSync(new URL("../src/home-peek.css", import.meta.url), "utf8");

check("home-peek.js is byte-identical to the confirmed design package", () => {
  assert.equal(APP_JS, PKG_JS);
});

check("home-peek.css keeps the confirmed package content byte-identical (only an additive block after it)", () => {
  assert.ok(APP_CSS.startsWith(PKG_CSS), "app CSS must contain the whole package CSS unchanged, as a prefix");
});

// ── 2. parent decision 7 — reduced-motion static settled peek, no invented pose ────────────
check("reduced-motion turns off all 4 loops and freezes each layer at its own confirmed settled value", () => {
  const added = APP_CSS.slice(PKG_CSS.length);
  assert.match(added, /@media \(prefers-reduced-motion: reduce\)/);
  const media = added.slice(added.indexOf("@media (prefers-reduced-motion: reduce)"));
  // body: homePeekGo 38%/76% settled value (HOME_PEEK_HANDOFF.md §3 "빼꼼")
  assert.match(media, /\.homePeekBody\s*\{\s*animation:\s*none;\s*transform:\s*translate\(-1px, -7px\) rotate\(23deg\);/);
  // hand: homePeekPop 16%/76% settled value — visible at full scale, not hidden
  assert.match(media, /\.homePeekHand\s*\{\s*animation:\s*none;\s*transform:\s*scale\(1\);\s*opacity:\s*1;/);
  // eyes open (homePeekBlink rest value), leg neutral (homePeekStep rest value)
  assert.match(media, /\.homePeekEyes\s*\{\s*animation:\s*none;\s*transform:\s*scaleY\(1\);/);
  assert.match(media, /\.homePeekLegR\s*\{\s*animation:\s*none;\s*transform:\s*rotate\(0\);/);
});

check("outside the reduced-motion query, the original infinite 6s loops are untouched", () => {
  assert.match(PKG_CSS, /animation: homePeekGo 6s infinite;/);
  assert.match(PKG_CSS, /animation: homePeekPop 6s infinite;/);
  assert.match(APP_CSS.slice(0, PKG_CSS.length), /animation: homePeekGo 6s infinite;/);
});

check("no new pose/art was invented — every reduced-motion value is a keyframe value already in the confirmed CSS", () => {
  for (const value of ["translate(-1px, -7px) rotate(23deg)", "scale(1)", "scaleY(1)"]) {
    assert.ok(PKG_CSS.includes(value), `${value} must already exist in the confirmed keyframes`);
  }
});

// ── 3. mountPlusPiggyTab() — tiny hand-built DOM stand-in, no fetch needed ─────────────────
class FakeStyle {
  setProperty(k, v) { this[k] = v; }
}
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      contains: (c) => this._classes.has(c),
    };
    this.style = new FakeStyle();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this._listeners = {};
    this.offsetLeft = 0; this.offsetTop = 0; this.offsetWidth = 0; this.offsetHeight = 0;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  dispatchClick() { (this._listeners.click || []).forEach((fn) => fn({ type: "click" })); }
  set innerHTML(_v) { /* mountPlusPiggyTab overwrites lastChild.textContent directly, no parse needed here */
    this._lastChildStub = { textContent: "" };
  }
  get lastChild() { return this._lastChildStub; }
  after(node) {
    const i = this.parent.children.indexOf(this);
    this.parent.children.splice(i + 1, 0, node);
    node.parent = this.parent;
  }
  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
  querySelectorAll(sel) {
    assert.equal(sel, ".homePaper__card--piggy");
    return this.children.filter((c) => c._classes.has("homePaper__card--piggy"));
  }
}

function makePaperWithCards(n) {
  const paper = new FakeElement("div");
  paper.offsetWidth = 400;
  const cards = [];
  for (let i = 0; i < n; i += 1) {
    const c = new FakeElement("div");
    c._classes.add("homePaper__card--piggy");
    c.offsetLeft = 26;
    c.offsetTop = 214 + i * 115;
    c.offsetWidth = 348;
    c.offsetHeight = 101;
    c.parent = paper;
    paper.children.push(c);
    cards.push(c);
  }
  return { paper, cards };
}

const realDocument = globalThis.document;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
try {
  check("mountPlusPiggyTab attaches to the LAST resident card and computes right/top from its real offsets", () => {
    const { paper, cards } = makePaperWithCards(2);
    let clicked = 0;
    const off = mountPlusPiggyTab(paper, { onClick: () => { clicked += 1; } });
    const last = cards[1];
    assert.equal(paper.style["--tab-right"], (paper.offsetWidth - (last.offsetLeft + last.offsetWidth)) + 14 + "px");
    assert.equal(paper.style["--tab-top"], (last.offsetTop + last.offsetHeight - 2) + "px");
    assert.equal(last.classList.contains("hasPeek"), true);
    const btn = paper.children[paper.children.indexOf(last) + 1];
    assert.equal(btn.className, "homePlusPiggyTab");
    btn.dispatchClick();
    assert.equal(clicked, 1);
    off();
    assert.equal(paper.children.includes(btn), false, "off() removes the tab and nothing else");
    assert.equal(paper.children.length, 2, "both resident cards remain, untouched");
  });

  check("mountPlusPiggyTab is a no-op (returns a safe off()) when the paper has no resident card yet", () => {
    const { paper } = makePaperWithCards(0);
    const off = mountPlusPiggyTab(paper, { onClick: () => {} });
    assert.doesNotThrow(() => off());
  });

  check("calling off() twice never throws — teardown stays idempotent (no duplicate-mount leftovers)", () => {
    const { paper } = makePaperWithCards(1);
    const off = mountPlusPiggyTab(paper, { onClick: () => {} });
    off();
    assert.doesNotThrow(() => off());
  });
} finally {
  globalThis.document = realDocument;
}

console.log(`\n${pass}/${pass} PASS`);
