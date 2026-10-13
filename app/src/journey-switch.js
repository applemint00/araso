// [A-948] Switch between Journey 1 (testnet) and Journey 2 (shared fork) inside the one address. Not wired to any button yet: the entry (card E)
// and a later design GO call it. Order: drop the live signer → remember the journey → reload "/" (a full page load, so the next boot picks
// the profile once — boot-profile.js — and nothing in memory crosses over).
// Signing-related storage removed here: NONE. The signer lives only in main.js memory (activeSession / activeAccount, ended by the
// disposer main.js registers = endActiveSession); no signing key is kept in localStorage or sessionStorage (sessionStorage holds only the
// Home-life UI layout and the one-use Journey switch timestamp). The passkey credential and PRF salt are device identity, not a session: kept.
// [A-956] No switch while money is moving: before anything else, switchJourney refuses (returns false, writes nothing, no reload) when
//   · an unconfirmed First send is recorded (araso.sendPending) or a tab holds a send reservation (araso.sendPending.reserve.<tab>)
//   · an unconfirmed Second send is recorded (any araso.secondSendPending* key)
//   · main.js's busy probe says a signature is in progress or a tx is unconfirmed (registerJourneySwitchBusyProbe)
//   · the probe or the storage read throws (fail closed).
import { JOURNEY_KEY } from "./boot-profile.js";

// A1206: UI-only, one-use bridge across the authenticated Journey switch; never a signer.
export const JOURNEY_SWITCH_UNLOCK_KEY = "araso.journeySwitchUnlock.v1";
export function consumeJourneySwitchUnlock({ storage = typeof localStorage !== "undefined" ? localStorage : null, session = typeof sessionStorage !== "undefined" ? sessionStorage : null, now = Date.now() } = {}) {
  try {
    const raw = session?.getItem(JOURNEY_SWITCH_UNLOCK_KEY);
    session?.removeItem(JOURNEY_SWITCH_UNLOCK_KEY);
    if (!raw || !/^\d+$/.test(raw) || storage?.getItem(JOURNEY_KEY) !== "2") return false;
    const timestamp = Number(raw);
    return Number.isSafeInteger(timestamp) && now >= timestamp && now - timestamp <= 30000;
  } catch { return false; }
}

let disposeSession = null;
let busyProbe = null;

export const SWITCH_BLOCK_KEYS = Object.freeze(["araso.sendPending"]); // [A-956] = main.js SEND_PENDING_KEY
export const SWITCH_BLOCK_PREFIXES = Object.freeze(["araso.sendPending.reserve.", "araso.secondSendPending"]); // [A-956]

/** main.js registers how to drop the live signer (endActiveSession). */
export function registerJourneySessionDisposer(fn) {
  disposeSession = typeof fn === "function" ? fn : null;
}

/** [A-956] main.js registers () => ({ signing: boolean, unconfirmed: boolean }). */
export function registerJourneySwitchBusyProbe(fn) {
  busyProbe = typeof fn === "function" ? fn : null;
}

/** [A-956] Why a switch must not happen now: null = free, else a reason. Never throws. */
export function journeySwitchBlocker(storage) {
  try {
    if (!storage || typeof storage.getItem !== "function") return "storage_unavailable";
    for (const k of SWITCH_BLOCK_KEYS) if (storage.getItem(k) !== null) return "send_pending";
    if (typeof storage.key === "function" && Number.isInteger(storage.length)) {
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (typeof k === "string" && SWITCH_BLOCK_PREFIXES.some((p) => k.startsWith(p))) return k.startsWith("araso.secondSendPending") ? "second_send_pending" : "send_reserved";
      }
    }
    if (busyProbe) {
      const b = busyProbe();
      if (!b || typeof b !== "object") return "busy_unknown";
      if (b.signing === true) return "signing";
      if (b.unconfirmed === true) return "unconfirmed_tx";
      if (b.signing !== false || b.unconfirmed !== false) return "busy_unknown";
    }
    return null;
  } catch {
    return "busy_unknown";
  }
}

/** Switch to journey 1 or 2. Returns false (and does nothing) for any other value, when storage refuses the write, or [A-956] while busy. */
export function switchJourney(n, { storage = typeof localStorage !== "undefined" ? localStorage : null, loc = typeof location !== "undefined" ? location : null, session = typeof sessionStorage !== "undefined" ? sessionStorage : null, now = Date.now() } = {}) {
  const v = n === 1 || n === "1" ? "1" : n === 2 || n === "2" ? "2" : null;
  if (v === null || !storage || !loc) return false;
  if (journeySwitchBlocker(storage) !== null) return false; // [A-956]
  try { disposeSession?.(); } catch { /* the reload below drops memory anyway */ }
  try { storage.setItem(JOURNEY_KEY, v); } catch { return false; }
  try {
    if (v === "2") session?.setItem(JOURNEY_SWITCH_UNLOCK_KEY, String(now));
    else session?.removeItem(JOURNEY_SWITCH_UNLOCK_KEY);
  } catch { /* no bridge: normal boot lock */ }
  loc.replace(`${loc.origin}/`);
  return true;
}
