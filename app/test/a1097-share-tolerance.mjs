import assert from "node:assert/strict";
import { EULER_FORK_POSITION_RAW, EULER_FORK_SIZE_RAW, EULER_LIVE_LIMITS, FORK_SHARE_TOLERANCE_BPS, encodeEulerStep } from "../src/mainnet-job-euler.js";
import { UPSHIFT_FORK_POSITION_RAW, UPSHIFT_FORK_SIZE_RAW, encodeUpshiftStep } from "../src/mainnet-job-upshift.js";
import { CURVANCE_FORK_SHARES_RAW, CURVANCE_FORK_SIZE_RAW, encodeCurvanceStep } from "../src/mainnet-job-curvance.js";

const PIGGY = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const cap = (raw) => (BigInt(raw) * (10000n + BigInt(FORK_SHARE_TOLERANCE_BPS))) / 10000n;
let pass = 0;
const check = (name, fn) => { fn(); pass += 1; console.log(`PASS  ${name}`); };

check("one 100-bps constant matches the existing Euler live slippage precedent", () => {
  assert.equal(FORK_SHARE_TOLERANCE_BPS, 100);
  assert.equal(FORK_SHARE_TOLERANCE_BPS, EULER_LIVE_LIMITS.maxSlippageBps);
});

for (const row of [
  ["upshift", UPSHIFT_FORK_POSITION_RAW, (v) => encodeUpshiftStep("instantRedeem", { piggyAddress: PIGGY, heldSharesRaw: v })],
  ["euler", EULER_FORK_POSITION_RAW, (v) => encodeEulerStep("redeem", { piggyAddress: PIGGY, heldSharesRaw: v })],
  ["curvance", CURVANCE_FORK_SHARES_RAW, (v) => encodeCurvanceStep("redeem", { piggyAddress: PIGGY, heldSharesRaw: v })],
]) {
  check(`${row[0]} accepts the measured position and the inclusive 100-bps cap`, () => {
    assert.equal(row[2](row[1]).error, null);
    assert.equal(row[2](cap(row[1]).toString()).error, null);
  });
  check(`${row[0]} refuses one raw unit above the cap and invalid/zero shares`, () => {
    assert.equal(row[2]((cap(row[1]) + 1n).toString()).error, "shares_above_fork_proven_position");
    assert.notEqual(row[2]("0").error, null);
    assert.notEqual(row[2]("nope").error, null);
  });
}

check("deposit amount caps remain exact and are not tolerance-adjusted", () => {
  const rows = [
    [UPSHIFT_FORK_SIZE_RAW, (v) => encodeUpshiftStep("deposit", { piggyAddress: PIGGY, amountRaw: v })],
    [EULER_FORK_SIZE_RAW, (v) => encodeEulerStep("deposit", { piggyAddress: PIGGY, amountRaw: v })],
    [CURVANCE_FORK_SIZE_RAW, (v) => encodeCurvanceStep("deposit", { piggyAddress: PIGGY, amountRaw: v })],
  ];
  for (const [limit, encode] of rows) {
    assert.equal(encode(limit).error, null);
    assert.equal(encode((BigInt(limit) + 1n).toString()).error, "amount_above_fork_proven_size");
  }
});

console.log(`\n${pass}/${pass} PASS`);
