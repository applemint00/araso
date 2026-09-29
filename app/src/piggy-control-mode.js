// [A-644 2B] Selected-Piggy control depth — a **preference**, never a permission.
//
// Owner labels (verbatim): "Piggy decides" / "Ask me" / "I'll manage". Stored as the semantic
// value only (piggy_decides / ask_me / ill_manage); the label is chosen at render time.
//
// What this store is NOT (contract): it does not create a signer session, an execution
// permission, a tx intent, funding, or Job READY. Changing the mode moves no money. Nothing in
// the app reads this value to authorise an action — every money action still goes through its
// own per-action confirmation (Face ID / passkey), whatever the mode says.
//
// Scope: one Piggy. Key = `araso.piggyControlMode.<chainId>.<accountId>.<piggyId>` — one small
// record per Piggy, so changing one Piggy's mode cannot touch another's (two keys, two writes,
// no shared object). Same scope/version/fail-closed pattern as piggy-registry.js.
//
// Default = `ask_me`. Canon names no default (A-644 Lane S §2). This is the coordinator's
// conservative existing-behavior equivalent (today every action already asks first) — not an
// Owner-sourced default.

import { findSecretLikeKey } from "./piggy-registry.js";

export const CONTROL_MODE_VERSION = 1;
const PREFIX = "araso.piggyControlMode";

export const CONTROL_MODE = Object.freeze({
  PIGGY_DECIDES: "piggy_decides",
  ASK_ME: "ask_me",
  ILL_MANAGE: "ill_manage",
});
const MODES = Object.freeze(Object.values(CONTROL_MODE));
export const DEFAULT_CONTROL_MODE = CONTROL_MODE.ASK_ME;

// Display order + exact Owner labels. No other copy.
export const CONTROL_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: CONTROL_MODE.PIGGY_DECIDES, label: "Piggy decides" }),
  Object.freeze({ value: CONTROL_MODE.ASK_ME, label: "Ask me" }),
  Object.freeze({ value: CONTROL_MODE.ILL_MANAGE, label: "I'll manage" }),
]);

// Closed allow-list of persisted fields. Anything else on read → default; never written.
const FIELDS = Object.freeze(["version", "chainId", "accountId", "piggyId", "mode", "updatedAt"]);
const ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;

export function isControlMode(value) {
  return typeof value === "string" && MODES.includes(value);
}

function cleanScope(scope = {}) {
  const s = scope && typeof scope === "object" ? scope : {};
  const pick = (v) => (typeof v === "string" ? v.trim() : "");
  const out = { chainId: pick(s.chainId), accountId: pick(s.accountId), piggyId: pick(s.piggyId) };
  const ok = ID_RE.test(out.chainId) && ID_RE.test(out.accountId) && ID_RE.test(out.piggyId);
  return ok ? out : null;
}

export function piggyControlModeKey(scope = {}) {
  const clean = cleanScope(scope);
  if (!clean) return null;
  return `${PREFIX}.${clean.chainId}.${clean.accountId}.${clean.piggyId}`;
}

// Read one Piggy's mode. Never throws. Missing / corrupt JSON / wrong version / wrong scope /
// unknown mode / extra or secret-like field → { mode: DEFAULT_CONTROL_MODE, error }.
export function loadControlMode(storage, scope = {}) {
  const clean = cleanScope(scope);
  if (!clean) return { mode: DEFAULT_CONTROL_MODE, error: "bad_scope" };
  let raw = null;
  try {
    raw = storage ? storage.getItem(piggyControlModeKey(clean)) : null;
  } catch {
    return { mode: DEFAULT_CONTROL_MODE, error: "storage_unavailable" };
  }
  if (raw === null || raw === undefined) return { mode: DEFAULT_CONTROL_MODE, error: null };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { mode: DEFAULT_CONTROL_MODE, error: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { mode: DEFAULT_CONTROL_MODE, error: "corrupt" };
  if (findSecretLikeKey(parsed)) return { mode: DEFAULT_CONTROL_MODE, error: "secret_like_field" };
  if (Object.keys(parsed).some((k) => !FIELDS.includes(k))) return { mode: DEFAULT_CONTROL_MODE, error: "unknown_field" };
  if (parsed.version !== CONTROL_MODE_VERSION) return { mode: DEFAULT_CONTROL_MODE, error: "version_mismatch" };
  if (parsed.chainId !== clean.chainId || parsed.accountId !== clean.accountId || parsed.piggyId !== clean.piggyId) {
    return { mode: DEFAULT_CONTROL_MODE, error: "scope_mismatch" };
  }
  if (!isControlMode(parsed.mode)) return { mode: DEFAULT_CONTROL_MODE, error: "unknown_mode" };
  return { mode: parsed.mode, error: null };
}

// Write one Piggy's mode. Only the closed shape is ever written. Unknown mode / bad scope →
// nothing written. Returns { saved, mode, error } — never throws.
export function saveControlMode(storage, scope = {}, mode, { at = null } = {}) {
  const clean = cleanScope(scope);
  if (!clean) return { saved: false, mode: DEFAULT_CONTROL_MODE, error: "bad_scope" };
  if (!isControlMode(mode)) return { saved: false, mode: loadControlMode(storage, clean).mode, error: "unknown_mode" };
  const record = {
    version: CONTROL_MODE_VERSION,
    chainId: clean.chainId,
    accountId: clean.accountId,
    piggyId: clean.piggyId,
    mode,
    updatedAt: typeof at === "string" && at ? at : new Date().toISOString(),
  };
  try {
    storage.setItem(piggyControlModeKey(clean), JSON.stringify(record));
  } catch {
    return { saved: false, mode: loadControlMode(storage, clean).mode, error: "storage_unavailable" };
  }
  return { saved: true, mode, error: null };
}
