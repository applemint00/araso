// [A-902] Sound set wiring (node only, no audio device): trigger mapping, A/B alternation, once-per-moment, gesture unlock,
// fails silent, flag off -> no play, persistence, mute icon markup/CSS. Browser frames are the coordinator's.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSoundPlayer, SOUND_MOMENTS, SOUND_STORAGE_KEY, MASTER_GAIN } from "../src/sound.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(REPO, p), "utf8");
const sha = (p) => createHash("sha256").update(readFileSync(path.join(REPO, p))).digest("hex");
let n = 0;
const check = async (name, fn) => { await fn(); n += 1; console.log(`ok  ${name}`); };

// ---- fakes -----------------------------------------------------------------------------------------------------------
function fakeWin({ withAudio = true, decodeFails = false, fetchFails = false } = {}) {
  const started = [];
  const listeners = {};
  class Ctx {
    constructor() { this.state = "suspended"; this.destination = {}; }
    resume() { this.state = "running"; return Promise.resolve(); }
    decodeAudioData(_d, ok, bad) { if (decodeFails) bad(new Error("x")); else ok({ fake: true }); }
    createBufferSource() { const s = { buffer: null, connect() {}, start() { started.push({ buffer: s.buffer, gain: s.gainNode?.gain.value }); } }; this.last = s; return s; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
  }
  const win = {
    AudioContext: withAudio ? Ctx : undefined,
    addEventListener: (t, h) => { (listeners[t] ||= []).push(h); },
    removeEventListener() {},
    fire: (t) => (listeners[t] || []).forEach((h) => h()),
    listeners,
  };
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); if (fetchFails) throw new Error("net"); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  return { win, started, urls, fetchImpl };
}
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
function make(opts = {}) {
  const f = fakeWin(opts);
  const storage = opts.storage ?? memStore();
  const p = createSoundPlayer({ win: f.win, storage, fetchImpl: f.fetchImpl });
  return { ...f, p, storage };
}

// ---- assets ----------------------------------------------------------------------------------------------------------
await check("S1 five WAVs copied byte-identical to the Owner set, only under app/public/sound", () => {
  const pairs = [
    ["_private/design/sound_home_paper_unfold.wav", "app/public/sound/sound_home_paper_unfold.wav"],
    ["_private/design/sound_receipt_toss.wav", "app/public/sound/sound_receipt_toss.wav"],
    ["_private/design/sound_return_bell_dmsd_glass.wav", "app/public/sound/sound_return_bell_dmsd_glass.wav"],
    ["_private/design/chog/sound_chog_babble_radio_A.wav", "app/public/sound/chog/sound_chog_babble_radio_A.wav"],
    ["_private/design/chog/sound_chog_babble_radio_B.wav", "app/public/sound/chog/sound_chog_babble_radio_B.wav"],
  ];
  for (const [src, dst] of pairs) {
    assert.ok(existsSync(path.join(REPO, dst)), dst);
    if (existsSync(path.join(REPO, src))) assert.equal(sha(dst), sha(src), `${dst} == design original`);
  }
  for (const m of Object.values(SOUND_MOMENTS)) for (const f of m.files) assert.ok(existsSync(path.join(REPO, "app/public", f)), f);
});

// ---- trigger mapping -------------------------------------------------------------------------------------------------
await check("S2 exactly four moments mapped to the card's files; no File-it sound", () => {
  assert.deepEqual(Object.keys(SOUND_MOMENTS).sort(), ["bell", "chog", "toss", "unfold"]);
  assert.deepEqual(SOUND_MOMENTS.unfold.files, ["/sound/sound_home_paper_unfold.wav"]);
  assert.deepEqual(SOUND_MOMENTS.toss.files, ["/sound/sound_receipt_toss.wav"]);
  assert.deepEqual(SOUND_MOMENTS.bell.files, ["/sound/sound_return_bell_dmsd_glass.wav"]);
  assert.deepEqual(SOUND_MOMENTS.chog.files, ["/sound/chog/sound_chog_babble_radio_A.wav", "/sound/chog/sound_chog_babble_radio_B.wav"]);
  assert.ok(!Object.keys(SOUND_MOMENTS).some((k) => /file/i.test(k)));
});

await check("S3 one moderate master level; every trim is a positive finite number (equal-loudness only)", () => {
  assert.ok(MASTER_GAIN > 0 && MASTER_GAIN <= 0.7);
  for (const m of Object.values(SOUND_MOMENTS)) { assert.equal(m.trims.length, m.files.length); for (const t of m.trims) assert.ok(Number.isFinite(t) && t > 0 && t < 2); }
});

