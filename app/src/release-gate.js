// [A-943] Release gate. The deployed build shows the First Journey only until the Owner opens the next release.
// One build value: VITE_ARASO_RELEASE_LEVEL. Unset, empty or unreadable = 1 (fail closed). The only default above 1 is the vite dev
// server (import.meta.env.DEV — the mode every local/browser test harness runs in), so the existing suites keep today's behaviour; a
// production build (`vite build`, DEV false) without the value is level 1. Every entry asks releaseAllows(feature) here and nowhere else.
//   level 1 = First Journey only (invite → hatch → name → shMON → return → receipt → file → Home, then Home stays quiet)
//   level 2 = + Second Journey (Explore) · what opens after it (honey jar · Money · Gift send · + Piggy) · Gift links (Gift Open · Release 2 promotion)

export const RELEASE_FEATURES = Object.freeze({
  second: 2, // Explore Paper (post-file Chog cue → intro → Explore) and every openSecondJourneyExplore() caller
  afterSecond: 2, // the stored "Second done" mark that opens the honey jar · Money tab · Gift send · + Piggy
  gift: 2, // a Gift link read at boot (Gift Open paper · A-897 Release 2 promotion → alpha! stamp)
});

/** Level from a build env object. Pure: no globals, so node tests pass their own env. */
export function resolveReleaseLevel(env) {
  const raw = env?.VITE_ARASO_RELEASE_LEVEL;
  const text = raw == null ? "" : String(raw).trim();
  if (text !== "") return /^[1-9]\d*$/.test(text) ? Number(text) : 1; // set but unreadable ("0", "two", "-1") = fail closed
  return env?.DEV === true ? 2 : 1;
}

// import.meta.env is undefined outside vite (node tests import this file directly) → level 1.
export const RELEASE_LEVEL = resolveReleaseLevel(import.meta.env);

/** true when the given feature is open at this level. An unknown feature is closed. (No Object.hasOwn: older WebViews, A-895 L10.) */
export function releaseAllows(feature, level = RELEASE_LEVEL) {
  const need = Object.prototype.hasOwnProperty.call(RELEASE_FEATURES, feature) ? RELEASE_FEATURES[feature] : null;
  return Number.isInteger(need) && Number.isInteger(level) && level >= need;
}
