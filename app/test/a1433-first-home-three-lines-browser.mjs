// [A-1433 · Owner 06:1x the three lines · 06:5x "ㅇㅇ" · OUTBOX 「마스터 정리 v3」 A1–A4 · B2] First Home, said through the real app (390 · touch):
// (가) Piggy sits → 2 s → before the card Chog says, in one bubble, one line at a time (earlier lines stay · ≥ 1 s between lines):
//      "work's coming!" → "let's send Piggy to work~" → "your money does the job ♪"
// (나) the Send card comes at the later of: sitting + 20 s · the three lines said + a 1 s breath (the grant can only make it later)
// (다) Send can be pressed 2 s after the card (disabled before)
// (라) first-Home ?: a tap while Chog is speaking says nothing again · a tap after the lines ended says the three lines from the start ·
//      before the card that re-say holds the card · after the card the card stays and only the words are said · Send is never pressed
//      for the person · the scene never changes. One locator('#chogHelp').tap() per tap (never two in a row: E44 zoom).
// The voice is not heard in a headless browser, so "the next line waits for the voice" is not measured here.
//   ARASO_TEST_BROWSER=1 ARASO_PRIVATE_BASE=<private dir> node app/test/a1433-first-home-three-lines-browser.mjs
import { launch, sleep } from "./helpers/a803-browser.mjs";
import { FORK_MODE_INIT, forkRpcStub } from "./helpers/fork-mode.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1433 first Home three lines (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }

const L = ["work's coming!", "let's send Piggy to work~", "your money does the job ♪"];
const SAID = [L[0], `${L[0]} ${L[1]}`, `${L[0]} ${L[1]} ${L[2]}`];
const speakMs = (t) => Math.round(String(t).length * 60 + 1200); // = main.js chogSpeakMs
const linesMs = L.reduce((ms, t) => ms + speakMs(t) + 1000, 0); // all three said, a breath after each (= main.js chogLinesMs)
const SLACK = 150; // the timeline samples every 50 ms; a timer can land a beat late
let pass = 0, fail = 0;
const check = (ok, label) => { if (ok) { pass += 1; console.log(`PASS  ${label}`); } else { fail += 1; console.log(`FAIL  ${label}`); } };

// what a person can see, every 50 ms: scene · card · Send live · Chog's first-Home words (visible lines only) · Piggy's phase · ? · allow sheet
const TIMELINE = () => {
  const tl = []; let last = {};
  new MutationObserver((ms) => { for (const m of ms) if (m.target.id === "sendButton" && m.target.classList.contains("is-armed")) tl.push({ t: Date.now(), k: "armed", v: true }); }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
  const live = (sel) => { const el = document.querySelector(sel); if (!el || el.disabled || el.hidden) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  setInterval(() => {
    try {
      const cue = document.querySelector("#firstSendChogCue");
      const now = {
        scene: document.querySelector("[data-scene]")?.dataset.scene || "",
        card: !!document.querySelector("#sendButton") && document.querySelector("#sendButton").getBoundingClientRect().width > 0,
        send: live("#sendButton"),
        phase: document.querySelector("#homeChar")?.dataset.phase || "",
        help: live("#chogHelp"),
        sheet: live("#sendAllowNo") || live("#sendAllowYes"),
        chog: !cue || !cue.getBoundingClientRect().width ? "" : (() => { const ls = [...cue.querySelectorAll(".chogCheckLine__line")]; return (ls.length ? ls.filter((l) => getComputedStyle(l).visibility !== "hidden").map((l) => l.textContent.trim()).join(" ") : cue.textContent).replace(/\s+/g, " ").trim(); })(),
      };
      for (const k of Object.keys(now)) if (now[k] !== last[k]) tl.push({ t: Date.now(), k, v: now[k] });
      last = now; window.__a1433 = tl;
    } catch (e) { window.__a1433Error = String(e); }
  }, 50);
};

// The fork profile (the only one this harness can seed a Piggy on): there the first Send button stays sealed (LEGACY_TESTNET_PATH, a
// testnet-only path), so "Send can be pressed" is read as the moment the app arms it — armSend marks the button .is-armed (MutationObserver).
const H = await launch({ forkMode: true });
const world = async () => {
  const context = await H.context.browser().newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await context.addInitScript(() => { try { localStorage.setItem("araso.entryEnvelope.v1", "1"); } catch {} });
  await context.addInitScript(FORK_MODE_INIT);
  await context.addInitScript(TIMELINE);
  await context.route("**/*", (route) => { const u = new URL(route.request().url()); if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort(); return route.continue(); });
  await forkRpcStub(context);
  const p = await context.newPage();
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  // the same seeding as helpers/a803-browser.mjs seedSolo, stopped at the Name save so the first Home is watched from its start
  await p.goto(H.BASE, { waitUntil: "networkidle" });
  for (let a = 0; a < 4; a += 1) {
    if (await p.locator("#inviteFaceButton").count()) await p.locator("#inviteFaceButton").click().catch(() => {});
    await p.waitForFunction(() => ["hatch", "name"].includes(document.querySelector("[data-scene]")?.dataset.scene) || document.querySelector("#authTryAgainButton"), { timeout: 25000 }).catch(() => {});
    if (["hatch", "name"].includes(await scene())) break;
    await p.locator("#authTryAgainButton").click().catch(() => {}); await sleep(800);
  }
  for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
    const v = await p.evaluate(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden && getComputedStyle(e).visibility !== "hidden"; }; return { input: vis("#piggyNameInput"), ok: vis(".nameCard__okBtn") }; });
    if (v.input) break;
    if (v.ok) { await p.locator(".nameCard__okBtn").first().click({ force: true }).catch(() => {}); await sleep(900); continue; }
    await sleep(300);
  }
  await p.locator("#piggyNameInput").fill("Honeybun"); await sleep(150);
  await p.evaluate(() => document.querySelector("#nameForm").requestSubmit());
  for (let t0 = Date.now(); Date.now() - t0 < 10000 && (await scene()) !== "sendstay";) await sleep(100);
  const tl = () => p.evaluate(() => window.__a1433 || []);
  const until = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = await tl(); if (pred(x)) return x; await sleep(50); } return tl(); };
  return { context, p, tl, until };
};
const first = (tl, k, pred, from = 0) => tl.find((e) => e.t >= from && e.k === k && pred(e.v));
const homeOf = (tl) => first(tl, "scene", (v) => v === "sendstay")?.t;
const sitOf = (tl) => { const h = homeOf(tl); return first(tl, "phase", (v) => v && v !== "walk", (h || 0) + 500)?.t || h; };
const chogSeen = (tl, from = 0) => tl.filter((e) => e.k === "chog" && e.t >= from).map((e) => e.v);

