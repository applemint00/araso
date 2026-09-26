// HOME PEEK — 1번 피기 카드 뒤 빼꼼. 새 그림 0장, 원본 piggy_assembled_stand.svg path 무수정.
// 사용: import { mountHomePeek } from './home-peek.js';  mountHomePeek(document.querySelector('.homePaper'));
// 되돌리기: const off = await mountHomePeek(el); off();
const SRC = '/motion/assets/piggy_assembled_stand.svg';
const NS = 'http://www.w3.org/2000/svg';
// path 순서(0부터): 0 왼귀 1 왼귀안 2 오른귀 3 오른귀안 4 왼다리 5 오른다리 6 왼팔 7 오른팔 8 몸통 9 눈L 10 눈R 11 입
const ARM_L = 6, LEG_R = 5, EYES = [9, 10];
let svgCache = null;

async function loadPaths() {
  if (!svgCache) {
    const txt = await (await fetch(SRC)).text();
    const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
    svgCache = [...doc.querySelectorAll('path')].map((p) => p.cloneNode(true));
  }
  return svgCache.map((p) => document.importNode(p, true));
}

function el(tag, attrs = {}, ns = NS) {
  const n = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

export async function mountHomePeek(paper, { card } = {}) {
  if (!paper) return () => {};
  card = card || paper.querySelector('.homePaper__card--piggy');   // 1번 피기 카드
  if (!card) return () => {};
  const P = await loadPaths();

  // 카드 실측(로컬 px, transform 무관) → 기본값 374 / 214
  paper.style.setProperty('--peek-edge', card.offsetLeft + card.offsetWidth + 'px');
  paper.style.setProperty('--peek-top', card.offsetTop + 'px');

  // 몸 (왼팔 뺌) — 얼굴은 같은 svg 안이라 같이 움직인다
  const body = el('svg', { class: 'homePeekBody', viewBox: '0 0 1000 1042', 'aria-hidden': 'true' });
  const eyes = el('g', { class: 'homePeekEyes' });
  P.forEach((p, i) => {
    if (i === ARM_L || EYES.includes(i)) return;
    if (i === LEG_R) { const g = el('g', { class: 'homePeekLegR' }); g.append(p); body.append(g); return; }
    body.append(p);
    if (i === 8) body.append(eyes);           // 눈은 몸통 위, 입(11) 아래 순서 유지
  });
  EYES.forEach((i) => eyes.append(P[i]));

  // 손 = 왼팔 path 를 손목(y≥660)에서 잘라서
  const clipId = 'homePeekPaw' + Math.random().toString(36).slice(2, 7);
  const handSvg = el('svg', { viewBox: '30 600 220 220' });
  const defs = el('defs'), cp = el('clipPath', { id: clipId });
  cp.append(el('rect', { x: 30, y: 660, width: 220, height: 400 }));
  defs.append(cp);
  const g = el('g', { 'clip-path': `url(#${clipId})` });
  g.append(P[ARM_L]);
  handSvg.append(defs, g);
  const hand = el('div', { class: 'homePeekHand' }, null); hand.append(handSvg);
  const clip = el('div', { class: 'homePeekHandClip', 'aria-hidden': 'true' }, null); clip.append(hand);

  card.classList.add('hasPeek');
  card.before(body);   // 카드 뒤
  card.after(clip);    // 카드 위 (카드 오른쪽 가장자리에서 잘림)

  return () => { body.remove(); clip.remove(); card.classList.remove('hasPeek'); };
}

// ===== + Piggy 탭 =====
// 마지막 피기 카드 발아래(오른쪽, 피기 발 쪽)에 붙는다 — 1마리면 1번 밑, 2마리면 2번 밑.
// 사용: const offTab = mountPlusPiggyTab(paper, { onClick: () => ... });
export function mountPlusPiggyTab(paper, { onClick, label = '+ Piggy' } = {}) {
  if (!paper) return () => {};
  const cards = paper.querySelectorAll('.homePaper__card--piggy');
  const card = cards[cards.length - 1];
  if (!card) return () => {};
  const paperW = paper.offsetWidth;
  paper.style.setProperty('--tab-right', (paperW - (card.offsetLeft + card.offsetWidth)) + 14 + 'px');
  paper.style.setProperty('--tab-top', (card.offsetTop + card.offsetHeight - 2) + 'px');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'homePlusPiggyTab';
  btn.setAttribute('aria-label', 'Add a Piggy');
  btn.innerHTML = '<span class="homePlusPiggyTab__paper"></span><span class="homePlusPiggyTab__label"></span>';
  btn.lastChild.textContent = label;
  if (onClick) btn.addEventListener('click', onClick);
  card.classList.add('hasPeek');            // 카드 z-index:2 → 탭 윗변이 카드 밑으로
  card.after(btn);
  return () => btn.remove();
}
