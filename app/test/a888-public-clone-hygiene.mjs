// Public-clone release hygiene (docs/test-hygiene only; no product code is read for behaviour).
//
// N1  package.json "license" = "MIT" and LICENSE is the MIT text.
// N2  README: MIT + LICENSE link, Playfair Display + Delicious Handrawn OFL credits (files exist), deployed build
//     labelled UNKNOWN, LOCAL/LIVE labels, setup / full-test / relayer commands, AI-assistance line, no stale lines.
// N3  .gitignore covers *.pre_* / *.bak / *.orig backups (plus the private dir and .env*), checked with `git check-ignore`
//     in a throwaway repo (SKIP if git is unavailable).
// N4  no personal email address or absolute home-directory path in the public tree (everything except the
//     ignored/private paths).
// N5  public clone: copy the tree WITHOUT the private dir to a temp dir, run the suites that used to read private
//     pre-copies; each must exit 0, print its "(public checkout)" SKIP, and never hit a missing-file error.
//
// Exit code: 1 if any FAIL.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVATE_DIR } from "./helpers/private-base.mjs"; // [A-1033] private baseline root = $ARASO_PRIVATE_BASE (unset = public checkout)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const rd = (p) => readFileSync(path.join(REPO, p), "utf8");
let pass = 0, fail = 0;
async function check(name, fn) {
  try { const r = await fn(); if (r === "SKIP") { console.log(`SKIP  ${name}`); return; } console.log(`PASS  ${name}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${name}\n      ${String((e && e.message) || e).split("\n").slice(0, 6).join("\n      ")}`); fail += 1; }
}

// Paths that never ship (mirrors .gitignore): private workspace, secrets, deps, build output, agent files.
const NOT_PUBLIC = new Set([PRIVATE_DIR, "node_modules", "dist", ".git", ".claude", ".agents", ".codex", "Claude outputs", "AGENTS.md", "CLAUDE.md", ".DS_Store"]);
const notPublic = (name) => NOT_PUBLIC.has(name) || name === ".env" || name.startsWith(".env.") || name.startsWith(".grant-ledger.json") || /\.(pre_[^/]*|bak|orig)$/.test(name) || /\.pre_/.test(name);

await check("N1 package.json license = MIT; LICENSE is the MIT text", () => {
  const pkg = JSON.parse(rd("package.json"));
  assert.equal(pkg.license, "MIT");
  const lic = rd("LICENSE");
  assert.match(lic, /^MIT License\n/);
  assert.match(lic, /Copyright \(c\) 2026 Araso contributors/);
  assert.match(lic, /Permission is hereby granted, free of charge/);
});

await check("N2 README: license, font credits, evidence labels, deployed build UNKNOWN, commands, no stale lines", () => {
  const md = rd("README.md");
  assert.match(md, /\*\*MIT\*\*, see \[LICENSE\]\(LICENSE\)/, "MIT + LICENSE link");
  assert.match(md, /Playfair Display/, "Playfair credit");
  assert.match(md, /Delicious Handrawn/, "Delicious Handrawn credit");
  for (const f of ["app/public/fonts/OFL.txt", "app/public/card/DeliciousHandrawn-OFL.txt", "LICENSE"]) {
    assert.ok(md.includes(`(${f})`), `${f} linked`);
    assert.ok(existsSync(path.join(REPO, f)), `${f} exists`);
  }
  assert.match(rd("app/public/fonts/OFL.txt"), /Playfair Display Project Authors/);
  assert.match(md, /\*\*Deployed build: UNKNOWN\.\*\*/, "deployed build is UNKNOWN, not asserted");
  for (const label of ["LIVE (testnet)", "LOCAL", "FORK-ONLY", "NOT LIVE"]) assert.ok(md.includes(label), `label ${label}`);
  for (const cmd of ["npm ci", "npm run dev", "npm run build", "npm test", "ARASO_TEST_BROWSER=1 npm test", "npm run test:security", "npm run relayer:test", "npm run relayer"]) assert.ok(md.includes(cmd), `command ${cmd}`);
  const pkg = JSON.parse(rd("package.json"));
  for (const s of ["dev", "build", "test", "test:security", "relayer", "relayer:test"]) assert.ok(pkg.scripts[s], `package script ${s} exists`);
  assert.match(md, /Claude Code and OpenAI Codex assisted/, "AI-assistance disclosure");
  assert.match(md, /Prior work reused from \*\*gift-piggy\*\*/, "prior work disclosure");
  assert.equal(/repository is private/i.test(md), false, "stale 'repository is private'");
  assert.equal(/license not yet added/i.test(md), false, "stale 'license not yet added'");
  assert.equal(/\bA-\d{3}\b|INBOX|OUTBOX/.test(md) || md.includes(`${PRIVATE_DIR}/`), false, "no internal card / ops references");
});

