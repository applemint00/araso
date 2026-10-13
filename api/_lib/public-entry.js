// A1160: server-owned public entry flag and cap. No clock, implicit default or client override.
export function publicEntryConfig(env = process.env) {
  const own = k => env && Object.hasOwn(env, k) ? env[k] : undefined;
  const raw = own('ARASO_PUBLIC_GRANT_CAP');
  const cap = typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : 0;
  return Object.freeze({ enabled: own('ARASO_PUBLIC_ENTRY') === '1', cap: Number.isSafeInteger(cap) ? cap : 0 });
}
