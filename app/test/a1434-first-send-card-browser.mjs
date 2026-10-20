// [A-1434 · Owner 06:5x "좋아 시안 괜찮다" · OUTBOX 「마스터 정리 v3」 A5–A8 · B1 · B3–B5 · 시안 v3 (card) / v4 (sheet)] First Send card and sheet, real app
// (testnet profile, where the first Send and its stamp live · 390 touch, then a short 390 screen):
// (가) the card: $5 · "Piggy's first job?" · one-line button #sendMoreInfo (aria-expanded="false") "out & back · more info" · "You sign." (ink #141210 +
//      a yellow hand-drawn underline #e0b100) · "Piggy takes your money to work." (ink) · no stamp on the card · no old "0.001 MON test" line
// (나) one tap on #sendMoreInfo → aria-expanded="true" · "out & back · close" · three dot lines "MON → shMON → MON" / "network: Monad Testnet" /
//      "tutorial · actual send 0.001 MON" · one more tap on the same spot → closed · the button and the card do not move or resize (285×364 @390)
// (다) the stamp "tutorial · free" sits outside the card, above it (hand font · gold · floating) · on a screen shorter than ≈650 it sits on the card's
//      top-right corner · it never covers ARASO · ? · Chog · Piggy
// (라) the first sheet: one line "piggy goes to its first job" (no "with your $5.") · under $5 a grey "tutorial · actual send 0.001 MON" · 332 high
// Taps = one locator('#sendMoreInfo').tap() at a time (never two in a row: E44 zoom).
//   ARASO_TEST_BROWSER=1 ARASO_PRIVATE_BASE=<private dir> node app/test/a1434-first-send-card-browser.mjs [shots dir]
import { launch, sleep } from "./helpers/a803-browser.mjs";

if (process.env.ARASO_TEST_BROWSER !== "1") { console.log("SKIP  a1434 first Send card (ARASO_TEST_BROWSER=1 to run)"); process.exit(0); }
const SHOTS = process.argv[2] || "";
const DOTS = ["MON → shMON → MON", "network: Monad Testnet", "tutorial · actual send 0.001 MON"];
let pass = 0, fail = 0;
const check = (ok, label) => { if (ok) { pass += 1; console.log(`PASS  ${label}`); } else { fail += 1; console.log(`FAIL  ${label}`); } };
const near = (a, b, d = 0.6) => Math.abs(a - b) <= d;

