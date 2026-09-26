// HOME PAPER — 여러 피기 (Owner 확정 2026-09-23)
// 1마리: 아무것도 안 함(= home-peek 확정 화면)  ·  2마리+: 접힘 → 탭하면 챠르륵 펼침
// 펼침: 창 높이 = 카드 2장 반. 넘치면 창 안에서만 스크롤. HOME 카드·피크·도장은 고정.
// 전제(app): 피기마다 `.homePaper__card--piggy` 한 장씩, 같은 부모(.homePaper) 안에 순서대로 렌더.
//            각 카드 안 records 버튼 = `.homePaper__records[data-piggy-id]` (id 중복 금지).
import { mountHomePeek, mountPlusPiggyTab } from './home-peek.js';

const GAP = 14, HOME_TOP = 214, MARK_BLOCK = 168, MARK_GAP = 24, BASE_H = 568, FADE = 26;

function flapLabel(names) {           // "Mochi" · "Mochi · Bebe" · "Mochi · Bebe · +5"
  const rest = names.slice(1);
  if (rest.length <= 2) return rest.join(' · ');
  return `${rest[0]} · ${rest[1]} · +${rest.length - 2}`;
}

export async function mountResidentPaper(paper, { onAdd, nameOf } = {}) {
  if (!paper) return () => {};
  const cards = [...paper.querySelectorAll('.homePaper__card--piggy')];
  if (!cards.length) return () => {};
  if (cards.length === 1) {                                  // 1마리 = A-538 확정 화면 그대로
    const offPeek = await mountHomePeek(paper);
    const offTab = mountPlusPiggyTab(paper, { onClick: onAdd });
    return { open() {}, fold() {}, off() { offPeek(); offTab(); } };
  }
  const names = cards.map((c, i) => (nameOf ? nameOf(c, i) : c.querySelector('.homePaper__name')?.textContent.trim() || ''));

  // 창 만들고 카드들을 그 안으로 (순서 유지)
  const win = document.createElement('div');
  win.className = 'homeResidents';
  cards[0].before(win);
  cards.forEach((c) => win.append(c));

  // + Piggy 탭 = 목록 맨 끝
  const tab = document.createElement('button');
  tab.type = 'button'; tab.className = 'homePlusPiggyTab'; tab.setAttribute('aria-label', 'Add a Piggy');
  tab.innerHTML = '<span class="homePlusPiggyTab__paper"></span><span class="homePlusPiggyTab__label">+ Piggy</span>';
  if (onAdd) tab.addEventListener('click', onAdd);
  win.append(tab);

  const fade = document.createElement('div'); fade.className = 'homeResFade'; win.after(fade);
  const flaps = [];
  const n = cards.length;
  paper.classList.add('hasResidents');

  const H = cards[0].offsetHeight;                          // 실측 (app ≈ 101)
  const contentH = () => win.scrollHeight;                  // 카드들 + 탭

  function layout(open) {
    let winH, bottom;
    if (!open) {
      // 접힘 — 1번 카드만, 밑에 접힌 종이 끝 + 그 밑에 + Piggy
      winH = H;
      win.classList.remove('isOpen', 'isScroll'); paper.classList.remove('isResOpen', 'isResScroll');
      tab.style.display = 'none';
      flaps.forEach((f, i) => (f.style.top = HOME_TOP + H - 4 + i * 7 + 'px'));
      bottom = HOME_TOP + H - 4 + (flaps.length - 1) * 7 + 24;
      foldTab.style.top = bottom - 2 + 'px'; foldTab.style.display = '';
      bottom += 28;
      win.scrollTop = 0;
    } else {
      tab.style.display = ''; foldTab.style.display = 'none';
      win.classList.add('isOpen'); paper.classList.add('isResOpen');
      const cap = Math.round(2 * H + 2 * GAP + H * 0.5) + FADE;   // 2장 반 (+흐림 자리)
      const full = contentH();
      const scroll = full > cap;
      win.classList.toggle('isScroll', scroll); paper.classList.toggle('isResScroll', scroll);
      winH = scroll ? cap : full;
      bottom = HOME_TOP + winH;
      fade.style.top = bottom - 22 + 'px';
    }
    win.style.setProperty('--res-h', winH + 'px');
    const paperH = Math.max(BASE_H, bottom + MARK_GAP + MARK_BLOCK);
    paper.style.height = paperH + 'px';
    paper.dispatchEvent(new CustomEvent('homepaper:resize', { bubbles: true, detail: { height: paperH } }));
  }

  // 접힌 상태 전용 + Piggy (플랩 밑)
  const foldTab = tab.cloneNode(true); foldTab.style.position = 'absolute'; foldTab.style.right = '40px';
  if (onAdd) foldTab.addEventListener('click', onAdd);
  paper.append(foldTab); foldTab.style.display = 'none';

  {
    const layers = n === 2 ? 1 : 2;
    for (let i = 0; i < layers; i++) {
      const f = document.createElement('button');
      f.type = 'button'; f.className = 'homeFlap' + (i ? ' homeFlap--2' : '');
      f.setAttribute('aria-label', 'Show all Piggies');
      if (!i) { const s = document.createElement('span'); s.className = 'homeFlap__label'; s.textContent = flapLabel(names); f.append(s); }
      f.addEventListener('click', () => layout(true));
      win.after(f); flaps.push(f);
    }
  }

  // 피크: 창 오른쪽 위에 고정 (스크롤해도 같은 자리 — Owner "웃기고 좋다")
  const offPeek = await mountHomePeek(paper, { card: win });

  layout(false);
  const api = {
    open: () => layout(true),
    fold: () => layout(false),        // 접는 트리거는 OPEN(판정) — app 이 원하는 곳에 연결
    off() { offPeek(); fade.remove(); foldTab.remove(); flaps.forEach((f) => f.remove());
            cards.forEach((c) => win.before(c)); win.remove(); paper.style.height = '';
            paper.classList.remove('hasResidents', 'isResOpen', 'isResScroll'); },
  };
  return api;
}
