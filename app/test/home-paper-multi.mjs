// [A-540] Multi-Piggy HOME paper fold/expand/scroll module contract — 네트워크 0 · 브라우저 0.
// Owner-confirmed source: $ARASO_PRIVATE_BASE/design/home_paper_multi_20260923/home-paper-multi.{js,css}.
//   node app/test/home-paper-multi.mjs
//
// Same two-part approach as home-peek-module.mjs:
//  1. byte-identical verbatim copy proof (no card-authorized deviation touches this module).
//  2. structural contract tests against the real `mountResidentPaper()` — run via node:vm with
//     mountHomePeek/mountPlusPiggyTab STUBBED OUT (that half is proven separately, and its real
//     fetch/DOMParser/SVG needs are out of scope for a DOM-less node test) and a tiny hand-built
//     DOM stand-in. contentH()/scrollHeight is a controlled fixture value in each case (not a
//     real browser layout result) — the fold/scroll *decision* (cap comparison, class toggling,
//     paper height, resize event) is what's under test here; the real pixel geometry is proven
//     by this card's headless-Chrome receipt, not by this file.
import assert from "node:assert/strict";
import vm from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import { privatePath } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

let pass = 0;
async function check(label, fn) { await fn(); console.log(`PASS  ${label}`); pass += 1; }

// ── 1. verbatim copy ────────────────────────────────────────────────────────────────────
// Public checkout: the design package is local-only. Without it the two package comparisons print SKIP (not PASS).
const HAS_PKG = existsSync(privatePath());
const PKG_JS = HAS_PKG ? readFileSync(privatePath("design/home_paper_multi_20260923/home-paper-multi.js"), "utf8") : null;
const APP_JS = readFileSync(new URL("../src/home-paper-multi.js", import.meta.url), "utf8");
const PKG_CSS = HAS_PKG ? readFileSync(privatePath("design/home_paper_multi_20260923/home-paper-multi.css"), "utf8") : null;
const APP_CSS = readFileSync(new URL("../src/home-paper-multi.css", import.meta.url), "utf8");
const pkgCheck = (label, fn) => (HAS_PKG ? check(label, fn) : console.log(`SKIP  ${label} — design package absent (public checkout)`));

await pkgCheck("home-paper-multi.js is byte-identical to the confirmed design package", () => {
  assert.equal(APP_JS, PKG_JS);
});
await pkgCheck("home-paper-multi.css is byte-identical to the confirmed design package (no deviation needed here)", () => {
  assert.equal(APP_CSS, PKG_CSS);
});
await check("the 420ms expansion curve is untouched (parent decision 6 — APPLIED_NOT_VISUALLY_CHECKED, no invented timing)", () => {
  assert.match(APP_CSS, /transition: height 420ms cubic-bezier\(\.2, \.8, \.2, 1\);/);
});

// ── 2. tiny DOM stand-in + node:vm — exercise the real mountResidentPaper() ────────────────
class FakeStyle { setProperty(k, v) { this[k] = v; } }
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      toggle: (c, force) => { if (force === undefined) { this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c); } else if (force) this._classes.add(c); else this._classes.delete(c); },
      contains: (c) => this._classes.has(c),
    };
    this.style = new FakeStyle();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this._listeners = {};
    this.offsetHeight = 0; this.scrollTop = 0; this.scrollHeight = 0;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  dispatchEvent(evt) { (this._listeners[evt.type] || []).forEach((fn) => fn(evt)); return true; }
  set innerHTML(_v) {}
  append(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    this.children.push(node);
    node.parent = this;
  }
  before(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    const i = this.parent.children.indexOf(this);
    this.parent.children.splice(i, 0, node);
    node.parent = this.parent;
  }
  after(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    const i = this.parent.children.indexOf(this);
    this.parent.children.splice(i + 1, 0, node);
    node.parent = this.parent;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  querySelectorAll(sel) {
    assert.equal(sel, ".homePaper__card--piggy");
    return this.children.filter((c) => c._classes.has("homePaper__card--piggy"));
  }
  cloneNode() {
    const clone = new FakeElement(this.tagName);
    clone.attrs = { ...this.attrs };
    this._classes.forEach((c) => clone._classes.add(c));
    return clone;
  }
}

