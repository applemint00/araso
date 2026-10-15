// AI training/collection crawlers are asked to stay out, link-preview fetchers are let in (an invite link must still unfurl),
// and every response says noai — without touching the CSP or any other header.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const robotsPath = new URL("../public/robots.txt", import.meta.url);
assert.ok(existsSync(robotsPath), "app/public/robots.txt exists (served at /robots.txt)");
const robots = readFileSync(robotsPath, "utf8");
const groups = robots.split(/\n\s*\n/).map((g) => g.trim()).filter(Boolean);
const rule = (agent) => {
  const g = groups.find((x) => x.split("\n").some((l) => l.trim().toLowerCase() === `user-agent: ${agent.toLowerCase()}`));
  assert.ok(g, `robots.txt names ${agent}`);
  return g.split("\n").find((l) => /^(dis)?allow:/i.test(l.trim())).trim();
};
for (const ai of ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "PerplexityBot", "Bytespider", "Applebot-Extended", "meta-externalagent", "Amazonbot", "cohere-ai"]) {
  assert.equal(rule(ai), "Disallow: /", `${ai} is asked to stay out`);
}
for (const preview of ["facebookexternalhit", "Twitterbot", "Slackbot", "kakaotalk-scrap", "TelegramBot", "Discordbot", "LinkedInBot"]) {
  assert.equal(rule(preview), "Allow: /", `${preview} may read the invite card`);
}

const vercelRaw = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
const vercel = JSON.parse(vercelRaw);
const all = vercel.headers.find((h) => h.source === "/(.*)").headers;
assert.deepEqual(all.find((h) => h.key === "X-Robots-Tag"), { key: "X-Robots-Tag", value: "noai, noimageai" });
assert.equal(all.filter((h) => h.key === "Content-Security-Policy").length, 1, "CSP stays a single header");

console.log("A1280 robots.txt (13 AI out · 7 previews in) · X-Robots-Tag noai PASS");
