// [A-901] Relay quote proxy (api/relay-quote.js) — 0 network calls: every upstream call is an injected fake fetch.
// The "key" in this file is a made-up sentinel, never a real key.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const realFetch = globalThis.fetch;
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error("network forbidden in a901"); };

const P = await import("../../api/relay-quote.js");
const RR = await import("../src/funding-rail-relay.js");
const { createRelayQuoteHandler, PROXY_PATH, RELAY_UPSTREAM_URL, MAX_BODY_BYTES, RELAY_RELEASE_LEVEL_ENV } = P;

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };

const KEY = "TEST_SENTINEL_not_a_real_key_0123456789";
const logs = [];
const origLog = { l: console.log, e: console.error, w: console.warn, i: console.info };
const capture = () => { console.log = console.error = console.warn = console.info = (...a) => logs.push(a.join(" ")); };
const release = () => { console.log = origLog.l; console.error = origLog.e; console.warn = origLog.w; console.info = origLog.i; };

const mkRes = () => {
  const r = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, end(b) { r.body = b ?? ""; } };
  return r;
};
const mkReq = ({ method = "POST", url = PROXY_PATH, body, headers = {} } = {}) => ({ method, url, body, headers: { host: "app.example", ...headers } });
const fakeUp = (status, text, { delayMs = 0, throws = false, rec } = {}) => async (url, init) => {
  if (rec) rec.push({ url, init });
  if (throws) throw new Error("boom");
  if (delayMs) await new Promise((r, j) => { const to = setTimeout(r, delayMs); init.signal.addEventListener("abort", () => { clearTimeout(to); const e = new Error("aborted"); e.name = "AbortError"; j(e); }); });
  return { status, headers: { "set-cookie": "x=1", "x-api-key": KEY }, text: async () => text };
};
const runRaw = async (handlerOpts, reqOpts) => { const res = mkRes(); capture(); try { await createRelayQuoteHandler(handlerOpts)(mkReq(reqOpts), res); } finally { release(); } return res; };
const level2Env = (env = {}) => {
  const out = Object.create(Object.getPrototypeOf(env));
  Object.assign(out, env);
  out[RELAY_RELEASE_LEVEL_ENV] = "2";
  return out;
};
const run = (handlerOpts, reqOpts) => runRaw({ ...handlerOpts, env: level2Env(handlerOpts.env) }, reqOpts);
const MUSDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const GOOD = { user: "0x" + "11".repeat(20), recipient: "0x" + "22".repeat(20), refundTo: "0x" + "11".repeat(20), originChainId: 8453, originCurrency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", destinationChainId: 143, destinationCurrency: MUSDC, tradeType: "EXACT_INPUT", amount: "20000000", topupGas: false, includeProtocolData: true };
const BODY = JSON.stringify(GOOD);

// ── [A-1029] server release gate: fail closed before key/upstream; level >= 2 preserves the existing path ──
for (const [label, value] of [["absent", undefined], ["level 1", "1"], ["empty", ""], ["blank", "   "], ["zero", "0"], ["negative", "-1"], ["word", "two"], ["float", "2.5"], ["leading zero", "02"], ["unsafe integer", "999999999999999999999"]]) {
  const rec = [];
  const env = { RELAY_API_KEY: KEY };
  if (value !== undefined) env[RELAY_RELEASE_LEVEL_ENV] = value;
  const res = await runRaw({ fetchImpl: fakeUp(200, "{}", { rec }), env }, { body: BODY });
  t(`server release gate ${label} -> 404 not_found, no upstream`, res.statusCode === 404 && JSON.parse(res.body).error === "not_found" && rec.length === 0);
}
{
  const rec = [];
  const inherited = Object.create({ [RELAY_RELEASE_LEVEL_ENV]: "2" });
  inherited.RELAY_API_KEY = KEY;
  const res = await runRaw({ fetchImpl: fakeUp(200, "{}", { rec }), env: inherited }, { body: BODY });
  t("server release level must be an own env property", res.statusCode === 404 && rec.length === 0);
}
for (const level of ["2", " 2 ", "3"]) {
  const rec = [];
  const res = await runRaw({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY, [RELAY_RELEASE_LEVEL_ENV]: level } }, { body: BODY });
  t(`server release level ${JSON.stringify(level)} keeps the existing quote path`, res.statusCode === 200 && rec.length === 1);
}