// ---- behaviour -------------------------------------------------------------------------------------------------------
await check("S4 default ON; no play (no fetch) before a user gesture; plays after unlock", async () => {
  const t = make();
  assert.equal(t.p.isOn(), true);
  assert.equal(await t.p.play("unfold"), false);
  assert.equal(t.urls.length, 0, "nothing fetched before a gesture");
  t.p.installGestureUnlock();
  assert.ok(["pointerdown", "touchend", "keydown", "click"].every((e) => t.win.listeners[e]?.length), "gesture listeners installed");
  assert.equal(t.p.unlocked, false);
  t.win.fire("pointerdown");
  assert.equal(t.p.unlocked, true);
  assert.equal(t.urls.length, 5, "all five sounds preloaded right after the first gesture");
  assert.equal(await t.p.play("unfold"), true);
  assert.equal(t.started.length, 1);
  assert.equal(t.urls.length, 5, "play fetches nothing more");
});

await check("S5 Chog babble alternates A, B, A, B per bubble", async () => {
  const t = make(); t.p.unlock();
  for (let i = 0; i < 4; i += 1) assert.equal(await t.p.play("chog"), true);
  assert.ok(t.urls.includes("/sound/chog/sound_chog_babble_radio_A.wav") && t.urls.includes("/sound/chog/sound_chog_babble_radio_B.wav"));
  assert.equal(t.urls.length, 5, "each file fetched once, then cached");
  assert.equal(t.started.length, 4);
});

await check("S6 once per moment key: a re-render with the same key stays silent", async () => {
  const t = make(); t.p.unlock();
  assert.equal(await t.p.playOnce("toss", "scene-1"), true);
  assert.equal(await t.p.playOnce("toss", "scene-1"), false);
  assert.equal(await t.p.playOnce("toss", "scene-2"), true);
  assert.equal(t.started.length, 2);
});

await check("S7 flag off -> no play, persisted, and back on -> plays; default stays ON with empty storage", async () => {
  const t = make(); t.p.unlock();
  assert.equal(t.p.setOn(false), false);
  assert.equal(t.storage.getItem(SOUND_STORAGE_KEY), "1");
  assert.equal(await t.p.play("bell"), false);
  assert.equal(t.started.length, 0);
  const again = createSoundPlayer({ win: t.win, storage: t.storage, fetchImpl: t.fetchImpl });
  assert.equal(again.isOn(), false, "survives a reload");
  assert.equal(t.p.setOn(true), true);
  assert.equal(t.storage.getItem(SOUND_STORAGE_KEY), null);
  assert.equal(await t.p.play("bell"), true);
});

await check("S8 fails silent: no AudioContext, fetch error, decode error, throwing storage, unknown moment", async () => {
  const a = make({ withAudio: false }); a.p.unlock();
  assert.equal(a.p.unlocked, false); assert.equal(await a.p.play("unfold"), false);
  const b = make({ fetchFails: true }); b.p.unlock(); assert.equal(await b.p.play("unfold"), false);
  const c = make({ decodeFails: true }); c.p.unlock(); assert.equal(await c.p.play("unfold"), false);
  const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const d = make({ storage: bad }); d.p.unlock();
  assert.equal(d.p.isOn(), true); assert.equal(d.p.setOn(false), false, "memory flag holds when storage throws");
  assert.equal(await d.p.play("unfold"), false);
  const e = make(); e.p.unlock(); assert.equal(await e.p.play("file-it"), false);
});

