// Bound the application wait independently of the authenticator's timeout.
// Start synchronously in the click stack. A late PRF must never reach a signer.
export function waitForPasskey(start, { timeoutMs = 45_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      reject(error);
    };
    let pending;
    try { pending = start(); } catch (error) { fail(error); return; }
    timer = setTimer(() => {
      const error = new Error("passkey wait elapsed");
      error.name = "AuthWaitTimeout";
      fail(error);
    }, timeoutMs);
    Promise.resolve(pending).then((result) => {
      if (settled) {
        if (result?.prfOutput instanceof Uint8Array) result.prfOutput.fill(0);
        return;
      }
      settled = true;
      clearTimer(timer);
      resolve(result);
    }, fail);
  });
}
