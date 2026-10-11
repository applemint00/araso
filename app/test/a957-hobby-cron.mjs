// [A-957] Vercel Hobby allows a cron at most once a day; a more frequent schedule makes the deploy fail.
// Node only, network 0. Every vercel.json cron must have fixed numeric minute and hour fields
// (so it fires at most once a day). The gift reconcile cron stays registered.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERCEL = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

function atMostDaily(schedule) {
  const fields = String(schedule).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour] = fields;
  return /^\d{1,2}$/.test(minute) && Number(minute) <= 59 && /^\d{1,2}$/.test(hour) && Number(hour) <= 23;
}

// the judge itself
assert.equal(atMostDaily("0 18 * * *"), true);
assert.equal(atMostDaily("* * * * *"), false);
assert.equal(atMostDaily("*/5 * * * *"), false);
assert.equal(atMostDaily("0 * * * *"), false);
assert.equal(atMostDaily("0 */6 * * *"), false);
assert.equal(atMostDaily("0 1,13 * * *"), false);
assert.equal(atMostDaily("0-5 3 * * *"), false);
assert.equal(atMostDaily("0 18 * *"), false);

const crons = Array.isArray(VERCEL.crons) ? VERCEL.crons : [];
for (const c of crons) {
  assert.ok(atMostDaily(c.schedule), `cron ${c.path} schedule "${c.schedule}" is more than once a day (Vercel Hobby rejects the deploy)`);
}
assert.ok(crons.some((c) => c.path === "/api/gift-sponsor-reconcile"), "gift reconcile cron still registered");

console.log(`a957-hobby-cron: PASS (${crons.length} cron(s), all at most once a day)`);
