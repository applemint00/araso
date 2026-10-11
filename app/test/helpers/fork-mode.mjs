// [A-950] Browser-harness fork-profile mode (A-948 STALE_TESTS.md class (a)).
// After A-948 the Second UI opens only at release level >= 2 AND on the fork profile (release-gate.js journeyFeatureOpen). The fork profile
// boots when the dev server carries the fork build config (boot-profile.js hasForkEnv) and the stored journey is "2" before the page loads
// (boot-profile.js selectBootProfile rule 2). This module is the one place the harness gets both from:
//   · FORK_MODE_ENV   — merged into the vite dev-server env. Dummy https URL on a reserved TLD: no network (every harness context aborts
//                       non-local requests, and the Explore/Away flows under test never reach the RPC).
//   · FORK_MODE_INIT  — a context/page init script: sets araso.journey.v1 = "2" before any page script, only when nothing is stored
//                       (a suite that explicitly stores "1" keeps it; a suite that clears storage and reloads gets "2" back).
//   · FORK_MODE_SEED  — the same key as a plain seed row, for raw-CDP suites that seed localStorage and then navigate.
// On the fork profile the storage scope is "monad-fork": Second keys are `<key>.monad-fork` (boot-profile.js scopedSecondKey) and the
// testnet legacy receipts (araso.receipts / araso.txHash / tripClosed) are not read (main.js LEGACY_TESTNET_PATH).
// Default everywhere = off (unchanged testnet dev server).
// A950_FORK_MODE=0 in the environment turns fork mode OFF for a whole run without editing a suite (the forkMode-off regression / baseline
// run, RECEIPT §first-journey regression): FORK_MODE_ENV = {} · FORK_MODE_INIT = no-op · forkFirstDone = no-op · forkKey = the bare (testnet) key.
export const FORK_MODE_OFF = typeof process !== "undefined" && process.env?.A950_FORK_MODE === "0";
const FORK_DUMMY_ENV = Object.freeze({ VITE_ARASO_FORK_RPC_URL: "https://fork-public.invalid/rpc", VITE_ARASO_FORK_INSTANCE_ID: "a950-local" });
export const FORK_MODE_ENV = FORK_MODE_OFF ? Object.freeze({}) : FORK_DUMMY_ENV;
export const FORK_JOURNEY_KEY = "araso.journey.v1";
// [A-974] + a dummy invite (araso.forkInvite.v1, fork-entry-client.js FORK_INVITE_KEY) when none is stored: on the fork profile Explore opens only
// after the fork entry server's status says this Piggy entered (main.js [A-974] block), and that read sends the device's invite. The server is
// the local stub below (forkRpcStub / forkRpcStubCdp). pre-A-974: the journey key only.
export const FORK_INVITE_KEY = "araso.forkInvite.v1";
export const FORK_DUMMY_INVITE = "a974-local-dummy-invite";
export const FORK_MODE_INIT = FORK_MODE_OFF ? "void 0;" : `try { if (localStorage.getItem(${JSON.stringify(FORK_JOURNEY_KEY)}) === null) localStorage.setItem(${JSON.stringify(FORK_JOURNEY_KEY)}, "2"); if (localStorage.getItem(${JSON.stringify(FORK_INVITE_KEY)}) === null) localStorage.setItem(${JSON.stringify(FORK_INVITE_KEY)}, ${JSON.stringify(FORK_DUMMY_INVITE)}); } catch (e) {}`;
export const FORK_MODE_SEED = FORK_MODE_OFF ? Object.freeze({}) : Object.freeze({ [FORK_JOURNEY_KEY]: "2", [FORK_INVITE_KEY]: FORK_DUMMY_INVITE }); // [A-974] + invite. pre-A-974: journey only
export const FORK_SCOPE = "monad-fork";
/** `<base>.monad-fork` — the fork-scope name of a Second key (boot-profile.js scopedSecondKey). */
export const forkKey = (base) => (FORK_MODE_OFF ? base : `${base}.${FORK_SCOPE}`);
/** The chain scope a fork-mode suite boots on in this run: "monad-fork", or "monad-testnet" when A950_FORK_MODE=0. */
export const RUN_SCOPE = FORK_MODE_OFF ? "monad-testnet" : FORK_SCOPE;
/** Env for a vite spawn: forkMode on → base + FORK_MODE_ENV; off → base unchanged. */
export const forkEnv = (base, forkMode = true) => (forkMode ? { ...base, ...FORK_MODE_ENV } : base);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POINT = ([s]) => {
  const el = document.getElementById(s); if (!el || el.hidden || el.disabled) return null; const b = el.getBoundingClientRect(); if (!b.width) return null;
  for (let dy = 0; dy < b.height / 2; dy += 2) for (const sy of [1, -1]) for (let dx = 0; dx < b.width / 2; dx += 2) for (const sx of [1, -1]) {
    const x = b.left + b.width / 2 + sx * dx, y = b.top + b.height / 2 + sy * dy;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) return { x, y };
  }
  return null;
};
/**
 * Fork-profile stand-in for the testnet "First done" seed, on a Playwright page already on Home (sendstay).
 * The testnet seed (araso.receipts / araso.txHash / araso.tripClosed + reload) is not read on the fork profile (main.js LEGACY_TESTNET_PATH),
 * and the fork First Send is sealed, so the only way to the post-file quiet Home there is the DEV return jump (the same path a943's level-2
 * control and a891 Part B take): __arasoScene("return", { arrival: true }) → tap through → filed → Home (goHomeFromFilebox arms the cue).
 * NOTE: a RELOAD afterwards does not re-arm the cue on the fork profile (main.js homeQuietForExplore needs state.tripClosed) — see A-950 RECEIPT (iii).
 * [A-974] Since A-974 a reload on the fork re-arms it once the (stubbed) fork entry server says this Piggy entered (main.js [A-974] block).
 * Returns the final scene.
 */
