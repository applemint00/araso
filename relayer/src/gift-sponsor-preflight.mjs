// [A-913 F] Code-hash preflight for the Gift sponsor. READ-ONLY: only eth_getCode (via the injected `getCode`), no tx, no key.
// Reads the runtime code of StatelessDeleGator impl · DelegationManager · ExactExecutionEnforcer · LimitedCallsEnforcer · TimestampEnforcer on the
// policy's chain and compares keccak256(code) with the policy pin (policy itself is already forced equal to the pin table by createGiftSponsorPolicy).
// Any mismatch / empty code / RPC failure => { ok:false } => the service answers 503 unavailable_not_sent and logs which target differed (never code bytes).
// Runs: once on relayer start (server.mjs) and before EVERY sponsor send (gift-sponsor-service.mjs `send()`), so a code swap between two sends is caught.

import { keccak256 } from "viem";

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

/** The five (name, address, expected hash) rows taken from a policy object (createGiftSponsorPolicy output). */
export function preflightTargets(policy) {
  if (!policy || typeof policy !== "object") return null;
  const rows = [
    ["delegateImpl", policy.delegateImpl, policy.implCodeHash],
    ["delegationManager", policy.delegationManager, policy.delegationManagerCodeHash],
    ["exactExecutionEnforcer", policy.exactExecutionEnforcer, policy.exactExecutionCodeHash],
    ["limitedCallsEnforcer", policy.limitedCallsEnforcer, policy.limitedCallsCodeHash],
    ["timestampEnforcer", policy.timestampEnforcer, policy.timestampCodeHash],
  ];
  if (rows.some(([, a, h]) => typeof a !== "string" || typeof h !== "string")) return null;
  return rows.map(([name, address, expected]) => ({ name, address, expected }));
}

/** One preflight pass. Never throws. Returns { ok, chainId, rows:[{name,address,expected,actual,match}], reason? }. */
export async function runGiftSponsorPreflight({ policy, getCode }) {
  const targets = preflightTargets(policy);
  if (!targets || typeof getCode !== "function") return { ok: false, chainId: policy?.chainId ?? null, rows: [], reason: "not_configured" };
  const rows = [];
  let rpcFailed = false;
  await Promise.all(targets.map(async (t, i) => {
    let actual = null;
    try {
      const code = await getCode(t.address);
      actual = typeof code === "string" && HEX.test(code) && code.length > 2 ? keccak256(code) : null; // "0x" (no code) => null => mismatch
    } catch { rpcFailed = true; }
    rows[i] = { ...t, actual, match: actual !== null && actual === t.expected };
  }));
  const ok = !rpcFailed && rows.every((r) => r.match);
  return { ok, chainId: policy.chainId, rows, ...(ok ? {} : { reason: rpcFailed ? "rpc_error" : "code_hash_mismatch" }) };
}

/** Log line for a failed pass: names + short hashes only. */
export function describePreflightFailure(result) {
  if (!result || result.ok) return "preflight ok";
  const bad = (result.rows ?? []).filter((r) => !r.match).map((r) => `${r.name}(${r.address.slice(0, 10)}…) expected ${r.expected.slice(0, 12)}… got ${r.actual ? `${r.actual.slice(0, 12)}…` : "none"}`);
  return `preflight FAILED reason=${result?.reason ?? "unknown"}${bad.length ? ` ${bad.join("; ")}` : ""}`;
}

/** Gate used by the service: `await gate()` => true only when this very call's read matched. Remembers the last result for /health. */
export function createPreflightGate({ policy, getCode, log = () => {} }) {
  const state = { last: null, lastAt: null, runs: 0, failures: 0 };
  const say = (m) => { try { log(`gift-sponsor ${m}`); } catch { /* logger must not break flow */ } };
  const gate = async () => {
    const r = await runGiftSponsorPreflight({ policy, getCode });
    state.last = r; state.lastAt = new Date().toISOString(); state.runs += 1;
    if (!r.ok) { state.failures += 1; say(describePreflightFailure(r)); }
    return r.ok;
  };
  gate.status = () => ({ ok: state.last?.ok ?? null, at: state.lastAt, runs: state.runs, failures: state.failures, reason: state.last?.reason ?? null });
  return gate;
}
