// Account-scoped recovery evidence. The old device-wide flags are preserved, never erased.
const keyFor = address => /^0x[0-9a-f]{40}$/i.test(address || "")
  ? `araso.firstJourney.10143.${address.toLowerCase()}` : null;
const legacy = storage => ({ closed: storage.getItem("araso.tripClosed"), tx: storage.getItem("araso.txHash") });

export function readRecoveredFirst(storage, address) {
  try {
    const key = keyFor(address);
    if (!key) return null;
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const row = JSON.parse(raw);
    if (!row || !["has", "none", "unknown"].includes(row.verdict)) return { verdict: "unknown" };
    if (row.verdict === "none") {
      const now = legacy(storage);
      // A pre-upgrade tab can still close First using only the legacy fields.
      // A new positive signal after our evidence snapshot must close this stale tab too.
      if ((now.closed === "1" && row.closed !== "1") || (now.tx && now.tx !== row.tx)) return { verdict: "has" };
    }
    return row;
  } catch { return { verdict: "unknown" }; }
}

export function saveRecoveredFirst(storage, address, verdict) {
  try {
    const key = keyFor(address);
    if (!key || !["has", "none", "unknown"].includes(verdict)) return { verdict: "unknown" };
    // Completed is monotonic, including another tab's completion during a chain read.
    if (readRecoveredFirst(storage, address)?.verdict === "has") verdict = "has";
    const row = { verdict, ...legacy(storage) };
    const text = JSON.stringify(row);
    storage.setItem(key, text);
    return storage.getItem(key) === text ? row : { verdict: "unknown" };
  } catch { return { verdict: "unknown" }; }
}

export function recoveredFirstVerdict(evidence, latestNonce) {
  if (evidence?.verdict === "has") return "has";
  // A partial deposit / pending outgoing transaction must never offer a second First.
  if (evidence?.verdict === "none_confirmed" && evidence.reason === "no_testnet_tx" && latestNonce === "0x0") return "none";
  return "unknown";
}
