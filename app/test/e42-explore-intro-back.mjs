// E42: Second Journey first intro card (Home / ok) and a back on every later Explore paper.
//   node app/test/e42-explore-intro-back.mjs
// Markup checks use second-journey-view.js directly. Behaviour checks run the ACTUAL main.js functions, cut out by name
// (same harness idea as second-journey-decision-wiring.mjs) against small stubs. No browser, no network, no tx.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMemoryStorage, loadSecondJourneyDraft } from "../src/second-journey-state.js";
import { secondJourneyCardMarkup } from "../src/second-journey-view.js";

const SRC_DIR = new URL("../src/", import.meta.url);
const MAIN = readFileSync(new URL("main.js", SRC_DIR), "utf8");
const ADDRESS = "0x00000000000000000000000000000000000000e4";

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${label}\n      ${String((e && e.message) || e).split("\n").slice(0, 4).join("\n      ")}`); fail += 1; }
}
function cutFunction(name) {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(MAIN);
  if (!m) throw new Error(`main.js function ${name} not found`);
  const start = m.index + 1;
  const end = MAIN.indexOf("\n}\n", start);
  return MAIN.slice(start, end + 2);
}
const ids = (html) => [...html.matchAll(/<button[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => `${m[1]}:${m[2].replace(/<[^>]+>/g, "").trim()}`);
const footerIds = (html) => {
  const at = html.search(/<div class="(secondJourney__footer|footer)">/);
  return at < 0 ? [] : ids(html.slice(at));
};

// ── markup ──────────────────────────────────────────────────────────────────────────────────────────────────────
const INTRO_LINES = ["second job journey is on!", "wanna give it a try?", "home = not now.", "come back to the app, and we’ll check again."];
await check("M1 the intro card shows the four Owner lines, Home on the left and ok on the right (the Explore paper footer)", () => {
  const html = secondJourneyCardMarkup({ step: "intro" });
  const flat = html.replace(/<br \/>/g, " ").replace(/,\s+/g, ", ");
  for (const line of INTRO_LINES) assert.ok(flat.includes(line), `missing line: ${line}`);
  const f = footerIds(html);
  assert.deepEqual(f.map((x) => x.split(":")[0]), ["stayButton", "secondIntroOkButton"], JSON.stringify(f));
  assert.match(f[0], /:Home$/);
  assert.match(f[1], /:ok$/);
});
await check("M2 interests paper footer = back / save (no Home)", () => {
  const f = footerIds(secondJourneyCardMarkup({ step: "interests", errands: [{ id: "grow", label: "grow" }] }));
  assert.deepEqual(f.map((x) => x.split(":")[0]), ["exploreBackButton", "exploreSaveButton"], JSON.stringify(f));
  assert.match(f[0], /:back$/);
});
await check("M3 candidates paper footer = back / ok (no Home)", () => {
  const f = footerIds(secondJourneyCardMarkup({ step: "candidates", destinations: [] }));
  assert.deepEqual(f.map((x) => x.split(":")[0]), ["exploreBackButton", "secondOkButton"], JSON.stringify(f));
  assert.match(f[0], /:back$/);
});
await check("M4 final Job paper footer = back / Send (no Home)", () => {
  const chosen = { id: "kintsu-like-grow-delayed-return", title: "a quick trip", errandIds: ["grow"] };
  const html = secondJourneyCardMarkup({ step: "readiness", chosen, canSend: false, sendReason: "" });
  const f = footerIds(html);
  assert.equal(f.some((x) => x.startsWith("stayButton:")), false, JSON.stringify(f));
  assert.deepEqual(f.map((x) => x.split(":")[0]).filter((id) => id !== "secondSendReason"), ["exploreBackButton", "secondSendButton"], JSON.stringify(f));
});
await check("M5 no-chosen check paper = back only (no Home)", () => {
  const f = footerIds(secondJourneyCardMarkup({ step: "readiness", chosen: null }));
  assert.deepEqual(f.map((x) => x.split(":")[0]), ["exploreBackButton"], JSON.stringify(f));
});

// ── behaviour (real main.js functions) ──────────────────────────────────────────────────────────────────────────
async function loadApp({ pick = null } = {}) {
  const url = (file) => new URL(file, SRC_DIR).href;
  const body = ["secondJourneyScope", "currentSecondDraft", "persistSecondDraft", "safeLocalStorage", "handleReadinessBack", "handleSecondIntroOk"]
    .map(cutFunction).join("\n\n").replaceAll("import.meta.env.DEV", "__env.DEV");
  const code = `