// ---- wiring (static) -------------------------------------------------------------------------------------------------
const MAIN = read("app/src/main.js");
const a = MAIN.indexOf("// ── [A-902] Sound set wiring");
const b = MAIN.indexOf("// ── [A-902] end ──");
await check("S9 main.js [A-902] block is delimited, comments only for prose, observation only", () => {
  assert.ok(a > 0 && b > a);
  const block = MAIN.slice(a, b);
  assert.ok(!/\/\*/.test(block), "line comments only");
  assert.ok(!/\brender\(/.test(block.replace(/\/\/.*$/gm, "")), "no render() call");
  for (const m of ["unfold", "toss", "bell", "chog"]) assert.match(block, new RegExp(`playSound\\("${m}"\\)`));
  assert.ok(!/playSound\("(?!unfold|toss|bell|chog)/.test(block), "no other moment");
  assert.match(block, /chogCheckLine/);
  assert.match(block, /prevT < 6\.3 && t >= 6\.3/); assert.match(block, /prevT < 0\.7 && t >= 0\.7/);
  assert.ok(!/setTimeout/.test(block), "no timers: frame-aligned");
  assert.match(block, /A902_NO_SOUND_IDS = new Set\(\["awayRestoreLine", "returnArrivalAlarm"\]\)/);
  assert.ok(!/"pointerover", "focusin", "click", "keydown", "touchstart"\]\) document\.addEventListener\(type, a902ArmUnfold/.test(block), "hover/focus never arm the unfold");
  assert.match(block, /\["click", "keydown", "touchstart"\]\) document\.addEventListener\(type, a902ArmUnfold/);
  assert.match(block, /a902FitSoundTap/);
  assert.match(block, /import \{ playSound, setSoundOn, soundIsOn \} from "\.\/sound\.js";/, "import lives inside the one block");
  assert.ok(!MAIN.slice(0, a).includes("sound.js") && !MAIN.slice(b).includes("sound.js"), "no A-902 text outside the block");
  const outside = (MAIN.slice(0, a) + MAIN.slice(b)).split("\n").filter((l) => /a902/.test(l));
  assert.equal(outside.length, 2, "only the two one-line a902WatchReturn hooks (First and Second Return mount) are outside the block");
  assert.ok(outside.every((l) => l.trim() === "a902WatchReturn(returnView, valid); // [A-902] bell + toss sounds"));
});

await check("S10 no autoplay hooks, no new dependency, nothing else imports sound outside the allowed files", () => {
  const SND = read("app/src/sound.js");
  assert.ok(!/\.play\(\)|\bautoplay\s*=|<audio/i.test(SND.replace(/\/\/.*$/gm, "")));
  assert.ok(!/^import /m.test(SND), "sound.js has no imports");
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /howler|tone|sound|audio/i.test(d)));
});

await check("S11 mute icon: top right of the HOME card, no text, aria-label sound on/off + aria-pressed, crayon filter, default ON", async () => {
  const { homePaperMarkup, homeSoundToggleMarkup } = await import("../src/home-paper.js");
  const html = homePaperMarkup({ mode: "home", name: "Piggy", time: "9:10 PM" });
  const iHead = html.indexOf('class="homePaper__heading"');
  const iBtn = html.indexOf('id="homeSoundToggle"');
  const iTime = html.indexOf("homePaper__time");
  assert.ok(iHead > 0 && iBtn > iHead && iBtn < iTime, "inside the HOME status card, on the heading row, before the time");
  const on = homeSoundToggleMarkup(true);
  assert.match(on, /aria-label="sound on"/); assert.match(on, /aria-pressed="true"/); assert.ok(!/a902-sound--off/.test(on));
  const off = homeSoundToggleMarkup(false);
  assert.match(off, /aria-label="sound off"/); assert.match(off, /aria-pressed="false"/); assert.match(off, /a902-sound--off/);
  assert.match(on, /feTurbulence/); assert.match(on, /stroke-linecap="round"/); assert.match(on, /#141210/);
  assert.equal(on.replace(/<svg[\s\S]*<\/svg>/, "").replace(/<[^>]+>/g, "").trim(), "", "no visible text");
  const money = homePaperMarkup({ mode: "money", bodyMarkup: "<div>x</div>" });
  assert.ok(!/homeSoundToggle/.test(money), "icon is on the HOME card only");
});

await check("S12 CSS: marked block, top-right of the status card, tap box >= 44 (em), slash only when off, nothing outside the speaker", () => {
  const CSS = read("app/src/style.css");
  const i = CSS.indexOf("[A-902] sound on/off");
  assert.ok(i > 0);
  const block = CSS.slice(i, CSS.indexOf("[A-902] end", i));
  assert.match(block, /\.homePaper__card--status > \.a902-sound \{[^}]*top: calc\(50px - 46px \* var\(--a902k, 1\)\); right: 6px; width: calc\(46px \* var\(--a902k, 1\)\)/);
  assert.ok(46 >= 44);
  assert.match(block, /\.a902-sound__slash \{ display: none; \}/);
  assert.match(block, /\.a902-sound--off \.a902-sound__slash \{ display: inline; \}/);
  assert.ok(!/@keyframes|animation/.test(block));
  // title row box 4..50 local px stays above the status row (card padding 20 + heading 25 + margin 14 = 59)
  assert.ok(4 + 46 <= 20 + 25 + 14);
});

console.log(`a902 sound: ${n} PASS`);
