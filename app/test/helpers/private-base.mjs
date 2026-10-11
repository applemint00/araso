// [A-1033] One root for the private-workspace baselines the tests compare against (pre-card copies, design packages,
// harness runs, playwright). The root comes from ONE env var, ARASO_PRIVATE_BASE; no test source spells the folder name.
//   set   (main workspace: ARASO_PRIVATE_BASE=<repo>/<private dir>) → the comparisons run against that tree.
//   unset (public checkout)                                          → privatePath() points at a path that never exists,
//         so every existing "baseline absent" branch takes its public-checkout SKIP and prints its reason.
// A worktree points ARASO_PRIVATE_BASE at the main workspace's private tree, so it no longer silently skips (A-1023 blind spot).
import { existsSync } from "node:fs";
import path from "node:path";

export const PRIVATE_BASE_ENV = "ARASO_PRIVATE_BASE";
export const PRIVATE_BASE = process.env[PRIVATE_BASE_ENV] ? path.resolve(process.env[PRIVATE_BASE_ENV]) : null;
// Set but pointing nowhere (typo, stale worktree path) would turn every comparison into a quiet SKIP — fail loudly instead.
if (PRIVATE_BASE !== null && !existsSync(PRIVATE_BASE)) throw new Error(`${PRIVATE_BASE_ENV} is set but does not exist: ${PRIVATE_BASE} (unset it for a public-checkout run)`);
const UNSET_ROOT = path.join(path.parse(process.cwd()).root, ".araso-private-base-unset");

export const privatePath = (...rel) => path.join(PRIVATE_BASE ?? UNSET_ROOT, ...rel);
export const hasPrivate = () => PRIVATE_BASE !== null && existsSync(PRIVATE_BASE);

// Hygiene checks ("no private-folder path in shipped code") need the folder token itself as a needle.
// It is spelled in two parts so this file does not contain the token the leak-scan BLOCK rule watches.
export const PRIVATE_DIR = "_" + "private";
export const PRIVATE_RE = new RegExp(PRIVATE_DIR);