function makePaperWithCards(n) {
  const paper = new FakeElement("div");
  const cards = [];
  for (let i = 0; i < n; i += 1) {
    const c = new FakeElement("div");
    c._classes.add("homePaper__card--piggy");
    c.offsetHeight = 101;
    const nameEl = new FakeElement("div");
    nameEl.textContent = `Piggy${i}`;
    c._nameEl = nameEl;
    c.querySelector = (sel) => (sel === ".homePaper__name" ? nameEl : null);
    c.parent = paper;
    paper.children.push(c);
    cards.push(c);
  }
  return { paper, cards };
}

// vm harness — strip the home-peek.js import, stub it, run the real module body.
const RAW = readFileSync(new URL("../src/home-paper-multi.js", import.meta.url), "utf8");
const withoutImport = RAW.replace(/^import \{ mountHomePeek, mountPlusPiggyTab \} from '\.\/home-peek\.js';\n/m, "");
const noExport = withoutImport.replace(/^export /gm, "");
assert.notEqual(withoutImport, RAW, "the home-peek.js import line must be found and stripped for the vm harness");

function makeApi() {
  const calls = { mountHomePeek: [], mountPlusPiggyTab: [], peekOff: 0, tabOff: 0 };
  const ctx = {
    console,
    document: { createElement: (tag) => new FakeElement(tag) },
    CustomEvent,
    Math,
    mountHomePeek: async (paper, opts) => { calls.mountHomePeek.push({ paper, opts }); return () => { calls.peekOff += 1; }; },
    mountPlusPiggyTab: (paper, opts) => { calls.mountPlusPiggyTab.push({ paper, opts }); return () => { calls.tabOff += 1; }; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${noExport}\nglobalThis.__mount = mountResidentPaper;`, ctx);
  return { mount: ctx.__mount, calls };
}

await check("1 resident: delegates entirely to home-peek.js (mountHomePeek + mountPlusPiggyTab), no window/flap DOM created", async () => {
  const { paper, cards } = makePaperWithCards(1);
  const { mount, calls } = makeApi();
  const api = await mount(paper, { onAdd: () => {} });
  assert.equal(calls.mountHomePeek.length, 1);
  assert.equal(calls.mountPlusPiggyTab.length, 1);
  assert.equal(paper.children.length, 1, "no .homeResidents window wraps a lone card");
  assert.equal(paper._classes.has("hasResidents"), false);
  api.off();
  assert.equal(calls.peekOff, 1);
  assert.equal(calls.tabOff, 1);
  assert.deepEqual(cards, paper.children); // untouched
});

await check("2 residents: exactly 1 flap (no --2 layer), both cards wrapped in DOM order, tab appended once", async () => {
  const { paper, cards } = makePaperWithCards(2);
  const { mount } = makeApi();
  await mount(paper, { onAdd: () => {} });
  const win = paper.children.find((c) => c.className === "homeResidents" || c === cards[0].parent);
  assert.ok(win, "a .homeResidents window must exist");
  assert.deepEqual(win.children.filter((c) => c._classes.has("homePaper__card--piggy")), cards, "cards stay in DOM order inside the window");
  const flaps = paper.children.filter((c) => c.className === "homeFlap" || c.className === "homeFlap homeFlap--2");
  assert.equal(flaps.length, 1, "2 Piggies = one folded flap (spec §1)");
  assert.equal(flaps[0].className.includes("homeFlap--2"), false);
  const tabsInWin = win.children.filter((c) => c.className === "homePlusPiggyTab");
  assert.equal(tabsInWin.length, 1, "+ Piggy sits at the end of the resident list, exactly once");
});

for (const n of [3, 8]) {
  await check(`${n} residents: exactly 2 flap layers (spec §1 "3 이상")`, async () => {
    const { paper } = makePaperWithCards(n);
    const { mount } = makeApi();
    await mount(paper, { onAdd: () => {} });
    const flapClasses = paper.children.filter((c) => c.tagName === "button" && c.className?.startsWith("homeFlap")).map((c) => c.className);
    assert.equal(flapClasses.length, 2);
    assert.ok(flapClasses.includes("homeFlap"));
    assert.ok(flapClasses.includes("homeFlap homeFlap--2"));
  });
}

await check("open() toggles isOpen/isResOpen and dispatches homepaper:resize; fold() reverses it — window never scrolls when content fits under the 2.5-card cap", async () => {
  const { paper, cards } = makePaperWithCards(2);
  const { mount } = makeApi();
  const api = await mount(paper, { onAdd: () => {} });
  const win = cards[0].parent;
  win.scrollHeight = 250; // fixture: comfortably under the 2-card cap — content fits, no scroll (spec §1 "스크롤 없음")
  let resizeEvents = 0;
  paper.addEventListener("homepaper:resize", () => { resizeEvents += 1; });
  api.open();
  assert.equal(win.classList.contains("isOpen"), true);
  assert.equal(paper._classes.has("isResOpen"), true);
  assert.equal(win.classList.contains("isScroll"), false);
  assert.equal(paper._classes.has("isResScroll"), false);
  assert.equal(resizeEvents, 1);
  assert.match(paper.style.height, /^\d+px$/);
  api.fold();
  assert.equal(win.classList.contains("isOpen"), false);
  assert.equal(paper._classes.has("isResOpen"), false);
  assert.equal(resizeEvents, 2);
});

await check("8 residents scrolled past the 2.5-card cap: isScroll/isResScroll turn on (spec §1/§4 — 3+ scroll is the accepted consequence, parent decision 2)", async () => {
  const { paper, cards } = makePaperWithCards(8);
  const { mount } = makeApi();
  const api = await mount(paper, { onAdd: () => {} });
  const win = cards[0].parent;
  win.scrollHeight = 900; // fixture: far past the 2.5-card window — must scroll
  api.open();
  assert.equal(win.classList.contains("isScroll"), true);
  assert.equal(paper._classes.has("isResScroll"), true);
});

await check("off() restores every card as a direct child of paper, in original order, and removes every DOM node the module added — mounting again after off() creates no duplicates", async () => {
  const { paper, cards } = makePaperWithCards(3);
  const { mount, calls } = makeApi();
  const api = await mount(paper, { onAdd: () => {} });
  api.off();
  assert.deepEqual(paper.children, cards, "paper.children is exactly the 3 original cards, in order — no leftover window/flap/fade/foldTab");
  assert.equal(calls.peekOff, 1);
  // re-mount on the same (now-clean) paper: must not accumulate a second window/flap set.
  const { mount: mount2 } = makeApi();
  await mount2(paper, { onAdd: () => {} });
  const flapButtons = paper.children.filter((c) => c.tagName === "button" && c.className?.startsWith("homeFlap"));
  assert.equal(flapButtons.length, 2, "exactly one fresh flap set after off()+remount — no duplicate mounts");
  const windows = paper.children.filter((c) => c.children?.some((k) => k._classes?.has("homePaper__card--piggy")));
  assert.equal(windows.length, 1, "exactly one .homeResidents window — off() left no stale wrapper behind");
});

await check("the flap label names 2nd+ residents, truncating to '· +N' beyond 2 — no invented copy", async () => {
  const { paper } = makePaperWithCards(5); // names Piggy0..Piggy4
  const { mount } = makeApi();
  await mount(paper, { onAdd: () => {} });
  const flap = paper.children.find((c) => c.className === "homeFlap");
  const label = flap.children[0];
  assert.equal(label.textContent, "Piggy1 · Piggy2 · +2"); // rest = [Piggy1..Piggy4], first 2 + "+2"
});

await check("+ Piggy onAdd fires exactly the callback given to mountResidentPaper (product beginAddPiggy wiring stays in main.js, not here)", async () => {
  const { paper, cards } = makePaperWithCards(2);
  let fired = 0;
  const { mount } = makeApi();
  await mount(paper, { onAdd: () => { fired += 1; } });
  const win = cards[0].parent;
  const tab = win.children.find((c) => c.className === "homePlusPiggyTab");
  tab._listeners.click[0]();
  assert.equal(fired, 1);
});

console.log(`\n${pass}/${pass} PASS`);
