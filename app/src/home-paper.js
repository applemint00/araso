// Home 노트패드 — 정본 `HomeNotepad.dc.html` (canvas/onboarding_scenes_20260916, A-336).
// 원본 값 그대로: 용지 left30 top26 400×568 radius3, 종이 #EBE3D5 + paper_tex_ivory.png
// center/290px auto, 그림자 0 14px 30px rgba(0,0,0,.55). 카드1(HOME) left26 top34 348×
// (padding 20 20 18), 카드2(피기 줄) left26 top214 348×(padding 18 20) gap14, 아래 집도장
// 52px rotate(-5deg) + 로고 218px, gap22, bottom54. 이 파일은 chog-home.js #chogHomePad
// 안에 얹는 **공유 markup** 이다 — 기존 손끝 좌표·wrap 변환(±width/height 만 이 회차에서
// 맞춤, 자세한 사유는 chog-home.js 주석)은 여기서 건드리지 않는다.
//
// HOME 제목은 원본 private 폰트(Playfair Display weight 900)로 구워야 한다(§구현경계 2).
// 이번 회차 샌드박스에서는 그 렌더 경로(헤드리스 브라우저 · 폰트 변환기)를 안전하게 확보하지
// 못했다 — UNKNOWN, PNG 를 굽지 않고 시스템 serif 텍스트로 대체했다. 웹폰트는 싣지 않는다.
//
// 동적 값(이름/상태/시간)은 실제 데이터다. 샘플 "Honeybun"/"6:04 PM"을 그대로 쓰지 않는다.

const CARD_DIR = "/card";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 지금 이 기기엔 Piggy 가 하나뿐이다 — home/away 는 그 하나가 지금 어디 있는지의 사실이다.
// scene 에서 파생한다(main.js 가 판정을 두 번 하지 않도록).
export function homeStatusFromScene(scene) {
  const away = scene === "away";
  return {
    homeCount: away ? 0 : 1,
    awayCount: away ? 1 : 0,
    label: away ? "away" : "still in home",
  };
}

export function homeTimeNow(now = new Date()) {
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function homePaperMarkup({
  name = "Piggy",
  homeCount = 1,
  awayCount = 0,
  label = "still in home",
  time = "",
} = {}) {
  return `
    <div class="homePaperMount">
      <div class="homePaper" id="homePaper">
        <div class="homePaper__card homePaper__card--status">
          <div class="homePaper__heading" aria-label="Home">HOME</div>
          <div class="homePaper__statusRow">
            <span class="homePaper__statusText">&gt; status &nbsp; ${homeCount} in &nbsp; ${awayCount} out</span>
            <span class="homePaper__time">${escapeHtml(time)}</span>
          </div>
        </div>
        <div class="homePaper__card homePaper__card--piggy">
          <div class="homePaper__num">1</div>
          <div class="homePaper__piggyInfo">
            <div class="homePaper__name">${escapeHtml(name)}</div>
            <div class="homePaper__state">${escapeHtml(label)}</div>
          </div>
          <img class="homePaper__face" src="${CARD_DIR}/home-face.png" alt="" aria-hidden="true" />
        </div>
        <div class="homePaper__mark" aria-hidden="true">
          <img class="homePaper__stamp" src="${CARD_DIR}/house-stamp.png" alt="" />
          <img class="homePaper__logo" src="${CARD_DIR}/arasoo-logo.png" alt="ARASOO" />
        </div>
      </div>
    </div>
  `;
}