export async function forkFirstDone(p, { timeoutMs = 30000 } = {}) {
  const scene = () => p.evaluate(() => document.querySelector("[data-scene]")?.dataset.scene || null);
  if (FORK_MODE_OFF) return scene(); // forkMode off: the testnet First-done seed arms the cue as before
  await p.evaluate(() => window.__arasoScene("return", { arrival: true }));
  for (let t0 = Date.now(); Date.now() - t0 < timeoutMs;) {
    if ((await scene().catch(() => null)) === "sendstay") break;
    // tap through the Return only; at "filed" (#returnOpen up) the app goes Home by itself after the filed line (a891AfterFiling → goHomeFromFilebox)
    const r = await p.evaluate(POINT, ["returnTap"]).catch(() => null);
    if (r) { await p.mouse.click(r.x, r.y); await sleep(1200); } else await sleep(150);
  }
  for (let t0 = Date.now(); Date.now() - t0 < 9000;) { if ((await scene().catch(() => null)) === "sendstay") break; await sleep(100); }
  return scene();
}

// The dummy fork RPC host. Nothing leaves the machine: forkRpcStub() answers it locally.
export const FORK_RPC_HOST = new URL(FORK_DUMMY_ENV.VITE_ARASO_FORK_RPC_URL).hostname;
const FORK_CHAIN_HEX = "0x1de2ab7";
// [A-974] the fork entry server stand-in (shared by the Playwright and raw-CDP stubs)
export const FORK_ENTRY_PATH = "/api/fork-entry";
function forkEntryAnswer(method, invite, postData) {
  if (method !== "POST") return { status: 405, body: { ok: false, reason: "method" }, counted: false };
  let b = null; try { b = JSON.parse(postData || "null"); } catch { b = null; }
  if (b?.action === "status" && invite === FORK_DUMMY_INVITE && b.forkInstanceId === FORK_DUMMY_ENV.VITE_ARASO_FORK_INSTANCE_ID) return { status: 200, body: { ok: true, allowed: true, forkInstanceId: FORK_DUMMY_ENV.VITE_ARASO_FORK_INSTANCE_ID }, counted: true };
  return { status: 403, body: { ok: false, allowed: false, reason: "a974_stub_refused" }, counted: true };
} // 31337143 = funding-context.js FORK_CHAIN_ID
const forkRpcResult = (m) => (m === "eth_chainId" ? FORK_CHAIN_HEX : m === "net_version" ? "31337143" : m === "eth_blockNumber" ? "0x1" : m === "eth_getBalance" ? "0x0" : m === "eth_call" ? `0x${"0".repeat(64)}` : m === "eth_getTransactionCount" ? "0x0" : null);
/**
 * Playwright: answer the dummy fork RPC host locally (register AFTER a suite's own catch-all route — the later route wins).
 * Reads get fixed zero answers (balance 0, block 1, chain 31337143); any eth_send* is refused (aborted) and counted in the returned
 * counter; an unknown method gets a JSON-RPC error. A testnet suite that used route.continue() read the REAL testnet RPC; on the fork
 * profile the read goes to this stub instead — no real network.
 */
