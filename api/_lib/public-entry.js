// A1160: server-owned public entry flag and cap. No clock, implicit default or client override.
export function publicEntryConfig(env = process.env) {
  const own = k => env && Object.hasOwn(env, k) ? env[k] : undefined;
  const raw = own('ARASO_PUBLIC_GRANT_CAP');
  const cap = typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : 0;
  return Object.freeze({ enabled: own('ARASO_PUBLIC_ENTRY') === '1', cap: Number.isSafeInteger(cap) ? cap : 0 });
}

// [A-1305 ⑥ · Owner 10:0x (가)] "Major change coming." hold. ARASO_HOLD=1 closes the door for every device without a pass mark;
// ARASO_HOLD_PASS_SHA256 = hex sha256 of the one Owner pass token (the token itself never reaches the server config, logs or code).
export function holdConfig(env = process.env) {
  const own = k => env && Object.hasOwn(env, k) ? env[k] : undefined;
  const sha = own('ARASO_HOLD_PASS_SHA256');
  return Object.freeze({ enabled: own('ARASO_HOLD') === '1', passSha256: typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : null });
}
