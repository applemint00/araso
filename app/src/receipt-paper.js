// 영수증 종이 — 정본 `Receipt.dc.html` (canvas/onboarding_scenes_20260916, A-346).
// 원본은 196px 폭 카드 한 장, 완료(rotate -1.2deg) / 빈손(rotate 2.4deg, #8C3A2E) 두 상태를
// 나란히 그린 비교 시트다. 새로 디자인하지 않는다 — 옮기는 것은 종이 껍질(로고·날짜·구분선·
// 이름·세 줄·상태·teeth)과 치수뿐이고, 안의 값은 실제 receipt 데이터로 채운다.
//
// README(onboarding_scenes_20260916) "영수증 · 서류철 — 종이 그대로": 노트패드/카드와 달리
// 이 종이에는 결 타일(paper_tex_ivory.png)을 입히지 않는다. 배경은 평평한 #F2ECE0 그대로.
//
// 로고는 새로 굽지 않고 기존 `card/arasoo-logo.png` 를 재사용한다(104px, 원본 arasoo_brush_black
// 자리와 같은 폭). teeth 는 원본 SVG(`assets/receipt_teeth.svg`)를 표시 196px 기준 최대 2x
// PNG 로 줄인 사본(`card/receipt-teeth.png`)이다 — 원본 SVG는 배포에 싣지 않는다.
//
// 날짜·이름·went out/came back/kept·상태는 전부 동적 텍스트라 웹폰트 없이 시스템 serif로
// 같은 자리에 쓴다(name-card.js·send-card.js·home-paper.js와 같은 방법).
//
// 이 파일은 앱(main.js)과 private 검토 하네스가 **같은 markup** 을 쓰려고 분리했다 — 귀환
// 두 번째 탭 대기 중 확대된 종이(return-view.js `#returnTap`)와 filebox 읽기 화면이 같은
// 종이를 이어서 보여준다(A-346 §3, 「캔버스 옛 종이와 DOM 새 종이 중복 0」).

const CARD_DIR = "/card";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function receiptPaperMarkup({
  name = "Piggy",
  date = "",
  wentOut = "—",
  cameBack = "—",
  kept = "—",
  statusLabel = "done",
  empty = false,
} = {}) {
  return `
    <div class="receiptPaper${empty ? " receiptPaper--empty" : ""}">
      <div class="receiptPaper__sheet">
        <div class="receiptPaper__logoRow">
          <img class="receiptPaper__logo" src="${CARD_DIR}/arasoo-logo.png" alt="ARASOO" />
        </div>
        <div class="receiptPaper__date">${escapeHtml(date)}</div>
        <div class="receiptPaper__rule" aria-hidden="true"></div>
        <div class="receiptPaper__name">${escapeHtml(name)}</div>
        <div class="receiptPaper__row"><span>went out</span><span>${escapeHtml(wentOut)}</span></div>
        <div class="receiptPaper__row"><span>came back</span><span>${escapeHtml(cameBack)}</span></div>
        <div class="receiptPaper__row"><span>kept</span><span>${escapeHtml(kept)}</span></div>
        <div class="receiptPaper__rule" aria-hidden="true"></div>
        <div class="receiptPaper__status">&gt; ${escapeHtml(statusLabel)}</div>
      </div>
      <img class="receiptPaper__teeth" src="${CARD_DIR}/receipt-teeth.png" alt="" aria-hidden="true" />
    </div>
  `;
}

// 실제 receipt(state.receipts[i])에서 종이 필드를 뽑는다. main.js 의 receiptRows()가 이미
// 쓰는 것과 같은 원본 객체를 받는다 — 여기서 금액을 새로 계산하지 않는다.
//
// [A-348 §4] receipt 가 없다고 "came back empty"(빈손 귀환이라는 새 금융 결론)로 판정하던
// 것을 고쳤다 — receipt 객체가 없는 것은 "정보가 없다"는 뜻이지 "빈손으로 왔다"는 증거가
// 아니다(예: finishTrip 이 done + balance-unavailable 로 receipt 를 안 남기는 경우 — 실제로
// 확인된 결과가 전혀 아니다). 정보없음은 Unknown 으로만 표시하고, done/empty 같은 결과
// 딱지는 실제 receipt 증거가 있을 때만 붙인다. 날짜도 없는 값을 오늘 귀환처럼 채우지 않고
// "—" 로 둔다(§4). 실제 금융 판단/저장 로직 변경 0 — 이 함수는 읽기만 한다.
//
//   date      receipt.at(완료 시각) 가 있으면 그 날짜. 없으면 "—"(오늘로 채우지 않는다).
//   wentOut   출발 시각을 담는 필드가 현재 receipt 에 없다 — "—"(Unknown), 항상.
//   cameBack  receipt.at 을 시:분으로. 없으면 "—".
//   kept      "kept" 의 금융 의미(잔액이냐 이익이냐)가 현재 데이터로 확인되지 않는다 —
//             sent/after/gas 같은 다른 필드를 임의로 끌어다 채우지 않는다(A-346 §2). "—" 고정.
//   status    receipt 객체가 있으면(성공한 바퀴에서만 남는다 — main.js rememberReceipt 참조)
//             "done". 없으면 실제 결과를 모르는 것이므로 "Unknown"(§4) — "came back empty"
//             처럼 결과를 추론하지 않는다.
export function receiptPaperFields({ receipt = null, name = "Piggy" } = {}) {
  const empty = !receipt;
  const hasAt = !!(receipt && receipt.at);
  const at = hasAt ? new Date(receipt.at) : null;
  return {
    name,
    date: hasAt ? at.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—",
    wentOut: "—",
    cameBack: hasAt ? at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—",
    kept: "—",
    statusLabel: empty ? "Unknown" : "done",
    empty,
  };
}
