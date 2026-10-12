// [A-1093] Fork-only Job gas cap arithmetic. Signing/broadcast integration is
// exercised by a977-job10-fork.mjs and the actual local-fork probe receipt.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The helper intentionally stays private: older mainnet-lane consumers pin
// the module's export surface. a977 separately checks signed-tx integration.
const source = readFileSync(new URL("../src/mainnet-job-lane.js", import.meta.url), "utf8");
const start = source.indexOf("const FORK_JOB_GAS_BUFFER_BPS = 2000n;");
const end = source.indexOf("function preparedSnapshot", start);
assert.ok(start > 0 && end > start);
const bufferForkJobGas = new Function(`${source.slice(start, end)} return bufferForkJobGas;`)();

const cases = [
  [1n, 100n, 1n],
  [5n, 100n, 6n],
  [87285n, 30000000n, 104742n],
  [351914n, 30000000n, 422296n],
  [355483n, 30000000n, 426579n],
  [300000n, 310000n, 310000n],
  [300000n, 300000n, 300000n],
];
for (const [estimate, block, want] of cases) {
  const { gas, problem } = bufferForkJobGas(estimate, block);
  assert.equal(problem, null);
  assert.equal(gas, want);
  assert.ok(gas >= estimate && gas <= block && gas <= estimate * 6n / 5n);
}
for (const [estimate, block, problem] of [
  [0n, 100n, "prepared_gas_invalid"],
  [-1n, 100n, "prepared_gas_invalid"],
  ["300000", 1000000n, "prepared_gas_invalid"],
  [300000n, 299999n, "block_gas_limit_unavailable"],
  [300000n, null, "block_gas_limit_unavailable"],
]) assert.equal(bufferForkJobGas(estimate, block).problem, problem);

console.log(`a1093-job-gas-buffer: ${cases.length + 5} passed, 0 failed`);