export async function forkRpcStub(context) {
  const seen = { reads: 0, sends: 0, entry: 0 };
  // [A-974] the same-origin fork entry server (/api/fork-entry): "status" for the dummy invite + this run's fork instance = allowed (the Piggy
  // entered); challenge / enter = refused (no entry is ever made here). PASS_LOCAL_MOCK. pre-A-974: no entry route (the vite server answered 404).
  await context.route((u) => u.pathname === FORK_ENTRY_PATH, async (route) => {
    const req = route.request();
    const r = forkEntryAnswer(req.method(), req.headers()["x-araso-invite"], req.postData());
    if (r.counted) seen.entry += 1;
    return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  await context.route((u) => u.hostname === FORK_RPC_HOST, async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    let body; try { body = JSON.parse(req.postData() || "null"); } catch { return route.abort(); }
    if (/eth_send/.test(JSON.stringify(body))) { seen.sends += 1; return route.abort(); }
    const one = (r) => { seen.reads += 1; const v = forkRpcResult(r?.method); return v === null ? { jsonrpc: "2.0", id: r?.id ?? 1, error: { code: -32601, message: "a950 stub: method not found" } } : { jsonrpc: "2.0", id: r?.id ?? 1, result: v }; };
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
  });
  return seen;
}

/**
 * [A-974] Raw-CDP twin of forkRpcStub (suites with a hand-rolled CDP client): Fetch.requestPaused answers the dummy fork RPC host and the
 * same-origin /api/fork-entry locally. send(method, params, sessionId) / on(event, handler) = the suite's own CDP client. No real network.
 */
export async function forkRpcStubCdp(send, on, sessionId) {
  const seen = { reads: 0, sends: 0, entry: 0 };
  if (FORK_MODE_OFF) return seen;
  const cors = [{ name: "access-control-allow-origin", value: "*" }, { name: "access-control-allow-headers", value: "*" }, { name: "access-control-allow-methods", value: "POST, OPTIONS" }];
  const fulfill = (requestId, status, obj, extra = []) => send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: "application/json" }, ...extra], body: Buffer.from(obj === null ? "" : JSON.stringify(obj)).toString("base64") }, sessionId).catch(() => {});
  on("Fetch.requestPaused", (ev) => {
    const req = ev.request; let u; try { u = new URL(req.url); } catch { return send("Fetch.continueRequest", { requestId: ev.requestId }, sessionId).catch(() => {}); }
    if (u.hostname === FORK_RPC_HOST) {
      if (req.method === "OPTIONS") return fulfill(ev.requestId, 204, null, cors);
      let body; try { body = JSON.parse(req.postData || "null"); } catch { return send("Fetch.failRequest", { requestId: ev.requestId, errorReason: "Failed" }, sessionId).catch(() => {}); }
      if (/eth_send/.test(JSON.stringify(body))) { seen.sends += 1; return send("Fetch.failRequest", { requestId: ev.requestId, errorReason: "Failed" }, sessionId).catch(() => {}); }
      const one = (r) => { seen.reads += 1; const v = forkRpcResult(r?.method); return v === null ? { jsonrpc: "2.0", id: r?.id ?? 1, error: { code: -32601, message: "a950 stub: method not found" } } : { jsonrpc: "2.0", id: r?.id ?? 1, result: v }; };
      return fulfill(ev.requestId, 200, Array.isArray(body) ? body.map(one) : one(body), cors);
    }
    if (u.pathname === FORK_ENTRY_PATH) {
      const inv = Object.entries(req.headers || {}).find(([k]) => k.toLowerCase() === "x-araso-invite")?.[1];
      const r = forkEntryAnswer(req.method, inv, req.postData); if (r.counted) seen.entry += 1;
      return fulfill(ev.requestId, r.status, r.body);
    }
    return send("Fetch.continueRequest", { requestId: ev.requestId }, sessionId).catch(() => {});
  });
  await send("Fetch.enable", { patterns: [{ urlPattern: `*://${FORK_RPC_HOST}/*` }, { urlPattern: `*${FORK_ENTRY_PATH}*` }] }, sessionId);
  return seen;
}
