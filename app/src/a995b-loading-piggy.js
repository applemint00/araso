// [A-995-b] PWA launch bridge: the approved dark Piggy splash remains in place for one
// approved 3.6 s eye-roll cycle, then reveals the existing app surface underneath.
// Art and geometry come from A-897's splash; motion comes from the Owner-approved
// piggy_icon_loading_roll_20261011.html. This module never renders Checking/auth copy.
export const A995_MOUTH_FOLLOW = 0.5;
export const A995B_EYE_RADIUS = 22;
export const A995B_CYCLE_MS = 3600;
export const A995B_BLINK_MS = 3200;

const SVG_NS = "http://www.w3.org/2000/svg";
const FALLBACK_SPLASH = "/splash/splash-1170x2532.png";
const FACE_SOURCE = "/motion/a995b-loading-piggy.svg";

export function a995bLoadingOffset(elapsedMs, reduce = false) {
  if (reduce) return { x: 0, y: 0 };
  const t = ((Number(elapsedMs) || 0) % A995B_CYCLE_MS + A995B_CYCLE_MS) % A995B_CYCLE_MS;
  if (t < 400 || t >= 2000) return { x: 0, y: 0 };
  const angle = ((t - 400) / 1600) * 2 * Math.PI - Math.PI / 2;
  const strength = Math.min(1, (t - 400) / 250, (2000 - t) / 250);
  return {
    x: Math.cos(angle) * A995B_EYE_RADIUS * strength,
    y: Math.sin(angle) * A995B_EYE_RADIUS * strength,
  };
}

export function a995bLoadingEnabled({ standalone, displayStandalone, force } = {}) {
  const navStandalone = standalone ?? (typeof navigator !== "undefined" && navigator.standalone === true);
  const mediaStandalone = displayStandalone ?? (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  const devForce = force ?? (import.meta.env?.DEV === true && typeof location !== "undefined" && new URLSearchParams(location.search).get("a995b-loading") === "1");
  return navStandalone || mediaStandalone || devForce;
}

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function matchingSplash() {
  if (typeof document === "undefined") return FALLBACK_SPLASH;
  const links = [...document.querySelectorAll('link[rel="apple-touch-startup-image"]')];
  const matched = links.find((link) => {
    try { return !link.media || matchMedia(link.media).matches; } catch { return false; }
  });
  return matched?.getAttribute("href") || FALLBACK_SPLASH;
}

function prepareFace(object, reduce) {
  const doc = object.contentDocument;
  const svg = doc?.querySelector("svg");
  const eyes = svg ? [...svg.querySelectorAll("path.eye")] : [];
  const paths = svg ? [...svg.querySelectorAll("path")] : [];
  const mouth = paths.at(-1);
  if (!svg || eyes.length !== 2 || !mouth) return null;
  svg.style.background = "#151515";

  const eyeGroup = doc.createElementNS(SVG_NS, "g");
  eyeGroup.classList.add("a995b-pk-eyes");
  eyes[0].before(eyeGroup);
  eyes.forEach((eye) => eyeGroup.append(eye));

  const mouthGroup = doc.createElementNS(SVG_NS, "g");
  mouthGroup.classList.add("a995b-pk-mouth");
  mouth.before(mouthGroup);
  mouthGroup.append(mouth);

  const style = doc.createElementNS(SVG_NS, "style");
  style.textContent = `
    @keyframes a995bBlink { 0%, 90%, 100% { transform: scaleY(1); } 94% { transform: scaleY(.08); } }
    .eye { transform-box: fill-box; transform-origin: center; animation: a995bBlink ${A995B_BLINK_MS}ms infinite; }
    ${reduce ? ".eye { animation: none; transform: scaleY(1); }" : ""}
  `;
  svg.prepend(style);
  return { eyeGroup, mouthGroup };
}

export function mountA995bLoadingPiggy({ force } = {}) {
  if (typeof document === "undefined" || !a995bLoadingEnabled({ force })) return () => {};
  document.querySelector(".a995bLoading")?.remove();
  const reduce = reducedMotion();
  const overlay = document.createElement("div");
  overlay.className = "a995bLoading";
  overlay.dataset.a995bLoading = "1";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.setProperty("--a995b-loading-splash", `url("${matchingSplash()}")`);
  overlay.innerHTML = `<div class="a995bLoading__face"><object type="image/svg+xml" data="${FACE_SOURCE}" tabindex="-1"></object></div>`;
  document.body.appendChild(overlay);

  const object = overlay.querySelector("object");
  const startedAt = performance.now();
  let frame = 0;
  let ended = false;
  const stop = () => {
    if (ended) return;
    ended = true;
    if (frame) cancelAnimationFrame(frame);
    overlay.remove();
  };
  const endTimer = setTimeout(stop, A995B_CYCLE_MS);
  object.addEventListener("load", () => {
    const face = prepareFace(object, reduce);
    if (!face || reduce || ended) return;
    const tick = (now) => {
      if (ended) return;
      const { x, y } = a995bLoadingOffset(now - startedAt);
      face.eyeGroup.setAttribute("transform", `translate(${x} ${y})`);
      face.mouthGroup.setAttribute("transform", `translate(${x * A995_MOUTH_FOLLOW} ${y * A995_MOUTH_FOLLOW})`);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }, { once: true });
  return () => { clearTimeout(endTimer); stop(); };
}
