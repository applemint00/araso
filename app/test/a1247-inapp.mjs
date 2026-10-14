import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyInAppBrowser, handleInAppBrowser } from "../src/inapp.js";

let pass = 0;
function check(name, fn) { fn(); pass += 1; console.log(`PASS ${name}`); }
function visit(userAgent, href = "https://arasoo.vercel.app/?i=ABC#invite=secret") {
  const events = [];
  const replacements = [];
  const order = [];
  const target = {
    navigator: { userAgent },
    location: { href, replace: value => { replacements.push(value); order.push("replace"); } },
  };
  const result = handleInAppBrowser({ target, emit: (...event) => { events.push(event); order.push("emit"); } });
  return { events, replacements, order, result };
}

check("Kakao emits before replace and preserves the complete hash URL", () => {
  const d = visit("Mozilla/5.0 KAKAOTALK 11.0");
  assert.deepEqual(d.events, [["inapp", "kakao"]]);
  assert.deepEqual(d.order, ["emit", "replace"]);
  assert.deepEqual(d.replacements, [`kakaotalk://web/openExternal?url=${encodeURIComponent("https://arasoo.vercel.app/?i=ABC#invite=secret")}`]);
  assert.equal(d.result.redirected, true);
});

check("LINE adds the external-browser query before the hash", () => {
  const d = visit("Mozilla/5.0 Line/14.0");
  assert.deepEqual(d.events, [["inapp", "line"]]);
  assert.equal(d.replacements.length, 1);
  const opened = new URL(d.replacements[0]);
  assert.equal(opened.searchParams.get("i"), "ABC");
  assert.equal(opened.searchParams.get("openExternalBrowser"), "1");
  assert.equal(opened.hash, "#invite=secret");
});

check("LINE already marked for external open does not replace again", () => {
  const d = visit("Mozilla/5.0 Line/14.0", "https://arasoo.vercel.app/?openExternalBrowser=1#invite=secret");
  assert.deepEqual(d.events, [["inapp", "line"]]);
  assert.deepEqual(d.replacements, []);
  assert.equal(d.result.redirected, false);
});

check("Instagram and Facebook are observed without navigation", () => {
  for (const [ua, code] of [["Instagram 350.0", "instagram"], ["FBAN/FBIOS;FBAV/500.0", "facebook"]]) {
    const d = visit(ua);
    assert.deepEqual(d.events, [["inapp", code]]);
    assert.deepEqual(d.replacements, []);
  }
});

check("generic Android WebView is other and stays in place", () => {
  const d = visit("Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36");
  assert.equal(classifyInAppBrowser("Mozilla/5.0 (Linux; Android 15; wv)"), "other");
  assert.deepEqual(d.events, [["inapp", "other"]]);
  assert.deepEqual(d.replacements, []);
});

check("Safari and Chrome neither emit nor navigate", () => {
  for (const ua of [
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
  ]) {
    const d = visit(ua);
    assert.deepEqual(d.events, []);
    assert.deepEqual(d.replacements, []);
    assert.equal(d.result.code, null);
  }
});

check("main handles the in-app visit synchronously before its first render", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const call = main.indexOf("handleInAppBrowser({ target: globalThis, emit: track });");
  assert.ok(call >= 0);
  assert.ok(call < main.indexOf("render();", call));
  assert.equal(main.slice(call, call + 80).includes("await"), false);
});

console.log(`A-1247 in-app: ${pass} PASS / 0 FAIL`);