const H = await launch();
const world = async (width, height) => {
  const context = await H.context.browser().newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true });
  await context.addInitScript(() => { try { localStorage.setItem("araso.entryEnvelope.v1", "1"); } catch {} });
  await context.route("**/*", (route) => { const u = new URL(route.request().url()); if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort(); return route.continue(); });
  await context.route("**/api/fork-entry", (r) => r.fulfill({ json: { ok: true, publicEntry: true, bound: false } })); // as a1230-trial-stamp-browser: the public entry opens
  const p = await context.newPage();
  const cdp = await context.newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene ?? null);
  // the seeding of helpers/a803-browser.mjs seedSolo (a touch page of its own)
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
  await p.locator("#sendCard").waitFor({ timeout: 45000 }); await sleep(2600); // the card, then Send armed (A-1433: card + 2 s)
  return { context, p };
};
const box = (r) => r && { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
const READ = () => {
  const q = (s) => document.querySelector(s);
  const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const seen = (e) => { if (!e) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05; };
  const card = q("#sendCard");
  const all = card ? [...card.querySelectorAll("*")] : [];
  const byText = (t) => all.find((e) => e.children.length === 0 && e.textContent.replace(/\s+/g, " ").trim() === t) || null;
  const more = q("#sendMoreInfo");
  const sign = byText("You sign.");
  const signLine = sign && [...(sign.parentElement?.querySelectorAll("svg path, svg line, [class*='underline'], [class*='Underline']") || [])].concat(sign.querySelectorAll ? [...sign.querySelectorAll("*")] : []);
  const yellow = (signLine || []).some((e) => { const s = getComputedStyle(e); return [s.stroke, s.backgroundColor, s.borderBottomColor, s.fill].some((c) => c === "rgb(224, 177, 0)"); })
    || (sign && ["::after", "::before"].some((p) => { const s = getComputedStyle(sign, p); return s.content !== "none" && [s.backgroundColor, s.borderBottomColor].includes("rgb(224, 177, 0)") || /e0b100|224,\s*177,\s*0/i.test(s.backgroundImage || ""); }));
  const takes = byText("Piggy takes your money to work.");
  const stamp = [...document.querySelectorAll(".trialStamp--send, .trialStamp")].find((e) => !e.classList.contains("trialStamp--invite")) || null;
  const dots = DOTS_IN.map((t) => { const e = byText(t) || byText(`• ${t}`) || byText(`· ${t}`); return e ? { t, seen: seen(e) } : { t, seen: false, missing: true }; });
  // Piggy's place = the seat image's box (#homeSeat: the seat is drawn over it, the img itself stays visibility:hidden)
  const others = { ARASO: q(".arasoBrand") || q("[class*='arasoBrand']"), help: q("#chogHelp"), chog: q("#chogHome") };
  return {
    card: rect(card),
    message: card?.querySelector(".sendCard__message")?.textContent.trim() || "",
    terms: card?.querySelector(".sendCard__terms")?.textContent.replace(/\s+/g, " ").trim() || "",
    more: more ? { tag: more.tagName, expanded: more.getAttribute("aria-expanded"), text: more.textContent.replace(/\s+/g, " ").trim(), rect: rect(more) } : null,
    sign: sign ? { color: getComputedStyle(sign).color, yellow } : null,
    takes: takes ? { color: getComputedStyle(takes).color } : null,
    oldTest: all.some((e) => e.children.length === 0 && /0\.001 MON test/.test(e.textContent)),
    oldStamp: all.some((e) => /trial phase · free/.test(e.textContent)),
    stamp: stamp ? { text: stamp.textContent.trim(), rect: rect(stamp), seen: seen(stamp), color: getComputedStyle(stamp).color, font: getComputedStyle(stamp).fontFamily, anim: getComputedStyle(stamp).animationName } : null,
    dots,
    others: { ...Object.fromEntries(Object.entries(others).map(([k, e]) => [k, seen(e) ? rect(e) : null])), piggy: rect(q("#homeSeat")) },
    chogParts: [...document.querySelectorAll("#chogHome .chogHome__part")].map(rect).filter((r) => r && r.w > 0),
  };
};
const read = (p) => p.evaluate(`(() => { const DOTS_IN = ${JSON.stringify(DOTS)}; return (${READ.toString()})(); })()`);
const hit = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

try {
  // ── 390 × 844 · the card · more info · stamp · sheet ─────────────────────────────────────────────────────────────────────────────────
  {
    const W = await world(390, 844);
    const c = await read(W.p);
    if (SHOTS) await W.p.screenshot({ path: `${SHOTS}/a1434-390-closed.png` });
    check(c.message === "Piggy's first job?" && /\$5/.test(c.terms), `(가) $5 · "Piggy's first job?" (${JSON.stringify(c.message)} · ${JSON.stringify(c.terms)})`);
    check(c.more && c.more.tag === "BUTTON" && c.more.expanded === "false" && c.more.text === "out & back · more info", `(가) #sendMoreInfo button · aria-expanded false · "out & back · more info" (${JSON.stringify(c.more)})`);
    check(c.sign && c.sign.color === "rgb(20, 18, 16)" && c.sign.yellow, `(가) "You sign." ink #141210 with a yellow #e0b100 underline (${JSON.stringify(c.sign)})`);
    check(c.takes && c.takes.color === "rgb(20, 18, 16)", `(가) "Piggy takes your money to work." ink (${JSON.stringify(c.takes)})`);
    check(!c.oldTest && !c.oldStamp, `(가) no old "0.001 MON test" line · no "trial phase · free" on the card (old line ${c.oldTest} · old stamp ${c.oldStamp})`);
    check(c.dots.every((d) => !d.seen), `(가) closed: the three dot lines are not shown (${JSON.stringify(c.dots)})`);
    check(c.card && near(c.card.w, 285, 1) && near(c.card.h, 364, 1), `(나) card 285×364 @390 (${c.card ? `${c.card.w.toFixed(1)}×${c.card.h.toFixed(1)}` : "—"})`);
    // (나) open · close on the same spot
    let o = null, z = null;
    if (c.more) { await W.p.locator("#sendMoreInfo").tap(); await sleep(700); o = await read(W.p); if (SHOTS) await W.p.screenshot({ path: `${SHOTS}/a1434-390-open.png` }); }
    check(o && o.more.expanded === "true" && o.more.text === "out & back · close", `(나) one tap → aria-expanded true · "out & back · close" (${JSON.stringify(o?.more)})`);
    check(o && o.dots.every((d) => d.seen), `(나) open: the three dot lines shown (${JSON.stringify(o?.dots)})`);
    if (c.more) { await sleep(400); await W.p.locator("#sendMoreInfo").tap(); await sleep(700); z = await read(W.p); }
    check(z && z.more.expanded === "false" && z.more.text === "out & back · more info" && z.dots.every((d) => !d.seen), `(나) one more tap → closed again (${JSON.stringify(z?.more)})`);
    const same = (a, b) => a && b && ["l", "t", "w", "h"].every((k) => near(a[k], b[k], 0.5));
    check(o && z && same(c.more.rect, o.more.rect) && same(o.more.rect, z.more.rect), `(나) the button does not move between the two states (${[c.more?.rect, o?.more?.rect].map((r) => r && `${r.l.toFixed(1)},${r.t.toFixed(1)} ${r.w.toFixed(1)}×${r.h.toFixed(1)}`).join(" → ")})`);
    check(o && z && same(c.card, o.card) && same(o.card, z.card), `(나) the card keeps its place and size open and closed (${[c.card, o?.card].map((r) => r && `${r.w.toFixed(1)}×${r.h.toFixed(1)}`).join(" → ")})`);
    // (다) the stamp
    const s = c.stamp;
    check(s && s.seen && s.text === "tutorial · free" && s.color === "rgb(224, 177, 0)", `(다) stamp "tutorial · free" · gold (${JSON.stringify(s && { text: s.text, color: s.color, font: s.font })})`);
    check(s && c.card && s.rect.b <= c.card.t + 1, `(다) 844 high: the stamp is outside the card, above it (stamp bottom ${s?.rect.b.toFixed(1)} · card top ${c.card?.t.toFixed(1)})`);
    check(s && s.font && !/Playfair/i.test(s.font), `(다) the stamp is in the hand font, not the card's serif (${s?.font})`);
    check(s && s.anim && s.anim !== "none", `(다) the stamp floats up and down (animation ${s?.anim})`);
    const cover = s && [["ARASO", c.others.ARASO], ["?", c.others.help], ["Piggy", c.others.piggy], ...c.chogParts.map((r) => ["Chog", r])].filter(([, r]) => hit(s.rect, r)).map(([k]) => k);
    check(s && cover.length === 0, `(다) the stamp covers nothing (ARASO · ? · Chog · Piggy) (${JSON.stringify(cover)})`);
    // (라) the first sheet: Send → sheet → not now
    await W.p.locator("#sendButton").tap().catch(() => {});
    let sheet = null;
    for (let i = 0; i < 40 && !sheet; i += 1) { await sleep(250); sheet = await W.p.evaluate(() => { const sh = document.querySelector("#sendAllowSheet .sendAllow__sheet"); if (!sh) return null; const r = sh.getBoundingClientRect(); const sum = document.querySelector(".sendAllow__sum")?.getBoundingClientRect(); const all = [...sh.querySelectorAll("*")].filter((e) => e.children.length === 0); const grey = all.find((e) => e.textContent.trim() === "tutorial · actual send 0.001 MON"); const g = grey?.getBoundingClientRect(); return { h: r.height, lines: [...sh.querySelectorAll(".sendAllow__line")].map((e) => e.textContent.trim()), sum: document.querySelector(".sendAllow__sum")?.textContent.trim(), grey: grey ? { below: g.top >= sum.bottom - 1, color: getComputedStyle(grey).color } : null, allText: sh.textContent.replace(/\s+/g, " ").trim() }; }); }
    if (SHOTS && sheet) await W.p.screenshot({ path: `${SHOTS}/a1434-390-sheet.png` });
    check(sheet && sheet.lines.length === 1 && sheet.lines[0] === "piggy goes to its first job" && !/with your/.test(sheet.allText), `(라) the sheet says one line "piggy goes to its first job" (${JSON.stringify(sheet?.lines)})`);
    check(sheet && sheet.sum === "$5" && sheet.grey && sheet.grey.below, `(라) under $5 a grey "tutorial · actual send 0.001 MON" (${JSON.stringify(sheet && { sum: sheet.sum, grey: sheet.grey })})`);
    check(sheet && near(sheet.h, 332, 0.5), `(라) the sheet stays 332 high (${sheet?.h})`);
    if (sheet) { await W.p.locator("#sendAllowNo").tap().catch(() => {}); await sleep(800); }
    const after = await W.p.evaluate(() => ({ sheet: !!document.querySelector("#sendAllowSheet"), card: !!document.querySelector("#sendCard") }));
    check(sheet && !after.sheet && after.card, `(라) not now → the sheet goes, the card stays (sheet ${after.sheet} · card ${after.card})`);
    await W.context.close();
  }
  // ── short screens (390 × 600 · 320 × 640): the stamp sits on the card's top-right corner ──────────────────────────────────────────────
  for (const [SW, SH] of [[390, 600], [320, 640]]) {
    const W = await world(SW, SH);
    const c = await read(W.p);
    if (SHOTS) await W.p.screenshot({ path: `${SHOTS}/a1434-${SW}x${SH}-closed.png` });
    const s = c.stamp;
    const cx = s && (s.rect.l + s.rect.r) / 2, cy = s && (s.rect.t + s.rect.b) / 2;
    check(s && c.card && hit(s.rect, c.card) && cx > c.card.r - s.rect.w && cy > c.card.t - s.rect.h && cy < c.card.t + s.rect.h, `(다) ${SW}×${SH}: the stamp sits on the card's top-right corner (stamp ${s ? `${s.rect.l.toFixed(0)}..${s.rect.r.toFixed(0)} × ${s.rect.t.toFixed(0)}..${s.rect.b.toFixed(0)}` : "—"} · card ${c.card ? `${c.card.l.toFixed(0)}..${c.card.r.toFixed(0)} × ${c.card.t.toFixed(0)}` : "—"})`);
    const cover = s && [["ARASO", c.others.ARASO], ["?", c.others.help], ["Piggy", c.others.piggy], ...c.chogParts.map((r) => ["Chog", r])].filter(([, r]) => hit(s.rect, r)).map(([k]) => k);
    check(s && cover.length === 0, `(다) ${SW}×${SH}: the stamp covers nothing (${JSON.stringify(cover)} · piggy ${JSON.stringify(c.others.piggy)} · stamp ${JSON.stringify(s?.rect)})`);
    await W.context.close();
  }
} finally { await H.close(); }
if (fail) { console.log(`FAIL a1434 first Send card (${fail} FAIL / ${pass} PASS)`); process.exit(1); }
console.log(`PASS a1434 first Send card (${pass} PASS)`);
