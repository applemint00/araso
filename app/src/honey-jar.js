// [A-905] Honey jar — the Home entry to the Money tab (Owner 2026-10-08, gift_card_20261004/README "Home 입구 배치").
//
// Pure logic + markup only (no DOM lookups, no storage, no network, no timers except an injected one):
//  · gate    : the jar exists only after the Second Journey is complete (same gate as the money entries) and only on a Home scene.
//              It does NOT depend on any Piggy's state, so it stays when every Piggy is Away.
//  · slot    : a stable position inside the measured safe-slot rules (never over Chog, Paper/HISTORY footprint, names, brand,
//              other living Piggies, outside the safe rect). Deterministic: the same anchors give the same slot (no random,
//              no teleport between renders). No slot that fits = no jar (it never overlaps instead).
//  · arrival : the bump runs ONLY for a confirmed real arrival (confirmed deposit · Return receipt with value · received Gift),
//              once per evidence id. Nothing else can trigger it. The honey level is not a balance gauge: nothing persists.
//  · motion  : prefers-reduced-motion means static (the bump does nothing).
// Class contract = receipts/A905_money_tab_jar/design/CLASS_CONTRACT.md. aria-label = "money" (Owner), no visible text.


export const JAR_SRC = "/card/honey-jar.svg";
export const JAR_ARIA_LABEL = "money"; // Owner (Cowork answer 2026-10-08): reuses the MONEY word; no visible text
export const JAR_SIZE_PX = 60; // Owner 2026-10-08 "60" (pre-A-905 jar-size baseline: 48). button is 1em square at --a905JarSize (>= 44 px tap area)
export const JAR_MIN_TAP_PX = 44;
// Home scenes that carry the Chog board + Home paper. Away scenes keep the jar (it is the Money entry when no Piggy sits at home).
// secondAway is NOT one: Chog is mounted there with cardClaimed (the Second card owns the shared paper slot), so the Home Paper can never open and a Money tab would be crushed (browser frames A-905).
export const JAR_HOME_SCENES = Object.freeze(["sendstay", "away"]);
export const JAR_BUMP_KINDS = Object.freeze(["deposit_confirmed", "return_receipt", "gift_received"]);
// Fallback if `animationend` never arrives (CSS missing): bump + settle is ~0.96 s in the design CSS.
export const JAR_BUMP_FALLBACK_MS = 1500;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Same gate as the money entries (Second complete) + a Home scene. Nothing about Piggies is read here. */
export function jarGate({ secondJourneyCompletedOnce = false, scene = null } = {}) {
  return secondJourneyCompletedOnce === true && JAR_HOME_SCENES.includes(scene);
}

const validRect = (r) => Boolean(r) && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.r) && Number.isFinite(r.b) && r.r > r.x && r.b > r.y;

// [A-918] The mock spot (receipts/A918_honey_jar_spot/RECEIPT.md "A. mock measurement"). honey_jar_mock.html draws the jar (left 162 / top 196 / 46 wide, CSS px
// of the 390x260 scene) in front of the seat Piggy's left foot; the seat Piggy art in that scene = ink box x 178..349 (171) y 32..210 (178).
// The rule is the ratio to the seat art box, so place AND size follow the Piggy art at every width (A-829 character stage; principle 0).
//   centre x = art.x + JAR_MOCK_CX * art.w   (left foot)        bottom y = art.y + JAR_MOCK_BOTTOM * art.h   (floor / name line)   size = JAR_MOCK_W * art.w
// pre-A-918 baseline: planJarSlot picked a free cell (seat-right / seat-left / seat-front / scan) with a fixed 60 px jar.
export const JAR_MOCK_CX = (162 + 46 / 2 - 178) / 171;
export const JAR_MOCK_BOTTOM = (196 + 46 - 32) / 178;
export const JAR_MOCK_W = 46 / 171;

/** The ONE spot from a seat art box { x, y, w, h } (viewport px). Pure ratio maths: no blockers, no scan, no fallback. */
export function jarSpotFromSeat(seat) {
  if (!validRect(seat)) return null;
  const w = seat.r - seat.x;
  const h = seat.b - seat.y;
  const size = JAR_MOCK_W * w;
  return { x: seat.x + JAR_MOCK_CX * w - size / 2, y: seat.y + JAR_MOCK_BOTTOM * h - size, w: size, h: size, spot: "mock" };
}

/**
 * Placement. With a seat Piggy: jarSpotFromSeat(anchors.seatImg), the same relation at every width, nothing else.
 * Away-only Home: the same relation from the invisible seat box (Owner "같은 자리", Cowork 20:53). pre-A-918 baseline: a safe-slot scan around Chog's ink.
 */
export function planJarSlot({ anchors } = {}) {
  if (!anchors) return null;
  // [A-918 E] Owner "같은 자리": seated or Away, the jar is placed from the seat box (Away = the invisible seat box, main.js a918SeatBoxFromBoard).
  // The old free-space scan is removed: no seat box = no jar (fallback 0).
  return validRect(anchors.seatImg) ? jarSpotFromSeat(anchors.seatImg) : null;
}

