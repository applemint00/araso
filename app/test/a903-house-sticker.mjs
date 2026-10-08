// [A-903] House stamp sticker + button press feel (static contract; browser frames are run by the coordinator).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = readFileSync(path.join(REPO, "app/src/style.css"), "utf8");
const JS = readFileSync(path.join(REPO, "app/src/home-paper.js"), "utf8");
const i = CSS.indexOf("[A-903] House stamp");
assert.ok(i > 0, "A-903 block present");
const block = CSS.slice(i, CSS.indexOf(".homePaper__logo {", i));
const rules = block.slice(block.indexOf("*/") + 2);

assert.ok(existsSync(path.join(REPO, "app/public/card/house-stamp-filled.png")), "filled asset shipped");
assert.match(JS, /class="homePaper__stamp" src="\$\{CARD_DIR\}\/house-stamp-filled\.png"/);
assert.ok(!/house-stamp\.png/.test(JS), "old flat stamp no longer referenced");
assert.match(block, /drop-shadow\(0\.14em 0 0 #fbf6ea\)/, "sticker outline");
assert.match(block, /0 0\.19em 0 rgba/, "resting thickness shadow in em");
assert.match(block, /:active\s*\{\s*transform: translateY\(0\.19em\)/, "press moves down by thickness");
assert.match(block, /100ms/);
assert.match(block, /prefers-reduced-motion: reduce[\s\S]*transform: none/, "reduced motion = no motion");
assert.ok(!/cubic-bezier|bounce|animation|@keyframes/.test(rules), "no bounce/animation");
assert.ok(!/#e0b100|--gold|yellow/i.test(rules), "no yellow fill");
assert.ok(!/padding|margin/.test(rules), "tap area untouched");
// closed Home: stamp markup exists only inside home-paper.js render, no bare-Home selector added.
assert.ok(!/\.home(?!Paper)[A-Za-z_]*[^{]*house/i.test(block));
console.log("a903 house sticker: PASS");
