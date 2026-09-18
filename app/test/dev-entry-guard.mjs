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
// [A-409] 옛 단언은 사용자 화면에 "Open/Send Piggy only at <도메인>." 이 **남아 있을 것**을
// 요구했다. A-407-e/f 가 Owner 지시로 그 문구와 "Not this door." 를 사용자 표시에서 걷어냈으므로
// 검사 목적을 뒤집는다 — 그 문구들이 **다시 들어오지 않는지** 보는 회귀 검사다.
// PRODUCTION_RP_ID 상수와 rpId 판정 자체는 그대로 유지(위 검사들이 계속 지킨다).
check(
  "removed user-facing copy stays removed (no domain, no 'Not this door.')",
  !src.includes("Not this door.") &&
    !src.includes("Open Piggy only at ${PRODUCTION_RP_ID}.") &&
    !src.includes("Check Piggy only at ${PRODUCTION_RP_ID}.") &&
    !src.includes("Send Piggy only at ${PRODUCTION_RP_ID}."),
);
check("local grant skip is explicit harness sentinel only", src.includes('isLocalDevRpId() && RELAYER_URL === "__HARNESS_NO_GRANT__"'));
check("reopen does not force closed trip back to birth", src.includes('if (state.scene === "received" && (readCredential() || state.address))'));
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