// ── happy path: exactly one upstream POST, quote/v2 only, key header, body unchanged ──
{
  const rec = [];
  const res = await run({ fetchImpl: fakeUp(200, '{"ok":1}', { rec }), env: { RELAY_API_KEY: KEY } }, { body: BODY });
  t("200 passes JSON body through", res.statusCode === 200 && res.body === '{"ok":1}');
  t("exactly one upstream call", rec.length === 1);
  t("upstream URL is the constant https://api.relay.link/quote/v2", rec[0].url === "https://api.relay.link/quote/v2" && RELAY_UPSTREAM_URL === rec[0].url);
  t("upstream method POST + x-api-key set from env", rec[0].init.method === "POST" && rec[0].init.headers["x-api-key"] === KEY);
  // pre-A-909 baseline: the proxy forwarded the raw text; since A-909 N4 it forwards JSON.stringify of the validated object (equal here because GOOD has no whitespace/dups and canonical key order)
  t("body forwarded unchanged (byte-identical string)", rec[0].init.body === BODY);
  t("redirects not followed", rec[0].init.redirect === "error");
  t("no CORS header ever set", !Object.keys(res.headers).some((k) => k.startsWith("access-control")));
  t("upstream headers not relayed (no set-cookie / x-api-key)", !("set-cookie" in res.headers) && !("x-api-key" in res.headers));
  t("key never in response headers/body", !JSON.stringify(res.headers).includes(KEY) && !res.body.includes(KEY));
  t("key never logged", !logs.join("\n").includes(KEY));
}
// object body (Vercel-parsed) is accepted
{
  const rec = [];
  const res = await run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { body: JSON.parse(BODY) });
  t("parsed-object body forwarded as JSON", res.statusCode === 200 && JSON.parse(rec[0].init.body).amount === "20000000");
}
// key echoed by upstream is scrubbed
{
  const res = await run({ fetchImpl: fakeUp(200, JSON.stringify({ echo: KEY }) ), env: { RELAY_API_KEY: KEY } }, { body: BODY });
  t("upstream body containing the key is redacted", !res.body.includes(KEY) && res.body.includes("[redacted]"));
}
// upstream error statuses
{
  const r429 = await run({ fetchImpl: fakeUp(429, '{"message":"rate"}'), env: { RELAY_API_KEY: KEY } }, { body: BODY });
  t("upstream 4xx passes through", r429.statusCode === 429);
  const r500 = await run({ fetchImpl: fakeUp(500, "oops"), env: { RELAY_API_KEY: KEY } }, { body: BODY });
  t("upstream 5xx -> 502 relay_upstream_error", r500.statusCode === 502 && JSON.parse(r500.body).error === "relay_upstream_error");
  const rth = await run({ fetchImpl: fakeUp(0, "", { throws: true }), env: { RELAY_API_KEY: KEY } }, { body: BODY });
  t("upstream throw -> 502, no detail leaked", rth.statusCode === 502 && !rth.body.includes("boom"));
}
// timeout -> 504
{
  const res = await run({ fetchImpl: fakeUp(200, "{}", { delayMs: 500 }), env: { RELAY_API_KEY: KEY }, timeoutMs: 20 }, { body: BODY });
  t("upstream timeout -> 504", res.statusCode === 504 && JSON.parse(res.body).error === "relay_upstream_timeout");
}
// missing key -> 503, no upstream call
for (const [label, env] of [["absent", {}], ["empty", { RELAY_API_KEY: "" }], ["blank", { RELAY_API_KEY: "   " }]]) {
  const rec = [];
  const res = await run({ fetchImpl: fakeUp(200, "{}", { rec }), env }, { body: BODY });
  t(`missing key (${label}) -> 503 relay_key_missing, no upstream call`, res.statusCode === 503 && JSON.parse(res.body).error === "relay_key_missing" && rec.length === 0);
}
{ // inherited (prototype-polluted) env is ignored
  const env = Object.create({ RELAY_API_KEY: KEY });
  const res = await run({ fetchImpl: fakeUp(200, "{}"), env }, { body: BODY });
  t("env read as own property only (polluted proto ignored)", res.statusCode === 503);
}
// default export at server level 2 with no key -> the A-972 live expectation: 503, still 0 network
{
  const saved = process.env.RELAY_API_KEY;
  const savedLevel = process.env[RELAY_RELEASE_LEVEL_ENV];
  delete process.env.RELAY_API_KEY;
  process.env[RELAY_RELEASE_LEVEL_ENV] = "2";
  const res = mkRes(); await P.default(mkReq({ body: BODY }), res);
  if (saved !== undefined) process.env.RELAY_API_KEY = saved;
  else delete process.env.RELAY_API_KEY;
  if (savedLevel !== undefined) process.env[RELAY_RELEASE_LEVEL_ENV] = savedLevel;
  else delete process.env[RELAY_RELEASE_LEVEL_ENV];
  t("default export at level 2 with no key -> 503", res.statusCode === 503);
}
// method / path allowlist
for (const m of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"]) {
  const rec = [];
  const res = await run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { method: m, body: BODY });
  t(`${m} refused 405, no upstream`, res.statusCode === 405 && rec.length === 0);
}
for (const u of ["/api/relay-quote/quote/v2", "/api/relay-quote/", "/api/relay-quote?x=1", "/api/relay-quote/../grant", "/api/grant", "/quote", "/chains", "/api/relay-quote/requests/v2", "//evil.example/api/relay-quote"]) {
  const rec = [];
  const res = await run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { url: u, body: BODY });
  t(`non-allowlisted path ${u} refused, no upstream`, res.statusCode === 404 && rec.length === 0);
}
// body cap + bad body
{
  const rec = [];
  const big = JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) });
  const res = await run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { body: big });
  t("oversize body -> 413, no upstream", res.statusCode === 413 && rec.length === 0);
  const res2 = await run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { body: BODY, headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
  t("content-length over cap -> 413", res2.statusCode === 413 && rec.length === 0);
  const exact = JSON.stringify({ p: "y".repeat(MAX_BODY_BYTES - 8) });
  t("body exactly at cap is not 413 (shape allowlist then applies)", Buffer.byteLength(exact) === MAX_BODY_BYTES && (await run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { body: exact })).statusCode === 400);
  for (const [label, b] of [["not json", "{nope"], ["array", "[1]"], ["null", "null"], ["number", "7"]]) {
    const r = await run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { body: b });
    t(`bad body (${label}) -> 400`, r.statusCode === 400);
  }
  t("rejected requests made 0 upstream calls", rec.length === 0);
}
// stream body path (no req.body)
{
  const rec = [];
  const req = mkReq({}); req.body = undefined;
  req[Symbol.asyncIterator] = async function* () { yield Buffer.from(BODY.slice(0, 10)); yield Buffer.from(BODY.slice(10)); };
  const res = mkRes(); await createRelayQuoteHandler({ fetchImpl: fakeUp(200, "{}", { rec }), env: level2Env({ RELAY_API_KEY: KEY }) })(req, res);
  t("streamed body reassembled and forwarded", res.statusCode === 200 && rec[0].init.body === BODY);
  const big = mkReq({}); big.body = undefined;
  big[Symbol.asyncIterator] = async function* () { for (let i = 0; i < 10; i++) yield Buffer.alloc(1024, 0x61); };
  const r2 = mkRes(); await createRelayQuoteHandler({ fetchImpl: fakeUp(200, "{}", { rec }), env: level2Env({ RELAY_API_KEY: KEY }) })(big, r2);
  t("streamed oversize -> 413", r2.statusCode === 413);
}
// same-origin only
{
  const rec = [];
  const mk = (headers) => run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { body: BODY, headers });
  t("cross-origin Origin refused 403", (await mk({ origin: "https://evil.example" })).statusCode === 403);
  t("Sec-Fetch-Site cross-site refused 403", (await mk({ "sec-fetch-site": "cross-site" })).statusCode === 403);
  t("same-site (sibling subdomain) refused 403", (await mk({ "sec-fetch-site": "same-site" })).statusCode === 403);
  t("same-origin Origin accepted", (await mk({ origin: "https://app.example", "sec-fetch-site": "same-origin" })).statusCode === 200);
  t("no Origin (server-side / curl) accepted", (await mk({})).statusCode === 200);
  t("refused requests made no upstream call", rec.length === 2);
}

