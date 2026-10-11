// A-995 — the A-766 eye math, shared by the current Gift cards and the tester intro.
// Visual constants are the approved A-766 values: 10 SVG units, 60-unit response range,
// 120 ms ease-out, and a 400 ms touch hold. No device-orientation input.
export const A995_EYE_MAX = 10;
export const A995_EYE_RANGE = 60;
export const A995_TOUCH_HOLD_MS = 400;

export function a995EyeOffset(direction, screenDistance, max = A995_EYE_MAX, range = A995_EYE_RANGE) {
  const dx = Number(direction?.x);
  const dy = Number(direction?.y);
  const localDistance = Math.hypot(dx, dy);
  const distance = Number(screenDistance);
  if (!Number.isFinite(localDistance) || localDistance === 0 || !Number.isFinite(distance) || distance <= 0) return { x: 0, y: 0 };
  const amount = Math.min(max, (distance / range) * max);
  return { x: (dx / localDistance) * amount, y: (dy / localDistance) * amount };
}

const svgCache = new Map();
let bound = false;
let raf = 0;
let touchTimer = 0;
let lastPointer = null;

function reduced() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function faces() {
  return [...document.querySelectorAll(
    '.a911-screen[data-a911="gift"] svg[data-a995-eye-face], .testerIntro__face[data-a995-eye-face]',
  )];
}

function setFace(face, point) {
  const eyes = [...face.querySelectorAll(".a995-eye")];
  if (eyes.length !== 2 || reduced() || !point) {
    for (const eye of eyes) {
      eye.style.setProperty("--a995-eye-x", "0px");
      eye.style.setProperty("--a995-eye-y", "0px");
    }
    return;
  }
  const ctm = face.getScreenCTM?.();
  const box = face.getBoundingClientRect();
  if (!ctm || !box.width || !box.height) return;
  const vx = Number(point.x) - (box.left + box.width / 2);
  const vy = Number(point.y) - (box.top + box.height / 2);
  const offset = a995EyeOffset(
    { x: ctm.d * vx - ctm.c * vy, y: -ctm.b * vx + ctm.a * vy },
    Math.hypot(vx, vy),
  );
  for (const eye of eyes) {
    eye.style.setProperty("--a995-eye-x", `${offset.x.toFixed(3)}px`);
    eye.style.setProperty("--a995-eye-y", `${offset.y.toFixed(3)}px`);
  }
}

function paint(point) {
  for (const face of faces()) setFace(face, point);
}

function schedule(point) {
  lastPointer = point;
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(lastPointer); });
}

function reset() {
  clearTimeout(touchTimer);
  touchTimer = 0;
  schedule(null);
}

export function bindA995EyeLook() {
  if (bound || typeof window === "undefined" || typeof document === "undefined") return;
  bound = true;
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || reduced()) return;
    schedule({ x: event.clientX, y: event.clientY });
  }, { passive: true });
  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || reduced()) return;
    schedule({ x: event.clientX, y: event.clientY });
    clearTimeout(touchTimer);
    touchTimer = setTimeout(reset, A995_TOUCH_HOLD_MS);
  }, { passive: true });
  window.addEventListener("pointercancel", reset, { passive: true });
  window.addEventListener("pointerleave", reset, { passive: true });
  window.addEventListener("blur", reset);
}

function svgText(src) {
  if (!svgCache.has(src)) {
    svgCache.set(src, fetch(src, { credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error(`eye_svg_${response.status}`);
      return response.text();
    }));
  }
  return svgCache.get(src);
}

async function hydrate(img) {
  if (!img?.isConnected || img.dataset.a995EyeHydrating) return;
  img.dataset.a995EyeHydrating = "1";
  try {
    const text = await svgText(img.getAttribute("src"));
    if (!img.isConnected) return;
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    const eyes = [...parsed.querySelectorAll('#eye_L, #eye_R, .eye')];
    if (eyes.length !== 2) { img.dataset.a995EyeHydrated = "none"; return; }
    const svg = document.importNode(parsed, true);
    for (const attr of [...img.attributes]) {
      if (attr.name !== "src" && attr.name !== "alt" && !attr.name.startsWith("data-a995-")) svg.setAttribute(attr.name, attr.value);
    }
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("data-a995-eye-face", "gift");
    for (const eye of svg.querySelectorAll('#eye_L, #eye_R, .eye')) eye.classList.add("a995-eye");
    img.replaceWith(svg);
  } catch {
    delete img.dataset.a995EyeHydrating;
  }
}

export function syncA995GiftEyes(root = document) {
  bindA995EyeLook();
  const jobs = [...root.querySelectorAll('img[data-a995-gift-eye]')].map(hydrate);
  return Promise.allSettled(jobs);
}

export function registerA995InlineFace(svg) {
  if (!svg) return;
  const eyes = [...svg.querySelectorAll(".eye")];
  if (eyes.length !== 2) return;
  svg.dataset.a995EyeFace = "inline";
  for (const eye of eyes) eye.classList.add("a995-eye");
  bindA995EyeLook();
}