try {
  // ── A · watch, no tap ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const W = await world();
    const tl = await W.until((x) => x.some((e) => e.k === "armed"), 60000);
    const sit = sitOf(tl);
    const card = first(tl, "card", (v) => v === true, sit)?.t;
    const send = first(tl, "armed", () => true, sit)?.t; // Send pressable (fork: the arm moment · see above)
    const t = SAID.map((s) => first(tl, "chog", (v) => v === s, sit)?.t);
    const seen = JSON.stringify([...new Set(chogSeen(tl, sit))]);
    check(t.every(Boolean) && t[0] >= sit + 2000 - SLACK && t[0] < t[1] && t[1] < t[2], `(가) sit + 2 s → the three lines one at a time, earlier lines stay (sit +${t.map((x) => x ? ((x - sit) / 1000).toFixed(1) : "—").join(" · +")} s · seen ${seen})`);
    check(t.every(Boolean) && t[1] - t[0] >= 1000 - SLACK && t[2] - t[1] >= 1000 - SLACK, `(가) ≥ 1 s between the lines (${t[0] && t[1] ? t[1] - t[0] : "—"} · ${t[1] && t[2] ? t[2] - t[1] : "—"} ms)`);
    check(t[2] && card && t[2] < card, `(가) all three lines are said before the card (third +${t[2] ? ((t[2] - sit) / 1000).toFixed(1) : "—"} s · card +${card ? ((card - sit) / 1000).toFixed(1) : "—"} s)`);
    check(card && card >= sit + 20000 - SLACK, `(나) card ≥ sit + 20 s (+${card ? ((card - sit) / 1000).toFixed(1) : "—"} s)`);
    check(card && t[2] && card >= t[2] + speakMs(L[2]) + 1000 - SLACK, `(나) card ≥ the third line said + 1 s (${card && t[2] ? card - t[2] : "—"} ms after it shows · needs ≥ ${speakMs(L[2]) + 1000})`);
    const sendSeen = tl.filter((e) => (e.k === "send" || e.k === "card" || e.k === "armed") && e.t >= sit).map((e) => `${e.k}=${e.v}@+${((e.t - sit) / 1000).toFixed(1)}`).join(" ");
    check(card && send && send - card >= 2000 - SLACK && send - card <= 2000 + 600, `(다) Send can be pressed 2 s after the card (${card && send ? send - card : "—"} ms · ${sendSeen})`);
    const after = card && first(tl, "chog", () => true, card + 300);
    check(card && !tl.some((e) => e.k === "chog" && e.t > card && e.t < (send || card) + 500 && e.v !== SAID[2]), `(가) the three lines stay up with the card (${after ? JSON.stringify(after.v) : "unchanged"})`);
    await W.p.screenshot({ path: `${process.argv[2] || "."}/a1433-A-390.png` }).catch(() => {});
    await W.context.close();
  }
  // ── B · the first-Home ? ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const W = await world();
    let tl = await W.until((x) => x.some((e) => e.k === "chog" && e.v === SAID[0]), 30000);
    const sit = sitOf(tl);
    const t0 = first(tl, "chog", (v) => v === SAID[0], sit)?.t;
    await sleep(400);
    const helpUp = await W.p.locator("#chogHelp").count();
    check(helpUp > 0, `(라) ? is on the first Home while Chog speaks`);
    const tap1 = Date.now(); if (helpUp) await W.p.locator("#chogHelp").tap();
    tl = await W.until((x) => x.some((e) => e.k === "chog" && e.v === SAID[2]), 20000);
    const t2a = first(tl, "chog", (v) => v === SAID[1], tap1)?.t;
    const back1 = tl.find((e) => e.k === "chog" && e.t > tap1 + 60 && e.t < (first(tl, "chog", (v) => v === SAID[2], tap1)?.t || Infinity) && !SAID.includes(e.v) && e.v !== "");
    check(t0 && t2a && t2a - t0 <= speakMs(L[0]) + 1000 + 400 && !tl.some((e) => e.k === "chog" && e.t > tap1 + 60 && e.v === SAID[0] && e.t > (t2a || 0)), `(라) a tap while speaking says nothing again (second line at +${t0 && t2a ? t2a - t0 : "—"} ms after the first, as untapped · ${back1 ? `odd ${JSON.stringify(back1.v)}` : "no restart"})`);
    const t3 = first(tl, "chog", (v) => v === SAID[2], sit)?.t;
    // after the three lines ended, before the card: the ? says them again from the start and the card waits for that
    const endAt = t3 + speakMs(L[2]) + 300;
    while (Date.now() < endAt) await sleep(50);
    const before = await W.tl();
    const cardEarly = before.some((e) => e.k === "card" && e.v === true && e.t > sit);
    const tap2 = Date.now(); if (helpUp) await W.p.locator("#chogHelp").tap();
    tl = await W.until((x) => x.some((e) => e.k === "armed" && e.t > tap2), 50000);
    const r0 = first(tl, "chog", (v) => v === SAID[0], tap2)?.t;
    const r2 = first(tl, "chog", (v) => v === SAID[2], tap2)?.t;
    const card = first(tl, "card", (v) => v === true, sit)?.t;
    check(!cardEarly && r0 && r0 - tap2 <= 700 && r2 && r2 > r0, `(라) a tap after the lines ended says the three lines from the start (first line +${r0 ? r0 - tap2 : "—"} ms after the tap · all three again at +${r2 ? r2 - tap2 : "—"} ms)`);
    check(card && r0 && card >= tap2 + linesMs - SLACK - 300, `(라) before the card, the re-say holds the card (card ${card ? card - tap2 : "—"} ms after the tap · lines + breath ${linesMs} ms)`);
    // after the card (Send live): the card stays, only the words are said again; nothing is pressed; the scene stays Home
    const send = first(tl, "armed", () => true, sit)?.t;
    check(!!send, `(라) Send was armed after the re-said lines and the card (${send ? "armed" : "never armed"})`);
    while (Date.now() < send + 800) await sleep(50);
    const tap3 = Date.now(); if (helpUp) await W.p.locator("#chogHelp").tap();
    await sleep(3500);
    tl = await W.tl();
    const s0 = first(tl, "chog", (v) => v === SAID[0], tap3)?.t;
    const cardGone = tl.some((e) => e.k === "card" && e.v === false && e.t > tap3);
    const sendOff = tl.some((e) => e.k === "card" && e.v === false && e.t > tap3); // (fork: the button stays sealed; the card staying is what is seen)
    const sheet = tl.some((e) => e.k === "sheet" && e.v === true && e.t > tap3);
    const sceneMoved = tl.some((e) => e.k === "scene" && e.t > tap3);
    check(s0 && s0 - tap3 <= 700 && !cardGone && !sendOff, `(라) after the card the ? says the words again and the card stays (first line +${s0 ? s0 - tap3 : "—"} ms · card ${cardGone ? "gone" : "stays"} · Send card ${sendOff ? "went away" : "stays"})`);
    check(!sheet && !sceneMoved, `(라) the ? never presses Send and never changes the scene (sheet ${sheet} · scene change ${sceneMoved})`);
    await W.p.screenshot({ path: `${process.argv[2] || "."}/a1433-B-390.png` }).catch(() => {});
    await W.context.close();
  }
} finally { await H.close(); }
if (fail) { console.log(`FAIL a1433 first Home three lines (${fail} FAIL / ${pass} PASS)`); process.exit(1); }
console.log(`PASS a1433 first Home three lines (${pass} PASS)`);