// ── [A-901 C2] body allowlist: only buildRelayQuoteRequest's shape is forwarded ──
{
  const rec = [];
  const go = (b) => run({ fetchImpl: fakeUp(200, "{}", { rec }), env: { RELAY_API_KEY: KEY } }, { body: JSON.stringify(b) });
  const built = RR.buildRelayQuoteRequest({ user: GOOD.user, recipient: GOOD.recipient, refundTo: GOOD.refundTo, originChainId: 8453, originCurrency: GOOD.originCurrency, amount: "20000000" });
  t("adapter-built request body passes the proxy allowlist", built.ok && (await go(built.request)).statusCode === 200 && rec.length === 1);
  const built2 = RR.buildRelayQuoteRequest({ user: GOOD.user, recipient: GOOD.recipient, refundTo: GOOD.refundTo, originChainId: 8453, originCurrency: GOOD.originCurrency, amount: "20000000", topupGas: true, topupGasAmount: "1000000" });
  t("adapter-built topupGas request also passes", built2.ok && (await go(built2.request)).statusCode === 200);
  t("proxy constants match the adapter (pinned origins, dest chain, dest currency)", JSON.stringify(P.ALLOWED_ORIGIN_CHAINS) === JSON.stringify(Object.keys(RR.RELAY_PINNED_CHAINS).map(Number)) && P.ALLOWED_DEST_CHAIN === RR.MONAD_CHAIN_ID && P.ALLOWED_DEST_CURRENCY === RR.MONAD_USDC_ADDRESS.toLowerCase());
  const before = rec.length;
  const bad = [
    ["appFees", { ...GOOD, appFees: [{ recipient: GOOD.user, fee: "100" }] }], ["referrer", { ...GOOD, referrer: "x" }], ["unknown key", { ...GOOD, extra: 1 }],
    ["topupGasAmount without topupGas", { ...GOOD, topupGasAmount: "1" }], ["topupGas true without amount", { ...GOOD, topupGas: true }],
    ["dest chain 10", { ...GOOD, destinationChainId: 10 }], ["dest chain string", { ...GOOD, destinationChainId: "143" }],
    ["dest currency other", { ...GOOD, destinationCurrency: "0x" + "ab".repeat(20) }], ["unpinned origin 1", { ...GOOD, originChainId: 1 }], ["origin string", { ...GOOD, originChainId: "8453" }],
    ["tradeType EXACT_OUTPUT", { ...GOOD, tradeType: "EXACT_OUTPUT" }], ["includeProtocolData false", { ...GOOD, includeProtocolData: false }],
    ["missing includeProtocolData", (() => { const g = { ...GOOD }; delete g.includeProtocolData; return g; })()], ["missing refundTo", (() => { const g = { ...GOOD }; delete g.refundTo; return g; })()],
    ["bad address", { ...GOOD, user: "0x12" }], ["amount number", { ...GOOD, amount: 20000000 }], ["amount zero", { ...GOOD, amount: "0" }], ["amount decimal", { ...GOOD, amount: "1.5" }],
    ["topupGas string", { ...GOOD, topupGas: "false" }], ["empty object", {}],
  ];
  for (const [name, b] of bad) { const r = await go(b); t(`body allowlist refuses ${name} -> 400 body_not_allowed`, r.statusCode === 400 && JSON.parse(r.body).error === "body_not_allowed"); }
  t("refused bodies made 0 upstream calls", rec.length === before);
}
{ // N3: 3xx / 1xx from upstream are not forwarded
  for (const st of [301, 302, 304, 100]) t(`upstream ${st} -> 502 (status clamped to 2xx/4xx)`, (await run({ fetchImpl: fakeUp(st, "{}"), env: { RELAY_API_KEY: KEY } }, { body: BODY })).statusCode === 502);
}

