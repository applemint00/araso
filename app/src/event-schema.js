// Fixed vocabulary only: no user identifiers, error messages or arbitrary metadata.
export const EVENT_CODES = Object.freeze(Object.fromEntries(Object.entries({
  entry_shown: ['invite', 'public', 'used'],
  entry_blocked: ['invite_only', 'used', 'unsupported_origin'],
  inapp: ['kakao', 'line', 'instagram', 'facebook', 'other'],
  auth_tap: ['create', 'find'],
  flow_error: ['open', 'unlock', 'home_money', 'prf_unavailable', 'other'],
  piggy_find: ['ok', 'after_get', 'after_get_mismatch', 'after_get_timeout', 'after_get_save', 'after_get_other', 'platform_pending'],
  passkey_create: ['ok', 'cancel', 'fail'],
  passkey_get: ['ok', 'cancel', 'fail'],
  grant: ['ok', 'already_funded', 'not_allowlisted', 'cap_reached', 'unavailable', 'unconfirmed', 'reverted', 'fail'],
  home_reached: ['ok'],
  send_tap: ['ok'],
  send: ['ok', 'auth', 'grant', 'simulate', 'unconfirmed', 'fail'],
  gift: ['ok', 'auth', 'requote', 'unavailable', 'fail'],
  js_error: ['error', 'type', 'range', 'reference', 'syntax', 'rejection'],
}).map(([step, codes]) => [step, Object.freeze(codes)])));
export function validEvent(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2 && Object.prototype.hasOwnProperty.call(value, 'step') && Object.prototype.hasOwnProperty.call(value, 'code')
    && typeof value.step === 'string' && typeof value.code === 'string'
    && Object.prototype.hasOwnProperty.call(EVENT_CODES, value.step) && EVENT_CODES[value.step].includes(value.code);
}
