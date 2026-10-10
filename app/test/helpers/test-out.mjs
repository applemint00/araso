// [A-932] One rule for test output (Owner 2026-10-10 "다음에 이런사고 안나게"): a test writes into _private/ops/receipts ONLY when the caller passes
// an explicit OUT (argv / env). Without it the output goes to $TMPDIR/araso-<name> so a plain run can never overwrite an earlier card's evidence.
import os from "node:os";
import path from "node:path";
export function testOutDir(name, explicit) {
  if (typeof explicit === "string" && explicit.trim() !== "") return path.resolve(explicit);
  return path.join(process.env.TMPDIR || os.tmpdir(), `araso-${name}`);
}
