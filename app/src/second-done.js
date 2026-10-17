// [A-1357] Journey 2 facts that belong to one Piggy ("Journey 2 done", "Journey 2 intro seen"): stored per chain scope AND Piggy address.
// Before, one flag per chain stood for every Piggy in this browser, so a new Piggy inherited an earlier Piggy's "done" and never got the
// Journey 2 intro (A-1356). The old per-chain flag is read once per chain and handed to the Piggy (or Piggies) it belonged to — the ones
// with their own Journey 2 record on that chain; when no Piggy has one, it can only be the current Piggy's. The old flag stays stored.
import { scopedSecondKey } from "./boot-profile.js";

const RECORD_PREFIX = "araso.secondJourney"; // second-journey-state.js domain record: `${RECORD_PREFIX}.${chainId}.${accountId}`
const lc = (s) => String(s || "").trim().toLowerCase();

/** `<old per-chain key>.<address>`; "" when there is no Piggy. */
export function secondFlagKey(base, scope, account) {
  const a = lc(account);
  return a ? `${scopedSecondKey(base, scope)}.${a}` : "";
}

function keysOf(storage) {
  const out = [];
  try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (typeof k === "string") out.push(k); } } catch { /* unreadable = none */ }
  return out;
}

/** Once per (base, scope): the old per-chain "1" → the Piggies with a Journey 2 record there, else the current Piggy. Never deletes. */
export function migrateSecondFlag(storage, base, scope, currentAccount) {
  if (!storage || !scope) return;
  const legacy = scopedSecondKey(base, scope);
  const marker = `${legacy}.moved`;
  try {
    if (storage.getItem(marker) === "1") return;
    if (storage.getItem(legacy) === "1") {
      const prefix = `${RECORD_PREFIX}.${scope}.`;
      const owners = keysOf(storage).filter((k) => k.startsWith(prefix)).map((k) => lc(k.slice(prefix.length))).filter((a) => /^0x[0-9a-f]{40}$/.test(a));
      const targets = owners.length ? [...new Set(owners)] : [lc(currentAccount)].filter(Boolean);
      if (!targets.length) return; // no Piggy yet: decide on the first boot that has one
      for (const a of targets) storage.setItem(secondFlagKey(base, scope, a), "1");
    }
    storage.setItem(marker, "1");
  } catch { /* storage refused: the next boot tries again */ }
}

export function readSecondFlag(storage, base, scope, account) {
  migrateSecondFlag(storage, base, scope, account);
  const k = secondFlagKey(base, scope, account);
  try { return !!k && storage.getItem(k) === "1"; } catch { return false; }
}

export function writeSecondFlag(storage, base, scope, account) {
  const k = secondFlagKey(base, scope, account);
  if (!k) return false;
  try { storage.setItem(k, "1"); return true; } catch { return false; }
}
