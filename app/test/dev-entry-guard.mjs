// Static guard for A-172 local-dev entry.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
function check(label, ok) { if (ok) { console.log(`PASS  ${label}`); pass++; } else { console.log(`FAIL  ${label}`); fail++; } }
check("production rpId remains arasoo", src.includes('const PRODUCTION_RP_ID = "arasoo.vercel.app";'));
check("local dev entry is DEV-gated", src.includes('import.meta.env.MODE === "a172-local" && import.meta.env.VITE_ARASO_LOCAL_DEV_ENTRY === "1"'));
check("local dev rpId defaults to retired harness rpId only inside dev branch", src.includes('const LOCAL_DEV_RP_ID = import.meta.env.VITE_ARASO_LOCAL_DEV_RP_ID || "arasoapp.vercel.app";'));
check("all door guards use allowed helper", (src.match(/if \(!isAllowedPiggyRpId\(\)\)/g) || []).length === 3);
check("render blocks use allowed helper", (src.match(/!isAllowedPiggyRpId\(\)/g) || []).length >= 5);
check("production label still used for blocked non-dev doors", src.includes('Open Piggy only at ${PRODUCTION_RP_ID}.') && src.includes('Send Piggy only at ${PRODUCTION_RP_ID}.'));
check("local grant skip is explicit harness sentinel only", src.includes('isLocalDevRpId() && RELAYER_URL === "__HARNESS_NO_GRANT__"'));
check("reopen does not force closed trip back to birth", src.includes('if (state.scene === "received" && (readCredential() || state.address))'));
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
