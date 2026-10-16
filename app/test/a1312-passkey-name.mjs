// [A-1312 ③ · Owner 12:5x "날짜 빼고 한 줄"] a new passkey is named "Araso" (no date); the rename to the Piggy's name after naming (A-1278) stays.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const body = (name) => { const i = MAIN.indexOf(`function ${name}(`); assert.ok(i >= 0, name); let d = 0, j = MAIN.indexOf("{", i); for (let k = j; k < MAIN.length; k += 1) { if (MAIN[k] === "{") d += 1; else if (MAIN[k] === "}" && --d === 0) return MAIN.slice(i, k + 1); } return ""; };
let pass = 0;
const check = (n, f) => { f(); pass += 1; console.log("PASS", n); };
check("③ passkeyCreateName() = \"Araso\" (no date, any time)", () => {
  const passkeyCreateName = new Function(`${body("passkeyCreateName")}; return passkeyCreateName;`)();
  for (const d of [new Date(2026, 9, 16, 12, 38), new Date(2027, 0, 1, 0, 0)]) assert.equal(passkeyCreateName(d), "Araso");
});
check("③ create still passes it as user.name/displayName; A-1278 rename to the Piggy name stays", () => {
  assert.match(MAIN, /user: \{ name: passkeyName, displayName: passkeyName \}/);
  assert.match(body("renamePasskeyForPiggy"), /signalCurrentUserDetails\(\{ rpId: getRpId\(\), userId, name, displayName: name \}\)/);
});
console.log(`A1312 passkey name ${pass} PASS / 0 FAIL / 0 SKIP`);
