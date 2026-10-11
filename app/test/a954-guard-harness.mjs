// [A-954] A-949 fork harness, A-954 additions (node only, no anvil, no network): (1) the start refuses unless anvil's --fork-url is the
// process's own read-only proxy; (2) the Public Guard answers araso_guardInfo itself with the name the app checks; (3) CORS only for
// dev-app origins given as start arguments (default none, no "*"); (4) anvil keeps its A-949 hardening. The live behaviour of all four
// is exercised by the real run (_private/ops/harness/a949-fork-infra/a954-app-link-run.mjs). Skips when this checkout has no _private.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORK_GUARD_METHOD, FORK_GUARD_NAME } from "../src/chain-profile.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, "..", "..", "_private/ops/harness/a949-fork-infra/fork-infra.mjs");
if (!existsSync(FILE)) { console.log("SKIP  no _private harness in this checkout"); process.exit(0); }
const SRC = readFileSync(FILE, "utf8");
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass += 1; console.log(`PASS  ${n}`); } catch (e) { fail += 1; console.log(`FAIL  ${n}\n      ${String(e && e.message || e).split("\n")[0]}`); } };

// The upstream assertion, evaluated as written (extracted from the harness source; its free variables are given here).
const fnSrc = SRC.slice(SRC.indexOf("function assertForkUpstreamIsProxy(args) {"), SRC.indexOf("\nasync function startFork("));
const make = (proxyUrl, upstreamProxyPort) => new Function("proxyUrl", "upstreamProxyPort", `${fnSrc}; return assertForkUpstreamIsProxy;`)(proxyUrl, upstreamProxyPort);
const argsWith = (u) => ["--fork-url", u, "--fork-block-number", "110874000", "--chain-id", "31337143", "--host", "127.0.0.1", "--port", "1"];

check("upstream: anvil --fork-url == this process's read-only proxy → start allowed", () => { make("http://127.0.0.1:50001", 50001)(argsWith("http://127.0.0.1:50001")); });
check("upstream: the public parent RPC (or any other URL) directly → REFUSED", () => {
  for (const u of ["https://rpc.monad.xyz", "https://rpc.monad.xyz/", "http://127.0.0.1:50002", "http://localhost:50001", null]) assert.throws(() => make("http://127.0.0.1:50001", 50001)(argsWith(u)), /REFUSED/, String(u));
  assert.throws(() => make(null, null)(argsWith("http://127.0.0.1:50001")), /REFUSED/, "proxy not started");
  assert.throws(() => make("https://rpc.monad.xyz", 50001)(argsWith("https://rpc.monad.xyz")), /REFUSED/, "proxyUrl swapped for the parent");
  assert.throws(() => make("http://127.0.0.1:50001", 50001)([...argsWith("http://127.0.0.1:50001"), "--fork-url", "https://rpc.monad.xyz"]), /REFUSED/, "a second fork url");
  assert.throws(() => make("http://127.0.0.1:50001", 50001)([...argsWith("http://127.0.0.1:50001"), "-f", "https://rpc.monad.xyz"]), /REFUSED/, "short flag");
});
check("upstream: checked before EVERY anvil spawn; anvil gets no env fallback upstream; one start-log line names the proxy", () => {
  const spawnAt = SRC.indexOf('const anvil = spawn("anvil", args'); const assertAt = SRC.indexOf("assertForkUpstreamIsProxy(args); //");
  assert.ok(assertAt > 0 && assertAt < spawnAt);
  assert.equal((SRC.match(/spawn\("anvil"/g) || []).length, 1);
  assert.match(SRC, /for \(const k of \["ETH_RPC_URL", "FOUNDRY_ETH_RPC_URL", "ANVIL_FORK_URL"\]\) delete anvilEnv\[k\]/);
  assert.match(SRC, /log\(`upstream = read-only proxy \$\{proxyUrl\}/);
  assert.match(SRC, /"--fork-url", proxyUrl,/);
});
check("Guard identity: araso_guardInfo answered by the Guard (never forwarded), same name/method as the app checks", () => {
  assert.equal(FORK_GUARD_METHOD, "araso_guardInfo");
  assert.ok(SRC.includes(`export const GUARD_NAME = "${FORK_GUARD_NAME}";`));
  const at = SRC.indexOf('if (m === "araso_guardInfo")'); const allowAt = SRC.indexOf("if (!publicAllows(m))");
  assert.ok(at > 0 && at < allowAt, "handled before the namespace allowlist / forwarding");
  assert.match(SRC.slice(at, allowAt), /result: \{ guard: GUARD_NAME, chainId: FORK_CHAIN_ID, forkInstanceId: f\.id \}/);
  assert.equal(/araso_/.test(SRC.slice(SRC.indexOf("const UP_ALLOW"), SRC.indexOf("const upstreamStats"))), false);
});
check("CORS: only --cors-origin values (127.0.0.1 / localhost with a port), default none, no '*', OPTIONS and POST share it", () => {
  const shape = new RegExp(SRC.match(/const CORS_ORIGIN_SHAPE = \/(.+)\/;/)[1].replace(/\\\\/g, "\\"));
  for (const ok of ["http://127.0.0.1:5173", "http://localhost:5173"]) assert.ok(shape.test(ok), ok);
  for (const bad of ["*", "null", "https://evil.example", "http://127.0.0.1", "http://127.0.0.1:5173/", "http://evil.localhost:5173", "http://localhost.evil:5173", "http://10.0.0.1:5173", "http://127.0.0.1:5173 "]) assert.equal(shape.test(bad), false, bad);
  assert.equal(/"access-control-allow-origin": "\*"/.test(SRC.replace(/^\/\/.*$/gm, "")), false);
  assert.match(SRC, /if \(typeof origin !== "string" \|\| !CORS_ORIGINS\.has\(origin\)\) return \{\};/);
  assert.match(SRC, /if \(request\.method === "OPTIONS"\) \{ response\.writeHead\(204, CORS\);/);
  assert.equal(/process\.env\.[A-Z0-9_]*CORS/.test(SRC), false, "no env value opens CORS");
});
check("anvil hardening kept (--balance 0 --no-cors, 127.0.0.1)", () => {
  assert.match(SRC, /const ANVIL_HARDENING = \["--balance", "0", "--no-cors"\];/);
  assert.match(SRC, /"--host", "127\.0\.0\.1"/);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
