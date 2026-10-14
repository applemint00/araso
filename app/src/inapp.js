export function classifyInAppBrowser(userAgent = "") {
  const ua = String(userAgent);
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  if (/\bLine\//i.test(ua)) return "line";
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN\/|FBAV\//i.test(ua)) return "facebook";
  if (/(?:;\s*wv\)|\bWebView\b)/i.test(ua)) return "other";
  return null;
}

export function handleInAppBrowser({ target = globalThis, emit = () => {} } = {}) {
  const code = classifyInAppBrowser(target.navigator?.userAgent || "");
  if (!code) return { code: null, redirected: false, targetUrl: null };

  try { emit("inapp", code); } catch { /* observation must not affect entry */ }

  const href = String(target.location?.href || "");
  if (!href || typeof target.location?.replace !== "function") {
    return { code, redirected: false, targetUrl: null };
  }
  if (code === "kakao") {
    const targetUrl = `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
    target.location.replace(targetUrl);
    return { code, redirected: true, targetUrl };
  }
  if (code === "line") {
    try {
      const targetUrl = new URL(href);
      if (targetUrl.searchParams.has("openExternalBrowser")) {
        return { code, redirected: false, targetUrl: targetUrl.href };
      }
      targetUrl.searchParams.set("openExternalBrowser", "1");
      target.location.replace(targetUrl.href);
      return { code, redirected: true, targetUrl: targetUrl.href };
    } catch { /* malformed locations stay on the existing page */ }
  }
  return { code, redirected: false, targetUrl: null };
}
