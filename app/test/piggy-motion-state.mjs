import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPiggyMotionStateMap,
  PIGGY_MOTION_STATE,
  piggyMotionStateFromMap,
  resolvePiggyMotionState,
} from "../src/piggy-motion-state.js";

const piggies = [
  { id: "honeybun", location: "home" },
  { id: "mochi", location: "home" },
  { id: "bebe", location: "away" },
];
const before = structuredClone(piggies);
const states = buildPiggyMotionStateMap(piggies, {
  affectedPiggyId: "mochi",
  cue: PIGGY_MOTION_STATE.WORK,
});

assert.equal(piggyMotionStateFromMap(states, "honeybun").state, PIGGY_MOTION_STATE.IDLE);
assert.equal(piggyMotionStateFromMap(states, "mochi").state, PIGGY_MOTION_STATE.WORK);
assert.equal(piggyMotionStateFromMap(states, "bebe").state, PIGGY_MOTION_STATE.IDLE);
assert.equal([...states.values()].filter((state) => state.active).length, 1);
assert.deepEqual(piggies, before, "visual projection must not mutate runtime Piggy state");

assert.deepEqual(
  resolvePiggyMotionState({ piggyId: "honeybun", affectedPiggyId: "honeybun", cue: "unknown" }),
  { piggyId: "honeybun", state: PIGGY_MOTION_STATE.IDLE, active: false },
);
assert.equal(piggyMotionStateFromMap(states, "unknown").state, PIGGY_MOTION_STATE.IDLE);
assert.equal(resolvePiggyMotionState({ piggyId: null, affectedPiggyId: "mochi", cue: PIGGY_MOTION_STATE.WORK }).active, false);

const source = readFileSync(new URL("../src/piggy-motion-state.js", import.meta.url), "utf8");
for (const forbidden of ["settleSend", "finishTrip", "rememberReceipt", "localStorage", "transaction", "receipt"]) {
  assert.equal(source.includes(forbidden), false, `motion projection must not contain ${forbidden}`);
}

console.log("PASS  only the affected Piggy receives work motion");
console.log("PASS  other and unknown Piggies stay idle");
console.log("PASS  visual projection is pure and contains no completion/storage path");