import { saveSecondJourneyDraft, validatePersistenceScope } from ${JSON.stringify(url("second-journey-state.js"))};
export const __env = { DEV: false };
export const __io = { store: null, renders: 0, recomputes: 0, pick: ${JSON.stringify(pick)} };
const localStorage = new Proxy({}, { get: (_, k) => { const v = __io.store[k]; return typeof v === "function" ? v.bind(__io.store) : v; } });
const window = { get localStorage() { return __io.store; } };
function render() { __io.renders += 1; }
function recomputeSecondJourneyFlow() { __io.recomputes += 1; }
function explorePickState(sj) { return sj.step === "candidates" && __io.pick ? { kind: __io.pick } : null; }
export const state = { address: ${JSON.stringify(ADDRESS)}, scene: "explore", secondJourneyCompletedOnce: false, secondJourney: null };
${body}
export { handleReadinessBack, handleSecondIntroOk, persistSecondDraft };
`;
  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  mod.__io.store = createMemoryStorage();
  return mod;
}
const sjAt = (step, extra = {}) => ({ step, selectedIds: ["grow"], seedStage: "done", pickedCandidateId: null, chosenDestinationId: null,
  jitAnswer: null, amount: "", decisionEventId: null, returnRead: null, flow: null, outcome: null, ...extra });
const draftOf = (app) => loadSecondJourneyDraft(app.__io.store, { accountId: ADDRESS.toLowerCase(), chainId: "monad-testnet" }).draft
  || loadSecondJourneyDraft(app.__io.store, { accountId: ADDRESS, chainId: "monad-testnet" }).draft;

await check("B0 a draft at the intro card (Home there) is saved and read back", async () => {
  const app = await loadApp();
  app.state.secondJourney = sjAt("intro", { selectedIds: [] });
  app.persistSecondDraft();
  assert.equal(draftOf(app)?.step, "intro");
});
await check("B1 intro ok → interests (a new Second); completed Second with saved interests → candidates", async () => {
  const app = await loadApp();
  app.state.secondJourney = sjAt("intro");
  app.handleSecondIntroOk();
  assert.equal(app.state.secondJourney.step, "interests");
  app.state.secondJourneyCompletedOnce = true;
  app.state.secondJourney = sjAt("intro");
  app.handleSecondIntroOk();
  assert.equal(app.state.secondJourney.step, "candidates");
});
await check("B2 back on interests → the intro card (its Home is the way home)", async () => {
  const app = await loadApp();
  app.state.secondJourney = sjAt("interests");
  app.handleReadinessBack();
  assert.equal(app.state.secondJourney.step, "intro");
});
await check("B3 back on candidates → interests, the pick cleared, the draft says interests", async () => {
  const app = await loadApp();
  app.state.secondJourney = sjAt("candidates", { pickedCandidateId: "euler-k3-weth" });
  app.handleReadinessBack();
  assert.equal(app.state.secondJourney.step, "interests");
  assert.equal(app.state.secondJourney.pickedCandidateId, null);
  assert.equal(draftOf(app)?.step, "interests");
});
await check("B4 back on the final Job paper (two or more can go) → candidates; amount cleared; memory and draft agree", async () => {
  const app = await loadApp({ pick: "two" });
  app.state.secondJourney = sjAt("readiness", { pickedCandidateId: "a", chosenDestinationId: "a", amount: "5", decisionEventId: "decision:check:a:1" });
  app.handleReadinessBack();
  const sj = app.state.secondJourney;
  assert.equal(sj.step, "candidates");
  assert.equal(sj.amount, "");
  assert.equal(sj.pickedCandidateId, null);
  assert.equal(sj.chosenDestinationId, null);
  const d = draftOf(app);
  assert.equal(d?.step, "candidates");
  assert.equal(d?.amount, "");
  assert.equal(d?.chosenDestinationId ?? null, null);
});
await check("B5 back on the final Job paper when only one Job can go → interests (no empty candidates paper)", async () => {
  const app = await loadApp({ pick: "one" });
  app.state.secondJourney = sjAt("readiness", { pickedCandidateId: "a", chosenDestinationId: "a", amount: "5" });
  app.handleReadinessBack();
  assert.equal(app.state.secondJourney.step, "interests");
  assert.equal(draftOf(app)?.step, "interests");
});
await check("B6 a JIT answer: first back clears only the answer (same Job, draft agrees); second back → candidates", async () => {
  const app = await loadApp({ pick: "two" });
  app.state.secondJourney = sjAt("readiness", { pickedCandidateId: "a", chosenDestinationId: "a", jitAnswer: "right_back",
    flow: { jitQuestions: [{ id: "q" }] } });
  app.handleReadinessBack();
  assert.equal(app.state.secondJourney.step, "readiness");
  assert.equal(app.state.secondJourney.jitAnswer, null);
  assert.equal(draftOf(app)?.jitAnswer ?? null, null);
  app.handleReadinessBack();
  assert.equal(app.state.secondJourney.step, "candidates");
});

// ── opening and Home (source: wiring is in the big module scope) ────────────────────────────────────────────────
const fnBody = (name) => cutFunction(name);
await check("S1 both Explore openers show the intro card only when there is no saved draft", () => {
  for (const name of ["openSecondJourneyExplore", "a974OpenForkExplore"]) {
    assert.match(fnBody(name), /if \(applySecondDraftIfAny\(sj, domainState\) == null\) sj\.step = "intro";/, name);
  }
});
await check("S2 the intro ok and every back are wired; the intro Home is the plain Home (stayHome)", () => {
  const w = fnBody("wireExploreCard");
  assert.match(w, /#secondIntroOkButton"\)\?\.addEventListener\("click", handleSecondIntroOk\)/);
  assert.match(w, /#exploreBackButton"\)\?\.addEventListener\("click", handleReadinessBack\)/);
});
await check("S2b Home on the intro card saves a draft (step intro) so the existing bell can ask again on the next open", () => {
  assert.match(fnBody("wireExploreCard"), /if \(sj\.step === "intro"\) document\.querySelector\("#stayButton"\)\?\.addEventListener\("click", persistSecondDraft\);/);
});
await check("S3 Home from the intro card waits for a place the same way the candidates Home did (A-851 re-check kept)", () => {
  assert.match(fnBody("markSecondWaitingForPlace"), /sj\.step !== "candidates" && sj\.step !== "intro"/);
});
await check("S4 the bell never arms over the Money / Gift screen", () => {
  assert.match(fnBody("a1182HomeVisible"), /!document\.querySelector\("\.a911-screen"\)/);
});
await check("S5 a fork-entry refusal never falls back to the legacy opener in the product", () => {
  const at = MAIN.indexOf("const a974PrevOpen = openSecondJourneyExplore;");
  const block = MAIN.slice(at, MAIN.indexOf("};", at) + 2);
  assert.doesNotMatch(block, /else a974PrevOpen\(\.\.\.args\);/, "refusal still calls the legacy opener");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
