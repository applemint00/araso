// Fixed vocabulary only: no user identifiers, error messages or arbitrary metadata.
export const EVENT_CODES = Object.freeze(Object.fromEntries(Object.entries({
  os: ['ios18_7', 'ios18', 'ios17', 'ios_old', 'ipados', 'android', 'mac', 'windows', 'other', 'bot'],
  entry_shown: ['invite', 'public', 'used'],
  entry_blocked: ['invite_only', 'used', 'unsupported_origin', 'hold'],
  inapp: ['kakao', 'line', 'instagram', 'facebook', 'other'],
  auth_tap: ['create', 'find'],
  flow_error: ['open', 'unlock', 'home_money', 'prf_unavailable', 'create_lost', 'other'],
  piggy_find: ['ok', 'after_get', 'after_get_mismatch', 'after_get_timeout', 'after_get_save', 'after_get_other', 'platform_pending', 'get_cancel', 'get_fail'],
  passkey_create: ['ok', 'cancel', 'fail'],
  passkey_get: ['ok', 'cancel', 'fail'],
  grant: ['ok', 'already_funded', 'not_allowlisted', 'cap_reached', 'unavailable', 'unconfirmed', 'reverted', 'fail'],
  home_reached: ['ok'],
  send_tap: ['ok'],
  send: ['ok', 'auth', 'grant', 'simulate', 'unconfirmed', 'fail', 'retry', 'retry_ok', 'retry_held'], // [A-1493] the resume/retry path reports itself: retry sent · retry trip done · verification held it (nothing sent)
  send_why: ['auth', 'sign', 'refused', 'broadcast', 'mismatch', 'unconfirmed', 'redeem', 'locked', 'insufficient', 'nonce', 'fee', 'other'],
  job_why: ['unavailable', 'auth', 'signer', 'server_refused', 'changed', 'read_failed', 'refused', 'failed'],
  unlock_why: ['cancelled', 'timeout', 'identity', 'unsupported', 'other'],
  gift: ['ok', 'auth', 'requote', 'unavailable', 'fail'],
  gift_receive: ['ok', 'auth', 'unavailable', 'fail'],
  js_error: ['error', 'type', 'range', 'reference', 'syntax', 'rejection'],
}).map(([step, codes]) => [step, Object.freeze(codes)])));
export function validEvent(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2 && Object.prototype.hasOwnProperty.call(value, 'step') && Object.prototype.hasOwnProperty.call(value, 'code')
    && typeof value.step === 'string' && typeof value.code === 'string'
    && Object.prototype.hasOwnProperty.call(EVENT_CODES, value.step) && EVENT_CODES[value.step].includes(value.code);
}
// [A-1431] The Gift receive result as one fixed word. `settled` = the claim settlement this tap produced (null = none);
// `out` = what the receive tap returned. null = no result yet (card turned, already running, Piggy born and the claim still ahead).
const unavailableWord = (w) => typeof w === 'string' && /unavailable/.test(w);
export function giftReceiveCode({ settled = null, out = null } = {}) {
  if (settled && typeof settled === 'object') {
    if (settled.reason === 'already_claimed_by_same') return 'ok';
    if (settled.result === 'ok') {
      const sent = settled.valueSubmission?.status;
      if (!sent || sent === 'value_transferred') return 'ok';
      return unavailableWord(sent) ? 'unavailable' : 'fail';
    }
    if (settled.status === 'sign_failed') return 'auth';
    return [settled.status, settled.reason].some(unavailableWord) ? 'unavailable' : 'fail';
  }
  if (!out || typeof out !== 'object' || out.ok === true || out.started === true) return null;
  const reason = typeof out.reason === 'string' ? out.reason : '';
  if (reason === 'card_flipped' || reason === 'already_running') return null;
  if (out.cancelled === true || /cancel|declin|passkey|auth|not_?allowed/i.test(reason)) return 'auth';
  return unavailableWord(reason) ? 'unavailable' : 'fail';
}
