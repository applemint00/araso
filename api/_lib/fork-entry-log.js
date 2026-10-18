// [A-1385] Journey 2 entry refuse log — the ONE place the entry server writes a log line. One fixed-word line per refusal:
//   console.warn("fork_entry refuse", JSON.stringify({ action, reason, asset?, adminStatus?, forkInstance? }))
// Allowed fields only, each checked against its word shape (anything else = dropped, so an address, hash, nonce, signature, token or
// invite can never ride in, not even as a "reason"). forkInstance = the first 8 characters of the fork instance id.
// public-watch counts these lines by reason (fixed words only, no raw text kept).
const ACTIONS = new Set(["challenge", "enter", "status", "complete"]);
const REASON_RE = /^[a-z][a-z0-9_]{0,47}$/;
const ASSET_RE = /^[A-Z][A-Z0-9]{0,11}$/;
const INSTANCE_RE = /^(?!0x)[a-z0-9][a-z0-9._:-]{0,63}$/; // an instance id, never an address-looking value
const status = (v) => (v === "sign" || (Number.isSafeInteger(v) && v >= 0 && v <= 599) ? v : undefined);

/** -> the JSON text of one refuse line (allowed fields only). */
export function forkEntryRefuseLine({ action, reason, asset, adminStatus, forkInstanceId } = {}) {
  const out = { action: ACTIONS.has(action) ? action : "other", reason: typeof reason === "string" && REASON_RE.test(reason) ? reason : "other" };
  if (typeof asset === "string" && ASSET_RE.test(asset)) out.asset = asset;
  if (status(adminStatus) !== undefined) out.adminStatus = adminStatus;
  if (typeof forkInstanceId === "string" && INSTANCE_RE.test(forkInstanceId)) out.forkInstance = forkInstanceId.slice(0, 8);
  return JSON.stringify(out);
}

/** -> log(fields) for createForkEntryService({ log }). A broken sink never breaks an answer. */
export function createForkEntryLog({ sink = (...a) => console.warn(...a) } = {}) {
  return (fields) => { try { sink("fork_entry refuse", forkEntryRefuseLine(fields)); } catch { /* the answer stays as it was */ } };
}

export const forkEntryRefuseLog = createForkEntryLog();
