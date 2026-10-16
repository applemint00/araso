import { EVENT_CODES } from './event-schema.js';

// Tester feedback: the person's own words plus two fixed words. No identifiers, addresses, keys or free metadata.
export const FEEDBACK_MAX_CHARS = 500;
export const FEEDBACK_SCREENS = Object.freeze(['home']);

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
/** The words as stored: control characters dropped, trimmed; null when empty or over the limit (counted in characters, not bytes). */
export function feedbackText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(CONTROL, '').trim();
  const chars = [...text].length;
  return chars > 0 && chars <= FEEDBACK_MAX_CHARS ? text : null;
}
export function validFeedback(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3 && ['text', 'screen', 'os'].every((k) => Object.prototype.hasOwnProperty.call(value, k))
    && feedbackText(value.text) !== null
    && FEEDBACK_SCREENS.includes(value.screen) && EVENT_CODES.os.includes(value.os);
}
