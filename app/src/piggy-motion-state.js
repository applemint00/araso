export const PIGGY_MOTION_STATE = Object.freeze({
  IDLE: "idle",
  WORK: "work",
});

function piggyIdOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolvePiggyMotionState({ piggyId, affectedPiggyId = null, cue = PIGGY_MOTION_STATE.IDLE } = {}) {
  const id = piggyIdOf(piggyId);
  const affected = piggyIdOf(affectedPiggyId);
  const work = id !== null && affected === id && cue === PIGGY_MOTION_STATE.WORK;
  return Object.freeze({
    piggyId: id,
    state: work ? PIGGY_MOTION_STATE.WORK : PIGGY_MOTION_STATE.IDLE,
    active: work,
  });
}

export function buildPiggyMotionStateMap(piggies = [], context = {}) {
  const states = new Map();
  for (const piggy of Array.isArray(piggies) ? piggies : []) {
    const id = piggyIdOf(piggy?.id);
    if (!id || states.has(id)) continue;
    states.set(id, resolvePiggyMotionState({ ...context, piggyId: id }));
  }
  return states;
}

export function piggyMotionStateFromMap(states, piggyId) {
  const id = piggyIdOf(piggyId);
  return (id && states instanceof Map && states.get(id)) || resolvePiggyMotionState({ piggyId: id });
}