await check("N3 .gitignore ignores *.pre_* / *.bak / *.orig backups (and still the private dir, .env*)", () => {
  const gi = rd(".gitignore").split("\n").map((l) => l.trim());
  for (const rule of ["*.pre_*", "*.bak", "*.orig", `${PRIVATE_DIR}/`, ".env", ".env.*"]) assert.ok(gi.includes(rule), `rule ${rule}`);
  if (spawnSync("git", ["--version"]).status !== 0) return "SKIP";
  const dir = mkdtempSync(path.join(tmpdir(), "a888-gi-"));
  try {
    writeFileSync(path.join(dir, ".gitignore"), rd(".gitignore"));
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir }).status, 0, "git init");
    const ignored = ["app/src/main.js.pre_A292_1241", "app/src/style.css.pre_A292_1241", "app/src/main.js.bak", "app/src/main.js.orig", `${PRIVATE_DIR}/x.md`, ".env", "relayer/.env", ".env.local"];
    const kept = ["app/src/main.js", "app/src/style.css", "app/test/a888-public-clone-hygiene.mjs", "README.md", "LICENSE", "package.json"];
    for (const p of ignored) assert.equal(spawnSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: dir }).status, 0, `${p} ignored`);
    for (const p of kept) assert.equal(spawnSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: dir }).status, 1, `${p} not ignored`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check("N4 public tree: no personal email address, no absolute home-directory path", () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const ASSET_DOMAIN = /\.(png|jpe?g|webp|svg|gif|avif|woff2?)$/i; // "name@2x.png" asset names are not addresses
  const RESERVED_DOMAIN = /\.(example|invalid|test|localhost)$|@example\.(com|org|net)$/i; // RFC 2606 fixture hosts (e.g. URL userinfo probes)
  // also catches the regex-escaped form ("Users\/<name>") a test pattern would carry
  const HOME = new RegExp(["/" + "Users\\\\?/[A-Za-z0-9._-]+", "/" + "home\\\\?/[a-z][a-z0-9._-]*\\\\?/", "Users\\\\/[A-Za-z0-9._-]+"].join("|"));
  const TEXT = /\.(m?js|cjs|json|md|txt|html|css|webmanifest|svg|ya?ml|toml|sh)$|^(LICENSE|\.gitignore)$/;
  // the detectors fire on the patterns they guard (strings built at run time so this file stays clean)
  assert.ok(("x " + "someone" + "@" + "gmail.com").match(EMAIL)?.some((m) => !RESERVED_DOMAIN.test(m)), "email detector");
  assert.ok(HOME.test("/" + "Users/someone/Downloads/a.svg") && HOME.test("/" + "home/someone/x") && HOME.test("{ pattern: /" + "Users" + "\\/someone/ }") && HOME.test("/" + "Users" + "\\/someone"), "home-path detector (plain and escaped)");
  const hits = [];
  let scanned = 0;
  const walk = (rel) => {
    for (const name of readdirSync(path.join(REPO, rel))) {
      if (notPublic(name)) continue;
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(path.join(REPO, r));
      if (st.isDirectory()) { walk(r); continue; }
      if (!TEXT.test(name) || st.size > 8 * 1024 * 1024) continue;
      scanned += 1;
      const lines = readFileSync(path.join(REPO, r), "utf8").split("\n");
      lines.forEach((l, i) => {
        for (const m of l.match(EMAIL) || []) if (!/noreply/i.test(m) && !ASSET_DOMAIN.test(m) && !RESERVED_DOMAIN.test(m)) hits.push(`${r}:${i + 1} email ${m}`);
        if (HOME.test(l)) hits.push(`${r}:${i + 1} home path`);
      });
    }
  };
  walk("");
  console.log(`INFO  N4 scanned ${scanned} public text files`);
  assert.ok(scanned > 100, `scanned ${scanned}`);
  assert.deepEqual(hits, []);
});

await check("N5 public clone without the private dir: the formerly private-reading suites exit 0 with a public-checkout SKIP", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "a888-clone-"));
  try {
    for (const name of readdirSync(REPO)) {
      if (notPublic(name)) continue;
      cpSync(path.join(REPO, name), path.join(dir, name), { recursive: true, filter: (src) => !notPublic(path.basename(src)) });
    }
    if (existsSync(path.join(REPO, "node_modules"))) symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir"); // = npm ci
    assert.equal(existsSync(path.join(dir, PRIVATE_DIR)), false, "clone has no private dir");
    const suites = [
      ["a728-ipad-three-piggy-home.mjs", { A728_NODE_ONLY: "1" }, ["SKIP  N0", "SKIP  N3"]],
      ["a786-home-scale-second-hierarchy.mjs", {}, ["SKIP  browser part"]],
      ["a837-scenes-v10.mjs", {}, ["SKIP  N5 pre-copy"]],
      ["a839-invite-fullbleed.mjs", {}, ["SKIP  N3", "SKIP  N5"]],
    ];
    const bad = [];
    for (const [file, env, skips] of suites) {
      const r = spawnSync(process.execPath, [path.join(dir, "app/test", file)], { cwd: dir, env: { ...process.env, ARASO_TEST_BROWSER: "", ARASO_PRIVATE_BASE: "", ...env } /* [A-1033] the clone run must not see the main private base */, encoding: "utf8", timeout: 170000 });
      const out = `${r.stdout || ""}${r.stderr || ""}`;
      if (r.status !== 0) bad.push(`${file}: exit ${r.status} ${r.signal || ""}\n${out.split("\n").filter((l) => /FAIL|Error/.test(l)).slice(0, 4).join("\n")}`);
      if (/ENOENT|Cannot find (module|package)/.test(out)) bad.push(`${file}: missing-file error`);
      for (const s of skips) if (!out.includes(s)) bad.push(`${file}: no "${s}" line`);
      console.log(`INFO  N5 ${file} exit ${r.status}`);
    }
    assert.deepEqual(bad, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\nA-888: ${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
