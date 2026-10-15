// Coarse, fixed vocabulary only. The caller sends only the returned bucket;
// the user agent, version numbers and device model never leave this function.
export function coarseOsBucket(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  // Crawlers and link-preview fetchers first: many borrow a phone/desktop UA, and they must not read as a person.
  if (/[\w-]*(?:bot|spider|crawler)\/|compatible;\s*[\w-]*(?:bot|spider)\b|\bBytespider\b|HeadlessChrome|facebookexternalhit|kakaotalk-scrap|\bSlackbot\b|\bTelegramBot\b/i.test(ua)) return "bot";
  if (/\biPad\b/i.test(ua)) return "ipados";

  const ios = ua.match(/\b(?:iPhone|iPod)\b[^)]*\bOS (\d+)[._](\d+)/i);
  if (ios) {
    const major = Number(ios[1]);
    const minor = Number(ios[2]);
    if (major === 18 && minor === 7) return "ios18_7";
    if (major === 18) return "ios18";
    if (major === 17) return "ios17";
    if (major < 17) return "ios_old";
    return "other";
  }

  if (/\bAndroid\b/i.test(ua)) return "android";
  if (/\bWindows(?: NT)?\b/i.test(ua)) return "windows";
  if (/\bMacintosh\b|\bMac OS X\b/i.test(ua)) return "mac";
  return "other";
}