// ── source-level guarantees ──
const src = readFileSync(path.join(ROOT, "api/relay-quote.js"), "utf8");
const code = src.replace(/(^|\s)\/\/.*$/gm, "$1");
t("proxy source has no console.* / process.stdout logging", !/console\.|process\.std(out|err)/.test(code));
t("proxy source never sets access-control-*", !/access-control/i.test(code));
t("proxy source: only one upstream URL literal, quote/v2", (code.match(/https?:\/\/[^"'`\s)]+/g) || []).join(",") === "https://api.relay.link/quote/v2");
t("proxy source: key only via RELAY_API_KEY and gate only via server release env, no VITE_ and no key-looking literal", code.includes('"RELAY_API_KEY"') && code.includes('"ARASO_SERVER_RELEASE_LEVEL"') && !/VITE_/.test(code) && !/relay_[a-z0-9]{16,}/i.test(code));
t("proxy does not import app/src (transport only; no binding logic copy)", !/from\s+["'][^"']*app\/src/.test(code) && !/verifyRelayDepositBinding|validateRelayQuote/.test(code));

// ── adapter points at the proxy; binding still runs ──
t("RELAY_API_BASE is the same-origin proxy path", RR.RELAY_API_BASE === PROXY_PATH && RR.RELAY_API_BASE === "/api/relay-quote" && !/^https?:/.test(RR.RELAY_API_BASE));
const adapter = readFileSync(path.join(ROOT, "app/src/funding-rail-relay.js"), "utf8");
const acode = adapter.replace(/(^|\s)\/\/.*$/gm, "$1");
t("adapter has no api.relay.link request URL and no key/header", !/api\.relay\.link/.test(acode.replace(/snapshot:\s*"[^"]*"/, "")) && !/x-api-key|RELAY_API_KEY/i.test(acode));
t("adapter still runs validateRelayQuote + verifyRelayDepositBinding on the response", /const checked = validateRelayQuote\(/.test(acode) && /const bound = verifyRelayDepositBinding\(/.test(acode) && /if \(!bound\.ok\) return/.test(acode));
{
  const sent = [];
  const input = { user: "0x" + "11".repeat(20), recipient: "0x" + "22".repeat(20), refundTo: "0x" + "11".repeat(20), originChainId: 8453, originCurrency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "20000000" };
  const r = await RR.requestRelayQuote(input, { fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({ steps: [] }) }; } });
  t("adapter posts once to /api/relay-quote with JSON body, no key header", sent.length === 1 && sent[0].url === "/api/relay-quote" && sent[0].init.method === "POST" && Object.keys(sent[0].init.headers).join() === "content-type");
  t("proxy transport does not bypass validation (junk quote through proxy URL -> rejected)", r.ok === false);
}

// ── [A-901 D2] LIVE quote/v2 capture (Base USDC -> Monad USDC, 5 USDC, 1 POST via this proxy, 2026-10-08) as a fixture ──
// user = refundTo = 0x1df6…42d3ac (throwaway, discarded), recipient = 0x054d…a916 (throwaway). No key in it.
const LIVE = JSON.parse(String.raw`{"requestId":"0x1791425060d612237e802de9470afd8f333ab1a15cc8c3b3b3de7ecc4709160c","steps":[{"id":"approve","action":"Confirm transaction in your wallet","description":"Sign an approval for USDC","kind":"transaction","items":[{"status":"incomplete","data":{"from":"0x1df681813a210ee1c57c68f608fbab7fcd42d3ac","to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x095ea7b30000000000000000000000004cd00e387622c35bddb9b4c962c136462338bc3100000000000000000000000000000000000000000000000000000000004c4b40","value":"0","chainId":8453,"gas":"73112","maxFeePerGas":"6500000","maxPriorityFeePerGas":"1000000"}}],"requestId":"0x1791425060d612237e802de9470afd8f333ab1a15cc8c3b3b3de7ecc4709160c"},{"id":"deposit","action":"Confirm transaction in your wallet","description":"Depositing funds to the relayer to execute the swap for USDC","kind":"transaction","items":[{"status":"incomplete","data":{"from":"0x1df681813a210ee1c57c68f608fbab7fcd42d3ac","to":"0x4cd00e387622c35bddb9b4c962c136462338bc31","data":"0xe80179520000000000000000000000001df681813a210ee1c57c68f608fbab7fcd42d3ac000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda0291300000000000000000000000000000000000000000000000000000000004c4b408e90331df92614d80f5569c559ed131726f059f72e8c5354f6ff27176a436ae0","value":"0","chainId":8453,"gas":"76194","maxFeePerGas":"6500000","maxPriorityFeePerGas":"1000000"},"check":{"endpoint":"/intents/status/v3?requestId=0x1791425060d612237e802de9470afd8f333ab1a15cc8c3b3b3de7ecc4709160c","method":"GET"}}],"requestId":"0x1791425060d612237e802de9470afd8f333ab1a15cc8c3b3b3de7ecc4709160c","depositAddress":""}],"fees":{"gas":{"currency":{"chainId":8453,"address":"0x0000000000000000000000000000000000000000","symbol":"ETH","name":"Ether","decimals":18,"metadata":{"logoURI":"https://assets.relay.link/icons/1/light.png","verified":true}},"amount":"497209737868","amountFormatted":"0.000000497209737868","amountUsd":"0.001282","minimumAmount":"497209737868"},"relayer":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"20853","amountFormatted":"0.020853","amountUsd":"0.020848","minimumAmount":"20853"},"relayerGas":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"349","amountFormatted":"0.000349","amountUsd":"0.000349","minimumAmount":"349"},"relayerService":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"20504","amountFormatted":"0.020504","amountUsd":"0.020499","minimumAmount":"20504"},"app":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"0","amountFormatted":"0.0","amountUsd":"0","minimumAmount":"0"},"subsidized":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"0","amountFormatted":"0.0","amountUsd":"0","minimumAmount":"0"}},"details":{"operation":"swap","sender":"0x1df681813a210ee1c57c68f608fbab7fcd42d3ac","recipient":"0x054dcf6978026f5a94a40a84b62652f2a084a916","currencyIn":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"5000000","amountFormatted":"5.0","amountUsd":"4.998855","minimumAmount":"5000000"},"currencyOut":{"currency":{"chainId":143,"address":"0x754704bc059f8c67012fed69bc8a327a5aafb603","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"4979147","amountFormatted":"4.979147","amountUsd":"4.978091","minimumAmount":"4879565"},"refundCurrency":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"5000000","amountFormatted":"5.0","amountUsd":"4.998855","minimumAmount":"5000000"},"totalImpact":{"usd":"-0.020764","percent":"-0.42"},"swapImpact":{"usd":"0.000084","percent":"0.00"},"expandedPriceImpact":{"swap":{"usd":"-0.000416"},"execution":{"usd":"-0.020348"},"relay":{"usd":"0"},"app":{"usd":"0"},"sponsored":{"usd":"0"}},"rate":"0.9958294000000001","slippageTolerance":{"total":"200","origin":{"usd":"0.000000","value":"0","percent":"0.00"},"destination":{"usd":"0.099064","value":"99582","percent":"1.99"}},"timeEstimate":1,"userBalance":"0","isFixedRate":false,"route":{"origin":{"inputCurrency":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"5000000","amountFormatted":"5.0","amountUsd":"4.998855","minimumAmount":"5000000"},"outputCurrency":{"currency":{"chainId":8453,"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"5000000","amountFormatted":"5.0","amountUsd":"4.998855","minimumAmount":"5000000"},"router":"relay"},"destination":{"inputCurrency":{"currency":{"chainId":143,"address":"0x754704bc059f8c67012fed69bc8a327a5aafb603","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"4979147","amountFormatted":"4.979147","amountUsd":"4.978091","minimumAmount":"4879565"},"outputCurrency":{"currency":{"chainId":143,"address":"0x754704bc059f8c67012fed69bc8a327a5aafb603","symbol":"USDC","name":"USD Coin","decimals":6,"metadata":{"logoURI":"https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694","verified":true}},"amount":"4979147","amountFormatted":"4.979147","amountUsd":"4.978091","minimumAmount":"4879565"},"router":"relay"}}},"protocol":{"v2":{"orderId":"0x8e90331df92614d80f5569c559ed131726f059f72e8c5354f6ff27176a436ae0","hubType":"onchain","orderData":{"version":"v1","solverChainId":"base","solver":"0xf70da97812cb96acdf810712aa562db8dfa3dbef","salt":"0x163c48cea56b4e7a207d019640831013f8d35e5ca3505fb7dea427419e266585","inputs":[{"payment":{"chainId":"base","currency":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","amount":"5000000","weight":"1"},"refunds":[{"chainId":"base","recipient":"0x1df681813a210ee1c57c68f608fbab7fcd42d3ac","currency":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","minimumAmount":"0","deadline":1792029861,"extraData":"0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f"},{"chainId":"monad","recipient":"0x054dcf6978026f5a94a40a84b62652f2a084a916","currency":"0x754704bc059f8c67012fed69bc8a327a5aafb603","minimumAmount":"0","deadline":1792029861,"extraData":"0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f"}]}],"output":{"chainId":"monad","payments":[{"recipient":"0x054dcf6978026f5a94a40a84b62652f2a084a916","currency":"0x754704bc059f8c67012fed69bc8a327a5aafb603","minimumAmount":"4879565","expectedAmount":"4979147"}],"calls":[],"deadline":1792029861,"extraData":"0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f"},"fees":[]},"orderSignature":"0x4c5d821c0a08b364d214fdfaa395543008bb6f41f517489e9821c571c275b9e95c73c403927cccfb04facf2cf7fd603cc0415b003de3736ebffdcce1f2b237cc1c","paymentDetails":{"chainId":"base","depository":"0x4cd00e387622c35bddb9b4c962c136462338bc31","currency":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","amount":"5000000"}}}}`);
const L_USER = "0x1df681813a210ee1c57c68f608fbab7fcd42d3ac", L_RECIP = "0x054dcf6978026f5a94a40a84b62652f2a084a916";
const L_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const L_NOW = 1792029861000 - 3600000; // one hour before the quoted deadline
const lclone = () => JSON.parse(JSON.stringify(LIVE));
const lctx = (o = {}) => ({ originChainId: 8453, payer: L_USER, refundTo: L_USER, sourceToken: L_USDC, inputAmountUnits: 5000000n, nowMs: L_NOW, ...o });
const lv = (mut, o) => { const q = lclone(); mut(q); return RR.verifyRelayDepositBinding(q, lctx(o)); };
const lrej = (r, reason) => r.ok === false && r.reasons.includes(reason);
{
  const okR = RR.verifyRelayDepositBinding(LIVE, lctx());
  t("LIVE fixture: binding ok with the refundTo we sent", okR.ok === true && okR.binding.deadlineSec === 1792029861 && okR.binding.depository === "0x4cd00e387622c35bddb9b4c962c136462338bc31");
  const app = LIVE.steps[0].items[0].data, dep = LIVE.steps[1].items[0].data;
  t("LIVE: approve spender == /chains depository, amount == input, selector approve; deposit selector depositErc20 -> depository", RR.decodeRelayApproveCalldata(app.data).spender === "0x4cd00e387622c35bddb9b4c962c136462338bc31" && RR.decodeRelayApproveCalldata(app.data).amount === 5000000n && dep.data.startsWith("0xe8017952") && dep.to === "0x4cd00e387622c35bddb9b4c962c136462338bc31");
  t("LIVE: paymentDetails.chainId label 'base' maps to origin 8453 via the pinned snapshot name", LIVE.protocol.v2.paymentDetails.chainId === RR.RELAY_PINNED_CHAINS[8453].name);
  const seen = [];
  const r = await RR.requestRelayQuote({ user: L_USER, recipient: L_RECIP, refundTo: L_USER, originChainId: 8453, originCurrency: L_USDC, amount: "5000000" }, { fetchImpl: async (u, i) => { seen.push(u); return { ok: true, json: async () => lclone() }; }, validate: { nowMs: L_NOW } });
  t("LIVE: requestRelayQuote end-to-end (fake fetch) ok incl. validateRelayQuote + binding", r.ok === true && seen.length === 1 && seen[0] === "/api/relay-quote");
  const rBad = await RR.requestRelayQuote({ user: L_USER, recipient: L_RECIP, refundTo: "0x" + "ab".repeat(20), originChainId: 8453, originCurrency: L_USDC, amount: "5000000" }, { fetchImpl: async () => ({ ok: true, json: async () => lclone() }), validate: { nowMs: L_NOW } });
  t("LIVE: refundTo sent differs from the quote's origin refund recipient -> rejected", rBad.ok === false && rBad.reasons.includes("refund_recipient_not_refundto"));
}
t("LIVE: no refundTo in ctx -> origin refund unproven -> rejected", lrej(lv(() => {}, { refundTo: undefined }), "refund_recipient_not_refundto"));
t("LIVE: origin refund recipient = attacker -> rejected", lrej(lv((q) => { q.protocol.v2.orderData.inputs[0].refunds[0].recipient = "0x" + "ee".repeat(20); }), "refund_recipient_not_refundto"));
t("LIVE: origin refund recipient malformed -> rejected", lrej(lv((q) => { q.protocol.v2.orderData.inputs[0].refunds[0].recipient = "nope"; }), "refund_recipient_not_refundto"));
const EVIL = "0x" + "ee".repeat(20);
t("LIVE: Monad-labelled refund to the request recipient ok (as captured); to attacker -> rejected", lv((q) => {}).ok === true && lrej(lv((q) => { q.protocol.v2.orderData.inputs[0].refunds[1].recipient = EVIL; }), "refund_recipient_not_refundto"));
t("LIVE: Monad refund checked against ctx.recipient when given", lv(() => {}, { recipient: L_RECIP }).ok === true && lrej(lv(() => {}, { recipient: EVIL }), "refund_recipient_not_refundto"));
for (const [name, label] of [["Base (case variant)", "Base"], ["numeric 8453", 8453], ["numeric 143", 143], ["arbitrum", "arbitrum"], ["MONAD upper", "MONAD"], ["missing label", undefined], ["null", null], ["array", ["base"]]]) {
  for (const idx of [0, 1]) t(`LIVE C1 attack: refund[${idx}] label ${name} + attacker recipient -> rejected`, lv((q) => { const rf = q.protocol.v2.orderData.inputs[0].refunds[idx]; if (label === undefined) delete rf.chainId; else rf.chainId = label; rf.recipient = EVIL; }).ok === false);
}
t("LIVE C1: an extra refund leg with an unknown label (valid recipient) is also rejected", lrej(lv((q) => { q.protocol.v2.orderData.inputs[0].refunds.push({ chainId: "arbitrum", recipient: L_USER, deadline: 1792029861 }); }), "refund_chain_unmapped"));
const od = (q) => q.protocol.v2.orderData;
for (const [name, mut] of [
  ["output.deadline missing", (q) => { delete od(q).output.deadline; }],
  ["output.deadline string", (q) => { od(q).output.deadline = "1792029861"; }],
  ["output.deadline float", (q) => { od(q).output.deadline = 1792029861.5; }],
  ["output.deadline ms", (q) => { od(q).output.deadline = 1792029861000; }],
  ["output.deadline null", (q) => { od(q).output.deadline = null; }],
  ["output not an object", (q) => { od(q).output = "x"; }],
  ["refund[0].deadline missing", (q) => { delete od(q).inputs[0].refunds[0].deadline; }],
  ["refund[1].deadline string", (q) => { od(q).inputs[0].refunds[1].deadline = "1792029861"; }],
  ["refund[1].deadline float", (q) => { od(q).inputs[0].refunds[1].deadline = 1792029861.25; }],
  ["refund[0].deadline ms", (q) => { od(q).inputs[0].refunds[0].deadline = 1792029861000; }],
  ["refunds not an array", (q) => { od(q).inputs[0].refunds = {}; }],
  ["inputs not an array", (q) => { od(q).inputs = {}; }],
]) t(`LIVE deadline fail-closed: ${name}`, lrej(lv(mut), "order_deadline_unknown"));
t("LIVE: output.deadline expired -> order_expired", lrej(lv((q) => { od(q).output.deadline = 1792029861; }, { nowMs: 1792029861000 }), "order_expired"));
t("LIVE: a refund deadline expired (output still valid) -> order_expired", lrej(lv((q) => { od(q).inputs[0].refunds[1].deadline = 1792020000; }), "order_expired"));
t("LIVE: flat orderData.deadline is ignored when orderData.output exists", lrej(lv((q) => { delete od(q).output.deadline; od(q).deadline = 1792029861; }), "order_deadline_unknown"));
for (const [name, v] of [["unknown label", "ethereum"], ["number 8453", 8453], ["upper-case", "BASE"], ["null", null], ["array", ["base"]]]) {
  t(`LIVE chain label unmapped -> rejected: ${name}`, lrej(lv((q) => { q.protocol.v2.paymentDetails.chainId = v; }), "payment_chain_unmapped"));
}
t("LIVE other binding items still bite: spender attacker", lrej(lv((q) => { const d = q.steps[0].items[0].data; d.data = d.data.slice(0, 34) + "ee".repeat(20) + d.data.slice(74); }), "approve_spender_not_depository"));
t("LIVE other binding items still bite: deposit target attacker", lrej(lv((q) => { q.steps[1].items[0].data.to = "0x" + "ee".repeat(20); }), "deposit_target_not_depository"));
t("LIVE other binding items still bite: payer differs", lrej(lv(() => {}, { payer: "0x" + "99".repeat(20) }), "deposit_depositor_not_payer"));
t("LIVE other binding items still bite: input amount differs", lrej(lv(() => {}, { inputAmountUnits: 5000001n }), "deposit_amount_not_input"));
t("LIVE other binding items still bite: orderId mismatch", lrej(lv((q) => { q.protocol.v2.orderId = "0x" + "12".repeat(32); }), "deposit_id_not_order_id"));
t("LIVE other binding items still bite: payment amount", lrej(lv((q) => { q.protocol.v2.paymentDetails.amount = "5000001"; }), "payment_details_mismatch"));
t("LIVE other binding items still bite: unpinned origin", lrej(lv(() => {}, { originChainId: 1 }), "origin_chain_not_pinned"));

globalThis.fetch = realFetch;
t("0 network calls (global fetch never invoked)", netCalls === 0);
console.log(`a901: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