/** Jar layer markup (CLASS_CONTRACT §1). x / y are the layer-local top-left px. `honey` must come BEFORE the img. */
export function honeyJarLayerMarkup({ x = 0, y = 0, size = JAR_SIZE_PX, bump = false, minTap = null } = {}) {
  const px = (n) => `${Math.round(Number(n) * 100) / 100}px`;
  // [A-918] x / y / size = the ART box (follows the Piggy art). minTap = the 44 px tap floor in the layer's own (scaled) px; the button grows to the tap box around the art
  // centre (CSS --a905Tap) while the art keeps its size. pre-A-918 baseline: the tap floor was min-width/min-height on a button whose art filled it (art grew with the floor).
  const tap = Number.isFinite(minTap) && minTap > 0 ? `;--a905Tap:${Math.ceil(Number(minTap) * 100) / 100}px` : ""; // rounded UP so the screen tap box never lands at 43.99
  return `<div class="a905-jarLayer" data-a905-layer="1">`
    + `<button class="a905-jar" type="button" id="a905Jar" aria-label="${esc(JAR_ARIA_LABEL)}" style="--a905JarX:${px(x)};--a905JarY:${px(y)};--a905JarSize:${px(size)}${tap}"${bump ? ' data-bump="1"' : ""}>`
    + `<span class="a905-jar__art">`
    + `<span class="a905-jar__fill"><span class="a905-jar__honey"></span></span>`
    + `<img class="a905-jar__img" src="${esc(JAR_SRC)}" alt="" draggable="false">`
    + `<span class="a905-jar__shine"></span>`
    + `<span class="a905-jar__drop"></span>`
    + `</span>`
    + `</button></div>`;
}

/**
 * Is this a confirmed REAL arrival? Strict on purpose: unknown kind, unconfirmed, no evidence id = not an arrival.
 *   { kind:"deposit_confirmed", confirmed:true, creditsTarget:true, evidenceId }
 *   { kind:"return_receipt",    confirmed:true, hasValue:true,      evidenceId }
 *   { kind:"gift_received",     confirmed:true, claimed:true,       evidenceId }
 */
export function confirmedArrivalKind(evt) {
  if (!evt || typeof evt !== "object") return null;
  if (evt.confirmed !== true) return null;
  if (typeof evt.evidenceId !== "string" || evt.evidenceId.trim() === "") return null;
  if (evt.kind === "deposit_confirmed") return evt.creditsTarget === true ? evt.kind : null;
  if (evt.kind === "return_receipt") return evt.hasValue === true ? evt.kind : null;
  if (evt.kind === "gift_received") return evt.claimed === true ? evt.kind : null;
  return null;
}

/**
 * One arrival gate for the whole app. offer(evt) -> true only when a confirmed, not-yet-seen real arrival was accepted and
 * `onBump` ran. The same evidence id never bumps twice (the seen-set lives for the page; a reload bumps nothing by itself).
 */
export function createJarArrivals({ onBump } = {}) {
  const seen = new Set();
  const pending = new Set(); // confirmed arrivals whose bump could not play yet (jar not mounted): played once on mount
  const play = (key, kind, evidenceId) => (typeof onBump !== "function" ? true : onBump({ kind, evidenceId }) !== false);
  return {
    offer(evt) {
      const kind = confirmedArrivalKind(evt);
      if (!kind) return false;
      const evidenceId = evt.evidenceId.trim();
      const key = `${kind}:${evidenceId}`;
      if (seen.has(key) || pending.has(key)) return false;
      if (play(key, kind, evidenceId)) seen.add(key); else pending.add(key);
      return true;
    },
    /** Called when the jar is mounted: queued real arrivals play now (one bump for the batch). */
    flush() {
      if (pending.size === 0) return false;
      if (typeof onBump === "function" && onBump({ kind: "queued", evidenceId: "" }) === false) return false;
      for (const k of pending) seen.add(k);
      pending.clear();
      return true;
    },
    get seenCount() { return seen.size; },
    get pendingCount() { return pending.size; },
  };
}

/**
 * Run the bump on a jar element (contract: set data-bump="1"; remove it on animationend of .a905-jar__img; re-trigger = remove,
 * force reflow, add). reduced motion = static: nothing is set. `timers` is injectable for tests. Returns true when it started.
 */
export function bumpJarElement(button, { reduced = false, timers = globalThis } = {}) {
  if (!button || reduced === true) return false;
  button.removeAttribute("data-bump");
  void button.offsetWidth; // force reflow so the animation restarts
  button.setAttribute("data-bump", "1");
  const img = button.querySelector(".a905-jar__img");
  let done = false;
  let timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer !== null && typeof timers.clearTimeout === "function") timers.clearTimeout(timer);
    if (img) img.removeEventListener("animationend", finish);
    button.removeAttribute("data-bump");
  };
  if (img) img.addEventListener("animationend", finish);
  if (typeof timers.setTimeout === "function") timer = timers.setTimeout(finish, JAR_BUMP_FALLBACK_MS);
  return true;
}
