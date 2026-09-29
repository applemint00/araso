import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, parseEther, recoverMessageAddress } from "viem";
import { chogHomeMarkup, mountChogHome, CHOG_HOME_GEOMETRY, pairConvergenceEase } from "./chog-home.js";
import { chogInviteMarkup, mountChogInvite, CHOG_INVITE_GEOMETRY } from "./chog-invite.js";
import { createDepartPlayback, createDepartRenderer, loadDepartAssets } from "./piggy-depart.js";
import {
  buildPiggyMotionStateMap,
  PIGGY_MOTION_STATE,
  piggyMotionStateFromMap,
  resolvePiggyMotionState,
} from "./piggy-motion-state.js";
import { nameCardMarkup, mountNameCard } from "./name-card.js";
import { returnSceneMarkup, mountReturnView, RETURN_VIEW_GEOMETRY } from "./return-view.js";
import {
  homePaperMarkup,
  homePaperRecordsEntryMarkup,
  homeStatusFromScene,
  homeTimeNow,
  homeMoneyMarkup,
  homeMoneyPiggyRows,
  homeMoneyTotalsNote,
  fundingMethodsMarkup,
  amountChoices,
  amountChoiceMarkup,
  confirmButtonMarkup,
  homePiggyDetailMarkup,
  HOME_NOT_APPLICABLE_LABEL,
} from "./home-paper.js";
import { createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry } from "./piggy-registry.js";
import { CLAIM_RESULT, claimStatement } from "./gift-piggy-claim-link.js";
import {
  beginGiftClaim,
  bindGiftToNewPiggy,
  createGiftClaimSubmitter,
  GIFT_ENTRY_STATUS,
  isGiftBinding,
  readClaimFragment,
  settleGiftClaim,
} from "./gift-claim-entry.js";
import { giftValueLabel } from "./gift-value-spec.js";
import { createGiftRecordSource } from "./gift-record-source.js";
import { filterHistory, historyIdentityLabel, resolveHistorySelection } from "./history-filter.js";
import { issuePermission, authorize, consume, permissionNonce, cancel as cancelPermission, PERMISSION_STATE } from "./permission-envelope.js";
import {
  authRequestForPiggy,
  bindSigner,
  fundingTargetChallenge,
  prfSaltFromHex,
  selectionContext,
  switchSelection,
  verifyFundingTargetProof,
} from "./piggy-session.js";
import { admitModelAPiggy, loadMyPiggiesIndex, registerControlledPiggy, renameIndexedPiggy } from "./piggy-index.js";
import { recoverProductList } from "./gate-b-recovery.js";
import { listFundingMethods, startFunding, applyFundingResult, FUNDING_STATE } from "./funding-entry.js";
import { checkIntentFunding, fundingRequestForShortfall, resumeAfterFunding } from "./funding-intent-bridge.js";
import { buildFundingContext, validateFundingContext, scopeForChainId } from "./funding-context.js";
import { reconcileConfirmedFunding } from "./funding-reconcile.js";
import {
  decodeReceiptRow,
  encodeReceiptRow,
  receiptIdentityKey as codecReceiptIdentityKey,
  RECEIPT_KIND,
} from "./receipt-codec.js";
import { sendCardButtonMarkup, sendCardMarkup } from "./send-card.js";
import { receiptPaperMarkup, receiptPaperFields } from "./receipt-paper.js";
import { buildVisibleLaneChoices, runSecondJourney } from "./job-feed.js";
// [A-579] decision-time read-only observation seam (inactive while RETURN_EVIDENCE_READ_CONFIG is null).
import { readReturnObservation } from "./second-job-readiness.js";
import { commitSecondJourneyReceipt } from "./second-journey-receipt-bridge.js";
// [A-472] 개인화 학습은 **기존** updatePreference 를 그대로 쓴다 — 새 engine 0.
import { updatePreference } from "./job-selector.js";
import {
  applyExploreSelection,
  createSecondJourneyState,
  loadSecondJourneyState,
  saveSecondJourneyState,
  validatePersistenceScope,
  // [A-475] Send 전 이어쓰기 — 최소 draft 만.
  loadSecondJourneyDraft,
  saveSecondJourneyDraft,
  clearSecondJourneyDraft,
  // [A-579] action-0 decision Receipt → same Second Journey storage key / receipts array.
  recordSecondJourneyDecisionReceipt,
} from "./second-journey-state.js";
import {
  paperStatusCopy,
  readinessCardKind,
  secondJourneyCardMarkup,
  secondJourneyReceiptFields,
  secondJourneySendReason,
  validateSecondAmount,
  SECOND_ACTION_TITLES_EN,
  secondActionTitle,
} from "./second-journey-view.js";
import "./style.css";
// [A-540] confirmed HOME peek/+Piggy + multi-Piggy fold/expand packages — dropped in verbatim
// (<private>, <private>). CSS is
// imported here so vite bundles it with the rest of the app (no style.css value transplant).
import "./home-peek.css";
import "./home-paper-multi.css";
import { mountResidentPaper } from "./home-paper-multi.js";

const PASSKEY_STORAGE_KEY = "araso.passkey";
// rpId 이력: arasoapp.vercel.app (9/2 낮, 폐기) → arasoo.vercel.app (9/2 밤 재생성, 현재).
// 이후 변경 금지 — 바뀌면 기존에 등록된 패스키가 전부 못 찾는 상태가 된다.
const PRODUCTION_RP_ID = "arasoo.vercel.app";
const LOCAL_DEV_ENTRY = import.meta.env.MODE === "a172-local" && import.meta.env.VITE_ARASO_LOCAL_DEV_ENTRY === "1";
const LOCAL_DEV_RP_ID = import.meta.env.VITE_ARASO_LOCAL_DEV_RP_ID || "arasoapp.vercel.app";
const MONAD_TESTNET_RPC = "https://testnet-rpc.monad.xyz";
const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" },
  rpcUrls: {
    default: { http: [MONAD_TESTNET_RPC] },
  },
};
// 기본값 = 같은 origin 의 서버리스(`/api/grant`). 로컬 relayer 로 붙일 때만 VITE_RELAYER_URL 로 덮는다.
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL ?? "/api";
const SEND_AMOUNT = parseEther("0.001");
const SHMON_ADDRESS = "0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9";
const SHMON_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
];
const RECEIPTS_KEY = "araso.receipts";
const TRIP_CLOSED_KEY = "araso.tripClosed";
// [A-441] First Send 가 broadcast 한 뒤 결과가 확정되지 않은 동안의 최소 기록(민감정보 0 —
// stage·address·tx hash 만). 있으면 재탭·새로고침에서 새 서명/재제출 0(fail-closed).
const SEND_PENDING_KEY = "araso.sendPending";
const SEND_PENDING_STAGES = ["deposit-sending", "deposit-broadcast", "redeem-sending", "redeem-broadcast"];
// [A-377 §3] 보관은 전체 — 저장 cap 을 없앴다(옛 RECEIPT_KEEP=2).
// [A-460] 화면 쪽 "최근 3장만"(RECORDS_FOLDER_PREVIEW)은 **서류철 그림의 미리보기 장수**였고,
// HISTORY 가 텍스트 전용이 되면서 그 그림과 함께 사라졌다. 보관·열람은 전과 같이 전체다
// (recordsCardListMarkup() 이 state.receipts 를 전부 그린다). 상수는 쓰이지 않으므로 지웠다 —
// 값이 다시 필요해지면 그때 정본 근거와 함께 되살린다.

// --- 탄생 한 바퀴의 세 가지 사실 (A-292 번호 8) -------------------------
// 셋은 서로 다른 사실이라 각각 따로 기록한다. 하나로 묶으면 「이름은 아직인데
// 연출은 끝난」 중간 상태를 표현할 수 없다. WebAuthn 의 user 필드(`araso-owner`/`Araso`)와
// PASSKEY_STORAGE_KEY 는 이 셋과 무관하다 — 캐릭터 이름 저장소로 쓰지 않는다(§7).
const PIGGY_RECEIVED_KEY = "araso.piggyReceived"; // Piggy 받음 (패스키가 생겼다)
const PIGGY_NAME_KEY = "araso.piggyName"; // 이름 저장 완료 (빈 문자열 = 미완료)
// [A-462 Owner] Second 까지 끝낸 사실은 **영속한다** — 재방문/새로고침이면 조용한 Home 으로
// 돌아오고 Explore 자동재실행 0. 저장하는 것은 **완료 사실 boolean 하나뿐**이다: 선택/권한/금액
// 같은 Second 의 일시 상태는 저장하지 않는다(A-411-p 의 "세션 메모리" 결정은 이 판정으로 대체).
const SECOND_JOURNEY_CLOSED_KEY = "araso.secondJourneyClosed";
// [A-466 Owner] 결과(귀환/영수증) 모션은 **첫 한 번만 전체 재생**하고, 그 뒤부터 skip 을 보여준다.
// 단위는 Owner 문구 "결과 모션은 첫 번째만"의 최소 해석 — Journey 종류를 가리지 않고 이 저장소에서
// **첫 성공 결과 1회**다(First/Second 를 각각 1회로 늘리지 않는다). 저장은 boolean 하나뿐이고,
// Return 진입만으로는 서지 않는다 — File it 을 지나 Home 까지 정리한 뒤에 선다.
const RESULT_MOTION_SEEN_KEY = "araso.resultMotionSeen"; // "한 바퀴가 닫혔다" = TRIP_CLOSED_KEY 와 같은 어휘
const BIRTH_PLAYED_KEY = "araso.birthPlayed"; // 최초 연출 처리 (해치를 한 번 돌렸다)

function hasReceivedPiggy() {
  return localStorage.getItem(PIGGY_RECEIVED_KEY) === "1";
}

function readPiggyName() {
  return localStorage.getItem(PIGGY_NAME_KEY) || "";
}

function hasPlayedBirth() {
  return localStorage.getItem(BIRTH_PLAYED_KEY) === "1";
}

function displayPiggyName() {
  const name = readPiggyName().trim();
  return name || "Piggy";
}

const app = document.querySelector("#app");

// [A-387-a/b → A-389] render() 의 씬 분기(아래, 파일 끝의 큰 삼항식)가 실제로 다루는
// 이름의 전체 목록. 이 목록 밖 값은 전부 마지막 else 분기로 떨어진다 — 2026-09-03 최초
// 씬 배선 커밋(1102c18)부터 있던 "정해지지 않은 값의 기본값"이다. "birth" 는 여전히
// 실제 인증 실패 카드(renderAuthCard, 구 renderBirth — A-389 §1)의 씬 이름이다.
// 지금까지 실제 setScene() 호출과 computeInitialScene() 은 전부 이 목록 안의 값만 써
// 왔다 — 유일하게 검증 없이 임의 문자열을 받는 지점은 아래 window.__arasoScene()
// (DEV 전용 콘솔 도우미, 683783b 에서 도입 — 도입 때부터 지금까지 검증이 없었다) 뿐이었다.
// 그 지점만 이 목록으로 막는다.
const KNOWN_SCENES = [
  "received",
  "hatch",
  "name",
  "sendstay",
  "away",
  "return",
  "filebox",
  "explore",
  "secondAway",
  "secondReturn",
  "birth",
  // [A-389, Owner 승인 2026-09-18] "authfail" 은 실제 state.scene 값이 되지 않는다 — DEV
  // 콘솔 도우미(window.__arasoScene, import.meta.env.DEV 안에서만 존재)가 이 이름을
  // 실제 dispatch 로 넘기기 전에 가로채 "birth"(renderAuthCard, 승인 인증실패 카드)를
  // 표시 전용으로 미리보기한다. 목록에는 이 도우미의 기존 검증 게이트를 통과시키려고만
  // 올린다 — 실제 인증 호출·저장 쓰기·finishHatch·금융 호출은 전부 0 이다.
  "authfail",
];

// scene 은 credential/txHash 로부터 최초 1회 파생하고, 그 뒤로는 사용자 행동에 따라
// 명시적으로 전환한다(완전 파생이 아님 — away/filebox 전환은 진행 중인 네트워크 상태를 담아야 해서
// 이벤트 사실만으로는 부족하다).
function computeInitialScene(hasCredential, hasClosedTrip, hasAddress) {
  // 아무것도 없는 첫 방문 = Invite(Received). 그 전까지는 이 화면이 한 번도 뜨지 않았다 —
  // credential 이 없으면 곧장 Birth 로 보냈기 때문이다(2026-09-03 A-018 에서 발견).
  if (!hasCredential && !hasAddress) return "received";
  if (!hasCredential) return "birth";
  // 이름을 끝내지 않고 나간 사람은 Name it 으로 되돌아온다. 이때 Piggy 는 숨은 상태로
  // 기다리고 Save 로만 다시 나온다(A-288·A-290). 탄생 연출은 다시 돌지 않는다 —
  // 이미 한 번 처리됐기 때문이다(BIRTH_PLAYED_KEY).
  if (!readPiggyName()) return "name";
  // [A-411-p] 옛 "hasClosedTrip → filebox" 분기를 없앤다. Owner 확정(A-411-n §1):
  // First 가 끝난 뒤의 초기 재방문은 "정리된 서류철 화면"이 아니라 "Chog+Piggy 가 함께
  // Home 에 정착한 조용한 상태"다 — filebox 는 이제 방금 File it 한 직후에만 지나가는
  // 화면이고(mountReturn onOpenFilebox/onIdleEnter, 이 함수는 안 건드림), 새로고침/재방문의
  // 착지점이 아니다. hasClosedTrip 자체(=state.tripClosed)는 여전히 참이고 다른 곳에서
  // 그대로 쓰인다 — 여기서 scene 분기만 뺐다.
  return "sendstay";
}

function migrateTestMeraKeys() {
  const RENAMES = {
    "araso.testMera.passkey": "araso.passkey",
    "araso.testMera.receipts": "araso.receipts",
    "araso.testMera.address": "araso.address",
    "araso.testMera.mark": "araso.mark",
    "araso.testMera.txHash": "araso.txHash",
    "araso.testMera.prfSalt": "araso.prfSalt",
  };
  for (const [oldKey, newKey] of Object.entries(RENAMES)) {
    const value = localStorage.getItem(oldKey);
    if (value === null) continue;
    if (localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, value);
    }
    localStorage.removeItem(oldKey);
  }
}
migrateTestMeraKeys();

const state = {
  scene: "received", // 5장 중 1장 — 첫 진입
  message: "",
  detail: "",
  address: localStorage.getItem("araso.address") || "",
  mark: localStorage.getItem("araso.mark") || "",
  txHash: localStorage.getItem("araso.txHash") || "",
  grantTxHash: "",
  // settle() 이 만든 receipt 를 최근 것부터 2건. 세션 메모리가 아니라 저장소에 남는다 —
  // 2회차에서는 새 영수증을 받은 뒤에도 직전 바퀴를 다시 열어봐야 한다(A-015).
  receipts: readReceipts(),
  receiptIndex: 0,
  credential: readCredential(),
  awayLine: "I'll check it.",
  // 복구 연속 실패 횟수. 2회면 이 기기엔 되찾을 Piggy 가 없다고 본다.
  recoverFailures: 0,
  // [A-533 R1] 이 세션에서 새 기기 되찾기를 이미 한 번 시도했나(저장하지 않음).
  freshRecoveryTried: false,
  noPiggy: false,
  // 바퀴의 결말. "" = 아직 안 났다 · "done" · "failed". 사유는 tripReason 에 남긴다.
  tripOutcome: "",
  tripReason: "",
  // 「보냈다」(txHash)와 분리된 「이번 바퀴가 닫혔다」. 성공한 바퀴에서만 선다.
  // 옛 저장값에는 이 키가 없으므로 txHash 가 있으면 닫힌 것으로 본다(A-048 이관과 같은 다리).
  // [A-441] 단 미확정 Send 기록(SEND_PENDING_KEY)이 있으면 그 다리를 쓰지 않는다 — 확정 전 txHash 가
  // 닫힌 바퀴로 복구되지 않게(computeTripClosed).
  tripClosed: computeTripClosed({
    tripClosedFlag: localStorage.getItem(TRIP_CLOSED_KEY),
    txHash: localStorage.getItem("araso.txHash"),
    pending: readSendPending(),
  }),
  // 이름을 짓다 나갔다가 돌아온 진입인가. 그렇다면 Piggy 는 숨은 상태로 기다리고
  // Save 로만 다시 나온다(A-288). 해치에서 곧장 온 진입은 숨기지 않는다.
  // 「일반 대기에서 언제 숨길지」(시간)는 아직 정해지지 않았다 — 여기 넣지 않는다.
  nameResumed: false,
  // 다음 Home 렌더가 첫 도착 연출(확정 걷기 → 털썩)을 돌아야 하는가. 한 번 쓰고 꺼진다.
  homeArrival: false,
  // 씬 교체 직전 Piggy 그림의 화면 rect 와 그 순간의 포즈 사본. 걷기 출발점이고
  // 이번 전환에만 쓴다 — 저장소에 남기지 않는다.
  homeStartRect: null,
  homeStartPose: null,
  chogStartRect: null,
  // 출발 모션을 이번 away 진입에서 한 번만 돌릴지. 메모리 값이라 새로고침에 남지 않는다.
  departureArrival: false,
  // 귀환 연출 1회용 표. sendPiggy 와 달리 finishTrip 의 성공+영수증에서만 선다.
  returnArrival: false,
  // [A-413 §4] 작은 노란 알람 + "[실제 저장 이름] is coming home" 문구용 — 단수 실제
  // 귀환(finishTrip 성공+receipt)에서만 finishTrip() 이 세운다. 위 returnArrival 과
  // 일부러 분리한 값이다: returnArrival 은 mountReturn() 이 마운트되는 즉시 소비해서
  // "이번 진입에서 걷기 연출을 돌릴지"만 판정하고 꺼지지만, 이 문구는 그 순간이 아니라
  // return 씬이 실제로 화면에 떠 있는 동안(=파일링 완료 또는 씬 이탈까지) 유지돼야 한다
  // (mountReturn()/chogHomeMarkupForReturn 참고). 이름 자체는 여기 담지 않고 그릴 때
  // displayPiggyName() 을 그대로 다시 읽는다 — finishTrip() 소스는 app/test/return-outcome.mjs
  // 가 함수 본문만 잘라 최소 스텁 위에서 돌리므로(§그 파일 주석) displayPiggyName 처럼
  // 그 스텁에 없는 이름을 finishTrip 안에서 직접 부르면 그 격리 테스트가 깨진다 — 그래서
  // 여기는 불리언 표 하나만 세운다. 모의 인원/누적 Receipt 카운트/큐는 만들지 않는다.
  returnArrivalAlarm: false,
  // [A-354-b] 도착 즉시 큰 Send 카드가 캐릭터를 덮는 동작을 막는다(Owner 실측:
  // renderSendStay 의 중앙고정 SendCardStage 와 Home 판 fitHomeBoard() 축소가 서로 다른
  // 좌표계라 380×560 카드가 초그를 완전히 가림). Home 대기(Chog·HomeNotepad 만)와 Send
  // 표시를 이 플래그로 분리한다. 언제 true 로 세우는지(원문 "잠깐 대기 뒤 First
  // Journey")는 connected 참고본에도 send-card.js 범위 First Journey 카드에도 확정 수치가
  // 없다 — 새 대기 초수를 여기서 만들지 않는다(A-354-b 지시). 이번 라운드는 항상 false로
  // 시작하고 올리는 배선은 다음 라운드(send-card.js 변경) 몫이다. UNKNOWN 으로 보고.
  sendCardVisible: false,
  // [A-383 §1] Home 카드 오른쪽에 펼치는 기록 카드 — 별도 화면 전환이 아니라 같은
  // sendstay 렌더 안의 표시 상태다. recordsCardVisible 은 열림/닫힘, recordsDetailIndex
  // 는 null(목록) 또는 실제 state.receipts 인덱스(상세). 둘 다 메모리 값이다(저장 0).
  recordsCardVisible: false,
  // [A-484 Lane C] 오른쪽 HISTORY 가 보고 있는 Piggy. null = 기존 전체 기록 동작.
  historyPiggyId: null,
  // [A-486 Lane B] 돈 동작의 **의도(intent)** 상태. 여기 값이 있다고 실행된 게 아니다 —
  // 실제 실행은 권한 경계(Face ID/passkey) 뒤에 있고, 이 칸에서는 fork/하네스에서만 일어난다.
  moneyIntent: null, // { piggyId, action, amount, status: "choosing" | "awaiting_permission" }
  // [A-512 Gate C] 돈 동작의 **정본 선택** — { id, address } 하나. historyPiggyId 는 기록 보기 필터일 뿐이다.
  selectedPiggy: null,
  // [A-512] 지금 살아 있는 서명자 주소. state.address(한 마리 경로의 저장 scope)와 **다른 칸**이다.
  activeSignerAddress: "",
  // [A-522 B2a] `+ Piggy` 흐름 상태. 인증 제공자가 없으면 { status: "credential_model_required" } 에서 멈춘다.
  addPiggy: null,
  // [A-522] 방금 통제 증명과 함께 색인에 들어온 **추가** Piggy — Name it 저장이 이 id 를 이름 짓는다.
  pendingNamePiggyId: null,
  // [A-495 Lane B] 충전 흐름. 부족분에서 시작했으면 **원래 의도가 여기 실려 있다.**
  funding: null, // { state, intent, resumeAfter, shortfall }
  recordsDetailIndex: null,
  // [A-412 §1] 왼쪽 NOW 종이 내부 모드 — "home" | "money" | "piggyDetail". 세션 메모리
  // 값이라 저장소에 남기지 않는다(§forbidden "새 storage 스키마 0"). sendstay 가 아닌
  // 씬에서는 항상 "home"으로 취급한다(homePaperEffectiveMode) — 다른 씬으로 옮겨가면
  // setScene() 이 이 값을 다시 "home"으로 내린다(§383 recordsCardVisible 과 같은 자리 규율).
  homePaperMode: "home",
  // [A-412 §3] 실제 읽기 원천(publicClient/readShmonBalance) 조회 상태 — "idle" | "loading"
  // | "ready" | "error". 값 자체는 세션 메모리다. Money 모드를 열 때만 조회하고, 실패해도
  // 자동으로 wallet 연결/인증 재시도를 걸지 않는다(§forbidden) — 사용자가 같은 종이의
  // "다시 읽기" 버튼을 눌러야 재조회한다.
  homeMoneyStatus: "idle",
  homeMoneyNativeWei: null, // 집에 있는 실제 네이티브 MON 잔액(publicClient.getBalance)
  homeMoneyShmonWei: null, // Piggy 에게 맡긴/실제 나가 있는 shMON 잔액(readShmonBalance)
  homeMoneyErrorText: null,
  // [A-360] Second Journey — Explore/후보check/JIT/permission/amount/Send 진행 상태.
  // 메모리 값이다(§forbidden "fixture 결과는 메모리만"). 관심(interests)만 계정/체인
  // scope 가 유효할 때 second-journey-state.js 저장소로도 남는다(§5) — 그 외 필드
  // (선택 후보·amount·permission 체크)는 새로고침에 남지 않는다.
  secondJourney: createEmptySecondJourney(),
  // [A-411-p] Second Journey 를 이 세션에서 실제로 한 번 끝냈는가(finishSecondJourney()
  // 에서만 선다). 저장소에 새 스키마를 만들지 않는다(§금지) — 세션 메모리 표 하나뿐이다.
  // openSecondJourneyExplore() 의 candidates 직행 여부, settle() 의 자동 quiet→Paper
  // 억제(Owner "Second 완료: Explore 자동재실행 0")에 쓴다.
  secondJourneyCompletedOnce: localStorage.getItem(SECOND_JOURNEY_CLOSED_KEY) === "1",
  // [A-462] 위 값은 저장에서 복원되지만, **이번 세션에서 실제로 끝냈는가**는 따로 센다 —
  // 화면의 Journey 번호(buildSecondJourneyViewModel)가 새로고침으로 달라지지 않게 하려는 것뿐이다.
  secondCompletedThisSession: false,
  // [A-466] 첫 결과 모션을 이미 봤는가(저장에서 복원). skip 표시 여부만 정한다 — 금융 0.
  resultMotionSeen: localStorage.getItem(RESULT_MOTION_SEEN_KEY) === "1",
  // [A-411-p] "First Receipt filed → 정착 → 잠깐 조용 → Paper" 1회용 표. goHomeFromFilebox()
  // 와 아래 초기 scene 계산에서만 세우고, mountHome() 의 settle() 이 한 번 읽고 곧장 끈다
  // (기존 homeArrival/returnArrival 과 같은 1회용 transient 플래그 패턴 재사용 — 새 상태
  // 체계를 만들지 않는다). 이 값이 서 있어야만 자동으로 Explore 를 연다 — 그 밖의
  // sendstay 재진입(Send 실패 메시지 등)에서는 서지 않으므로 반복 강제 표시 0.
  homeQuietForExplore: false,
  // [A-389] birth 카드(구 renderBirth 자리 — 이제 renderAuthCard)의 표시 국면.
  // "checking"(진행 중, 버튼 없음) 이외에는 항상 "idle" — 문자열 파싱으로 국면을
  // 추측하지 않고 각 호출부가 명시적으로 세운다. authCancelled 는 직전 실패가
  // 진짜 WebAuthn 취소(cause.name === "NotAllowedError")였는지를 기록한다 —
  // 다음 시도가 그 값을 이어받지 않도록 매 호출부가 다시 세운다.
  authPhase: "idle",
  authCancelled: false,
  // [A-633 A] 앱 잠금(신원 확인만) — **메모리 값뿐**(저장 키·스키마 0). null = 잠기지 않음.
  // { phase: "waiting" | "checking" | "failed", cancelled } — 잠긴 동안 state.scene 은 풀린 뒤 갈 진짜
  // 목적지(Name/Home/Away)를 그대로 들고 있고, render() 가 그 위에 LOGIN_CHECKING 만 그린다(목적지 mount 0).
  appLock: null,
  // [A-633 C/D] 부팅 때 읽은 First Send 미확정 기록의 read-only 조회 표시(Away 의 Chog 머리 위 한 줄).
  // null | "checking" | "pending"(still out.) | "unknown"(can't tell yet.) — 메모리 값뿐.
  awayRestore: null,
};
state.scene = computeInitialScene(!!state.credential, state.tripClosed, !!state.address);
// 최초 진입이 곧장 Name it 이라는 것은 이름을 짓다 나갔다 왔다는 뜻이다.
state.nameResumed = state.scene === "name";
// [A-411-p] 초기 재방문도 실사용 흐름과 같은 정착→조용→Paper 를 타야 한다(Home next
// errand 버튼이 없어졌으므로 이게 First 완료/Second 미완료 사용자의 유일한 자연 진입로다).
// tripClosed 가 서 있고(First 끝남) 이 세션은 방금 시작했으니 secondJourneyCompletedOnce
// 는 항상 false — 조건은 사실상 "First 끝났고 scene 이 sendstay로 떨어졌는가"뿐이다.
// [A-462 Owner 판정] Second 를 이미 끝낸 사용자는 재방문해도 **조용한 Home** 이다 — 자동
// Explore 0. 이전에는 완료 표가 세션 메모리뿐이라 새로고침하면 항상 false 가 되어 정본
// ("Second 완료는 quiet Home", A-411-n §2/A-421)을 어겼다(A-461 Lane B 재현 g).
state.homeQuietForExplore = state.scene === "sendstay" && state.tripClosed && !state.secondJourneyCompletedOnce;

const publicClient = createPublicClient({
  chain: MONAD_TESTNET,
  transport: http(MONAD_TESTNET_RPC),
});

let activeSession = null;
let activeAccount = null;
let idleTimer = null; // [A-556] app-idle 만의 타이머 (10분) — 서명자 5분 절대 만료와 분리
let signerExpiryTimer = null; // [A-556] 서명자 5분 절대 만료 — activateSigningSession 이후로만 다시 잰다

function readCredential() {
  try {
    return JSON.parse(localStorage.getItem(PASSKEY_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

// receipt 의 금액은 BigInt 라 JSON 이 그대로 담지 못한다. 넣을 때 문자열로 눕히고 읽을 때 되세운다.
// [A-377 §3] 더 이상 slice 하지 않는다 — 전체를 읽는다(저장 cap 제거, RECEIPT_KEEP 폐기).
// [A-553 Lane B] 모양 판정·인코딩/디코딩은 receipt-codec.js 로 옮겼다(legacy shMON 줄은
// byte/의미 동일, add_money 줄은 `kind` 로 구분). 예전엔 이 map() 전체가 **하나의** try/catch
// 였다 — 한 줄이라도 깨지면(BigInt("undefined") 등) 이력 전체가 [] 로 사라졌다. legacy 줄은
// **그 안전장치를 그대로 지킨다**(반쯤 읽힌 목록에서 숫자를 그리지 않는다) — legacy 줄 decode 실패는
// 바깥 catch 로 올라가 전체 [] 다. **add_money 줄만** 따로 감싼다: add_money 줄 하나가 깨져도
// legacy 이력은 지워지지 않는다(§lane_b/AUDIT.md 버그 2 · A-553 리뷰 결함 1 수리).
function readReceipts() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    const rows = [];
    for (const row of stored) {
      if (row && row.kind === RECEIPT_KIND.ADD_MONEY) {
        try {
          rows.push(decodeReceiptRow(row));
        } catch {
          // 깨진 add_money 줄 하나만 건너뛴다 — legacy 이력은 지킨다.
        }
      } else {
        rows.push(decodeReceiptRow(row));
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function serializeReceiptRow(row) {
  return encodeReceiptRow(row);
}

// 실제 tx 증거로만 "같은 바퀴"를 판정한다 — 추측으로 서로 다른 바퀴를 합치지 않는다(legacy:
// redeemTxHash 우선, 없으면 txHash; add_money: 체인까지 포함 — receipt-codec.js 참조).
function receiptIdentityKey(receipt) {
  return codecReceiptIdentityKey(receipt);
}

// [A-377 §3] 전체 보관(cap 제거) + 반복 호출/탭이 같은 바퀴를 새 항목으로 또 쌓지 않게.
// finishTrip 은 정상 경로에서 트랜잭션당 한 번만 부르지만, 방어적으로 여기서도 막는다 —
// 실제 tx 식별자가 전체 이력 중 하나와 같으면 중복으로 보고 기존 항목을 그대로 둔다(값 없는
// receipt 는 항상 새로 쌓는다, 식별자가 없어 "같다"고 볼 근거가 없으므로).
function rememberReceipt(receipt) {
  const key = receiptIdentityKey(receipt);
  const existingIndex = key
    ? state.receipts.findIndex((r) => receiptIdentityKey(r) === key)
    : -1;
  if (existingIndex >= 0) {
    state.receiptIndex = existingIndex;
    return;
  }
  const kept = [receipt, ...state.receipts];
  state.receipts = kept;
  state.receiptIndex = 0;
  localStorage.setItem(RECEIPTS_KEY, JSON.stringify(kept.map(serializeReceiptRow)));
}

function writeCredential(credential) {
  localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(credential));
  state.credential = credential;
}

function getRpId() {
  return window.location.hostname;
}

function isProductionRpId() {
  return getRpId() === PRODUCTION_RP_ID;
}

function isLocalDevRpId() {
  return LOCAL_DEV_ENTRY && getRpId() === LOCAL_DEV_RP_ID;
}

function isAllowedPiggyRpId() {
  return isProductionRpId() || isLocalDevRpId();
}

// --- LOCAL_ONLY WebAuthn hook (A-463) ---------------------------------
// 하네스가 실제 Face ID 없이 create/get 한 바퀴를 돌려 보려면 Mera 의 `webAuthnClient`
// 자리에 가짜 client 를 꽂아야 한다. 그 구멍을 앱 소스에 내되, **세 겹으로 잠가** 둔다.
// 왜 이 경계인가:
//   ① LOCAL_DEV_ENTRY(=a172-local 모드 + VITE_ARASO_LOCAL_DEV_ENTRY=1)가 아니면 아예 없다.
//      production/default 번들에서는 전역이 있어도 무시되고 기존 browserWebAuthnClient 기본
//      경로 그대로다 — 기본 경로의 salt 동작도 건드리지 않는다.
//   ② rpId 가 격리 하네스 rpId 하나일 때만. 실제 사용자 도메인(PRODUCTION_RP_ID)은 물론
//      LOCAL_DEV_RP_ID 로도 열리지 않는다. 판정은 기존 isLocalDevRpId() 를 재사용한다.
//   ③ 모양이 Mera 의 WebAuthnClient 계약(createCredential/getCredential 둘 다 함수)에
//      안 맞으면 무시(fail-closed) — 반쯤 맞는 객체로 실제 경로를 망가뜨리지 않는다.
// secret 은 앱이 만지지 않는다. PRF/privateKey 는 하네스의 메모리 closure 안에만 있고,
// 앱은 주입된 client 를 Mera 에 **전달만** 한다.
const HARNESS_RP_ID = "araso-harness.local.test";
const LOCAL_TEST_WEBAUTHN_HOOK = "__ARASO_LOCAL_TEST_WEBAUTHN_CLIENT__";

function localTestWebAuthnClient() {
  if (!isLocalDevRpId()) return null;
  if (getRpId() !== HARNESS_RP_ID) return null;
  const hook = globalThis[LOCAL_TEST_WEBAUTHN_HOOK];
  if (!hook || typeof hook !== "object") return null;
  if (typeof hook.createCredential !== "function") return null;
  if (typeof hook.getCredential !== "function") return null;
  return hook;
}

// Mera 호출부에 스프레드로 얹는다. 잠금 중 하나라도 걸리면 빈 객체 →
// 옵션 자체가 없는 것과 같고, Mera 는 기본 browserWebAuthnClient 를 쓴다.
function localTestWebAuthnOption() {
  const client = localTestWebAuthnClient();
  return client ? { webAuthnClient: client } : {};
}

// create 경로만: 하네스가 같은 salt 로 두 번 돌려 같은 주소가 나오는지 보려면 salt 가
// 고정돼야 한다. 같은 hook 객체의 prfSalt 필드를, **32바이트일 때만** 쓴다. 없거나
// 길이가 다르면 옵션을 얹지 않는다 → Mera 기본 salt 그대로(기본 경로 불변).
function localTestPrfSaltOption() {
  const client = localTestWebAuthnClient();
  const salt = client?.prfSalt;
  if (!(salt instanceof Uint8Array) || salt.length !== 32) return {};
  return { prfSalt: salt };
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// [A-556 Owner bank-style session policy — supersedes A-533/A-555 S4 "행동마다 즉시 종료"]
// 서명자 상태 + 서명자 전용 5분 절대 타이머만 지운다. pending/영수증/history/scene 은 건드리지
// 않는다(카드 PHASE 1) — app-idle 타이머(idleTimer)도 여기서 손대지 않는다. "서명자만 끝내는
// 것"과 "앱을 잠그는 것"은 이제 서로 다른 사건이라서다.
function endSignerSession() {
  activeSession?.end();
  activeSession = null;
  activeAccount = null;
  state.activeSignerAddress = "";
  clearTimeout(signerExpiryTimer);
  signerExpiryTimer = null;
}

// [A-556] 앱을 실제로 잠그거나(app-idle 만료·beforeunload·dev reset) 지금 살아 있는 서명자가
// 더는 어느 것에도 속하지 않을 때(Piggy 전환, +Piggy/충전-통제 증명 파생 세션 정리, Gate C
// 선택-불일치)만 부른다 — endSignerSession() 에 app-idle 타이머까지 함께 지운다. 이 이름·계약은
// A-555 이전부터 이 호출자들이 기대해 온 그대로다 — 바뀐 건 sendPiggy 성공/실패마다 무조건
// 부르던 A-555 S4 호출 2곳이 없어졌고(PHASE 0), consumeMoneyPermission 이 더는 이걸 부르지
// 않는다는 것(PHASE 2) 뿐이다.
function endActiveSession() {
  endSignerSession();
  clearTimeout(idleTimer);
  idleTimer = null;
}

// [A-556] app-idle(10분)만 다시 잰다 — 서명자 5분 절대 만료(armSignerExpiry)는 여기서 늘리지
// 않는다(카드 PHASE 1: "normal action activity may refresh app idle, but MUST NOT extend
// signer absolute expiry"). 만료되면 여전히 서명자까지 정리하고(endActiveSession) 기존
// resting 문구로 돌아간다 — 옛 touchSession() 콜백과 동일, 새 문구 0.
function touchAppSession() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    endActiveSession();
    // [A-633 B] 모바일/app 표면만: 풀린 Home 을 잠금 화면처럼 남기지 않고 LOGIN_CHECKING 으로 잠근다.
    // 웹(641+)·지원되지 않는 origin 은 아래 기존 resting 동작 그대로다.
    if (lockAppAfterIdle()) return;
    if (state.scene !== "away") {
      setScene("sendstay", "Piggy is resting.", "Open again when you need it.");
    }
  }, 10 * 60 * 1000);
}

// [A-633 A/B] 앱 잠금이 걸리는 표면 = 모바일/app 표면(기존 ≤640 기준) + Piggy 가 실제로 인증할 수 있는
// origin. 웹(641+)은 지금 라우팅 그대로이고, 인증할 수 없는 origin 에는 풀 수단이 없으므로 잠그지 않는다
// (그 origin 에서는 돈 동작도 이미 막혀 있다). window 가 없으면(DOM 없는 하네스) 잠그지 않는다.
function appLockSurface() {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= 640 && isAllowedPiggyRpId();
}

// [A-633 B] app-idle 10분 만료(서명자는 이미 endActiveSession 으로 끝났다) → 잠금 표시.
// 목적지만 정한다: Away 는 그대로(진행 중 결과가 오면 그 결과를 따른다), 그 밖에는 이름이 없으면 Name,
// 있으면 기존 resting Home. 새 인증·서명자·타이머 0. 잠갔으면 true.
function lockAppAfterIdle() {
  if (!appLockSurface() || !state.credential) return false;
  if (state.scene === "received" || state.scene === "birth") return false;
  if (state.scene !== "away") {
    state.scene = readPiggyName() ? "sendstay" : "name";
    state.homePaperMode = "home";
    state.message = state.scene === "sendstay" ? "Piggy is resting." : "";
    state.detail = state.scene === "sendstay" ? "Open again when you need it." : "";
  }
  state.appLock = { phase: "waiting", cancelled: false };
  render();
  return true;
}

// [A-556] 서명자 5분 **절대** 만료 — activateSigningSession 이 새 인증을 세울 때만 다시 잰다.
// 그 사이 어떤 송금/활동도 이 타이머를 늘리지 않는다(카드 §2: "5 minutes is an absolute
// signer-session cap from successful auth; sending another transaction does NOT extend that
// cap"). 만료 콜백은 서명자만 끝낸다 — scene 전환·영수증·pending·history 는 그대로다.
function armSignerExpiry() {
  clearTimeout(signerExpiryTimer);
  signerExpiryTimer = setTimeout(() => {
    endSignerSession();
  }, 5 * 60 * 1000);
}

// [A-512] `persistAddress:false` = 서명자만 세우고 한 마리 경로의 저장 scope(state.address)는 건드리지 않는다.
// 기본값 true — First/Second 경로는 지금까지와 같다.
// [A-556] 성공한 인증 한 번 = 서명자 5분 절대 타이머를 다시 세우고(armSignerExpiry), app-idle
// 10분도 함께 새로 잰다(touchAppSession) — 카드 PHASE 1 "activateSigningSession() starts/
// replaces signer expiry and refreshes app idle".
function activateSigningSession(prfOutput, { persistAddress = true } = {}) {
  endActiveSession();
  activeSession = createSecp256k1SigningSession({ privateKey: prfOutput });
  activeAccount = toViemAccount(activeSession);
  const address = getEvmAddress(activeSession.publicKey);
  state.activeSignerAddress = address;
  if (persistAddress) {
    localStorage.setItem("araso.address", address);
    state.address = address;
  }
  armSignerExpiry();
  touchAppSession();
  return { account: activeAccount, address };
}

// [A-565 Owner 2026-09-24] "신뢰된 in-app tap/key 활동은 app-idle(10분) 창만 늘린다" — Continue
// 버튼·모달 0, 새 인증 0. 서명자 5분 절대 만료는 activateSigningSession/armSignerExpiry 로만
// 세워지고 여기서는 절대 부르지 않는다(카드 FORBIDDEN: "extending signer expiry from activity").
//
// "앱 세션이 살아 있다"의 기준 = activeSession/activeAccount(서명자) 가 아니라 **idleTimer 그
// 자체**다. endSignerSession() 은 signerExpiryTimer 만 지우고 idleTimer 는 그대로 둔다(위 주석) —
// 즉 서명자가 5분 만에 죽어도 app-idle 10분은 아직 안 끝났을 수 있고, 그 구간의 신뢰된 활동도
// 여전히 app-idle 을 늘려야 한다(Owner 결정: app 세션 잠금은 서명자와 별개 사건). activeSession
// 을 기준으로 게이트하면 서명자가 죽는 순간부터 활동이 더 이상 app-idle 을 늘리지 못해 이
// 결정과 어긋난다.
//
// 문턱(throttle): 10분 타이머를 tap/keydown 마다 다시 세우는 건 낭비고(clearTimeout+setTimeout
// 쌍이 매번 돎) 의미상 필요도 없다 — "10분 무입력" 판정은 마지막 재무장 이후 경과로만 정해지므로
// 문턱 안의 재무장을 건너뛰어도 idle 판정은 그대로다(카드: "semantics remain idle-based"). 숫자
// 자체는 정책이 아니라 여유값이며 10분/5분처럼 카드가 고정한 숫자가 아니다 — 15초로 잡는다(사람이
// 실제로 타이핑/스크롤하는 리듬보다 훨씬 짧아 "계속 쓰는데 안 늘어난다"는 체감은 없고, 초당 여러
// 번 오는 pointerdown/keydown 스트림을 그대로 재무장으로 옮기지 않는다).
const TRUSTED_APP_ACTIVITY_THROTTLE_MS = 15 * 1000;
let lastTrustedAppActivityAt = -Infinity; // 아직 한 번도 안 늘렸다 — 첫 활동은 절대 문턱에 걸리지 않는다

function handleTrustedAppActivity(event) {
  if (!event || event.isTrusted !== true) return; // 합성/스크립트 dispatch 는 무시
  if (idleTimer === null) return; // app-idle 이 지금 돌고 있지 않다(인증 전이거나 이미 잠김) — 아무것도 하지 않는다
  const now = Date.now();
  if (now - lastTrustedAppActivityAt < TRUSTED_APP_ACTIVITY_THROTTLE_MS) return;
  lastTrustedAppActivityAt = now;
  touchAppSession(); // app-idle(10분)만 다시 잰다 — armSignerExpiry/activateSigningSession/인증 호출 없음
}

// --- 씬 정리 (A-292 번호 9) --------------------------------------------
// render() 는 app.innerHTML 을 통째로 갈아끼운다. DOM 은 사라지지만 RAF·interval·
// timeout·window 리스너는 남아서 다음 씬 위에 계속 쓴다. 씬을 여는 쪽이 해제 함수를
// 여기 등록하고, 다음 render() 가 그걸 전부 실행한 뒤에 그린다.
let sceneCleanups = [];
// 씬이 바뀔 때마다 오른다. 비동기 콜백은 자기가 뜬 시점의 표를 들고 있다가
// 표가 다르면 아무것도 하지 않는다 — 취소된 씬의 뒤늦은 콜백이 다음 씬을 덮지 못하게.
let sceneToken = 0;

function onSceneTeardown(fn) {
  sceneCleanups.push(fn);
}

function teardownScene() {
  const pending = sceneCleanups;
  sceneCleanups = [];
  sceneToken += 1;
  for (const fn of pending) {
    try {
      fn();
    } catch {
      // 해제는 최선 노력이다. 하나가 실패해도 나머지는 계속 푼다.
    }
  }
}

// RAF 루프를 씬에 묶는다. 씬이 닫히면 다음 프레임이 예약되지 않는다.
function runSceneFrames(step) {
  let handle = 0;
  let stopped = false;
  const tick = (now) => {
    if (stopped) return;
    if (step(now) === false) return;
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  onSceneTeardown(() => {
    stopped = true;
    cancelAnimationFrame(handle);
  });
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}

function sceneTimeout(fn, ms) {
  const id = setTimeout(fn, ms);
  onSceneTeardown(() => clearTimeout(id));
  return id;
}

function sceneListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  onSceneTeardown(() => target.removeEventListener(type, handler, options));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setScene(scene, message = "", detail = "") {
  // [A-383 §4] "닫으면 원래 Home 그대로" — 기록 카드는 render() 를 부르지 않는 직접 DOM
  // 토글로만 열린다(openRecordsCard, §5 주석). 그래서 어떤 이유로든 씬을 다시 그리면
  // (Send/Stay 결과, 재방문 등) 기록 카드는 항상 닫힌 채로 새로 시작한다 — 다른 씬 전환에
  // 열린 채로 새는 경로를 만들지 않는다.
  // [A-628 A] 같은 정규화를 render() 도 부른다(아래 resetRecordsForFullRender 주석) — 여기 호출은
  // 그 공유 헬퍼 하나로 바뀌었을 뿐 동작은 같다.
  resetRecordsForFullRender();
  // [A-412 §1] Money/Piggy 상세는 sendstay 안의 내부 전환일 뿐이다 — 다른 씬으로 나가면
  // (Send/Stay 결과, 귀환, 재방문 등) 항상 닫힌 HOME 모습으로 새로 시작한다. 조회해 둔
  // 잔액(homeMoneyStatus 등)은 지우지 않는다 — 다시 Money 를 열면 그 값을 그대로 보여주고
  // 필요하면 사용자가 다시 읽는다.
  state.homePaperMode = "home";
  state.scene = scene;
  state.message = message;
  state.detail = detail;
  render();
}

// 이 바퀴에서 Name it 으로 딱 한 번만 넘어간다 — 해치가 끝나서든 건너뛰기를 눌러서든,
// 그리고 연속으로 눌러도 한 번이다. 넘어가는 순간 씬이 닫히면서 해치의 RAF 가 끊기고
// sceneToken 이 올라간다. 아직 날아오지 않은 해치 콜백은 자기 표가 달라 Name it 을 덮지 못한다.
let hatchExitToken = -1;

function finishHatch() {
  if (hatchExitToken === sceneToken) return;
  hatchExitToken = sceneToken;
  // 「최초 연출 처리」는 이름과 무관하게 여기서 닫는다 — 건너뛰어도 연출은 처리된 것이고,
  // 재방문에 다시 돌지 않는다. 인증·이름 저장을 생략하거나 자동 완료시키지는 않는다.
  localStorage.setItem(BIRTH_PLAYED_KEY, "1");
  setScene("name", "", "");
}

// Save 이중 클릭에 걷기·이동이 두 번 돌지 않는다. 자물쇠는 버튼이 아니라 여기 있다 —
// 키보드 Enter 도 같은 자물쇠를 지난다.
let nameSaveToken = -1;

function savePiggyName(event) {
  event?.preventDefault();
  if (nameSaveToken === sceneToken) return;
  const input = document.querySelector("#piggyNameInput");
  const name = (input?.value || "").trim().slice(0, 24);
  if (!name) {
    input?.focus();
    return;
  }
  nameSaveToken = sceneToken;
  const form = document.querySelector("#nameForm");
  if (form) form.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
  // [A-522 B2a] **추가** Piggy 의 이름 — 첫 Piggy 이름(PIGGY_NAME_KEY)·legacy id 를 건드리지 않는다.
  // Hatch/Birth 연출 없이 Home 으로 돌아가 새 주민 카드가 보인다.
  if (state.pendingNamePiggyId) {
    const id = state.pendingNamePiggyId;
    state.pendingNamePiggyId = null;
    try { renameIndexedPiggy(safeLocalStorage(), secondJourneyScope().chainId, { id, name }); } catch {}
    setScene("sendstay", "", "");
    return;
  }
  // 「이름 저장 완료」= 이 한 줄. Piggy 받음·최초 연출 처리와 별개로 기록한다(번호 8).
  localStorage.setItem(PIGGY_NAME_KEY, name);
  // [A-520] 이미 색인에 있는 그 Piggy 의 이름만 바꾼다(없으면 아무것도 등록하지 않는다).
  if (state.address) {
    try { renameIndexedPiggy(safeLocalStorage(), secondJourneyScope().chainId, { id: indexedPiggyId(state.address), name }); } catch {}
  }

  // Save 가 숨은 Piggy 를 꺼낸다(A-290). 현재 빌드는 hello 를 생략하고 바로 첫 Home 으로
  // 간다 — hello 자산은 보관본에 그대로 있고 지우지 않았다. 대기 시간을 재서 자동
  // 재생하라는 뜻이 아니다.
  const scene = document.querySelector("#nameScene");
  scene?.classList.remove("is-hidden");
  state.nameResumed = false;

  const token = sceneToken;
  const go = () => {
    if (token !== sceneToken) return;
    // 출발점은 **씬이 교체되기 직전**의 실제 모습이다. 620ms 등장 시간 동안 Name it 의
    // 파츠 애니는 계속 돌므로, 미리 잡아 둔 rect 는 그 사이에 낡는다(A-306 지적 2).
    // 승인 `flow.js startHome()` 과 같이 여기서 rect 와 computed pose 를 함께 동결한다.
    state.homeStartRect = null;
    state.homeStartPose = null;
    state.chogStartRect = null;
    // Chog 도 같은 Save 전환에서 같이 출발한다. 그래서 rect 를 같은 순간에 잡는다.
    // [A-608 OWNER CORRECTION — FREEZE ALL WEB] `.nameScene__chog`(A-607의 master-size 판)는
    // 이제 웹에서 display:none — 그 자리는 `.nameScene__chogWeb`(원래 웹 레퍼런스, 되살림)가
    // 대신 보인다. 어느 쪽이 실제로 보이는지(0이 아닌 rect)를 직접 확인해 그 쪽을 쓴다 —
    // 웹/좁은화면 어느 쪽이든 항상 "지금 화면에 실제로 있는" Chog를 잡는다.
    const chogCandidates = [
      document.querySelector(".nameScene__chogWeb"),
      document.querySelector(".nameScene__chog"),
    ];
    const chogArt = chogCandidates.find((el) => el && el.getBoundingClientRect().width > 0) || null;
    const cbox = chogArt?.getBoundingClientRect();
    if (cbox && cbox.width > 0 && cbox.height > 0) {
      state.chogStartRect = {
        left: cbox.left,
        top: cbox.top,
        width: cbox.width,
        height: cbox.height,
        bottom: cbox.bottom,
      };
    }
    const art = document.querySelector("#namePiggy .pgsvg");
    const box = art?.getBoundingClientRect();
    if (box && box.width > 0 && box.height > 0) {
      state.homeStartRect = {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        bottom: box.bottom,
      };
      // 지금 이 순간의 포즈를 그대로 복사한다 — 애니메이션을 끄고 계산된 값을 박아 넣어
      // 다음 씬에서도 같은 자세로 서 있게 한다. 새 SVG 파일을 만드는 것이 아니라
      // 화면에 있던 DOM 의 일시 사본이다.
      const clone = art.cloneNode(true);
      const from = [art, ...art.querySelectorAll("*")];
      const to = [clone, ...clone.querySelectorAll("*")];
      from.forEach((el, i) => {
        const cs = getComputedStyle(el);
        const t = to[i];
        if (!t) return;
        t.style.transform = cs.transform;
        t.style.transformOrigin = cs.transformOrigin;
        t.style.opacity = cs.opacity;
        t.style.animation = "none";
      });
      clone.removeAttribute("class");
      clone.removeAttribute("id");
      state.homeStartPose = clone;
    }
    // 첫 Home 도착이다 — 일하고 돌아오는 귀환이 아니다(§1).
    state.homeArrival = true;
    setScene("sendstay", "Piggy is home.", "");
  };
  // Piggy 가 다시 보이는 순간을 사용자가 보고 나서 이동한다. reduced-motion 이면 곧장.
  if (prefersReducedMotion()) go();
  else sceneTimeout(go, 620);
}

// [A-389] 취소인지 판정 — 추측이 아니라 실제 원인을 본다. @category-labs/mera 는
// PASSKEY_OPERATION_FAILED 하나로 취소/미지원/이상한 credential 을 모두 묶지만
// (dist/passkey.js MeraError("PASSKEY_OPERATION_FAILED", ..., { cause: error })),
// 원본 WebAuthn 예외를 cause 에 그대로 보존한다 — 브라우저가 사용자 취소·타임아웃에
// 쓰는 표준 DOMException 이름은 NotAllowedError 다(WebAuthn 레벨3). 이 신호가 없으면
// UNKNOWN 으로 두고(추론 금지) 일반 실패 문구로 보여준다.
function isCancelledAuthError(error) {
  if (!isMeraError(error)) return false;
  const cause = error.cause;
  return !!cause && typeof cause === "object" && cause.name === "NotAllowedError";
}

// [A-451] 거래·인증 실패의 기술 상세(RPC URL·요청 인자·raw tx·주소·value/data·credential)는 화면에
// 보내지 않는다(Owner "거래 관련은 모두 뒤에서, 카드에는 안 보여야"). 내부 증거는 이 한 건만 —
// 시각·단계·안전한 분류/코드 allowlist. 원문 메시지·스택·주소는 저장·console 0.
const LAST_SEND_ERROR_KEY = "araso.lastSendError";
function safeErrorCategory(error) {
  const name = error && typeof error.name === "string" ? error.name : "";
  return /^[A-Za-z]{1,48}$/.test(name) ? name : "Error";
}
function safeErrorCode(error) {
  const raw = error?.code ?? error?.cause?.code;
  const code = raw === undefined || raw === null ? "" : String(raw);
  return /^-?\d{1,6}$/.test(code) || /^[A-Z][A-Z0-9_]{0,39}$/.test(code) ? code : "";
}
function recordSafeError(phase, error) {
  const entry = { at: Date.now(), phase, category: safeErrorCategory(error), code: safeErrorCode(error) };
  try {
    localStorage.setItem(LAST_SEND_ERROR_KEY, JSON.stringify(entry));
  } catch {
    /* 저장 불가여도 화면 흐름은 그대로 */
  }
  return entry;
}

function formatError(error) {
  if (isMeraError(error)) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

// credential 을 넘기면 그 패스키 하나로 제한된다. 넘기지 않으면
// "WebAuthn may choose any discoverable credential for the relying party."
// (@category-labs/mera passkey.d.ts) → 브라우저가 이 rpId 의 기존 패스키를 고르게 한다.
// [A-512] `prfSalt` 가 있으면 **그 salt 로** 묻는다(기본 salt 로 조용히 바꾸지 않는다). 없으면 Mera 기본 salt.
function requestPrf(credential, { prfSalt = null } = {}) {
  return getPasskeyPrfOutput({
    rpId: getRpId(),
    ...(credential ? { credential } : {}),
    ...(prfSalt instanceof Uint8Array && prfSalt.length === 32 ? { prfSalt } : {}),
    timeout: 120_000,
    // LOCAL_ONLY. 잠금이 하나라도 걸리면 빈 객체다(위 localTestWebAuthnOption 주석).
    ...localTestWebAuthnOption(),
  });
}

// [A-512 N1] 태어날 때 저장한 salt 를 **다시 읽어** 같은 주소를 연다. 기본 salt 로 태어났다면
// 저장값이 곧 기본 salt 라서 결과가 같다(Mera: 기본 salt = sha256("mera.prf.salt.v1"), 버전 불변).
function storedPrfSalt() {
  try { return prfSaltFromHex(localStorage.getItem("araso.prfSalt") || ""); } catch { return null; }
}

// [A-520 Stream B1] 실제 인증이 **성공한 뒤에만** MY PIGGIES 비금융 색인에 적는다.
// 통제 증명 = 이번 인증으로 파생된 서명자 주소(state.activeSignerAddress) == 그 Piggy 주소.
// 추가 Face ID 0 · 서명 세션/권한/잔액을 만들지 않는다 · 실패해도 First 흐름을 막지 않는다.
// id 는 레지스트리의 한 마리 이주 id(`legacy-<주소>`)와 같게 둔다 — 같은 Piggy 를 두 이름으로 부르지 않기 위해서다.
function indexedPiggyId(address) {
  return `legacy-${String(address).toLowerCase()}`;
}

function indexControlledPiggy({ address, credentialId, transports = null, prfSaltHex = null }) {
  try {
    return registerControlledPiggy(safeLocalStorage(), secondJourneyScope().chainId, {
      id: indexedPiggyId(address),
      name: readPiggyName() || null,
      address,
      signerAddress: state.activeSignerAddress,
      locator: {
        credentialId,
        ...(Array.isArray(transports) && transports.length ? { transports } : {}),
        ...(prfSaltHex ? { prfSalt: prfSaltHex } : {}),
      },
      at: new Date().toISOString(),
    });
  } catch {
    return { ok: false, reason: "index_write_failed" };
  }
}

async function recoverPiggy() {
  const pinned = state.credential;
  const prfSalt = storedPrfSalt();
  let result;
  try {
    result = await requestPrf(pinned, { prfSalt });
  } catch (error) {
    // 저장된 credential 하나만 지정했다가 실패했다면 그 패스키가 이 기기에서 사라졌을 수 있다.
    // 지정을 빼고 딱 한 번 다시 묻는다. 둘 다 실패해야 throw —
    // 어느 경우에도 새 패스키를 만들지 않는다. localStorage 가 비어도 마찬가지다.
    const mayBeGone = isMeraError(error) && error.code === "PASSKEY_OPERATION_FAILED";
    if (!pinned || !mayBeGone) throw error;
    result = await requestPrf(null, { prfSalt });
  }
  // 어떤 패스키가 선택됐는지 기억해 둔다. 다음부터는 그 하나로 고정된다.
  // transports 는 assertion 결과에 없으므로(Result = credentialId + prfOutput)
  // 같은 credential 로 돌아왔을 때만 이어붙인다.
  const sameAsPinned = pinned?.credentialId === result.credentialId;
  writeCredential({
    credentialId: result.credentialId,
    ...(sameAsPinned && pinned.transports ? { transports: pinned.transports } : {}),
  });
  const { account, address } = activateSigningSession(result.prfOutput);
  // 저장 salt 로 열었으면 그 salt, 아니면 Mera 기본 salt(= locator 에 salt 필드 없음).
  indexControlledPiggy({
    address,
    credentialId: result.credentialId,
    transports: sameAsPinned ? pinned?.transports ?? null : null,
    prfSaltHex: prfSalt ? toHex(prfSalt) : null,
  });
  return { ...result, account, address };
}

function noteRecoverSuccess() {
  state.recoverFailures = 0;
  state.noPiggy = false;
}

// 연속 2회 실패 = 이 기기엔 되찾을 Piggy 가 없다고 본다. Birth 화면의 안내문을
// "already have a Piggy?" 대신 새로 만들라는 쪽으로 넌지시 돌린다. 자동 생성은 여전히 없다.
function noteRecoverFailure() {
  state.recoverFailures += 1;
  if (state.recoverFailures >= 2) state.noPiggy = true;
}

async function openPiggy() {
  if (!isAllowedPiggyRpId()) {
    // [A-389 §3] 지원되지 않는 origin — 실패/취소로 위장하지 않고 실제 이유(state.detail)를
    // 그대로 보여준다. 인증 호출 자체를 하지 않는다(불가능한 auth 호출 0).
    state.authPhase = "idle";
    state.authCancelled = false;
    // [A-407-f] 사용자 화면에 도메인/rpId/디버그 문자열을 남기지 않는다 — 열 수 없다는
    // 사실만 짧게. isAllowedPiggyRpId 판정·auth·금융 게이트·버튼 동작은 그대로이고,
    // 실패 원인 원문은 OUTBOX/내부 debug 에만 남긴다.
    setScene("birth", "Not from here.", "Piggy opens in the real app.");
    return;
  }

  state.authPhase = "checking";
  state.authCancelled = false;
  setScene("birth", "The egg is checking this device.", "Face ID may appear once.");

  // [A-579 Lane G] Gift 은 **시작 시점에** 이 생성 흐름에 묶인다 — 흐름이 도는 동안 다른 경로(checkPiggy 등)가
  // 같은 pending 을 가져가지 못한다. 묶일 수 있는 것은 **이 흐름이 방금 만든** Piggy 뿐이다(시작 전 주소 목록에
  // 없던 주소 + 그 주소의 살아 있는 서명자). 생성이 안 되면(취소·실패) pending 을 되돌려 놓는다.
  const giftIntent = takePendingGiftClaim();
  const giftPreExisting = giftIntent ? knownPiggyAddresses() : null;
  let giftAttempted = false;

  try {
    const result = await createPasskeyWithPrfOutput({
      rp: { id: getRpId(), name: "Araso" },
      user: { name: "araso-owner", displayName: "Araso" },
      timeout: 120_000,
      // LOCAL_ONLY. 둘 다 잠금이 걸리면 빈 객체 → 기존 경로·기본 salt 그대로.
      ...localTestWebAuthnOption(),
      ...localTestPrfSaltOption(),
    });

    const credential = {
      credentialId: result.credentialId,
      transports: result.transports,
    };
    const { address } = activateSigningSession(result.prfOutput);

    writeCredential(credential);
    localStorage.setItem("araso.prfSalt", toHex(result.prfSalt));
    localStorage.setItem(PIGGY_RECEIVED_KEY, "1");
    indexControlledPiggy({ address, credentialId: result.credentialId, transports: result.transports, prfSaltHex: toHex(result.prfSalt) });
    noteRecoverSuccess();
    // [A-559 PHASE S1 → A-579 Lane G] 방금 **새로 만든** Piggy 가 받는 사람의 Gift Piggy 다 — 시작 때 잡아 둔
    // intent 가 있을 때만 그 새 주소에 묶고(bindGiftToNewPiggy) 그 묶음으로만 claim 을 시도한다. 실패해도
    // 위의 First 흐름(탄생)을 되돌리지 않는다. scene 은 아래 분기가 그대로 정한다.
    if (giftIntent) {
      const bound = bindGiftToNewPiggy({ intent: giftIntent, piggy: { address }, preExistingAddresses: giftPreExisting, signerAddress: state.activeSignerAddress, requireSequence: false });
      if (bound.ok) {
        giftAttempted = true;
        // [A-579 repair N-1] beginGiftPiggy 와 같은 모양 — Gift settle 이 던져도 방금 만든 Piggy 를
        // "could not open" 으로 바꾸지 않는다. 실패는 기록만 한다(시도한 intent 는 되돌리지 않는다: 리뷰 N-2).
        try {
          lastGiftClaimSettlement = await settleBoundGiftClaim(bound.binding, giftIntent);
        } catch {
          lastGiftClaimSettlement = { status: "claim_settle_failed" };
        }
      } else {
        lastGiftClaimSettlement = { status: GIFT_ENTRY_STATUS.REFUSED, reason: bound.reason };
        restorePendingGiftClaim(giftIntent);
      }
    }
    state.authPhase = "idle";

    // 실제 인증이 성공한 뒤에만 탄생 연출이 돈다(A-292 번호 2). 연출은 성공 사실을
    // 만들지 않는다 — 이미 만들어진 사실 위에서 도는 것뿐이다. 실패는 아래 catch 로 가고
    // 거기서는 해치도 Home 도청하지 않는다.
    if (hasPlayedBirth()) {
      // 최초 1회만. 같은 기기에서 다시 왔다면 연출 없이 다음 칸으로.
      setScene(readPiggyName() ? "sendstay" : "name", "Piggy is home.", "");
    } else {
      setScene("hatch");
    }
  } catch (error) {
    // [A-579 Lane G] 새 Piggy 에 claim 을 시도하기 전에 끝났다 — Gift intent 는 사라지지 않는다.
    if (giftIntent && !giftAttempted) restorePendingGiftClaim(giftIntent);
    state.authPhase = "idle";
    state.authCancelled = isCancelledAuthError(error);
    recordSafeError("open", error);
    setScene("birth", "Piggy could not open here.", "");
  }
}

// [A-389] 이미 Piggy 를 받은 기기에서 다시 Face ID 를 눌러도 새 패스키를 만들지 않는다 —
// 옛 renderBirth() 는 이 조건일 때 Open 버튼 자체를 숨겨서 막았다(2026-09-02 주소 3개
// 사고). 그 버튼 껍질은 지웠지만 판정 로직은 그대로 여기로 옮긴다 — Try again 이 이
// 조건에 걸리면 새로 만들지 않고 기존 Check Piggy 복구로 대신한다.
// [A-533 Lane A · R1] **새 기기에서는 만들기 전에 먼저 찾는다.**
// 로컬 표시(credential·받음·주소)가 하나도 없으면 첫 시도는 되찾기(checkPiggy — 생성 폴백 0)다.
// 되찾기가 실패하면(취소 포함 — iOS 는 "없음"과 "취소"를 같은 NotAllowedError 로 준다) 기존
// "Couldn't find your Piggy." 화면으로 가고, 사용자가 **다시 여는 것**이 새 Piggy 를 만드는 명시적 선택이다.
// 모호한 실패 뒤 자동 생성 0. 같은 기기 반복 동작(A-389)은 그대로. 이것이 기기 간 동기화를 풀지는 않는다.
// 비용: 완전 신규 사용자도 만들기 전에 시스템 패스키 시트를 한 번 본다 — Owner 결정 항목(A-533 gate).
const FRESH_DEVICE_RECOVERY_FIRST = true;

// [A-554] Gate B 추가 Piggy 순번 목록 복원 — **제품 기본값은 없음**. 원격 저장소 위치/조회
// 키/프라이버시/인증(rate-limit)은 진짜 OWNER_GATE 다 — 여기서 고르지 않는다. adapter 가
// null 인 한 checkPiggy 는 오늘과 정확히 같다(추가 requestPrf 0, 전역 debug hook 0).
// 실제 원격 어댑터를 연결하는 것은 이 상수 값을 바꾸는 별도의 명시적 빌드 결정이다.
const INDEX_BACKUP_ADAPTER = null;

// [A-559 PHASE S1 / A-562 LANE C] Gift claim 진입 seam. **제품 기본값은 여전히 없음(unavailable)**.
// A-562 는 A-559 의 durable-record blocker를 "레코드 원천 아키텍처 없음"에서 "검증된 배포/설정
// 없음"으로 좁히려고 읽기 전용 온체인 adapter(`gift-record-source.js`)를 새로 추가했지만, 그
// adapter 를 실제로 켜려면 **검증된 chain scope + 검증된(배포된) GiftPiggyUSDC contract address**
// 가 둘 다 있어야 한다 — 둘 다 아직 없다(GiftPiggyUSDC.sol 은 로컬 forge 증명일 뿐, 어디에도
// 배포되지 않았다). `GIFT_RECORD_CONFIG` 가 그 자리다: 지금은 `null` 이고, 값이 채워지기 전까지는
// 아래 `GIFT_RECORD_SOURCE` 는 오늘과 똑같이 `null` 이다. 값을 채우는 것은 A-554
// `INDEX_BACKUP_ADAPTER`/이 파일의 기존 `GIFT_RECORD_SOURCE = null` 과 같은 패턴의, 별도의 명시적
// 빌드 결정이다(실제 배포 주소가 생긴 뒤에만). 전역 debug hook 은 만들지 않는다(예:
// window.__arasoGiftRecordSource 같은 것 0) — 값을 바꾸려면 이 줄 자체를 고친다.
const GIFT_RECORD_CONFIG = null; // e.g. { chainScope: "monad-testnet", contractAddress: "0x..." } — 검증된 값이 생기기 전까지 null.

// `publicClient` 는 이 파일이 이미 만들어 쓰는 그 하나뿐이다(§397) — 이 seam 을 위해 새 client/
// RPC/provider 를 고르지 않는다. 체인이 실제로 맞는지는 adapter 자신이 매 호출마다
// `scopeForChainId(client.chain.id)` 로 다시 확인한다(main.js 의 다른 fail-closed 체인 바인딩과
// 같은 패턴, §3821) — 여기서는 설정값의 모양만 본다.
const GIFT_RECORD_SOURCE = GIFT_RECORD_CONFIG
  ? createGiftRecordSource({
      client: publicClient,
      chainScope: GIFT_RECORD_CONFIG.chainScope,
      contractAddress: GIFT_RECORD_CONFIG.contractAddress,
    })
  : null;

// [A-579 Lane G] Gift commit→claim **제출** seam — 제품 기본값은 없음(null). 켜려면 검증된 chain transport
// (읽기 + 서명된 raw tx 전달) 와 **별도의** 보내는 쪽 gas allowance(deliver 만) 와 배포된 escrow 주소, 측정된
// gas units 가 모두 있어야 한다 — 아무것도 아직 없다(GiftPiggyUSDC 미배포, A-577 은 로컬 fork 증거). 레코드
// 원천(GIFT_RECORD_CONFIG)이 없으면 이것도 만들지 않는다. debug hook 0 — 값을 바꾸려면 이 줄 자체를 고친다.
const GIFT_CLAIM_SUBMIT_CONFIG = null; // e.g. { chain, gasDelivery, chainScope, escrowAddress, gasUnits, safety, readFeeInputs } — 검증된 값이 생기기 전까지 null.
const GIFT_CLAIM_SUBMITTER = GIFT_CLAIM_SUBMIT_CONFIG && GIFT_RECORD_CONFIG
  ? createGiftClaimSubmitter(GIFT_CLAIM_SUBMIT_CONFIG)
  : null;

// 부팅 시 fragment 를 한 번 읽어 두는 자리(아래 boot 코드, 첫 render() 앞)만 채우는 순수 메모리
// 값 — state 도 아니고 저장도 하지 않는다(새로고침/재부팅에 남지 않는다). 실제 claim 시도는
// [A-579] 새 Gift Piggy 를 만드는 흐름(openPiggy·beginGiftPiggy)이 시작에서 꺼내(takePendingGiftClaim) 그 새
// Piggy 에 묶은 뒤에만 settleBoundGiftClaim() 이 한다 — 이 선언 자체는 아무 것도 하지 않는다.
let pendingGiftClaim = null;
// 테스트 관찰용(렌더되지 않는다) — settleBoundGiftClaim() 이 마지막으로 낸 결과.
let lastGiftClaimSettlement = null;

// [A-579 Lane G] Gift intent 는 **새 Piggy 를 만드는 흐름의 시작**에서 꺼낸다(메모리만 — 저장 0). 흐름이
// 끝까지 가서 그 새 Piggy 에 묶이면 소비되고, 못 가면 restorePendingGiftClaim 으로 되돌린다.
// 되찾기(checkPiggy)·평범한 +Piggy(beginAddPiggy) 는 이것을 꺼내지 않는다 — 기존 Piggy 에 Gift 가 붙는 길 0.
function takePendingGiftClaim() {
  const claim = pendingGiftClaim;
  pendingGiftClaim = null;
  return claim;
}
function restorePendingGiftClaim(claim) {
  if (claim && !pendingGiftClaim) pendingGiftClaim = claim;
}
// 흐름 시작 **전에** 이 기기가 이미 아는 Piggy 주소들 — 여기 있던 주소에는 Gift 가 묶이지 않는다.
function knownPiggyAddresses() {
  const out = new Set();
  if (state.address) out.add(String(state.address).toLowerCase());
  for (const p of indexedResidents()) if (p?.address) out.add(String(p.address).toLowerCase());
  try {
    for (const p of loadRegistry(safeLocalStorage(), secondJourneyScope()).registry.piggies) if (p?.address) out.add(String(p.address).toLowerCase());
  } catch {
    /* 레지스트리 읽기 실패 — 색인·state 만으로 판단 */
  }
  return out;
}

// [A-559 PHASE S1 / A-563 LANE B] fragment 의 토큰이 브라우저 히스토리·주소창에 남지 않게 한다.
// `history`/`location` 이 없으면(예: DOM 없는 하네스) 조용히 건너뛴다 — 실패해도 claim 시도 자체를
// 막지 않는다. [A-563] 부팅 시 pendingGiftClaim 을 메모리에 채우는 그 즉시(아래 boot 코드) 딱 한 번
// 불린다 — 인증 성공을 기다리지 않는다: 인증 전까지 원문 토큰이 주소창에 그대로 떠 있는 잔여
// 노출 구간을 없애는 것이 이 레인의 목적이다. pendingGiftClaim 자체(메모리 값)는 이 호출로 지워지지
// 않는다 — 새 Gift Piggy 흐름(settleBoundGiftClaim)이 인증 성공 뒤 여전히 그 값을 쓴다.
function stripClaimFragmentFromUrl() {
  try {
    if (typeof history !== "undefined" && typeof location !== "undefined") {
      history.replaceState(null, "", location.pathname + location.search);
    }
  } catch {
    /* no-op */
  }
}

// [A-559 PHASE S1 → A-579 Lane G] **새로 만든 Gift Piggy 에 묶인(binding) 뒤에만** 부른다 — openPiggy(첫 탄생)
// 와 beginGiftPiggy(모델 A 새 Piggy) 두 곳뿐이다. checkPiggy(되찾기)·beginAddPiggy(평범한 +Piggy)는 부르지 않는다
// (A-566 오배정 수리). binding 은 gift-claim-entry.js 가 만든 것이어야 하고(isGiftBinding), 받는 주소는
// 호출자가 넘기는 값이 아니라 **binding 의 주소**다. record source 가
// 없으면(제품 기본값 — GIFT_RECORD_SOURCE = null) beginGiftClaim() 자신이 정확히
// `record_source_unavailable` 을 돌려준다 — 여기서 그 경우를 앞질러 삼키지 않는다, 그래야
// "어떤 정확한 이유로 멈췄는지"가 호출자/테스트에 그대로 보인다. 어느 경우든 Piggy 생성/인증은
// 이미 호출자가 끝냈고, 이 함수는 그 위에 claim 만 덧붙인다. 실패해도 방금 만든 Piggy 를
// 되돌리지 않는다(claim 은 부가 행동이다).
//
// 이 함수는 **새 서명자를 세우지 않는다** — 방금 그 인증이 이미 활성화한 서명자(activeAccount)를
// 그대로 쓴다. `proveFundingTargetControl`(위, §3780)은 그 helper **전용으로** 짧은 서명자를 열고
// 끝내지만, 여기는 그 패턴이 아니다: 이미 살아 있는, 사용자의 "정상" 서명자를 대신 쓰는 것이므로
// 그 세션을 여기서 끝내면(endSignerSession) 이 claim 시도 하나가 사용자의 방금 성공한 인증을
// 조용히 무효화하는 부작용이 생긴다 — 필요 없이 죽이지 않는다(카드 지시, 결정 문서화). 그 서명자의
// 수명은 여전히 A-556 정책(5분 절대 만료·app-idle·Piggy 전환·beforeunload)이 그대로 관리한다.
async function settleBoundGiftClaim(binding, claim) {
  // [A-579 Lane G] 이 모듈이 만든 binding 만, 그 binding 의 giftId 와 같은 intent 만.
  if (!isGiftBinding(binding) || !claim || claim.giftId !== binding.giftId) return { status: "binding_invalid" };
  const recipientAddress = binding.recipientAddress;
  // [A-563 LANE B] 여기서 다시 stripClaimFragmentFromUrl() 을 부르지 않는다 — pendingGiftClaim 은
  // 오직 부팅 코드(아래, readClaimFragment 직후) 한 곳에서만 채워지고, 그 코드가 채우는 그 자리에서
  // 이미 한 번 불렀다(이 함수가 호출되는 시점엔 주소창이 이미 지워져 있다). 여기서 또 부르면
  // replaceState 가 같은 부팅에 필요 없이 두 번 실행된다 — 그래서 뺀다(카드 지시: "twice needlessly"
  // 금지). malformed/no-fragment 경로는 pendingGiftClaim 이 애초에 null 이라 이 함수가 끝까지
  // 오지도 않는다 — strip 자체가 없다(변경 없음).
  const opened = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: claim.giftId, token: claim.token },
    recordSource: GIFT_RECORD_SOURCE,
    now: new Date().toISOString(),
  });
  if (opened.status !== GIFT_ENTRY_STATUS.READY) {
    // openClaimLink (inside beginGiftClaim) cannot yet tell "the same recipient reopening
    // their own already-claimed link" from "a stranger replaying it" — it doesn't know who
    // is asking. Now that a real recipient identity exists, make exactly that one further
    // distinction against the record it already fetched, reusing settleClaim's own
    // ALREADY_CLAIMED_BY_SAME constant (no new status invented).
    if (opened.status === GIFT_ENTRY_STATUS.REFUSED
      && opened.reason === CLAIM_RESULT.ALREADY_CLAIMED_BY_OTHER
      && opened.record
      && String(opened.record.recipientAddress || "").toLowerCase() === String(recipientAddress || "").toLowerCase()) {
      return { status: GIFT_ENTRY_STATUS.REFUSED, reason: CLAIM_RESULT.ALREADY_CLAIMED_BY_SAME, giftId: opened.giftId };
    }
    return opened;
  }
  if (!activeAccount) return { status: "no_active_signer" };
  // [A-579 Lane G] 살아 있는 서명자가 바로 그 새 Gift Piggy 여야 한다 — 다른 Piggy 의 서명자로 대신 받지 않는다.
  if (String(activeAccount.address || "").toLowerCase() !== String(recipientAddress).toLowerCase()) return { status: "signer_not_bound" };
  const claimedAt = new Date().toISOString();
  let signature;
  try {
    // [A-560 PHASE 4] 값 필드는 opened.record.value(레코드 자신, `openClaimLink`가 이미 검증해
    // 돌려준 것)에서만 온다 — 화면/URL/다른 어떤 입력도 여기서 금액을 대신하지 못한다. 레거시
    // identity-only Gift는 opened.record.value === null 이라 문장이 A-495/A-499 와 그대로 같다.
    signature = await activeAccount.signMessage({
      message: claimStatement({
        giftId: opened.record.giftId,
        chainId: opened.record.chainId,
        senderAddress: opened.record.senderAddress,
        recipientAddress,
        claimTokenHash: opened.record.claimTokenHash,
        claimedAt,
        tokenAddress: opened.record.value?.tokenAddress ?? null,
        decimals: opened.record.value?.decimals ?? null,
        amountAtomic: opened.record.value?.amountAtomic ?? null,
      }),
    });
  } catch {
    return { status: "sign_failed" };
  }
  const settled = await settleGiftClaim({
    record: opened.record,
    token: claim.token,
    recipientAddress,
    signature,
    recover: ({ message, signature: sig }) => recoverMessageAddress({ message, signature: sig }),
    claimedAt,
  });
  // [A-560 PHASE 4] 영수증/테스트가 identity_claimed_no_value_moved 와 value_transferred(그리고
  // 이 카드가 더한 legacy/pending)를 섞지 않도록, 진짜 트랜스퍼 영수증이 없으면 절대
  // value_transferred 라 말하지 않는 라벨을 결과에 얹는다(`giftValueLabel`은 record.transfer의
  // 실제 상태만 본다 — 여기서 지어내지 않는다).
  if (!settled || !settled.record) return settled;
  if (settled.result !== CLAIM_RESULT.OK) return { ...settled, valueLabel: giftValueLabel(settled.record) };
  // [A-579 Lane G] 온체인 commit→claim 제출. 제품 기본값(GIFT_CLAIM_SUBMITTER = null)은 정확한 이유로 멈춘다 —
  // value_pending 그대로(가짜 transfer 0). 제출기가 있으면 그 새 Gift Piggy 서명자로만, binding 주소로만 낸다.
  if (!GIFT_CLAIM_SUBMITTER) {
    return { ...settled, valueLabel: giftValueLabel(settled.record), valueSubmission: { status: "claim_transport_unavailable" } };
  }
  let submission;
  try {
    submission = await GIFT_CLAIM_SUBMITTER.submit({ binding, record: settled.record, token: claim.token, account: activeAccount });
  } catch {
    submission = { status: "claim_submit_failed" };
  }
  const record = submission?.record || settled.record;
  return {
    ...settled,
    record,
    valueLabel: giftValueLabel(record),
    valueSubmission: { status: submission?.status || "claim_submit_failed", ...(submission?.txHashes ? { txHashes: submission.txHashes } : {}) },
  };
}

async function startPiggyOpen() {
  if (readCredential() || hasReceivedPiggy() || state.address) {
    return checkPiggy();
  }
  if (FRESH_DEVICE_RECOVERY_FIRST && !state.freshRecoveryTried) {
    state.freshRecoveryTried = true;          // 세션 메모리만 — 저장하지 않는다
    return checkPiggy();
  }
  return openPiggy();
}

async function checkPiggy() {
  if (!isAllowedPiggyRpId()) {
    state.authPhase = "idle";
    state.authCancelled = false;
    // [A-407-f] 같은 기준 — 되찾기도 여기서는 불가능하다는 사실만.
    setScene("birth", "Not from here.", "Piggy can only be found again in the real app.");
    return { ok: false, cancelled: false, reason: "rp_not_allowed" };
  }

  // 생성 폴백 없음 — 이 버튼은 절대 새 패스키를 만들지 않는다.
  state.authPhase = "checking";
  state.authCancelled = false;
  setScene("birth", "Chog is checking if this is the same Piggy.", "Face ID may appear once.");

  try {
    await recoverPiggy();
    // [A-579 Lane G] 되찾은 Piggy 는 **이미 있던** Piggy 다 — Gift 는 새 Gift Piggy 에만 묶인다(A-567 canon).
    // 그래서 여기서는 claim 을 시도하지 않고 pendingGiftClaim 을 건드리지도 않는다(메모리에 그대로 남는다).
    // [A-554] R1(위 recoverPiggy) 이 이미 성공했다 — 그 위에서만, adapter 가 실제로 설정된
    // 경우에만 추가 Piggy 순번 목록 복원을 시도한다. adapter 가 없으면(제품 기본값) 이 블록은
    // 통째로 건너뛴다 — 오늘까지의 정확한 동작, 추가 requestPrf 0. 실패해도 위의 root 복구
    // 성공을 무효로 만들지 않는다(best-effort, 조용히 삼킨다 — 사용자 화면·씬은 그대로).
    if (INDEX_BACKUP_ADAPTER) {
      try {
        await recoverProductList({
          adapter: INDEX_BACKUP_ADAPTER,
          storage: safeLocalStorage(),
          chainId: secondJourneyScope().chainId,
          rootCredential: state.credential,
          requestPrf: (credential, prfSalt) => requestPrf(credential, { prfSalt }),
          // beginAddPiggy 와 같은 유일한 raw-signer 경로(activateSigningSession)를 그대로
          // 쓴다 — main.js 에 새 createSecp256k1SigningSession 호출부를 만들지 않는다
          // (local-test-hook-guard.mjs 의 "raw private-key signer 신설 0" 불변식).
          deriveAddress: (prfOutput) => activateSigningSession(prfOutput, { persistAddress: false }).address,
          locks: webLocks(),
        });
      } catch {
        /* best-effort — 루트 Piggy 는 이미 되찾았다 */
      } finally {
        // 후보마다 activateSigningSession 을 거치므로 방금 recoverPiggy() 가 세운 루트 활성
        // 세션이 마지막 후보의 것으로 바뀌어 있을 수 있다 — beginAddPiggy 와 같은 이유로
        // (통제 증명 뒤 세션은 쓸 데가 없다) 여기서 통째로 정리한다. Gate C 는 활성 세션이
        // 없으면 다음 money 동작에서 새로 Face ID 를 묻는다 — 틀린 서명자로 조용히 남는 것보다 안전하다.
        endActiveSession();
      }
    }
    noteRecoverSuccess();
    localStorage.setItem(PIGGY_RECEIVED_KEY, "1");
    state.authPhase = "idle";
    // 복구는 신규 탄생이 아니다 — 해치·hello 를 다시 재생하지 않는다(§7 checkPiggy 행).
    // 다만 이름이 아직 없으면 그 칸만 마저 채운다. 그때 Piggy 는 숨은 상태다(A-288).
    if (!readPiggyName()) {
      setScene("name", "", "");
    } else {
      setScene("sendstay", "Piggy is home.", "Same place, same Piggy.");
    }
    return { ok: true };
  } catch (error) {
    noteRecoverFailure();
    state.authPhase = "idle";
    state.authCancelled = isCancelledAuthError(error);
    // [A-389-a] 복구 실패는 짧고 구분되는 원인만 보여준다 — cancelled 는 renderAuthCard 가
    // "Face ID was cancelled."로 따로 가로챈다(authCancelled). 그 외(NotFound 등)는 원본
    // 기술 에러 문자열(formatError) 대신 이 짧은 문구를 쓴다. 두 버튼 다시 보이는 것은
    // authPhase="idle" 복귀만으로 충분(§actions checking 게이트, 새로 disabled 걸지 않음).
    setScene("birth", "Chog could not find Piggy here.", "Couldn't find your Piggy.");
    return { ok: false, cancelled: state.authCancelled };
  }
}

// [A-633 A] LOGIN_CHECKING 잠금 해제 = **신원 확인만**. recoverPiggy()/checkPiggy() 를 쓰지 않는다 — 그 둘은
// 서명 세션을 연다(activateSigningSession). 여기서는:
//   · 사용자의 Chog 탭(신뢰된 click) 핸들러 안에서 **곧장** requestPrf 를 부른다 — 그 앞에 await·render·
//     타이머 0(Invite 의 5.9s 지연 패턴을 쓰지 않는다). 부팅 때 저절로 부르지 않는다.
//   · 저장된 credential **하나로만** 묻는다(생성 폴백 0 · 고정 해제 재시도 0 — 다른 패스키는 다른 주소다).
//   · 돌아온 credentialId 가 저장된 그 id 와 같을 때만 풀린다. PRF 출력(=서명 재료)은 판정 직후 0 으로
//     지우고 어디에도 넘기지 않는다: activateSigningSession·createSecp256k1SigningSession·armSignerExpiry·
//     activeSignerAddress·permission envelope 0. 풀리면 기존 app-idle 10분(touchAppSession)만 시작한다.
//   · 돈 동작은 여전히 자기 Face ID/서명 경계(sendPiggyOnce → recoverPiggy 등)를 따로 지난다.
function unlockApp() {
  const lock = state.appLock;
  if (!lock || lock.phase === "checking") return;
  const pinned = state.credential;
  if (!pinned || typeof pinned.credentialId !== "string" || !pinned.credentialId || !isAllowedPiggyRpId()) {
    settleUnlock(null, null, pinned);
    return;
  }
  lock.phase = "checking";
  lock.cancelled = false;
  requestPrf(pinned, { prfSalt: storedPrfSalt() }).then(
    (result) => settleUnlock(result, null, pinned),
    (error) => settleUnlock(null, error, pinned),
  );
}

function settleUnlock(result, error, pinned) {
  const same = !!result && !!pinned && typeof result.credentialId === "string" && result.credentialId === pinned.credentialId;
  if (result && result.prfOutput instanceof Uint8Array) result.prfOutput.fill(0);
  const lock = state.appLock;
  if (!lock) return;
  if (!same) {
    // 기존 정직한 인증 실패 카드(renderAuthCard)로 — 생성 폴백 0 · Hatch 0 · 잠금 유지.
    lock.phase = "failed";
    lock.cancelled = !!error && isCancelledAuthError(error);
    if (error) recordSafeError("unlock", error);
    render();
    return;
  }
  state.appLock = null;
  touchAppSession();
  render();
}

function stayHome() {
  // [A-354] stay home 을 눌러도 같은 Send 카드가 그대로 남던 버그 교정: sendstay 로 다시
  // 들어갈 때 카드 표시 표를 명시적으로 내려서 Home 대기(초그·HomeNotepad)로 분리한다.
  state.sendCardVisible = false;
  // [A-414-b] 기대를 풀고 앉는다 — work? 표를 지워서 다음에 카드가 다시 뜨면(다음 Save/
  // 재방문) 작은 perk 가 처음부터 다시 재생되게 한다. 지금 이 화면엔 카드가 없으니
  // 진행 중이던 표를 남겨도 아무도 안 보지만, 남겨두면 다음 카드가 "이미 정착한 자세"로
  // 곧장 뜨는 조용한 버그가 된다.
  sendWorkStartedAt = null;
  setScene("sendstay", "Piggy stayed home today.", "Chog is quiet.");
}

// [A-633 C] First Send 미확정 기록(SEND_PENDING_KEY)의 **read-only** 조회 ─────────────────────────────
// 부팅 때 모바일 잠금(LOGIN_CHECKING)과 병렬로 돈다 — Face ID 불필요. 이 구역이 부르는 것은 publicClient 의
// 읽기(getTransactionReceipt/getTransaction/getBalance/readContract/waitForTransactionReceipt)뿐이다:
// sendTransaction·signDigest·requestGrant·approve·walletClient·activeSession·recoverPiggy·requestPrf 0.
// 재제출·자동 redeem 0. 성공 확정만 기존 성공 계약(commitSendSuccess → finishTrip)으로 넘긴다.
function isTxHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

// 한 번 읽는다. 저장된 hash 가 이 Piggy 주소 → shMON 으로 간 tx 가 아니면 판정하지 않는다(unknown).
async function readSendTxReceipt(hash, address) {
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash });
  } catch (error) {
    // viem: 아직 채굴 전이면 TransactionReceiptNotFoundError. 그 밖(RPC 실패 등)은 모른다.
    return { kind: error?.name === "TransactionReceiptNotFoundError" ? "pending" : "unknown" };
  }
  const fromOk = String(receipt?.from || "").toLowerCase() === String(address).toLowerCase();
  const toOk = String(receipt?.to || "").toLowerCase() === SHMON_ADDRESS.toLowerCase();
  if (!fromOk || !toOk) return { kind: "unknown" };
  return { kind: receipt.status === "success" ? "success" : "reverted", receipt };
}

// 단계별 판정(카드 §C 1–7). 반환 kind: unknown | pending | deposit-confirmed | failed | success.
async function classifySendPending(pending) {
  const address = pending?.address;
  if (!pending || typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return { kind: "unknown" };
  if (pending.stage === "deposit-broadcast" && isTxHash(pending.depositTxHash)) {
    const dep = await readSendTxReceipt(pending.depositTxHash, address);
    // deposit 만 성공 = Job 은 아직 안 끝났다(redeem hash 없음). 자동 redeem 금지 — still out. 으로 남긴다.
    if (dep.kind === "success") return { kind: "deposit-confirmed", depositBlockNumber: dep.receipt.blockNumber };
    return { kind: dep.kind === "reverted" ? "failed" : dep.kind };
  }
  if (pending.stage === "redeem-broadcast" && isTxHash(pending.redeemTxHash) && isTxHash(pending.depositTxHash)) {
    const red = await readSendTxReceipt(pending.redeemTxHash, address);
    if (red.kind !== "success") return { kind: red.kind === "reverted" ? "failed" : red.kind };
    const dep = await readSendTxReceipt(pending.depositTxHash, address);
    return { kind: "success", redeemReceipt: red.receipt, depositReceipt: dep.kind === "success" ? dep.receipt : null };
  }
  // deposit-sending · redeem-sending · unknown · hash 없음 — 믿을 수 있는 broadcast hash 가 없다.
  return { kind: "unknown" };
}

// redeem 성공이 확정된 뒤 기존 Receipt 모양(settleSend 와 같은 필드)을 **체인 사실로만** 채운다. 모든 값은
// 그 tx 의 블록에 고정해 읽는다(before = deposit 직전 블록, after/shMON = 그 블록). 하나라도 못 읽으면 null —
// 없는 숫자를 만들지 않는다(→ finishTrip 의 기존 balance-unavailable 경로).
async function reconciledSendReceipt(pending, depositReceipt, redeemReceipt) {
  if (!depositReceipt || !redeemReceipt) return null;
  const address = pending.address;
  try {
    const depBlock = depositReceipt.blockNumber;
    const redBlock = redeemReceipt.blockNumber;
    if (typeof depBlock !== "bigint" || typeof redBlock !== "bigint" || depBlock < 1n) return null;
    const shmonAt = (blockNumber) => publicClient.readContract({ address: SHMON_ADDRESS, abi: SHMON_ABI, functionName: "balanceOf", args: [address], blockNumber });
    const [depositTx, before, after, shmonBefore, shmonAfterDeposit, shmonAfterRedeem] = await Promise.all([
      publicClient.getTransaction({ hash: pending.depositTxHash }),
      publicClient.getBalance({ address, blockNumber: depBlock - 1n }),
      publicClient.getBalance({ address, blockNumber: redBlock }),
      shmonAt(depBlock - 1n),
      shmonAt(depBlock),
      shmonAt(redBlock),
    ]);
    return {
      before,
      after,
      gas: depositReceipt.gasUsed * depositReceipt.effectiveGasPrice + redeemReceipt.gasUsed * redeemReceipt.effectiveGasPrice,
      sent: depositTx.value,
      txHash: pending.redeemTxHash,
      grantTxHash: "",
      depositTxHash: pending.depositTxHash,
      redeemTxHash: pending.redeemTxHash,
      depositBlockNumber: depBlock,
      redeemBlockNumber: redBlock,
      depositGasUsed: depositReceipt.gasUsed || 0n,
      redeemGasUsed: redeemReceipt.gasUsed || 0n,
      shmonReceived: shmonAfterDeposit - shmonBefore,
      shmonAfterRedeem,
      status: redeemReceipt.status,
      at: Date.now(),
      piggyId: indexedPiggyId(address),
    };
  } catch {
    return null;
  }
}

// 문구 = A-633 카드 문자열 그대로(checking… / still out. / can't tell yet.) — 그 밖의 문구 0. `coming home` 은
// 여기 없다(기존 returnArrivalAlarm). Owner 시각 검토 OPEN.
function awayRestoreLineMarkup(kind) {
  if (kind === "pending") return "still out.";
  if (kind === "unknown") return "can't tell yet.";
  return "checking…";
}

function showAwayRestore(kind) {
  state.awayRestore = kind;
  const line = document.querySelector("#awayRestoreLine");
  if (line) line.innerHTML = awayRestoreLineMarkup(kind);
}

async function reconcileSendPending(pending, { watch = true } = {}) {
  let result;
  try {
    result = await classifySendPending(pending);
  } catch {
    result = { kind: "unknown" };
  }
  let receipt = null;
  if (result.kind === "success") receipt = await reconciledSendReceipt(pending, result.depositReceipt, result.redeemReceipt);
  // 조회하는 동안 기록이 바뀌었거나(다른 결말이 이미 정리함) 사라졌으면 이 결과로 아무것도 하지 않는다.
  const now = readSendPending();
  if (!now || now.stage !== pending.stage || now.depositTxHash !== pending.depositTxHash || now.redeemTxHash !== pending.redeemTxHash) {
    return result;
  }
  if (result.kind === "success") {
    // 실시간 settle 과 **같은** 성공 계약: redeem receipt 성공 확인 → 확정값 저장·미확정 기록 제거 → finishTrip.
    // Receipt 가 있으면 finishTrip 이 기존 귀환 알람·포털·Piggy 귀환·Receipt 로 들어간다(새 화면·타이머 0).
    state.awayRestore = null;
    commitSendSuccess(pending.redeemTxHash);
    finishTrip(receipt ? { outcome: "done", reason: "ok", receipt } : { outcome: "done", reason: "balance-unavailable", receipt: null });
    return result;
  }
  if (result.kind === "failed") {
    // 기존 실패 결말 — 성공 귀환 0. 실패는 기록을 지우지 않는다(기존 계약: Send 잠금 유지, 수리는 별도 recovery).
    state.awayRestore = null;
    finishTrip({ outcome: "failed", reason: "reverted", receipt: null });
    return result;
  }
  // pending / deposit-confirmed → still out. · unknown(해시 없음·읽기 실패·주소 불일치) → can't tell yet.
  showAwayRestore(result.kind === "unknown" ? "unknown" : "pending");
  if (watch && result.kind === "pending" && pending.stage === "redeem-broadcast") {
    // redeem 이 아직 채굴 전이면 같은 hash 를 읽기로만 **한 번** 기다렸다가 처음부터 다시 판정한다(재제출 0).
    // 다시 판정한 결과가 또 pending 이어도 다시 기다리지 않는다(RPC 가 엇갈려도 읽기 반복 루프 0 — 다음 열기에서 다시 본다).
    publicClient.waitForTransactionReceipt({ hash: pending.redeemTxHash }).then(() => reconcileSendPending(pending, { watch: false }), () => {});
  }
  return result;
}

async function requestGrant(address) {
  if (isLocalDevRpId() && RELAYER_URL === "__HARNESS_NO_GRANT__") {
    return { granted: false, txHash: "" };
  }
  let res;
  try {
    res = await fetch(`${RELAYER_URL}/grant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
  } catch {
    throw new Error("relayer unreachable");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  // 403 already funded = 실패가 아니라 "줄 필요가 없다". 서버리스 grant 는 원장 대신
  // 수취 주소 잔고로 판정하므로(api/grant.js), 한 번 받은 Piggy 는 그 뒤 매번 403 을 받는다.
  // 이걸 에러로 처리하면 두 번째 Send 부터 영원히 막힌다(2026-09-03 A-004 실측).
  if (res.status === 403 && body?.error === "already funded") {
    return { granted: false, txHash: "" };
  }
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || "relayer unreachable");
  }
  return { granted: true, txHash: body.txHash };
}

function makeDepositTx(receiver) {
  return {
    to: SHMON_ADDRESS,
    value: SEND_AMOUNT,
    data: encodeFunctionData({
      abi: SHMON_ABI,
      functionName: "deposit",
      args: [SEND_AMOUNT, receiver],
    }),
  };
}

function makeRedeemTx(shares, receiver, owner) {
  if (shares <= 0n) throw new Error("no shMON received");
  return {
    to: SHMON_ADDRESS,
    data: encodeFunctionData({
      abi: SHMON_ABI,
      functionName: "redeem",
      args: [shares, receiver, owner],
    }),
  };
}

async function readShmonBalance(address) {
  return publicClient.readContract({
    address: SHMON_ADDRESS,
    abi: SHMON_ABI,
    functionName: "balanceOf",
    args: [address],
  });
}

// broadcast 전에 잔액/가스와 deposit calldata 를 확인한다. 부족하거나 읽을 수 없으면 여기서 throw — 추측 진행 금지.
// [A-451] 상한·간격은 INFERRED(정본 값 없음). 기존 funded 경로(grant 없음)는 부르지 않는다.
const GRANT_VISIBLE_POLL_MS = 1000;
const GRANT_VISIBLE_MAX_TRIES = 20;
async function waitForGrantBalance(address) {
  for (let i = 0; i < GRANT_VISIBLE_MAX_TRIES; i += 1) {
    try {
      const balance = await publicClient.getBalance({ address });
      if (balance >= SEND_AMOUNT) return true;
    } catch {
      /* 읽기 실패는 다음 시도로 — 상한이 끝을 정한다 */
    }
    await new Promise((resolve) => setTimeout(resolve, GRANT_VISIBLE_POLL_MS));
  }
  return false;
}

async function simulateSend(account) {
  const before = await publicClient.getBalance({ address: account.address });
  const beforeShares = await readShmonBalance(account.address);
  const depositTx = makeDepositTx(account.address);
  const gasEstimate = await publicClient.estimateGas({
    account: account.address,
    ...depositTx,
  });
  const gasPrice = await publicClient.getGasPrice();
  const required = SEND_AMOUNT + gasEstimate * gasPrice;
  if (before < required) {
    throw new Error(`not enough to send: have ${formatEther(before)}, need ${formatEther(required)}`);
  }
  // [A-451] 이미 계산한 준비 정보를 함수 경계에서 잃지 않게 남긴다(표시·저장 0). sendTransaction 인자는
  // 바꾸지 않는다 — type/fee 강제는 새 증거 전까지 UNKNOWN.
  return { before, beforeShares, depositTx, prepared: { chainId: MONAD_TESTNET.id, gas: gasEstimate, gasPrice, feeClass: "gasPrice" } };
}

// 바퀴의 결말은 둘이고(조건 불충족 nah. 은 아직 없다), 그 둘을 가르는 내부 사유는 넷이다.
// 넷을 둘로 접는 자리가 여기다 — 화면이 사유를 다시 해석하지 않게 한다.
//   unconfirmed / reverted → 실행 실패  (tx 가 성공하지 않았다)
//   balance-unavailable    → 완료       (tx 는 성공했고 숫자만 못 읽었다)
//   ok                     → 완료       (영수증까지 있다)
async function waitForSuccess(hash) {
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } catch {
    // 확정을 못 봤다. 보낸 것과 끝난 것은 다르므로 여기서 성공이라고 말하지 않는다.
    return null;
  }
  // 채굴됐다 ≠ 성공했다. status 는 지금까지 버려지던 값이다.
  return receipt.status === "success" ? receipt : null;
}

async function settleSend({ before, address, piggyId = "", grantTxHash = "", depositTxHash, depositReceipt, redeemTxHash, shmonReceived }) {
  const redeemReceipt = await waitForSuccess(redeemTxHash);
  if (!redeemReceipt) {
    return { outcome: "failed", reason: "redeem-unconfirmed-or-reverted", receipt: null };
  }
  const gas =
    depositReceipt.gasUsed * depositReceipt.effectiveGasPrice +
    redeemReceipt.gasUsed * redeemReceipt.effectiveGasPrice;
  let after;
  let shmonAfterRedeem;
  try {
    after = await publicClient.getBalance({ address });
    shmonAfterRedeem = await readShmonBalance(address);
  } catch {
    // tx 는 성공했다. 잔고 조회만 깨진 것이라 바퀴는 닫힌 것으로 본다 — 숫자가 없을 뿐이다.
    return { outcome: "done", reason: "balance-unavailable", receipt: null };
  }
  return {
    outcome: "done",
    reason: "ok",
    receipt: {
      before,
      after,
      gas,
      sent: SEND_AMOUNT,
      txHash: redeemTxHash,
      grantTxHash,
      depositTxHash,
      redeemTxHash,
      depositBlockNumber: depositReceipt.blockNumber || 0n,
      redeemBlockNumber: redeemReceipt.blockNumber || 0n,
      depositGasUsed: depositReceipt.gasUsed || 0n,
      redeemGasUsed: redeemReceipt.gasUsed || 0n,
      shmonReceived,
      shmonAfterRedeem,
      status: redeemReceipt.status,
      at: Date.now(),
      // [A-544] settle 안에서 UI 상태를 다시 읽지 않는다 — 호출자가 이미 넘긴 값만, 그리고
      // 그 값이 빈칸 아닌 문자열일 때만 receipt 에 적는다.
      ...(typeof piggyId === "string" && piggyId.trim() !== "" ? { piggyId: piggyId.trim() } : {}),
    },
  };
}

// 결말 하나가 화면과 저장을 같이 정한다. 성공했을 때만 바퀴가 닫힌다.
function finishTrip(trip) {
  state.tripOutcome = trip.outcome;
  state.tripReason = trip.reason;
  if (trip.receipt) rememberReceipt(trip.receipt);
  if (trip.outcome !== "done") {
    // 돌아왔다고 말하지 않는다 — 실패 경로에서는 "성공 귀환" 쪽 상태를 하나도 세우지 않는다.
    setScene("sendstay", "couldn't finish this one.");
    return;
  }
  state.tripClosed = true;
  localStorage.setItem(TRIP_CLOSED_KEY, "1");
  // [이번 dispatch, Owner GO 2026-09-18 "다른 건 지우라고. 지금 승인한 최신 게 확정"]
  // 여기 있던 `state.awayLine = "It's back.";` 를 지웠다 — 이 값은 어디에서도 렌더되지
  // 않는 죽은 대입이었다(renderReturn() 은 `line: ""` 만 넘긴다 — 3611행 근방 A-411-i
  // 주석; renderAway() 도 그 자리를 `""` 로 비운다 — A-415/A-414-a). 이 씬에 남는 유일한
  // 발화는 아래 returnArrivalAlarm 의 "[이름] is coming home" 한 줄뿐이다(단일 발화 증거
  // 는 grep, OUTBOX/보고 참고).
  // [A-320] 실제 영수증이 있는 성공에서만 귀환 연출로 들어간다.
  // 영수증이 없으면 기존 「확인 중」 경로를 그대로 둔다 — 없는 값을 만들지 않는다.
  // transient 플래그라 새로고침·재방문에서는 다시 재생되지 않는다.
  if (trip.receipt) {
    state.returnArrival = true;
    // [A-413 §4] 단수 실제 귀환 — 표만 세운다(이름은 그릴 때 displayPiggyName() 을 다시
    // 읽는다, 위 state 선언부 주석 참고). 문구의 생명주기는 mountReturn()/
    // chogHomeMarkupForReturn 이 관리한다.
    state.returnArrivalAlarm = true;
    setScene("return", "Piggy is home.", "One tag.");
    return;
  }
  setScene("away", "Piggy is home.", "Confirmation is still catching up.");
  setTimeout(() => setScene("filebox"), 1200);
}

// [A-441] First Send 단일 실행 · 확정 전 재진입 fail-closed ────────────────────────────
// sendInFlight: 이 탭에서 sendPiggy 가 도는 동안 두 번째 호출은 grant/서명/sendTransaction 을
// 시작하지 않고 돌아간다. SEND_PENDING_KEY: broadcast 가 시작된 뒤 결과가 확정되기 전까지 저장소에
// 남는다 — 새로고침·재탭에서도 재제출 0. 성공(receipt 확인) 뒤에만 지우고, 실패·미확정은 지우지
// 않는다(재시도 가능하다고 추정하지 않는다 — 수리는 별도 recovery).
let sendInFlight = false;

function readSendPending() {
  let raw;
  try {
    raw = localStorage.getItem(SEND_PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && SEND_PENDING_STAGES.includes(p.stage)) return p;
  } catch {
    /* 아래 */
  }
  // 알아볼 수 없는 기록도 "없음"으로 보지 않는다 — 미확정으로 취급(fail-closed).
  return { stage: "unknown" };
}

function writeSendPending(entry) {
  localStorage.setItem(SEND_PENDING_KEY, JSON.stringify({ ...entry, at: Date.now() }));
}

function computeTripClosed({ tripClosedFlag, txHash, pending }) {
  if (tripClosedFlag === "1") return true;
  if (pending) return false;
  return !!txHash; // 옛 txHash-only 사용자 다리(A-048) — 새 코드는 확정 전 txHash 를 쓰지 않는다.
}

function sendBusy() {
  return sendInFlight || !!readSendPending();
}

// 확정 성공 뒤에만: txHash 확정값 저장 → 미확정 기록 제거. tripClosed 는 finishTrip 이 세운다.
function commitSendSuccess(redeemTxHash) {
  localStorage.setItem("araso.txHash", redeemTxHash);
  state.txHash = redeemTxHash;
  localStorage.removeItem(SEND_PENDING_KEY);
}

// [A-444] 실제 Send 버튼 상태는 이 한 곳에서 정한다 — origin 막힘·진행 중·미확정 기록 중 하나라도
// 있으면 잠그고, 모두 없으면 푼다(broadcast 전 안전 실패 뒤 다시 쓸 수 있게). 새 렌더·문구 0.
function syncSendButton() {
  const btn = document.querySelector("#sendButton");
  if (!btn) return;
  const locked = !isAllowedPiggyRpId() || sendBusy();
  btn.disabled = locked;
  if (locked) btn.setAttribute("aria-disabled", "true");
  else btn.removeAttribute("aria-disabled");
}

async function sendPiggy() {
  // [A-441] 두 번째 호출·미확정 기록이 있으면 아무것도 시작하지 않는다.
  if (sendInFlight) return;
  if (readSendPending()) {
    // 새 문구 0 — 기존 「확인 중」 표현을 그대로 쓴다(finishTrip 의 미확정 경로와 같은 말).
    // [A-556] A-555 S4 가 여기 넣었던 fail-safe endActiveSession() 호출은 없앴다 — Owner
    // 정책 위반(행동마다 즉시 세션 종료)이었다. 서명자는 자기 5분 절대 타이머로만 끝난다.
    setScene("sendstay", "Piggy is home.", "Confirmation is still catching up.");
    return;
  }
  sendInFlight = true;
  syncSendButton();
  let settling = false; // true 가 되면 잠금 해제는 settle 결말이 맡는다
  try {
    await sendPiggyOnce(() => {
      settling = true;
    });
  } finally {
    // [A-556] A-555 S4 가 여기 넣었던 무조건 endActiveSession() 호출은 없앴다 — Owner
    // 은행앱식 정책(같은 Piggy 5분 안 재송금은 Face ID 재요구 0)이 "행동마다 즉시 종료"를
    // 대체한다. 서명자는 이제 activateSigningSession 이 세운 5분 절대 타이머
    // (armSignerExpiry)로만 끝나고, sendPiggyOnce 안의 touchAppSession() 은 app-idle 만
    // 새로 잰다 — 서명자 만료를 늘리지 않는다.
    if (!settling) {
      sendInFlight = false;
      syncSendButton(); // 안전 실패(broadcast 전)면 풀리고, pending 이 남았으면 잠긴 채
    }
  }
}

async function sendPiggyOnce(markSettling) {
  if (!isAllowedPiggyRpId()) {
    // [A-407-e] 사용자 화면에는 내부 origin/rpId 를 적지 않는다 — 지금 여기서는 보낼 수
    // 없다는 사실만 짧게. 가드(isAllowedPiggyRpId)·서명·tx·버튼 disabled 는 그대로이고,
    // 이 문구가 실행 가능성을 암시하지 않는다. 원인 원문은 OUTBOX 기록.
    setScene("sendstay", "Not from here.", "Piggy can only go out from the real app.");
    return;
  }

  // 생성 폴백 없음 — 저장된 credential 이 없으면 기존 패스키로 복구를 시도한다.
  if (!activeAccount || !activeSession) {
    setScene("sendstay", "Piggy is waking up.", "Face ID may appear once.");
    try {
      await recoverPiggy();
      noteRecoverSuccess();
    } catch (error) {
      noteRecoverFailure();
      state.authPhase = "idle";
      state.authCancelled = isCancelledAuthError(error);
      recordSafeError("recover", error);
      setScene("birth", "Chog could not wake Piggy.", "");
      return;
    }
  }

  setScene("sendstay", "Piggy is asking to go out.", "Checking with home base.");

  let grant;
  try {
    grant = await requestGrant(state.address);
  } catch (error) {
    // fail-closed — relayer 가 안 떠 있거나 그 밖의 이유로 거절하면 여기서 멈춘다. 추측 진행 금지.
    // 통과하는 거절은 위의 "already funded" 하나뿐이다.
    recordSafeError("grant", error);
    setScene("sendstay", "relayer unreachable", "");
    return;
  }
  // 이미 가스가 있으면 grant tx 자체가 없다. 그대로 simulate 로 넘어간다.
  state.grantTxHash = grant.txHash;
  // [A-451] 이번에 새 grant 가 나갔을 때만: 그 잔고가 RPC 에 실제로 보일 때까지 짧게 기다린다
  // (A-448 은 grant 확정 ≈2.5s 뒤 deposit 이 거부됨 — 원인 UNKNOWN, 가시성 지연은 INFERRED 후보).
  // 상한 안에 안 보이면 서명·전송 전에 멈춘다(pending 없음 → Send 다시 사용 가능).
  if (grant.granted) {
    const visible = await waitForGrantBalance(state.address);
    if (!visible) {
      recordSafeError("grant-visibility", { name: "GrantBalanceNotVisible" });
      setScene("sendstay", "Piggy can't go out yet.", "");
      return;
    }
  }

  const account = activeAccount;
  // [A-544] 이 실행이 어느 Piggy 것인지 **여기서, 비동기 tx/settle 체인 전에** 한 번만
  // 고정한다 — historyPiggyId/현재 HISTORY 선택/나중 UI 상태를 owner 로 쓰지 않는다
  // (§receipt owner 계약). `typeof` 가드는 이 함수 소스를 텍스트로 잘라 격리 스텁 위에서
  // 도는 기존 테스트(send-lock.mjs/send-error-boundary.mjs — indexedPiggyId 를 주입하지
  // 않는다, A-544 allowed_files 밖이라 고칠 수 없다)를 깨지 않기 위해서다. 실제 앱에서는
  // indexedPiggyId 가 이 파일 안에 항상 선언돼 있어 분기 없이 매번 잡힌다.
  const executingPiggyId = typeof indexedPiggyId === "function" ? indexedPiggyId(account.address) : "";
  let plan;
  try {
    plan = await simulateSend(account);
  } catch (error) {
    // fail-closed — broadcast 전에 멈춘다. 추측 진행 금지.
    recordSafeError("simulate", error);
    setScene("sendstay", "Piggy can't go out yet.", "");
    return;
  }

  state.awayLine = "I'll check it.";
  // 여기까지 왔다는 것은 grant·simulate 가 통과했다는 뜻이다. 그 사실 위에서만
  // 출발 연출이 돈다 — 모션이 먼저 돌아 "이미 떠났다"를 만들지 않는다.
  // 순서(rpId → recover → grant → simulate → away → 서명/broadcast)는 바뀌지 않았다.
  state.departureArrival = true;
  setScene("away", "Piggy went out.", "Can go out once, up to $5.");

  try {
    // [A-556] 송금이라는 "평범한 인앱 활동" 은 app-idle 만 새로 잰다 — 서명자 5분 절대
    // 만료(armSignerExpiry)는 여기서 늘어나지 않는다(카드 §2 절대 캡).
    touchAppSession();
    const walletClient = createWalletClient({
      account,
      chain: MONAD_TESTNET,
      transport: http(MONAD_TESTNET_RPC),
    });
    const bytes = new TextEncoder().encode(`araso:mera:send-piggy-to-work:v1:${account.address}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const signature = await activeSession.signDigest(digest);
    const mark = `${toHex(signature.compact)}:${signature.recovery}`;
    // [A-441] 여기부터 돈이 움직일 수 있다 — 보내기 직전에 미확정 기록을 남긴다(broadcast 여부를
    // 모르는 예외도 재제출 0 쪽으로 접힌다).
    writeSendPending({ stage: "deposit-sending", address: account.address });
    const depositTxHash = await walletClient.sendTransaction({
      account,
      chain: MONAD_TESTNET,
      ...plan.depositTx,
    });
    writeSendPending({ stage: "deposit-broadcast", address: account.address, depositTxHash });
    const depositReceipt = await waitForSuccess(depositTxHash);
    if (!depositReceipt) throw new Error("deposit unconfirmed or reverted");
    const afterDepositShares = await readShmonBalance(account.address);
    const shmonReceived = afterDepositShares - plan.beforeShares;
    const redeemTx = makeRedeemTx(shmonReceived, account.address, account.address);
    await publicClient.estimateGas({
      account: account.address,
      ...redeemTx,
    });
    writeSendPending({ stage: "redeem-sending", address: account.address, depositTxHash });
    const redeemTxHash = await walletClient.sendTransaction({
      account,
      chain: MONAD_TESTNET,
      ...redeemTx,
    });
    writeSendPending({ stage: "redeem-broadcast", address: account.address, depositTxHash, redeemTxHash });
    localStorage.setItem("araso.mark", mark);
    state.mark = mark;
    // [A-441] araso.txHash·state.txHash 는 여기서 쓰지 않는다 — redeem receipt 성공 확인 뒤에만(commitSendSuccess).

    markSettling();
    settleSend({
      before: plan.before,
      address: account.address,
      piggyId: executingPiggyId,
      grantTxHash: state.grantTxHash,
      depositTxHash,
      depositReceipt,
      redeemTxHash,
      shmonReceived,
    })
      .then((trip) => {
        // 성공(redeem receipt status success)일 때만 확정값 저장·미확정 기록 제거. 실패·미확정은 기록 유지.
        if (trip.outcome === "done") commitSendSuccess(redeemTxHash);
        finishTrip(trip);
      })
      // settleSend 는 결말을 반환한다 — 여기로 오는 건 그 밖의 예외뿐이라 미확인으로 접는다.
      .catch(() => finishTrip({ outcome: "failed", reason: "unconfirmed", receipt: null }))
      .finally(() => {
        sendInFlight = false;
        syncSendButton(); // 성공 뒤 pending 없음 → 풀림 · 미확정 pending → 잠긴 채
      });
  } catch (error) {
    recordSafeError("send", error);
    setScene("sendstay", "Piggy could not get ready.", "");
  }
}

// --- Second Journey (A-360) ---------------------------------------------
// 이 구역은 첫 Journey 금융(sendPiggy/requestGrant/simulateSend/settleSend/finishTrip)을
// 부르지도, 그 저장소(RECEIPTS_KEY/PASSKEY_STORAGE_KEY/TRIP_CLOSED_KEY)를 건드리지도
// 않는다. 실제 Second Journey 실행 adapter 는 없다(§6) — 여기서 새로 만들지 않는다.
// job-feed.js/second-job-readiness.js 의 순수 판정을 그대로 읽고 markup 만 second-
// journey-view.js 에 맡긴다.

function createEmptySecondJourney() {
  return {
    step: "interests", // interests | candidates | readiness | note
    selectedIds: [],
    chosenDestinationId: null,
    pickedCandidateId: null, // [A-421] 후보 카드에서 누른 것(ok 전). ok ≠ permission
    jitAnswer: null,
    permission: false,
    amount: "",
    domainState: null, // second-journey-state.js 의 interests/preference 저장 모양
    persisted: false, // 마지막 저장이 실제 localStorage 로 갔는가(scope 유효)
    devPreview: false, // [A-360 §7] DEV 전용 — production 진입 0(아래 window.__arasoScene)
    flow: null, // 마지막 runSecondJourney() 결과
    mockReceipt: null, // makeMockReceipt() 출력 — 메모리만, 실제 receipts 에 안 감
  // [A-472] **애니메이션 완료 ≠ 실행 확정.** 재생이 끝났다는 것과 이번 심부름이 끝났다는 것은
  // 다른 사실이다. First 가 trip.outcome 으로 그 둘을 가르는 것과 같은 개념을 메모리에만 둔다
  // (저장 스키마 증가 0 · First 의 SEND_PENDING_KEY/TRIP_CLOSED_KEY 는 건드리지 않는다).
  //   null = 아직 나가지도 않음 · "pending" = 나갔고 미확정 · "done" · "failed"
  outcome: null,
    awayLine: "",
    // [A-405/A-405-a] seedStage: "A" | "B" | "done" — 최초 seed(관심0/이벤트0)만 A→B
    // 두 세트를 거친다. 반복 방문·edit interests 는 항상 "done"(단일 bounded 세트).
    // 새 persisted 필드를 추가하지 않는다 — ensureSecondJourneyDomainState() 가 이미
    // 들고 있는 domainState.interests/processedEventIds 에서 매번 다시 유추한다
    // (inferSeedStage). 그래서 새로고침해도 "이미 관심이 있다/이미 seed A 를 한 번
    // none 했다"는 사실은 살아남는다 — 다만 "seed B 까지 갔었다"는 이 세션 메모리에만
    // 있고 새로고침 중간에 끊기면 done(반복 모드)으로 떨어진다(§UNKNOWN, OUTBOX 보고).
    seedStage: null,
    // interestsNote: seed A none 뒤 같은 interests 화면 위에 얹는 Chog/Paper 한 줄 —
    // 목록은 세트B로 교체되고, 이 노트는 다음 저장/이탈까지 그대로 남는다(타이머 없음).
    interestsNote: null,
    // chogSay: Explore 저장 직후 Chog 가 **자기 자리에서** 하는 반응 한 줄(카드 문구 아님).
    // 정본 NOTES_explore_page §5:180 "all of them?" · §10:334 "these two?" 만 쓴다 — 다른
    // 개수의 대사는 정본에 없어 비운다(UNKNOWN, 문구 발명 0). candidates 단계에서만 보인다.
    chogSay: null,
    // candidatesRevealed: 이번 저장 뒤 후보 행을 이미 보여줬는지 — 선택 재렌더 때 다시 숨기지 않는다.
    candidatesRevealed: true,
    // note/noteQueue: 목록 없이 문구만 보여주고 Home 으로 닫는 종결 화면(seed B 소진,
    // 본편 반복 none). render() 가 이 큐를 sceneTimeout 으로 한 걸음씩 넘긴다.
    note: null,
    noteQueue: [],
    // [A-579] 메모리만(draft 에 안 감). decisionEventId = 이번 check 한 번의 판정 이벤트 id.
    // returnRead = 그 이벤트를 위해 읽은 read-only 관측 — 다른 이벤트에 재사용하지 않는다.
    decisionEventId: null,
    decisionEventSeq: 0,
    returnRead: null,
  };
}

// Explore 에서 한 번에 내놓는 최대 후보 수 — job-feed.js EXPLORE_ERRANDS(8개 정본)는
// 그대로 두고, 이 view/delivery 경계에서만 최대 5개로 자른다(§success_criteria
// "표시 개수와 실제 선택가능 ids 일치, all=현재 제시목록"). job-feed.js 는 고치지 않는다.
const MAX_EXPLORE_VISIBLE = 5;
// seed B 소진("okay./maybe later.") 및 본편 반복 none 종결 노트가 화면에 머무는 시간 —
// 기존 filebox 자동전환(A-292, 1200ms)과 같은 값을 재사용한다(새 타이밍 발명 0).
const EXPLORE_NOTE_MS = 1200;
// [Owner 2026-09-19 "체킹 먼저, 두 옵션은 살짝 늦게 — 진짜 가능한 걸 보여줘야 하니 늦어도 된다"]
// 저장 직후 candidates 카드는 checking… 만 먼저 보이고 후보 행은 이 뒤에 뜬다. 값 = INFERRED.
const CANDIDATES_REVEAL_MS = 1500;
// [A-579] 판정 Receipt 의 selection.source — 코드 경로 이름이다(사람이 골랐다는 주장이 아니다).
const SECOND_DECISION_SELECTION_SOURCE = "app_ui_jit_answer";
// [A-579] 판정 시점 read-only 관측 설정. null = 읽지 않는다 → 판정은 unknown(never nah).
// 켜려면 { rpcUrl } 과 CSP connect-src 가 함께 필요하다 — RELEASE/HUMAN 게이트, 이 카드 밖.
const RETURN_EVIDENCE_READ_CONFIG = null;
// [A-629] LOCAL_ONLY decision-harness hooks. Same first lock as the WebAuthn hook (A-463 ①):
// outside LOCAL_DEV_ENTRY (a172-local mode + VITE_ARASO_LOCAL_DEV_ENTRY=1) they are never read,
// so the product path is unchanged: RETURN_EVIDENCE_READ_CONFIG stays null and no extra fixture
// is bound to a Job. The harness supplies the read-only RPC URL at runtime; app source holds
// none. A malformed hook is ignored (fail-closed). A read made through the hook is labelled
// `local_test_reader:` on the Receipt, so it can never pass as the product reader.
const LOCAL_TEST_RETURN_READ_HOOK = "__ARASO_LOCAL_TEST_RETURN_READ__";
const LOCAL_TEST_JOB_BINDINGS_HOOK = "__ARASO_LOCAL_TEST_JOB_BINDINGS__";

// domainState 가 진짜 "한 번도 Explore 선택을 한 적 없는" 상태인지 본다. 새 persisted
// 필드를 추가하지 않고 이미 있는 두 필드로만 유추한다:
//   interests.length>0            → 이미 뭔가 골랐다 — seed 대상 아님(done)
//   processedEventIds.length===0  → 이 계정/체인 scope 에서 저장 이벤트 자체가 0 —
//                                    최초 seed 세트A
//   processedEventIds.length===1  → interests 가 비었는데 이벤트가 하나 있다 = 세트A를
//                                    none 으로 한 번 처리했다(현재 코드 경로에서 interests
//                                    가 비어 있는 동안 processedEventIds 를 늘리는 곳은
//                                    applyExploreSelection 의 none/unsure 분기뿐이다) —
//                                    세트B
//   그 외                          → 이미 세트A/B 를 다 거쳤거나 반복 방문 — done
function inferSeedStage(domainState) {
  if (!domainState) return "A";
  if ((domainState.interests || []).length > 0) return "done";
  const noneEvents = (domainState.processedEventIds || []).length;
  if (noneEvents <= 0) return "A";
  if (noneEvents === 1) return "B";
  return "done";
}

// 지금 이 순간 카드에 실제로 그려질(=선택 가능한) errand 목록. job-feed.js 의 8개 정본
// 순서(baseScore desc)는 그대로 인용만 하고 여기서 최대 5개로 자른다.
//   seedStage "A" → 앞 5개(세트A)
//   seedStage "B" → 나머지 3개(세트B) — 5개를 채우려 다른 걸 더 넣거나 합성하지 않는다
//                    (§A-405-a "5개를 채우려 중복/합성 0")
//   그 외("done"/edit) → 이미 선택된 id 를 먼저 지키고, 남는 자리를 정본 순서로 채운다
//                    (edit interests 로 돌아왔을 때 이미 체크된 항목이 화면 밖으로
//                    밀려나 "표시id != 선택가능id" 가 되는 것을 막는다)
function computeExploreDisplayErrands(sj) {
  const all = buildVisibleLaneChoices();
  if (sj?.seedStage === "A") return all.slice(0, MAX_EXPLORE_VISIBLE);
  if (sj?.seedStage === "B") return all.slice(MAX_EXPLORE_VISIBLE);
  const preferredIds = sj?.selectedIds || [];
  const picked = [];
  const seen = new Set();
  for (const errand of all) {
    if (preferredIds.includes(errand.id)) {
      picked.push(errand);
      seen.add(errand.id);
    }
  }
  for (const errand of all) {
    if (picked.length >= MAX_EXPLORE_VISIBLE) break;
    if (seen.has(errand.id)) continue;
    picked.push(errand);
    seen.add(errand.id);
  }
  return picked.slice(0, MAX_EXPLORE_VISIBLE);
}

// Second Journey 저장 scope — 실제 계정 주소가 있어야 유효하다(§5 "실제계정/체인scope
// 유효시만관심persist"). 첫 Journey 의 RECEIPTS_KEY/PASSKEY_STORAGE_KEY 와는 다른
// 이름공간(second-journey-state.js STORAGE_PREFIX)이다 — 섞이지 않는다.
function secondJourneyScope() {
  return { accountId: state.address || "", chainId: "monad-testnet" };
}
// [A-475] 사용자가 **쓰다 만 것**만 남긴다. 배운 것(관심·선호)은 위 도메인 상태 몫이다.
// 권한·READY·판정 캐시·금융 결과는 저장하지 않는다 — 복귀 후 항상 새로 계산한다.
function currentSecondDraft() {
  const sj = state.secondJourney;
  return {
    step: sj.step,
    seedStage: sj.seedStage,
    selectedIds: sj.selectedIds,
    pickedCandidateId: sj.pickedCandidateId,
    chosenDestinationId: sj.chosenDestinationId,
    jitAnswer: typeof sj.jitAnswer === "string" ? sj.jitAnswer : null,
    amount: typeof sj.amount === "string" ? sj.amount : "",
    savedAt: new Date().toISOString(),
  };
}

// 입력·선택이 바뀔 때마다 바로 쓴다 — beforeunload 하나에 기대지 않는다(그 이벤트는 놓칠 수 있다).
// Send 를 누른 뒤에는 저장하지 않는다: 그때부터는 draft 가 아니라 실행 lifecycle 이다.
function persistSecondDraft() {
  const sj = state.secondJourney;
  if (sj.outcome) return;                        // 이미 보냈다 → draft 아님
  if (import.meta.env.DEV && sj.devPreview === true) return;  // fixture 는 남기지 않는다
  saveSecondJourneyDraft(safeLocalStorage(), secondJourneyScope(), currentSecondDraft());
}

// Send 로 들어간 순간·완료·리셋에서 draft 를 닫는다. 이후 reload 가 draft 로 되돌리지 않는다.
function dropSecondDraft() {
  clearSecondJourneyDraft(safeLocalStorage(), secondJourneyScope());
}

function safeLocalStorage() {
  try { return window.localStorage; } catch { return null; }
}


function ensureSecondJourneyDomainState() {
  const sj = state.secondJourney;
  if (sj.domainState) return sj.domainState;
  const scope = secondJourneyScope();
  const validScope = validatePersistenceScope(scope);
  sj.domainState = validScope.error ? createSecondJourneyState(scope) : loadSecondJourneyState(localStorage, scope).state;
  sj.persisted = !validScope.error;
  return sj.domainState;
}

// [A-499 Lane R] 실제 실행 증거가 붙은 영수증만 영속된다.
// 판정은 전부 bridge 가 한다 — 여기서 조건을 다시 쓰면 두 개의 진실이 생긴다.
function commitSecondReceiptIfReal() {
  const sj = state.secondJourney;
  // `executionReceipt` 는 **실행 어댑터가 채울 자리**다. 오늘은 비어 있다.
  // `mockReceipt` 는 여기 절대 들어오지 않는다.
  const candidate = sj?.executionReceipt;
  if (!candidate) return;
  const scope = secondJourneyScope();
  if (validatePersistenceScope(scope).error) return;   // 미인증 — 저장하지 않는다
  const out = commitSecondJourneyReceipt({
    state: sj.domainState,
    receipt: candidate,
    scope,
    storage: safeLocalStorage(),
    context: { devPreview: sj.devPreview === true || import.meta.env.DEV },
  });
  // 거절되면 bridge 가 **같은 state 객체를 그대로** 돌려준다 — 부분 변이 0.
  sj.domainState = out.state;
}

function persistSecondJourneyDomainState() {
  const sj = state.secondJourney;
  if (import.meta.env.DEV && sj.devPreview === true) {
    // DEV preview is a fixture only, even when an authenticated address exists.
    sj.persisted = false;
    return;
  }
  const scope = secondJourneyScope();
  const validScope = validatePersistenceScope(scope);
  if (validScope.error) {
    // 미인증 — 메모리만(§5). 이미 sj.domainState 에 있다.
    sj.persisted = false;
    return;
  }
  const result = saveSecondJourneyState(localStorage, scope, sj.domainState);
  sj.persisted = !!result.saved;
}

// [A-360 §7] DEV 전용 미리보기 픽스처 — 실제 currentPiggyStatus/evidence 를 덮어써
// evaluateReadinessEvidence 가 READY 를 낼 수 있게 한다. destinationOverrides/evidence는
// job-feed.js/second-job-readiness.js 가 이미 받는 주입 지점이다(그 파일들을 고치지
// 않는다). production 번들에는 이 값을 켜는 진입(window.__arasoScene)이 없다 — 아래.
function buildDevPreviewOverrides(destinationId) {
  if (!destinationId) return {};
  return {
    [destinationId]: {
      capabilityStatus: "qualified",
      currentPiggyStatus: "DEV_PREVIEW_FUNDED",
      currentPiggyContext: {
        piggyId: "dev-preview-piggy",
        chain: "monad-testnet-preview",
        address: "0xDEV0PREVIEW00000000000000000000000000",
        gas: "ok",
        assets: { mon: "1", usdc: "0", kintsuPosition: "0", merklClaimable: "0" },
        evidenceMode: "dev_preview_fixture",
        requiredAssets: [],
        missingNow: [],
        jobLevelNah: false,
      },
    },
  };
}

function buildDevPreviewEvidence(destinationId, nowMs) {
  if (!destinationId) return {};
  return {
    source: "dev_fixture_preview",
    chain: "monad-testnet-preview",
    address: "0xDEV0PREVIEW00000000000000000000000000",
    destinationId,
    block: 1,
    eligibility: true,
    exit: true,
    proof: true,
    gas: true,
    requiredAssets: [],
    availableAssets: [],
    missingNow: [],
    claimable: "1",
    timestampMs: nowMs - 1000,
    expiresAtMs: nowMs + 5 * 60 * 1000,
  };
}

// 현재 선택/후보/jit/permission/amount 로 runSecondJourney() 를 다시 부른다. 순수
// 재계산이다 — 여기서 아무것도 저장하지 않는다(호출부가 결정한다).
function recomputeSecondJourneyFlow() {
  const sj = state.secondJourney;
  const ids = sj.selectedIds;
  const selectionKind = ids.length === 0 ? "none" : ids.length === 1 ? "one" : "multi";
  const devPreview = import.meta.env.DEV && sj.devPreview === true;
  const chosenId = sj.chosenDestinationId;
  const amountCheck = validateSecondAmount(sj.amount);
  // [A-579] 이번 판정 이벤트(같은 check · 같은 답)를 위해 읽은 관측만 쓴다. 다른 이벤트의 읽기는 버린다.
  const read = sj.returnRead && sj.decisionEventId && sj.returnRead.eventId === sj.decisionEventId && sj.returnRead.answer === sj.jitAnswer ? sj.returnRead : null;
  sj.flow = runSecondJourney({
    selectionKind,
    selectedErrandIds: ids,
    scope: secondJourneyScope(),
    jitAnswer: sj.jitAnswer || undefined,
    preferredDestinationId: chosenId || undefined,
    destinationOverrides: devPreview && chosenId ? buildDevPreviewOverrides(chosenId) : {},
    // [A-421 v25] 사용자용 permission 체크박스는 화면에서 제거했다(Owner 최신 지시:
    // "이전 permission 체크박스를 사용자 선택 UI로 요구하지 않음"). 권한 요구 자체는
    // 코드에 그대로 남는다 — second-job-readiness.js:128 은 permission!==true 면
    // executionPermission 을 주지 않고, handleSecondSend()/canSend 의 fail-closed
    // 게이트(devPreview && JOB_READY && executionPermission===true)도 손대지 않았다.
    // devPreview 가 아닌 실제 경로에서는 canSend 가 devPreview 로 이미 막혀 있어 이
    // 값이 무엇이든 Send 가 열리지 않는다 — 즉 실경로 권한 경계는 변하지 않는다.
    permission: sj.permission === true || devPreview,
    readinessEvidence: devPreview && chosenId ? buildDevPreviewEvidence(chosenId, Date.now()) : {},
    ruleAgreed: devPreview,
    ruleValues: {
      amount: {
        found: amountCheck.valid ? amountCheck.amount : null,
        block: devPreview ? 1 : null,
        source: devPreview ? "dev_fixture_preview" : "fixture",
      },
    },
    nowMs: Date.now(),
    // [A-579] 판정은 판정 시점 관측으로만 한다(기록된 A-571 읽기는 provenance 일 뿐).
    requireFreshReturnObservation: true,
    decisionEventId: sj.decisionEventId || undefined,
    // [A-629] undefined outside the LOCAL_ONLY harness — the product binds only Kintsu.
    jobBindings: localTestJobBindings(),
    selectionSource: SECOND_DECISION_SELECTION_SOURCE,
    returnObservations: read?.observation ? { [read.jobId]: read.observation } : undefined,
    returnReadStatus: read ? read.status : "not_read",
    decisionAt: read?.at,
  });
}

function buildSecondJourneyViewModel() {
  const sj = state.secondJourney;
  // [A-421 Owner] 몇 번째 Journey: 첫 Journey 닫힘(tripClosed) + 이번 세션 Second 완료 수 + 지금 것.
  // [A-462] Second 완료 **사실**은 이제 저장된다(SECOND_JOURNEY_CLOSED_KEY). 그러나 이 숫자는
  // 화면에 그려지는 값이라 여기서는 **세션 카운트**(secondCompletedThisSession)를 계속 쓴다 —
  // 저장값을 쓰면 새로고침 뒤 2 가 3 으로 바뀌어 사용자 화면이 달라진다(CLAUDE.md 3항: 실험 중
  // 화면/문구 변경 금지). Owner 가 "새로고침 뒤에도 누적 표시"를 원하면 그때 바꾼다 — OUTBOX A-462 참고.
  const journeyNumber = 1 + (state.tripClosed ? 1 : 0) + (state.secondCompletedThisSession ? 1 : 0);
  const flow = sj.flow;
  const chosen = (flow?.destinations || []).find((d) => d.id === sj.chosenDestinationId) || null;
  const amountCheck = validateSecondAmount(sj.amount);
  const devPreview = import.meta.env.DEV && sj.devPreview === true;
  const preflight = flow?.preflight || null;
  // [A-421 v25] 기존 fail-closed 게이트는 그대로 두고, 빈 입력/조건 미충족일 때 Send 를
  // 더 막는 조건만 덧붙인다(Owner: 빈 입력/조건 미충족 Send disabled). 수령형은 맡길
  // 금액 칸이 없으므로 금액 조건을 걸지 않는다(APP_HANDOFF.md:24).
  const needsAmount = readinessCardKind(chosen) !== "collect";
  const canSend =
    devPreview &&
    preflight?.status === "JOB_READY" &&
    preflight?.executionPermission === true &&
    (!needsAmount || amountCheck.valid);
  // [A-421] Candidates/readiness 화면이 job-feed.js 내부 fixture title(예: "Swap-like
  // Trade")을 그대로 찍는 대신, 이미 interests 단계에서 사용자가 본
  // errand.label(job-feed.js EXPLORE_ERRANDS, buildVisibleLaneChoices())로 되짚을 수
  // 있도록 id→label 조회표를 만들어 넘긴다(second-journey-view.js
  // destinationDisplayLabel() 참고). 새 데이터/새 저장 필드 0 — 순수 조회용.
  const errandLabelById = Object.fromEntries(buildVisibleLaneChoices().map((errand) => [errand.id, SECOND_ACTION_TITLES_EN[errand.id] || errand.label]));
  return {
    journeyNumber,
    step: sj.step,
    // [A-405] 최대 5개 bounded 세트만 넘긴다 — job-feed.js 의 8개 canonical 은 그대로
    // 두고 이 view model 경계에서만 자른다. "all" 선택은 항상 이 배열 전체를 뜻한다.
    errands: sj.step === "interests" ? computeExploreDisplayErrands(sj) : [],
    selectedIds: sj.selectedIds,
    // interests 단계는 sj.interestsNote(타이머 0, 다음 저장/이탈까지 유지), 종결
    // note 단계는 sj.note(sceneTimeout 큐) — 같은 model.note 자리를 각 단계 markup 이
    // 서로 다른 뜻으로 읽는다(둘이 동시에 쓰이지 않는다).
    note: sj.step === "interests" ? sj.interestsNote || null : sj.note || null,
    destinations: flow?.destinations || [],
    pickedCandidateId: sj.pickedCandidateId,
    errandLabelById,
    chosen,
    decision: chosen?.decision || null,
    jitQuestion: flow?.jitQuestions?.[0] || null,
    jitAnswer: sj.jitAnswer,
    preflight,
    permission: sj.permission,
    amount: sj.amount,
    amountError: amountCheck.error,
    canSend,
    sendReason: secondJourneySendReason(preflight, devPreview),
    devPreview,
    ...secondJourneyV25Lines(chosen, preflight),
  };
}

// [A-421 v25] 승인 카드가 요구하는 실데이터 줄들. 값이 실제로 확인되지 않은 자리는
// null 로 남긴다 — 시안의 예시 수치(24 / 3.20 / 0.10 / 2 days, APP_HANDOFF.md:30)를
// 앱에 상수로 심지 않는다. 빈칸이 정답이고 발명한 문장은 위반이다.
function secondJourneyV25Lines(chosen, preflight) {
  return {
    // "> $N at home · USDC" / 입력 후 "left at home"(APP_HANDOFF.md:10). 앱이 실제로
    // 읽는 잔액은 네이티브 MON(state.homeMoneyNativeWei) 뿐이고, 달러 표시는 USDC 환산
    // quote 가 있어야 한다("없으면 숫자 발명 금지", CURRENCY_NOTES.md:3). 현재 quote/
    // adapter 연결이 없어 이 줄을 비운다(SOURCE_MISSING).
    balanceLine: null,
    // [A-421 Owner "있으니까 넣은거야"] 시안 실패 줄(CURRENCY_NOTES.md:9, #823F33 · > 접두 ·
    // 잔액 아래). 이 문구는 자금 부족(needs funding) 경우에만 쓴다 — 다른 실패엔 강제하지 않는다.
    failureLine: preflight?.status === "JOB_ELIGIBLE_NEEDS_FUNDING" ? "> cannot go · needs funding" : null,
    // cost: 실제 비용은 quote/실행비용 원천이 정해진 뒤에만 쓸 수 있다
    // (CURRENCY_NOTES.md:21). 현재 값은 mock_placeholder "0"(job-feed.js:372)라 비운다.
    costLine: null,
    // 예상 귀환: fixture 의 returnModel.maxWait 는 내부 enum("few_days",
    // job-feed.js:215)이고 승인된 영어 표기가 없다 — 발명하지 않고 비운다.
    returnEstimate: null,
    // 수령 값: 실제 claimable evidence 가 있을 때만(APP_HANDOFF.md:24/47). 숫자든 글자든
    // 같은 value 줄을 쓴다.
    // [A-421 감독 지적] evidence.claimable 은 단위 없는 게이트 증거(>0 판정용, DEV fixture "1")다 —
    // USD 환산값이 아니므로 화면 값으로 쓰지 않는다($ 강제·숫자 발명 금지, CURRENCY_NOTES). 환산 quote 가 생기면 연결.
    claimValue: null,
  };
}

// [A-411-r] Second Journey Explore 진입점. A-411-p 는 이 함수를 Chog 탭(onTap)에도
// 걸었으나, 그 배선은 Owner 최신 규칙과 충돌해 되돌렸다(mountHome() onTap 주석 참고) —
// 이제 이 함수를 부르는 자리는 mountHome() settle() 의 state.homeQuietForExplore
// 자동전개뿐이다. Chog 탭은 다시 관여하지 않는다.
function openSecondJourneyExplore() {
  if (!state.receipts.some((r) => r && r.txHash) && !(import.meta.env.DEV && state.secondJourney.devPreview)) return;
  const sj = state.secondJourney;
  const domainState = ensureSecondJourneyDomainState();
  sj.selectedIds = (domainState.interests || []).map((item) => item.errandId);
  sj.chosenDestinationId = null;
  sj.pickedCandidateId = null;
  sj.jitAnswer = null;
  sj.permission = false;
  sj.amount = "";
  sj.interestsNote = null;
  sj.chogSay = null;
  sj.note = null;
  sj.noteQueue = [];
  sj.decisionEventId = null;   // [A-579] 이전 판정 이벤트/읽기를 이어받지 않는다
  sj.returnRead = null;
  // [A-411-p] 옛 A-405-a 회귀동작("관심 있으면 곧장 candidates")을 Owner 확정으로 대체한다:
  // Second 를 이 세션에서 아직 한 번도 끝내지 않았으면 관심이 저장돼 있어도 항상 시작
  // Paper(interests)로 돌아간다("Second 이탈은 항상 시작점", A-411-n §1/A-411-p 대조).
  // Second 를 이미 한 번 끝낸 뒤의 다음 심부름 재진입만 candidates 로 곧장 간다.
  // seedStage 는 그대로 — 관심이 비어 있을 때만 다시 유추한다(최초 seed A/B 이어가기
  // 또는 반복 방문 단일 세트, A-405-a 로직 자체는 안 건드림).
  const resumeAtCandidates = state.secondJourneyCompletedOnce === true && sj.selectedIds.length > 0;
  sj.step = resumeAtCandidates ? "candidates" : "interests";
  sj.seedStage = sj.selectedIds.length ? "done" : inferSeedStage(domainState);
  // [A-475] 여기까지가 "처음부터" 이고, 아래가 "쓰다 만 자리로". Send 전에 나갔던 흔적이 있으면
  // 그 카드로 돌려준다 — 다시 입력하게 만들지 않는다. 단 **권한과 READY 는 복원하지 않는다**:
  // 아래 recomputeSecondJourneyFlow() 가 지금 조건으로 새로 계산한다(저장된 draft 가 문을 열지 않는다).
  applySecondDraftIfAny(sj, domainState);
  recomputeSecondJourneyFlow();
  setScene("explore", "", "");
}

// 저장해 둔 draft 를 지금 화면에 되살린다. 되살릴 수 없으면 **조용히 버리고 처음부터** —
// 빈 카드나 무한 복귀보다 낫다(stale destination·옛 버전·다른 계정 전부 여기서 걸러진다).
function applySecondDraftIfAny(sj, domainState) {
  if (import.meta.env.DEV && sj.devPreview === true) return null;
  const { draft } = loadSecondJourneyDraft(safeLocalStorage(), secondJourneyScope());
  if (!draft) return null;
  const displayedIds = computeExploreDisplayErrands({ ...sj, seedStage: draft.seedStage, selectedIds: draft.selectedIds })
    .map((errand) => errand.id);
  const known = new Set(buildVisibleLaneChoices().map((choice) => choice.id));
  const selected = (draft.selectedIds || []).filter((id) => known.has(id));

  sj.seedStage = draft.seedStage || sj.seedStage;
  if (selected.length) sj.selectedIds = selected;
  sj.amount = draft.amount || "";
  sj.jitAnswer = draft.jitAnswer;

  // destination 이 더 이상 유효하지 않으면 그 값만 버리고 후보 단계로 안전하게 내린다.
  const destinations = (sj.flow?.destinations || []).map((d) => d.id);
  const destOk = (id) => !id || destinations.length === 0 || destinations.includes(id);
  sj.pickedCandidateId = destOk(draft.pickedCandidateId) ? draft.pickedCandidateId : null;
  sj.chosenDestinationId = destOk(draft.chosenDestinationId) ? draft.chosenDestinationId : null;

  let step = draft.step;
  if (step === "readiness" && !sj.chosenDestinationId) step = "candidates";
  if (step === "jit" && !sj.pickedCandidateId) step = "candidates";
  if (step === "candidates" && !sj.selectedIds.length) step = "interests";
  if (step === "interests" && !displayedIds.length) step = "interests";
  sj.step = step;
  return step;
}

// [A-405] "표시 id == 선택가능 id" 를 여기서도 다시 지킨다 — DOM 에서 온 ids 를 그대로
// 믿지 않고, 지금 실제로 그려졌어야 할 bounded 세트(computeExploreDisplayErrands)에
// 없는 id 는 버린다. 빠르게 두 번 저장을 눌러도(예: 재렌더 전에 큐잉된 옛 클릭) 화면에
// 없던 항목이 섞여 들어가지 않는다.
// [A-472] 같은 화면에서 같은 선택을 두 번 저장해도 한 번만 학습되게 하는 멱등 키.
// 랜덤 키였을 때는 중복 가드가 통과돼 preference 가 재강화되고 seed 유추까지 어긋났다.
function exploreEventId(action, seedStage, ids) {
  return `explore-${action}-${seedStage || "a"}-${[...ids].sort().join(",")}`;
}

function handleExploreSave(ids) {
  const sj = state.secondJourney;
  const domainState = ensureSecondJourneyDomainState();
  const displayed = computeExploreDisplayErrands(sj);
  const displayedIds = displayed.map((errand) => errand.id);
  const safeIds = [...new Set(ids)].filter((id) => displayedIds.includes(id));
  const selectedErrands = safeIds.map((id) => displayed.find((errand) => errand.id === id)).filter(Boolean);

  if (selectedErrands.length === 0) {
    handleExploreNone();
    return;
  }

  const kind = selectedErrands.length === 1 ? "one" : "multi";
  const selection = { kind, errandIds: selectedErrands.map((errand) => errand.id), errands: selectedErrands };
  // [A-472] 여기까지 오던 preferenceUpdate 는 `preference: domainState.preference` 로 **기존 값을 그대로
  // 되먹이고** 있었다 — 계산(job-selector)과 저장(second-journey-state)이 만나지 않는 이중 배관이었다.
  // 이제 실제 학습을 통과시킨다. evidence 는 **지금 화면에 실제로 보여준 세트(displayed)** 뿐이다.
  const preferenceUpdate = updatePreference(domainState.preference, {
    kind,
    selectedJobs: selectedErrands,
    offeredJobs: displayed,
    offeredCount: displayed.length,
    setIndex: sj.seedStage === "b" ? 2 : 1,
  });
  const stateUpdate = applyExploreSelection(domainState, selection, preferenceUpdate, {
    // [A-472] 멱등 키 — 랜덤이면 second-journey-state 의 중복 가드가 무력해지고
    // processedEventIds 오염이 inferSeedStage 까지 번진다(같은 저장 두 번 = seed 단계 어긋남).
    eventId: exploreEventId("save", sj.seedStage, safeIds),
    now: new Date().toISOString(),
  });
  sj.domainState = stateUpdate.state;
  persistSecondJourneyDomainState();
  sj.selectedIds = selection.errandIds;
  persistSecondDraft();   // [A-475] 고른 즉시 남긴다
  // one/multi(= 지금 보여준 세트 전체를 골랐으면 그게 곧 "all") 선택은 A 든 B 든 seed
  // 시퀀스를 벗어나 기존 bounded preference + checking 흐름으로 합류한다(§A-405-a 3).
  sj.seedStage = "done";
  sj.interestsNote = null;
  sj.chogSay =
    selectedErrands.length === displayed.length && displayed.length > 1
      ? "all of them?"
      : selectedErrands.length === 2
        ? "these two?"
        : null;
  sj.candidatesRevealed = false;
  sj.step = "candidates";
  sj.chosenDestinationId = null;
  sj.pickedCandidateId = null;
  sj.jitAnswer = null;
  sj.permission = false;
  sj.amount = "";
  recomputeSecondJourneyFlow();
  render();
}

// [A-405-a] none 은 항상 weak hint 만 남긴다(applyExploreSelection 의 addsInterest 는
// kind:"none" 에서 false — 기존 관심 삭제0/신규 관심 추가0). 그 다음 어디로 가는지만
// seedStage 로 갈린다:
//   seed 세트A → Chog "…none?" / Paper "okay. one more." 를 같은 interests 화면에
//                얹고 세트B 로 목록만 교체(타이머 없음 — 카드 이탈 전까지 그대로 보인다)
//   seed 세트B → 종결 note("okay."/"maybe later.") 뒤 Home
//   그 외(반복 방문) → 종결 note 두 걸음("not these?"/"for now." 뒤 "maybe later.") 뒤 Home
function handleExploreNone() {
  const sj = state.secondJourney;
  const domainState = ensureSecondJourneyDomainState();
  const selection = { kind: "none", errandIds: [], errands: [] };
  // [A-472] none 도 같은 규율 — 보여준 세트만 dislike evidence 로 쓴다(안 보여준 항목 0).
  const displayedNone = computeExploreDisplayErrands(sj);
  const preferenceUpdate = updatePreference(domainState.preference, {
    kind: "none",
    selectedJobs: [],
    offeredJobs: displayedNone,
    offeredCount: displayedNone.length,
    setIndex: sj.seedStage === "b" ? 2 : 1,
  });
  const stateUpdate = applyExploreSelection(domainState, selection, preferenceUpdate, {
    eventId: exploreEventId("none", sj.seedStage, displayedNone.map((e) => e.id)),
    now: new Date().toISOString(),
  });
  sj.domainState = stateUpdate.state;
  persistSecondJourneyDomainState();
  sj.selectedIds = [];
  sj.chosenDestinationId = null;
  sj.pickedCandidateId = null;

  if (sj.seedStage === "A") {
    sj.seedStage = "B";
    sj.interestsNote = { chogLine: "…none?", paperLine: "okay. one more." };
    sj.step = "interests";
    recomputeSecondJourneyFlow();
    render();
    return;
  }

  if (sj.seedStage === "B") {
    beginExploreNoteSequence([{ chogLine: "okay.", paperLine: "maybe later." }]);
    return;
  }

  beginExploreNoteSequence([
    { chogLine: "not these?", paperLine: "for now." },
    { chogLine: "", paperLine: "maybe later." },
  ]);
}

// 목록 없는 종결 화면 큐 — render() 가 씬에 묶인 sceneTimeout 으로 한 걸음씩 넘긴다.
// 카드 이탈(다른 render()) 이 오면 teardownScene() 이 예약된 timeout 을 지워, 이미 닫힌
// 카드 위에 뒤늦게 다음 문구가 덮어씌워지지 않는다(§A-405 "빠른 중복입력/씬 이탈 가드",
// 기존 sceneTimeout/onSceneTeardown 패턴 재사용 — 새 타이머 체계 0).
function beginExploreNoteSequence(notes) {
  const sj = state.secondJourney;
  sj.step = "note";
  sj.interestsNote = null;
  sj.note = notes[0];
  sj.noteQueue = notes.slice(1);
  render();
}

function advanceExploreNote() {
  const sj = state.secondJourney;
  if (sj.step !== "note") return;
  if (sj.noteQueue.length) {
    sj.note = sj.noteQueue[0];
    sj.noteQueue = sj.noteQueue.slice(1);
    render();
    return;
  }
  sj.note = null;
  // [A-405-a] Piggy 출발0/Send0 — 그냥 Home. stayHome() 의 첫 Journey 전용 카피
  // ("Piggy stayed home today.")를 재사용하지 않고, goHomeFromFilebox() 와 같은
  // 중립 복귀만 쓴다(§禁 raw 내부 문자열 노출0, 새 카피 발명 최소화).
  setScene("sendstay", "", "");
}

// [A-421 Owner "시간이랑 고른거 다기록해야해"] 후보 누름·ok 를 시각과 함께 남긴다.
const SECOND_PICK_LOG_KEY = "araso.secondJourneyPicks";
function recordSecondPick(event, destinationId) {
  const destination = (state.secondJourney.flow?.destinations || []).find((d) => d.id === destinationId) || null;
  const entry = { event, destinationId, action: secondActionTitle(destination) || null, at: new Date().toISOString() };
  try {
    const log = JSON.parse(localStorage.getItem(SECOND_PICK_LOG_KEY) || "[]");
    log.push(entry);
    localStorage.setItem(SECOND_PICK_LOG_KEY, JSON.stringify(log));
  } catch {}
}

function handleCandidatePick(destinationId) {
  const sj = state.secondJourney;
  sj.pickedCandidateId = destinationId;
  persistSecondDraft();   // [A-475] 후보 선택 즉시
  recordSecondPick("pick", destinationId);
  render();
}

function handleCandidateOk() {
  const sj = state.secondJourney;
  if (!sj.pickedCandidateId) return;
  recordSecondPick("ok", sj.pickedCandidateId);
  handleCandidateCheck(sj.pickedCandidateId);
}

function handleCandidateCheck(destinationId) {
  const sj = state.secondJourney;
  sj.chosenDestinationId = destinationId;
  sj.jitAnswer = null;
  sj.decisionEventSeq += 1;   // [A-579] 판정 이벤트 하나 — 같은 ms 안의 두 check 도 서로 다른 이벤트다
  sj.decisionEventId = `check:${destinationId}:${new Date().toISOString()}:${sj.decisionEventSeq}`;
  sj.returnRead = null;
  sj.step = "readiness";
  persistSecondDraft();   // [A-475] 금액 카드로 넘어온 자리
  recomputeSecondJourneyFlow();
  render();
}

function handleJitAnswer(value) {
  state.secondJourney.jitAnswer = value;
  persistSecondDraft();   // [A-475] 사용자가 실제로 답한 입력만 남긴다
  recomputeSecondJourneyFlow();
  render();
  recordSecondJourneyDecisionForAnswer().catch(() => {});   // [A-579] 화면 변화 0 — 기록 실패가 화면을 막지 않는다
}

// [A-629] LOCAL_ONLY harness reader config — { rpcUrl } only, https only. null everywhere else.
function localTestReturnReadConfig() {
  if (!LOCAL_DEV_ENTRY) return null;
  let hook = null;
  try { hook = window[LOCAL_TEST_RETURN_READ_HOOK]; } catch { return null; }
  if (!hook || typeof hook !== "object" || typeof hook.rpcUrl !== "string" || !/^https:\/\/[^\s]+$/.test(hook.rpcUrl)) return null;
  return { rpcUrl: hook.rpcUrl };
}

// [A-629] LOCAL_ONLY harness fixture→Job bindings — { destinationId: jobId } strings only.
// job-feed.js still refuses an unknown Job, an already bound fixture, or a family mismatch.
function localTestJobBindings() {
  if (!LOCAL_DEV_ENTRY) return undefined;
  let hook = null;
  try { hook = window[LOCAL_TEST_JOB_BINDINGS_HOOK]; } catch { return undefined; }
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) return undefined;
  const bindings = {};
  for (const [destinationId, jobId] of Object.entries(hook)) {
    if (destinationId.length <= 64 && typeof jobId === "string" && jobId.length > 0 && jobId.length <= 64) bindings[destinationId] = jobId;
  }
  return Object.keys(bindings).length ? bindings : undefined;
}

// [A-579] 답 하나 = 판정 하나. 이 이벤트를 위해 read-only 로 읽고(설정이 없으면 읽지 않고
// unknown), 그 판정의 action-0 Receipt 를 기존 Second Journey 저장소(같은 키 · receipts 배열)에
// 남긴다. render() 를 부르지 않는다 — 보이는 것은 바뀌지 않는다. 권한·READY 를 만들지 않는다.
async function recordSecondJourneyDecisionForAnswer() {
  const sj = state.secondJourney;
  if (import.meta.env.DEV && sj.devPreview === true) return;   // fixture 는 남기지 않는다
  if (!sj.jitAnswer || !sj.chosenDestinationId || sj.outcome) return;
  // draft 로 되돌아온 readiness 에서 다시 답한 경우 — check 이벤트 id 가 없으면 이 답이 이벤트다.
  if (!sj.decisionEventId) {
    sj.decisionEventSeq += 1;
    sj.decisionEventId = `answer:${sj.chosenDestinationId}:${new Date().toISOString()}:${sj.decisionEventSeq}`;
  }
  const eventId = sj.decisionEventId;
  const answer = sj.jitAnswer;
  const destinationId = sj.chosenDestinationId;
  const chosen = (sj.flow?.destinations || []).find((d) => d.id === destinationId) || null;
  const jobId = chosen?.boundJobId || null;
  if (!jobId) return;   // 실제 Job 에 묶인 목적지만 판정 Receipt 를 낸다
  // [A-629] product config first. The LOCAL_ONLY harness reader is used only while it is null.
  const localReadConfig = RETURN_EVIDENCE_READ_CONFIG ? null : localTestReturnReadConfig();
  const readConfig = RETURN_EVIDENCE_READ_CONFIG || localReadConfig;
  const read = readConfig
    ? await readReturnObservation(jobId, {
      rpcUrl: readConfig.rpcUrl,
      fetchImpl: (...args) => fetch(...args),
      now: () => new Date().toISOString(),
    })
    : { observation: null, status: "reader_unconfigured" };
  // 읽는 동안 사용자가 다른 곳으로 갔으면 이 판정은 버린다(늦게 온 읽기가 새 이벤트에 붙지 않는다).
  if (state.secondJourney !== sj || sj.decisionEventId !== eventId || sj.jitAnswer !== answer || sj.chosenDestinationId !== destinationId) return;
  const readStatus = localReadConfig ? `local_test_reader:${read.status}` : read.status;
  sj.returnRead = { eventId, answer, jobId, observation: read.observation || null, status: readStatus, at: new Date().toISOString() };
  recomputeSecondJourneyFlow();
  const receipt = sj.flow?.decisionReceipt;
  if (!receipt) return;
  const out = recordSecondJourneyDecisionReceipt(ensureSecondJourneyDomainState(), receipt);
  if (!out.recorded) return;
  sj.domainState = out.state;
  persistSecondJourneyDomainState();
}

// [A-377 §6] 한 걸음만 되돌린다, 선택은 보존한다 — readiness 단계 안에는 실제로 두
// 페이지가 있다(질문 화면 / READY+Permission+amount 화면). 질문에 이미 답한 뒤라면
// 그 답만 지우고 질문 화면으로 돌아간다(후보 선택은 그대로). 아직 질문 전(또는 질문이
// 필요 없는 후보)이면 후보 목록으로 돌아간다(관심 선택은 그대로 — Home 닫기가 아니다).
function handleReadinessBack() {
  const sj = state.secondJourney;
  const hasJitQuestion = (sj.flow?.jitQuestions?.length || 0) > 0;
  sj.returnRead = null;   // [A-579] 다음 답은 새로 읽는다
  if (hasJitQuestion && sj.jitAnswer) {
    sj.jitAnswer = null;
    recomputeSecondJourneyFlow();
    render();
    return;
  }
  sj.step = "candidates";
  sj.chosenDestinationId = null;
  sj.pickedCandidateId = null;
  sj.jitAnswer = null;
  sj.decisionEventId = null;   // [A-579] check 이벤트가 끝났다
  recomputeSecondJourneyFlow();
  render();
}

// 입력창마다 전체 render() 를 다시 돌리면 포커스/커서가 끊긴다 — Send 버튼/사유 줄만
// 직접 손본다(fitCardAnchor 류 기존 관례와 같다).
function updateSecondJourneyReadinessUI() {
  const sj = state.secondJourney;
  const btn = document.querySelector("#secondSendButton");
  if (!btn) return;
  const devPreview = import.meta.env.DEV && sj.devPreview === true;
  const preflight = sj.flow?.preflight || null;
  const chosenForSend = (sj.flow?.destinations || []).find((d) => d.id === sj.chosenDestinationId) || null;
  const needsAmount = readinessCardKind(chosenForSend) !== "collect";
  const canSend =
    devPreview &&
    preflight?.status === "JOB_READY" &&
    preflight?.executionPermission === true &&
    (!needsAmount || validateSecondAmount(sj.amount).valid);
  btn.disabled = !canSend;
  const reasonEl = document.querySelector("#secondSendReason");
  if (reasonEl) reasonEl.textContent = secondJourneySendReason(preflight, devPreview);
  const preflightEl = document.querySelector("#secondJourneyPreflightLine");
  // [A-421 v25] READY 의 "Send this one?" 제목은 이 카드에서 제거됐다
  // (CURRENCY_NOTES.md:18) — 상태줄도 READY 면 비운다(second-journey-view.js 동일 규칙).
  if (preflightEl) preflightEl.textContent = preflight && preflight.status !== "JOB_READY" ? paperStatusCopy(preflight.status) : "";
  // [A-421 v25] 실패 줄(.failure)은 승인된 케이스별 카피가 있을 때만 켠다. 내부 reason
  // 코드나 스타일 예시 문구("cannot go · needs funding", CURRENCY_NOTES.md:9)를 공통
  // 문구로 쓰지 않는다 — 현재는 채울 승인 카피가 없어 항상 비어 있고 숨는다.
  const failureEl = document.querySelector("#secondAmountError");
  if (failureEl) {
    const chosen = (sj.flow?.destinations || []).find((d) => d.id === sj.chosenDestinationId) || null;
    const line = secondJourneyV25Lines(chosen, preflight).failureLine;
    failureEl.textContent = line || "";
    failureEl.hidden = !line;
  }
}

// 실제 경로에서는 devPreview 가 항상 false 라 canSend 가 절대 true 가 될 수 없다
// (recomputeSecondJourneyFlow 의 ruleAgreed/evidence 도 devPreview 로만 채워진다) —
// 이 함수 자신도 다시 한 번 같은 조건을 확인한다(fail closed 이중 방어, §금지 "새로운
// 금융 adapter/서명/permission 부여는 이번 범위 아님").
function handleSecondSend() {
  const sj = state.secondJourney;
  const devPreview = import.meta.env.DEV && sj.devPreview === true;
  const preflight = sj.flow?.preflight;
  // 버튼 disabled 에만 기대지 않고 실행 직전에 금액을 다시 검증한다.
  const chosenForSend = (sj.flow?.destinations || []).find((d) => d.id === sj.chosenDestinationId) || null;
  const needsAmount = readinessCardKind(chosenForSend) !== "collect";
  const canSend =
    devPreview &&
    preflight?.status === "JOB_READY" &&
    preflight?.executionPermission === true &&
    (!needsAmount || validateSecondAmount(sj.amount).valid);
  if (!canSend) return;
  sj.mockReceipt = sj.flow.mockReceipt;
  // [A-472] 여기가 First 의 writeSendPending 에 대응하는 자리다 — 게이트를 통과한 유일한 지점.
  // 아직 확정이 아니다. 확정은 아래 Away 에서 결과를 읽은 뒤에만 선다.
  sj.outcome = "pending";
  // [A-475] 여기서부터는 draft 가 아니라 실행 lifecycle 이다. 되돌아가 재전송시키지 않는다.
  dropSecondDraft();
  // [A-419 Source evidence] 승인 발화표에 Away 설명문이 없다 — DRAFT 조합을 앱에 넣지
  // 않는다(위 secondAway 렌더 주석 참고). 문구는 비우고 표시 자체를 없앤다. 승인된
  // 문장이 오면 여기서 세운다.
  sj.awayLine = "";
  setScene("secondAway", "", "");
}

function wireExploreCard() {
  const sj = state.secondJourney;
  document.querySelector("#exploreSaveButton")?.addEventListener("click", () => {
    const ids = [...document.querySelectorAll('#exploreForm input[type="checkbox"]:checked')].map((el) => el.dataset.errandId);
    handleExploreSave(ids);
  });
  document.querySelector("#exploreEditButton")?.addEventListener("click", () => {
    // [A-405] edit interests 는 seed 재방문이 아니다 — 항상 "done"(단일 bounded 세트,
    // 이미 고른 id 우선 유지 — computeExploreDisplayErrands 참고).
    sj.seedStage = "done";
    sj.interestsNote = null;
    sj.step = "interests";
    render();
  });
  document.querySelector("#exploreBackButton")?.addEventListener("click", handleReadinessBack);
  // [A-421] 옛 사각 `.secondJourney__checkBtn` 대신 확정 종이 버튼(.pkbtn)을 쓰는
  // second-journey-view.js checkButtonMarkup() 이 내놓는 순수 JS 훅 클래스로 맞춘다.
  document.querySelectorAll(".secondJourney__pick").forEach((btn) => {
    btn.addEventListener("click", () => handleCandidatePick(btn.dataset.destinationId));
  });
  document.querySelector("#secondOkButton")?.addEventListener("click", handleCandidateOk);
  document.querySelectorAll(".secondJourney__jitBtn").forEach((btn) => {
    btn.addEventListener("click", () => handleJitAnswer(btn.dataset.jitAnswer));
  });
  // [A-421 v25] 옛 `#secondPermission` 체크박스는 사용자 화면에서 제거됐다 — 배선도
  // 함께 없앤다(권한 요구는 recomputeSecondJourneyFlow()/second-job-readiness.js 쪽에
  // 그대로 남아 있다, 위 주석).
  const amountInput = document.querySelector("#secondAmount");
  amountInput?.addEventListener("input", () => {
    sj.amount = amountInput.value;
    persistSecondDraft();   // [A-475] 타이핑 즉시 — beforeunload 에 기대지 않는다
    recomputeSecondJourneyFlow();
    updateSecondJourneyReadinessUI();
  });
  document.querySelector("#secondSendButton")?.addEventListener("click", handleSecondSend);
}

function renderExplore() {
  const piggyName = displayPiggyName();
  const cardMarkup = secondJourneyCardMarkup(buildSecondJourneyViewModel());
  return `
    <section class="stage" data-scene="explore">
      ${buttonInkFilter()}
      ${corner("explore")}
      <canvas class="departStage" id="secondWorkStage" aria-hidden="true"></canvas>
      ${homeCharacter(piggyName)}
      <div class="cardAnchor" id="sendCardAnchor">
        <div class="cardAnchor__fit">${cardMarkup}</div>
      </div>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// Away/Return 모션 재사용 — piggy-depart.js/piggy-return.js(main.js 가 첫 Journey에
// 이미 쓰는 그 함수들) 그대로. 새 모션·새 캐릭터 0(§3). 완료 콜백은 "애니메이션이
// 끝났다"는 뜻일 뿐이라 실제 tx 완료 판정과 섞이지 않는다 — 여기선 그런 판정 자체가 없다
// (mock 만 있다).
function renderSecondAway() {
  return `
    <section class="stage" data-scene="secondAway">
      <canvas class="departStage" id="departStage" aria-hidden="true"></canvas>
      <div class="homeBoard" id="homeBoard">
        ${chogHomeMarkup({ padMarkup: homePadMarkup("away") })}
      </div>
      ${corner("secondAway")}
      ${
        // [A-419 Source evidence] 이 자리의 중앙 설명문은 승인 발화표에 없다.
        // 정본 역할표(onboarding_scenes_20260916/README.md:102-115, NOTES:570-578)의
        // Away 몫은 `Piggy : work? → yay → grab → go (말 없음, 동작만)` — Piggy 는
        // 말하지 않는다. "Piggy is checking a second errand."(구) 도, 내가 발주해 넣게
        // 한 "Piggy went out on a second errand."(신) 도 둘 다 작업자 DRAFT 조합이고
        // SOURCE PASS 가 아니다. 카드가 "임의 대체문구 발명 0 / 중앙 잔류 0" 을
        // 명시했는데 내가 문구 교체를 발주한 것이 지시 위반이었다 — 대체가 아니라
        // 제거가 맞다. First Away 도 같은 이유로 이미 이 자리를 비웠다(A-415 §4).
        // 새 문구를 넣지 않는다. 승인된 Away 문장이 오면 그때 이 자리에 붙인다.
        ""
      }
      <p class="secondJourney__mockTag">UI preview — no transaction</p>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// [A-472] Second 의 결과 확정. **재생이 아니라 결과가 이 값을 정한다.**
// 지금 Second 는 실제 체인 실행이 없으므로(J2-6 미개시) 확정 근거는 DEV mock 뿐이다 —
// mock 이 실행됐다고 말하지 않는 한 done 이 되지 않는다(fail-closed).
// 실제 adapter 가 붙으면 이 함수 하나에 실 결과를 물리면 된다.
function settleSecondOutcome(forced = null) {
  const sj = state.secondJourney;
  if (forced) { sj.outcome = forced; return sj.outcome; }
  if (sj.outcome === "done" || sj.outcome === "failed") return sj.outcome;
  const receipt = sj.mockReceipt;
  const confirmed = !!receipt && receipt.attempted === true && receipt.decidedStatus === "JOB_READY";
  sj.outcome = confirmed ? "done" : "failed";
  return sj.outcome;
}

function mountSecondAway() {
  const chogRoot = document.querySelector("#chogHome");
  const boardFit = fitHomeBoard();
  if (chogRoot && boardFit) {
    homeChog = mountChogHome(chogRoot, {
      startRect: null,
      startSrc: null,
      board: boardFit.rect,
      reduced: prefersReducedMotion(),
      cardClaimed: true,
      onFrame: (step) => runSceneFrames(step),
      onCleanup: (fn) => onSceneTeardown(fn),
      listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
    });
    onSceneTeardown(() => {
      homeChog = null;
    });
  }
  const token = sceneToken;
  let stopped = false;
  let advanced = false;
  onSceneTeardown(() => {
    stopped = true;
  });
  const advanceToReturn = () => {
    if (advanced || stopped || token !== sceneToken) return;
    // [A-472] 재생이 끝났다는 이유만으로 귀환하지 않는다. 확정된 결과일 때만 통과시킨다 —
    // 세 호출 지점(자산 실패·재생 완료·캔버스 없음)을 여기 한 곳에서 막는다.
    if (state.secondJourney.outcome !== "done") return;
    advanced = true;
    // [A-421] Second 단수 귀환도 First 성공 경로(finishTrip §974-978)와 같은 표를 세운다 —
    // chogHomeMarkupForReturn() 이 이 표만 보고 알람 발화 span 을 붙이고,
    // beginReturnArrivalAlarm() 이 벨 뒤 한 박자에 그 hidden 을 벗긴다. 재생 표
    // (returnArrival)는 건드리지 않는다 — Second 는 mountSecondReturn 이 play:true 고정.
    state.returnArrivalAlarm = true;
    setScene("secondReturn", "", "");
  };
  const canvas = document.querySelector("#departStage");
  if (!canvas) {
    sceneListener(window, "resize", () => {
      fitHomeBoard();
    });
    // [A-407-g] render() 의 씬 분기(맨 아래 if (state.scene === ...) 사슬, 이 함수를
    // 부른 그 자리)는 **하나의 render() 호출 안에서** 여러 if 를 차례로 검사한다 —
    // 여기서 advanceToReturn() 을 바로 부르면 setScene()→render() 가 지금 이
    // mountSecondAway() 를 부른 그 render() 호출 **안에서 재진입**해 버린다. 그러면
    // secondReturn 으로 다 넘어간 뒤에도 바깥 render() 가 이어서 `if (state.scene ===
    // "secondReturn") mountSecondReturn()` 을 한 번 더 실행해(state.scene 이 그 사이
    // 바뀌었으므로) mountReturnView 가 두 번 붙는다. mountSecondReturn 의 onIdleEnter 가
    // 이미 쓰는 것과 같은 방법(`sceneTimeout(fn, 0)`)으로 한 걸음 미뤄, 이 render() 가
    // 완전히 끝난 **다음**에 전환하게 한다 — 게이트·문구·완료판정은 그대로다.
    sceneTimeout(advanceToReturn, 0);
    return;
  }
  const fit = () => {
    const s = Math.min(window.innerWidth / 1256, window.innerHeight / 772);
    canvas.width = Math.round(1256 * s * (window.devicePixelRatio || 1));
    canvas.height = Math.round(772 * s * (window.devicePixelRatio || 1));
    canvas.style.width = `${1256 * s}px`;
    canvas.style.height = `${772 * s}px`;
    fitHomeBoard();
  };
  fit();
  sceneListener(window, "resize", fit);
  const reduced = prefersReducedMotion();
  const playback = createDepartPlayback({
    canvas,
    isValid: () => !stopped && token === sceneToken,
    schedule: (step) => runSceneFrames(step),
    reduced,
    onStatus: (st) => {
      // [A-472] 자산 로딩 실패는 **그림을 못 불렀다**는 뜻이지 심부름이 끝났다는 뜻이 아니다.
      // 예전에는 성공 완료와 같은 함수로 전진해 Return 을 열었고, 거기서 Home 을 누르면
      // 완료가 영속됐다 — 실패가 성공으로 굳는 경로였다. 이제 조용한 Home 으로 접는다
      // (First 의 finishTrip 실패 분기와 같은 모양).
      if (st.phase === "asset-missing" || st.phase === "asset-error") {
        settleSecondOutcome("failed");
        return;
      }
      if (st.phase === "complete" || st.phase === "reduced-final") {
        settleSecondOutcome();      // 재생 끝 → 그제서야 결과를 읽는다
        advanceToReturn();          // 확정(done)일 때만 통과한다
      }
    },
  });
  onSceneTeardown(() => playback.stop());
  sceneListener(window, "resize", () => playback.redraw());
  playback.start();
}

function renderSecondReturn() {
  return returnSceneMarkup({
    // [A-421] Owner 승인 "가운데 문구가 남으면 안돼" — First(line: "")와 동일, 발화는 알람 한 줄뿐.
    line: "",
    receiptRowsMarkup: receiptPaperMarkup(secondJourneyReceiptFields(state.secondJourney.mockReceipt, displayPiggyName())),
    name: displayPiggyName(),
    // [A-421] First 와 **같은** 귀환 markup 경로 — 알람 발화 span(#returnArrivalAlarm)이
    // 여기서만 붙는다. 이전에는 plain chogHomeMarkup() 이라 Second 는 어떤 상태에서도
    // 알람 DOM 자체가 없었다(감독 OUTBOX 지적). 새 문구/새 자산 0 — 같은 함수 재사용.
    homeChogMarkup: chogHomeMarkupForReturn("return"),
    devExtra: `<p class="secondJourney__mockTag">UI preview — no transaction</p>${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}`,
  });
}

// mountReturnView() 는 finance 를 모른다(return-view.js header) — 그래서 첫 Journey와
// 그대로 같이 쓸 수 있다. onOpenFilebox 를 filebox 가 아니라 곧장 Home 으로 접는다
// (§3 "정리→Home", 첫 Journey 의 "정리→filebox" 와 다르다 — 스펙이 그렇게 못박았다).
function mountSecondReturn() {
  const token = sceneToken;
  let stopped = false;
  onSceneTeardown(() => {
    stopped = true;
  });
  const valid = () => !stopped && token === sceneToken;
  // [A-462] persist=false 는 "완료 사실로 저장하지 않는다"는 뜻이다. 메모리 표는 기존과 같이
  // 세운다(이 세션의 동작 변경 0) — 저장만 갈라낸다.
  const finishSecondJourney = ({ persist = false } = {}) => {
    if (!valid()) return;
    // [A-472] 성공했을 때만 바퀴가 닫힌다(First finishTrip 과 같은 원칙).
    // 실패로 들어온 Return 에서 Home 을 눌러도 완료가 영속되지 않는다.
    const confirmed = state.secondJourney.outcome === "done";
    const persistNow = persist && confirmed;
    // [A-499 Lane R] 결과가 실제로 정해진 자리에서만 영수증을 넘긴다.
    // 이 훅은 **문을 열어 두는 것**이지 J2-6 이 끝났다는 뜻이 아니다 — 오늘 second 흐름의
    // 유일한 영수증은 DEV mock 이고, bridge 의 첫 관문이 그걸 거절한다(동작 변경 0).
    // 문은 실행 어댑터가 evidenceClass/executionMode(live 면 txHash)를 채울 때 비로소 열린다.
    // 원시 recordSecondJourneyReceipt 를 직접 부르지 않는다 — 게이트를 건너뛰게 된다.
    commitSecondReceiptIfReal();
    // [A-626 C] 보이는 Journey 번호(buildSecondJourneyViewModel)의 세션 카운트도 확인된 완료(persistNow)만
    // 센다 — DEV 점프·onError·idle 진입은 번호를 올리지 않는다. 한 번 true 면 내리지 않는다.
    if (persistNow) state.secondCompletedThisSession = true;
    if (persistNow) markResultMotionSeen();
    dropSecondDraft();   // [A-475] 끝난 바퀴의 draft 는 남기지 않는다 // Second: 사용자가 Home 을 눌러 실제로 끝낸 자리
    if (persistNow) {
      try {
        localStorage.setItem(SECOND_JOURNEY_CLOSED_KEY, "1");
      } catch {
        // 저장 실패는 조용히 넘긴다 — 완료 자체를 되돌리지 않는다(다음 재방문에 Explore 가
        // 다시 열릴 뿐, 가짜 완료를 만들지는 않는다).
      }
    }
    const prior = state.secondJourney;
    // [A-411-p] Second 를 이 세션에서 실제로 한 번 끝냈다는 표 — openSecondJourneyExplore()
    // 의 candidates 직행 판정과 settle() 의 자동 quiet→Paper 억제("Second 완료: Explore
    // 자동재실행 0")가 이 값을 읽는다. 세션 메모리일 뿐, 저장소 스키마를 늘리지 않는다.
    // [A-624 D2] 메모리 표도 저장 키와 **같은 확인**(persistNow = Home 탭 + outcome "done")을
    // 따른다. 이전에는 무조건 true 라, DEV-jump Return·onError(모션 자산 실패, 비-DEV 경로)로
    // 끝난 확인되지 않은 Second 에서도 이 세션 동안 `+ Piggy`/peek(showAddPiggyTab)·
    // beginAddPiggy 게이트가 열렸다(키는 null — A-624 sj d2_pre dev390 A/C 재현). 이미 true 면
    // (이전 확인·저장된 완료) 내리지 않는다.
    if (persistNow) state.secondJourneyCompletedOnce = true;
    state.secondJourney = createEmptySecondJourney();
    // Keep the in-memory interest/domain snapshot; clear only the transient run.
    state.secondJourney.domainState = prior.domainState;
    state.secondJourney.persisted = prior.persisted;
    state.secondJourney.devPreview = prior.devPreview;
    state.secondJourney.selectedIds = [...prior.selectedIds];
    // [A-447] Second 완료 = quiet Home. First Send 카드 표가 남아 있으면 sendstay 가 그 카드를 다시
    // 그린다(A-446 a446-22) — 진입 전에 내린다. 정상·onError·onIdleEnter 가 모두 이 함수를 지난다.
    state.sendCardVisible = false;
    setScene("sendstay", "Piggy is home.", "Second errand filed. (preview)");
  };
  // [A-421] First(mountReturn)와 같은 알람 생명주기 — 씬 이탈 정리 + 벨 뒤 한 박자
  // 발화 공개. 구현은 공용 beginReturnArrivalAlarm() 하나뿐이다(두 번째 구현 0).
  const hadAlarm = beginReturnArrivalAlarm(valid);
  const returnView = mountReturnView({
    isValid: valid,
    schedule: (step) => runSceneFrames(step),
    listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
    onCleanup: (fn) => onSceneTeardown(fn),
    fitBoard: () => fitHomeBoard(),
    mountHomeChog: (chogRoot, o) => {
      homeChog = mountChogHome(chogRoot, {
        startRect: null,
        startSrc: null,
        board: o.board,
        reduced: prefersReducedMotion(),
        cardClaimed: true,
        onFrame: (step) => runSceneFrames(step),
        onCleanup: (fn) => onSceneTeardown(fn),
        listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
      });
      return homeChog;
    },
    reduced: prefersReducedMotion(),
    play: true,
    // [A-466] 첫 결과에서는 숨기고, 그 뒤 Return 부터 보인다.
    allowSkip: state.resultMotionSeen === true,
    openFileLabel: "Home",
    // [A-462] **영속 저장은 이 경로 하나뿐이다** — 사용자가 Home 을 눌러 실제로 끝낸 자리.
    onOpenFilebox: () => finishSecondJourney({ persist: true }),
    // onError 는 **자산 로딩 실패**(return-view.js: phase asset-missing/asset-error)이지 Second 를
    // 끝냈다는 사실이 아니다. 지금은 Second 가 mock 이라 금융 실패 phase 가 없지만, 실제 tx 가
    // 붙으면 이 자리에 금융 실패가 들어올 수 있다 — 그때 조용히 "실패인데 완료로 영속"이 되지
    // 않도록 지금 갈라 둔다. 화면 동작(quiet Home)은 그대로다.
    onError: () => finishSecondJourney({ persist: false }),
    // onIdleEnter 는 재생 없는 진입이다. mountSecondReturn 은 play:true 고정이라 실사용에서는
    // 도달하지 않고 **DEV 씬점프에서만** 온다 — 씬 점프로 완료 사실을 영구히 남기지 않는다.
    onIdleEnter: () => {
      sceneTimeout(() => finishSecondJourney({ persist: false }), 0);
    },
  });
  // [A-421] 파일링 완료 시 알람 제거 — First 와 같은 공용 구현.
  endReturnArrivalAlarmWhenFiled(hadAlarm, returnView, valid);
}

// [A-466] 첫 결과를 **끝까지** 정리한 뒤에만 선다. 실패·중단·새로고침으로는 서지 않는다.
function markResultMotionSeen() {
  if (state.resultMotionSeen) return;
  state.resultMotionSeen = true;
  try {
    localStorage.setItem(RESULT_MOTION_SEEN_KEY, "1");
  } catch {
    // 저장 실패는 조용히 넘긴다 — 다음 결과에서 전체 재생이 한 번 더 돌 뿐이다(가짜 상태 0).
  }
}

function goHomeFromFilebox() {
  markResultMotionSeen(); // First: File it → Filebox → Home 까지 온 자리
  // [A-411-p] 서류철 정리 뒤 Home 복귀 — "First Receipt filed → 정착 → 잠깐 조용 → Paper"
  // 의 실제 진입점이다. Second 를 이 세션에서 이미 끝냈다면 세우지 않는다(Owner "Second
  // 완료: 조용한 Home만, Explore 자동재실행 0").
  state.homeQuietForExplore = !state.secondJourneyCompletedOnce;
  setScene("sendstay", "Piggy is home.", "");
}

// [A-383 §1] Home 피기 칸의 "records" entry — 별도 화면 전환이 아니라 Home 카드 오른쪽에
// 기록 카드를 편다. 읽기 전용: 아무것도 저장하지 않는다(§3 "반복탭이 영수증을 새로
// 저장하지 않게"). setScene()/render() 를 부르지 않는다 — 부르면 render() 의
// teardownScene() 이 mountChogHome() 을 처음부터 다시 마운트해 이미 손끝-고정(pinned)으로
// 열려 있는 Home 카드가 닫혀 버린다(chog-home.js mountChogHome, `let pinned = false`
// 초기값). 그래서 여기서는 이미 그려져 있던(hidden) 기록 카드 DOM만 그대로 채워 보여준다.
// [A-387 → A-607 REWORK → A-608 web freeze partial revert] Codex's own real-screen review
// found the old "common Send anchor IS the real Home paper" assumption wrong —
// `alignRecordsCardToHomePaper()` fixed that by reading `.homePaper`'s own live rect every
// frame. A-607's Owner addenda moved Records to a fixed left-rail anchor instead. The
// 2026-09-27 "FREEZE ALL WEB" correction reverts that specifically for web ("Home+Records
// web is also reference/frozen") — so `alignRecordsCardToHomePaper()`/
// `startRecordsAlignLoop()`/`setHomeTwoCardShift()` are ACTIVE again, but
// `alignRecordsCardToHomePaper()` itself now no-ops at ≤640px (see its own comment) so
// narrow keeps A-607's fixed CSS positioning undisturbed. [A-621] current mobile behavior:
// HISTORY stacks over the unmoved HOME from viewer-right — stackMobileRecordsOverHome().
function openRecordsCard() {
  const anchor = document.querySelector("#recordsCardAnchor");
  if (!anchor) return;
  state.recordsCardVisible = true;
  state.recordsDetailIndex = null;
  // [A-411] 두 카드 왼쪽 이동은 anchor.hidden 을 풀기 전, opening 클래스를 걸기 전에
  // 먼저 건다 — 그래야 open transition 첫 프레임부터 이미 옮겨진 자리에서 시작해
  // Piggy 귀와 겹치는 중간 프레임이 없다(§3 "opening transition 도 확인"). [A-608] 이
  // 겹침 회피는 웹에서만 여전히 의미가 있다(Records 가 다시 .homePaper 옆에 붙으므로) —
  // `setHomeTwoCardShift()` 자신이 좁은 화면에서는 별 효과 없는 로컬-px 계산이라 그대로
  // 불러도 무해하지만, 명확성을 위해 여기서도 web 폭에서만 부른다.
  // [A-623] the width decision now lives in syncRecordsViewportState() (one owner, re-run by
  // every align call so a live 640px crossing can't leave a stale shift/inert state).
  syncRecordsViewportState();
  renderRecordsCardBody();
  alignRecordsCardToHomePaper();
  // [A-387-a] Owner 지시: 카드가 Home 옆으로 스르륵 열리는 짧은 open transition만(새
  // 모션 디자인 확대 금지) — 숨김을 풀기 **전에** .recordsCardAnchor--opening(초기
  // opacity 0/이동)을 먼저 걸어 둬야 첫 페인트가 이미 그 상태로 나가고, 다음 프레임에
  // 떼면 CSS transition 이 자연스럽게 걸린다(순서를 반대로 하면 한 프레임 풀-오퍼시티로
  // 반짝인 뒤 되감기는 것처럼 보인다). reduced-motion 은 즉시 표시(클래스를 아예 걸지
  // 않는다 — CSS 쪽에도 안전망으로 media query 를 뒀다).
  const reduced = prefersReducedMotion();
  // [A-621] a reopen during the mobile exit cancels it (no stale `--closing` class/timer).
  clearRecordsExitTimer();
  anchor.classList.remove("recordsCardAnchor--closing");
  if (!reduced) anchor.classList.add("recordsCardAnchor--opening");
  anchor.hidden = false;
  if (!reduced) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => anchor.classList.remove("recordsCardAnchor--opening"));
    });
  }
  startRecordsAlignLoop();
}

// 닫으면 원래 Home 그대로(§4) — 기록 카드만 숨기고 그 옆 Home 카드는 손대지 않는다.
function closeRecordsCard() {
  state.recordsCardVisible = false;
  state.recordsDetailIndex = null;
  stopRecordsAlignLoop();
  const anchor = document.querySelector("#recordsCardAnchor");
  clearRecordsExitTimer();
  if (anchor) {
    anchor.classList.remove("recordsCardAnchor--opening");
    // [A-621] mobile stacked HISTORY exits toward viewer-right (style.css ≤640px
    // `--closing` = the same 160ms opacity/transform transition, mirrored), then hides. HOME
    // is never touched by this — it never moved on open. Web keeps its immediate hide (frozen);
    // reduced motion hides immediately (identical final state).
    if (window.innerWidth <= 640 && !anchor.hidden && !prefersReducedMotion()) {
      anchor.classList.add("recordsCardAnchor--closing");
      recordsExitTimer = window.setTimeout(() => {
        recordsExitTimer = 0;
        anchor.classList.remove("recordsCardAnchor--closing");
        if (!state.recordsCardVisible) anchor.hidden = true;
      }, RECORDS_EXIT_MS);
    } else {
      anchor.hidden = true;
      anchor.classList.remove("recordsCardAnchor--closing");
    }
  }
  // [A-411 → A-608] 기록 카드를 치우면 두 카드 이동도 즉시 되돌린다 — web 에서만 걸었던
  // 것이므로 여기서는 조건 없이 항상 꺼도 안전하다(narrow 에서는 애초에 켠 적이 없다).
  // [A-623] recordsCardVisible is false here → shift off AND HOME background controls live
  // again immediately (not after the 180ms mobile exit).
  syncRecordsViewportState();
}

// [A-623] the single owner of the two viewport-dependent pieces of "Records is open" state:
//   - web (>640px): the frozen A-411 Home two-card shift (`.homePaperMount--twoCardShift`),
//   - mobile (≤640px): HOME is BACKGROUND while the stacked HISTORY covers it — close-only.
//     `.homePaperMount` becomes `inert`, so its visible edge (A-621 leaves ~79/95px of HOME
//     showing, incl. part of the records entry) takes no pointer/tap and no focus/keyboard
//     activation — no openRecordsCard() replay, no historyPiggyId change, no money-stamp flip.
// Before A-623 the shift was decided once at open (innerWidth > 640) and cleared at close, so
// crossing 640px while open kept a stale web shift on mobile (HOME −46px, clipped at the left
// edge) or left web without it. Now every alignRecordsCardToHomePaper() (per-frame align loop
// + the mountHome resize listener) re-derives both from the CURRENT width before measuring.
// Web behavior is unchanged: HOME stays live there (side-by-side; the legit identity switch
// by tapping another Piggy's records while HISTORY is open keeps working).
function syncRecordsViewportState() {
  const open = Boolean(state.recordsCardVisible);
  const mobile = window.innerWidth <= 640;
  const mount = document.querySelector(".homePaperMount");
  if (!mount) return;
  const shift = open && !mobile;
  if (mount.classList.contains("homePaperMount--twoCardShift") !== shift) setHomeTwoCardShift(shift);
  const background = open && mobile;
  if (mount.inert !== background) mount.inert = background;
  // [A-624] Chog 는 같은 배경 Home 의 일부다. 모바일 HISTORY 가 열린 동안 Chog 탭(chog-home.js
  // toggle → pinned false → hover 0)은 Home 종이를 손끝 크기로 접었고, HISTORY 는 그 접힌
  // .homePaper rect 를 따라가 4.8×6.9px 로 오른쪽 아래에 남았다 — close 도 Home records 도
  // 포인터로 닿지 않는 갇힌 상태(A-624 pre 실측 hist390/hist430/histm390 S2). HOME 과 같은
  // close-only 규율로 hit 도 inert 로 둔다(포인터·포커스·키보드 0). 닫으면 곧장 다시 산다.
  // [A-626 D] 웹(>640)에서도 같은 접힘이 재현됐다(1440: HOME 10.698 / HISTORY 10.688, A-626 pre
  // histchog1440). 그래서 hit 는 **모든 폭에서** HISTORY 가 열린 동안 inert 다. 웹의 Home 종이
  // (.homePaperMount)는 계속 산다 — 다른 Piggy records 로 HISTORY 정체성을 바꾸는 웹 동작 유지.
  const chogHit = document.querySelector("#chogHomeHit");
  if (chogHit && chogHit.inert !== open) chogHit.inert = open;
}

// [A-621] mobile exit — matches the 160ms `.recordsCardAnchor` transition in style.css plus one
// frame of slack. A reopen during the exit cancels it (openRecordsCard()).
const RECORDS_EXIT_MS = 180;
let recordsExitTimer = 0;

function clearRecordsExitTimer() {
  if (recordsExitTimer) window.clearTimeout(recordsExitTimer);
  recordsExitTimer = 0;
}

// 목록 → 상세, 상세 → 목록. 같은 카드 영역 안에서 내용만 바꾼다(§4 "선택한 영수증
// 상세는 오른쪽 같은 카드 영역에서 교체"). index 가 실제 receipt 범위를 벗어나면
// 목록으로 그대로 둔다 — 없는 영수증을 합성해 상세로 열지 않는다.
function showRecordDetail(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= state.receipts.length) return;
  state.recordsDetailIndex = i;
  renderRecordsCardBody();
}

function showRecordsList() {
  state.recordsDetailIndex = null;
  renderRecordsCardBody();
}

// [A-379 §4] "reset local test" 버튼은 개발자 전용 — 일반 localhost/제품 화면에 섞이면
// 안 된다(Owner 지적). import.meta.env.DEV 만으로는 모든 DEV 빌드에서 항상 보인다. 명시적
// ?debug=1 옵트인이 함께 있을 때만 켠다. 조건 헬퍼 하나로 모든 렌더 지점에 적용한다 — DOM에
// 넣은 뒤 CSS 로 가리지 않는다(아예 마크업을 만들지 않는다).
function isDevDebugOptIn() {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

// @DEV_ONLY
function resetLocalTest() {
  localStorage.removeItem(PASSKEY_STORAGE_KEY);
  localStorage.removeItem("araso.address");
  localStorage.removeItem("araso.prfSalt");
  localStorage.removeItem("araso.mark");
  localStorage.removeItem("araso.txHash");
  localStorage.removeItem(TRIP_CLOSED_KEY);
  localStorage.removeItem(SEND_PENDING_KEY);
  localStorage.removeItem(LAST_SEND_ERROR_KEY);
  localStorage.removeItem(RECEIPTS_KEY);
  // [A-462] Second 완료 사실도 리셋에서만 지운다 — 일반 Home 이동·기록 열기·새로고침에서는 0.
  localStorage.removeItem(SECOND_JOURNEY_CLOSED_KEY);
  localStorage.removeItem(RESULT_MOTION_SEEN_KEY);
  // 탄생 한 바퀴의 세 가지 사실도 함께 지운다 — 안 지우면 리셋 뒤에도 Open 이 숨고
  // 해치가 다시 돌지 않는다.
  localStorage.removeItem(PIGGY_RECEIVED_KEY);
  localStorage.removeItem(PIGGY_NAME_KEY);
  localStorage.removeItem(BIRTH_PLAYED_KEY);
  endActiveSession();
  state.credential = null;
  state.address = "";
  state.selectedPiggy = null;
  state.addPiggy = null;
  state.pendingNamePiggyId = null;
  state.mark = "";
  state.txHash = "";
  state.grantTxHash = "";
  state.tripClosed = false;
  state.tripOutcome = "";
  state.tripReason = "";
  state.receipts = [];
  state.receiptIndex = 0;
  state.recordsCardVisible = false;
  state.recordsDetailIndex = null;
  state.nameResumed = false;
  state.homeArrival = false;
  // [A-360] Second Journey 는 메모리 상태만 되돌린다 — second-journey-state.js 저장소
  // (관심 목록)는 첫 Journey 사용자데이터초기화 범위가 아니다(§forbidden "사용자데이터초기화
  // 0" — 이건 애초에 이 함수가 원래 지우던 첫 Journey 키가 아니라 별개 이름공간이다).
  state.secondJourney = createEmptySecondJourney();
  // [A-411-p] 세션 전용 표도 함께 되돌린다 — 안 지우면 리셋 뒤에도 "이미 한 번 Second를
  // 끝냈다"는 판정이 남아 candidates 직행/자동 quiet→Paper 억제가 잘못 이어진다.
  state.secondJourneyCompletedOnce = false;
  state.secondCompletedThisSession = false;
  state.secondJourney.outcome = null;
  dropSecondDraft();
  state.resultMotionSeen = false;
  state.homeQuietForExplore = false;
  noteRecoverSuccess(); // 실패 카운터도 초기화 — 리셋 후엔 복구를 다시 처음부터 시도한다
  // [A-389] authPhase/authCancelled 도 같이 되돌린다 — 아니면 리셋 직전 실패가 취소였을 때
  // 그 표시가 그대로 남아 "Local test memory cleared." 옆에 "Face ID was cancelled." 가 붙는다.
  state.authPhase = "idle";
  state.authCancelled = false;
  setScene("birth", "You received a Piggy.", "Local test memory cleared.");
}

// [A-377 §4] records 목록/폴더 미리보기는 실제 receipt 텍스트(이름/날짜/상태)를 넣는다 —
// 다른 파일(home-paper.js/send-card.js 등)과 같은 escape 규칙.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "";
}

function formatMoney(wei) {
  const value = Number(formatEther(wei));
  const decimals = value !== 0 && Math.abs(value) < 0.001 ? 6 : 3;
  return `$${value.toFixed(decimals)}`;
}

// File Box 3칸: settle() receipt 위에서만 그린다. 화면은 숫자를 따로 계산하지 않는다.
// [A-553 Lane B] add_money 영수증은 BigInt sent/gas/after 필드가 아예 없다 — 옛 필드로
// formatEther()를 부르면 던진다(§lane_b/AUDIT.md 버그 3). **기존에 있던 라벨만** 보수적으로
// 쓴다(Tx/Block) — 새 문구·새 라벨 0.
function receiptRows(receipt) {
  if (!receipt) return [];
  if (receipt.kind === "add_money") {
    return [
      { label: "Tx", value: shortHash(receipt.txHash) },
      { label: "Block", value: receipt.blockNumber ? String(receipt.blockNumber) : "Unknown" },
    ];
  }
  return [
    { label: "Sent", value: formatMoney(receipt.sent) },
    { label: "Cost", value: formatMoney(receipt.gas) },
    { label: "Left", value: formatMoney(receipt.after) },
    { label: "Tx", value: shortHash(receipt.redeemTxHash || receipt.txHash) },
    { label: "Block", value: receipt.redeemBlockNumber ? String(receipt.redeemBlockNumber) : "Unknown" },
  ];
}

// 숫자 대조 한 줄 — 화면이 그린 숫자가 실제로 남은 것과 맞는지 사용자가 직접 본다.
// expected = 나가기 전 − 보낸 것 − 든 비용. 이것과 실제 잔고가 다르면 그 자체가 알림이다.
// add_money 영수증에는 이 계산에 쓰는 before/sent/gas/after 자체가 없다 — 빈 줄로 닫는다.
function receiptCheck(receipt) {
  if (!receipt) return "";
  if (receipt.kind === "add_money") return "";
  const expected = receipt.before - receipt.sent - receipt.gas;
  const off = receipt.after - expected;
  // 실제로 남은 값은 위 Left 칸에 이미 있다 — 여기서는 기대값과, 그것과 어긋난 만큼만 말한다.
  const tail = off === 0n ? "same as Left" : `off by ${formatMoney(off < 0n ? -off : off)}`;
  return `<p class="receipt-check">Expected ${formatMoney(expected)} · ${tail}</p>`;
}

// --- character art: file images only (no CSS shapes) -------------------
// 배포에 나가는 것은 **화면 크기 래스터 사본만**(최대 2x). 벡터 원본(SVG)·폰트 파일은
// app/public/ 에 두지 않는다 — 배포된 파일은 URL 만 알면 누구나 받아갈 수 있고,
// SVG 는 그림이 아니라 편집 가능한 도면이기 때문이다(Owner 판정 2026-09-03).
// 원본 = <private>** (커밋 대상 아님).
const CHOG_IDLE_SRC = "/chog/chog_idle@2x.png";
// [A-318] Away 걸음 대역(CHOG_WALK_FRAMES / chogWalkCycle)은 제거했다 — away 도
// Home 의 확정 Chog 를 그대로 쓴다. 대역을 두면 같은 화면에 초그가 둘이 된다.

// scene 별 구석 캐릭터. 모든 화면 = Chog idle 작게(away 만 walk 순환으로 대체).
function corner(scene) {
  // Home(sendstay)에는 확정 Piggy·Chog 본체가 서 있다. 거기에 대역까지 두면
  // 화면에 같은 캐릭터가 둘이 된다 — §8 「캐릭터 중복 0」.
  // 그래서 Home 에서는 구석 대역을 통째로 빼고, 아직 확정본을 잇지 않은 다른 씬에서만 남긴다.
  // [A-318 교정 3] away 도 같다. 원본 flow.js 의 Send 는 출발 overlay 만 얹고
  // **기존 Home Chog 를 그대로 둔다** — 여기서 걷기 대역을 만들면 초그가 둘이 된다.
  // [A-360] explore/secondAway/secondReturn 도 같은 Home 판(homeCharacter/chogHome)을
  // 그대로 쓰는 씬이라 같은 이유로 구석 대역을 뺀다.
  // [A-381 §1] filebox 는 Owner 가 거부한 별도 구석 Piggy 대역 껍질을 뺐다 — filebox 는
  // 더 이상 이 함수를 부르지 않는다(renderFileBox 참조). 남은 씬(birth/records 등)은
  // 기존 그대로 Chog idle 만 작게 남긴다.
  if (["sendstay", "away", "explore", "secondAway", "secondReturn"].includes(scene)) return "";
  return `
    <div class="corner" aria-hidden="true">
      <img class="chog-idle" src="${CHOG_IDLE_SRC}" alt="" />
    </div>
  `;
}

// [A-603] 공유 셀 브랜드 — Invite/Hatch/Name/Home 네 씬에 지금까지 ARASO 표식이 전혀
// 없었다(§ARASO BRAND 카드 지시, style.css .arasoBrand 주석 참고). `.stage`(position:
// relative) 의 직계 자식으로 얹는다 — 각 씬의 내부 판(.invite/.hatchStage/.nameScene/
// .homeBoard)은 전부 position:absolute 라 이 형제 요소를 스케일-핏 계산에 넣지 않는다
// (그 판들의 fit*() 함수는 window.innerWidth/innerHeight 만 읽는다 — 이 요소를 늘리거나
// 줄이지 않는다). 씬 이름(Name it/Hatch 등)을 넣지 않는다 — 제품 브랜드 한 줄뿐이다.
function arasoBrandMarkup() {
  return `<p class="arasoBrand" aria-hidden="true">Araso</p>`;
}

// 장면 1/5 — Received. 아직 아무것도 열지 않은 상태. 입력은 버튼 하나뿐.
// (봉투 연출은 이번 범위 밖 — Owner "envelope는 아침에")
// --- 장면 1/5 — Invite. Claude Design 캔버스(아티팩트 "Piggy Invite") 정본 이식.
// 아트보드 두 장을 그대로 옮긴다: InviteWide.dc.html(1280×800) · Main.dc.html(420×840).
// 좌표·크기·색·keyframes 는 캔버스 값이다. 여기에 우리가 만든 것을 얹지 않는다.
// 봉투를 뜯는 단계 전환은 와이드 아트보드의 tapFace() 타임라인 그대로다.
// 원본(폰트 otf·풀사이즈 PNG)은 `<private>**` 에만 둔다. 손글씨 두 줄은
// 폰트 파일을 배포하지 않으려고 낱말만 그림으로 렌더한 것이다(OPERATING_RULES §C-2).
const INVITE_WIDE_MIN = 900;

// 캔버스 tapFace() 의 타임라인 그대로(ms).
const INVITE_TIMELINE = [
  [1000, "success"],
  [1300, "peek1"],
  [1850, "peek2"],
  [2450, "tear"],
  [2740, "teared"],
  [3150, "exit"],
  [3690, "settle"],
  [5200, "idle"],
];

const INVITE_ENV_ANIM = {
  success: "env-success 0.3s ease-out both",
  peek1: "env-peek1 0.55s ease-in-out both",
  peek2: "env-peek2 0.6s ease-in-out both",
  tear: "env-pop 0.18s ease-out both",
  teared: "env-float 1s ease-in-out infinite",
  exit: "env-exit 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) both",
  settle: "env-exit 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) both",
  idle: "env-exit 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) both",
};

const INVITE_EGG_ANIM = {
  tear: "egg-burst 1.24s cubic-bezier(0.22, 0.9, 0.24, 1) both",
  teared: "egg-burst 1.24s cubic-bezier(0.22, 0.9, 0.24, 1) both",
  exit: "egg-burst 1.24s cubic-bezier(0.22, 0.9, 0.24, 1) both",
  settle: "egg-land 1.5s ease-in-out both",
  idle: "egg-idle2 3.2s ease-in-out infinite",
};

const INVITE_SPARK_ANIM = {
  tear: "spark-pop 0.3s ease-out both",
  teared: "env-float 1s ease-in-out infinite",
  exit: "spark-out 0.42s ease-in both",
  settle: "spark-out 0.42s ease-in both",
  idle: "spark-out 0.42s ease-in both",
};

// 캔버스의 알 — 인라인 SVG 그대로(검정 몸 + 흰 3px 외곽).
const INVITE_EGG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 225 186">
<path d="M106,25 L121,25 L133,28 L141,34 L155,43 L163,50 L170,64 L173,82 L179,95 L181,102 L181,114 L177,127 L170,138 L162,145 L152,150 L144,152 L115,153 L83,153 L71,150 L63,146 L55,139 L47,127 L44,120 L43,115 L43,103 L47,93 L51,83 L53,67 L57,57 L64,48 L71,42 L86,36 L99,27 Z " fill="black" stroke="white" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>
<path d="M99,76 L104,76 L106,80 L105,87 L103,89 L99,88 L97,86 L97,79 Z " fill="white"></path> <path d="M119,76 L124,76 L127,81 L125,87 L120,88 L118,86 L117,81 Z " fill="white"></path> <path d="M100,96 L126,96 L127,100 L126,101 L103,103 L98,102 L97,98 Z " fill="white"></path>
</svg>`;

let inviteTimers = [];
let inviteKind = "";

function clearInviteTimers() {
  inviteTimers.forEach(clearTimeout);
  inviteTimers = [];
}

function wantedInviteKind() {
  return window.innerWidth >= INVITE_WIDE_MIN ? "wide" : "mobile";
}

// 아트보드는 고정 크기다(1280×800 · 420×840). 화면이 그보다 작으면 그림을 다시 짜지 않고
// 판을 통째로 축소해 넣는다 — 좌표·간격 비율이 캔버스와 어긋나지 않게 하려는 것이다.
function fitInvite() {
  const board = document.querySelector(".invite");
  if (!board) return;
  if (wantedInviteKind() !== inviteKind) {
    render();
    return;
  }
  const w = board.dataset.kind === "wide" ? 1280 : 420;
  const h = board.dataset.kind === "wide" ? 800 : 840;
  const scale = Math.min(window.innerWidth / w, window.innerHeight / h);
  board.style.transform = `scale(${scale})`;
}

function setInvitePhase(phase) {
  const board = document.querySelector(".invite");
  if (!board) return;
  board.dataset.phase = phase;
  const env = board.querySelector(".invite__env");
  const egg = board.querySelector(".invite__egg");
  const spark = board.querySelector(".invite__burst");
  if (env) env.style.animation = INVITE_ENV_ANIM[phase] || "none";
  if (egg) egg.style.animation = INVITE_EGG_ANIM[phase] || "none";
  if (spark && board.dataset.kind === "wide") spark.style.animation = INVITE_SPARK_ANIM[phase] || "none";
  const label = board.querySelector(".invite__faceLabel");
  if (label) label.textContent = phase === "checking" ? "checking..." : "Face ID";
}

// 봉투 열기 = 이 화면의 유일한 입력. 뜯기는 순서가 끝나면 실제 Face ID 를 켠다.
// [A-389 §1] 옛 renderBirth() 의 Open 버튼(대기 화면 → 한 번 더 탭)을 지웠으므로, 봉투
// 연출이 끝나는 순간이 곧 실제 인증 시도다. 새 패스키를 만들지 여부는 여전히
// startPiggyOpen() 의 기존 판정(이미 Piggy 를 받았으면 recover, 아니면 create)이 정한다 —
// 여기서 새로 만들지 않는다.
function openInvite() {
  const board = document.querySelector(".invite");
  if (!board || (board.dataset.phase || "closed") !== "closed") return;
  clearInviteTimers();
  setInvitePhase("checking");
  INVITE_TIMELINE.forEach(([at, phase]) => {
    inviteTimers.push(setTimeout(() => setInvitePhase(phase), at));
  });
  inviteTimers.push(setTimeout(() => startPiggyOpen(), 5900));
}

// 봉투 hero — 두 아트보드가 같은 480×365 안쪽 좌표를 쓴다. 모바일은 그 덩어리를 0.55833 로 줄인다.
function inviteHero(dir) {
  return `
    <div class="invite__heroScale">
      <div class="invite__egg">${INVITE_EGG_SVG}</div>
      <div class="invite__env">
        <img class="invite__envImg invite__envImg--closed" src="${dir}/envelope@2x.png" alt="" />
        <img class="invite__envImg invite__envImg--tear" src="${dir}/envelope_tear@2x.png" alt="" />
        <img class="invite__envImg invite__envImg--open" src="${dir}/envelope_open@2x.png" alt="" />
        <div class="invite__ov">
          <img class="invite__postmark" src="${dir}/postmark@2x.png" alt="" />
        </div>
        <img class="invite__waves" src="${dir}/waves@2x.png" alt="" />
        <img class="invite__stamp" src="${dir}/stamp@2x.png" alt="" />
        <img class="invite__underline" src="${dir}/underline@2x.png" alt="" />
        <div class="invite__hand">
          <span class="invite__line1">something small</span>
          <span class="invite__line2">just for you</span>
        </div>
      </div>
    </div>
  `;
}

function inviteFace() {
  return `
    <button class="invite__face" id="inviteFaceButton">
      <svg class="invite__faceIcon" viewBox="0 0 22 22" fill="none" stroke="#E0B100" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M2 7 V5 Q2 2 5 2 H7 M15 2 H17 Q20 2 20 5 V7 M20 15 V17 Q20 20 17 20 H15 M7 20 H5 Q2 20 2 17 V15"></path>
        <circle cx="7.5" cy="9" r="0.9" fill="#E0B100" stroke="none"></circle>
        <circle cx="14.5" cy="9" r="0.9" fill="#E0B100" stroke="none"></circle>
        <path d="M8 14.5 Q11 16.5 14 14.5"></path>
      </svg>
      <span class="invite__faceLabel">Face ID</span>
    </button>
  `;
}

function inviteHoles(count) {
  return `<div class="invite__holes" aria-hidden="true">${Array.from({ length: count }, () => `<i class="invite__hole"></i>`).join("")}</div>`;
}

// 모바일 아트보드 — Main.dc.html 420×840
function inviteMobile() {
  return `
    <div class="invite invite--mobile" data-kind="mobile" data-phase="closed">
      <div class="invite__paper">
        <img class="invite__tape" src="/invite/tape@2x.png" alt="" aria-hidden="true" />
        ${inviteHoles(13)}
        <div class="invite__hero" aria-hidden="true">${inviteHero("/invite")}</div>
        <img class="invite__burst" src="/invite/burst@2x.png" alt="" aria-hidden="true" />
        ${inviteFace()}
        <div class="invite__chog" aria-hidden="true">
          <img class="invite__trail" src="/invite/trail@2x.png" alt="" />
          ${chogInviteMarkup()}
        </div>
        <p class="invite__copy">it's safe. only you can open it.</p>
        <div class="invite__corner" aria-hidden="true"></div>
        <div class="invite__cornerBack" aria-hidden="true"></div>
      </div>
    </div>
  `;
}

// 웹 아트보드 — InviteWide.dc.html 1280×800
function inviteWide() {
  return `
    <div class="invite invite--wide" data-kind="wide" data-phase="closed">
      <div class="invite__paper">
        ${inviteHoles(12)}
        <div class="invite__hero" aria-hidden="true">${inviteHero("/invite/wide")}</div>
        <img class="invite__burst" src="/invite/wide/burst@2x.png" alt="" aria-hidden="true" />
        ${inviteFace()}
        <div class="invite__chog" aria-hidden="true">
          <img class="invite__trail" src="/invite/wide/trail@2x.png" alt="" />
        </div>
        <div class="invite__chogNative" aria-hidden="true">${chogInviteMarkup()}</div>
        <img class="invite__tape" src="/invite/wide/tape@2x.png" alt="" aria-hidden="true" />
      </div>
    </div>
  `;
}

function renderReceived() {
  inviteKind = wantedInviteKind();
  return `
    <section class="stage stage--invite" data-scene="received">
      ${arasoBrandMarkup()}
      ${inviteKind === "wide" ? inviteWide() : inviteMobile()}
    </section>
  `;
}

// [A-389] 옛 renderBirth() 자리 — egg-big·구석 대역 Chog·검정 .note 패널·"Not this
// door." 큰 제목·Open/Check 패널을 전부 지우고, 승인된 인증실패 카드로 바꾼다.
// 보호 로직(isAllowedPiggyRpId)은 그대로 옮겨 왔다 — 지운 것은 UI 껍질뿐이다.
// 종이는 AskNameIt(nameCard, name-card.js)의 바탕/비율(460×300)/재질(ivory 텍스처)/
// 잉크색을 그대로 쓴다 — Name it 제목 이미지와 이름 입력칸은 옮기지 않는다. 버튼은
// sendCardButtonMarkup 의 기존 ButtonKit(문구를 그림이 아니라 텍스트로 얹는 A361 방식,
// send-card.js 참고)을 그대로 재사용한다 — "Try again"/"Check Piggy" 낱말 PNG 는 없다.
// [A-391 / A-391-a,b] 옆 Chog 는 옛 CHOG_IDLE_SRC(40×40 구석 아이콘, .chog-idle)가 아니라
// 현재 Invite/Hatch 가 실제 쓰는 동일 정본 — chogInviteMarkup()(같은 함수, 같은 DIR=/motion/
// chog-invite 자산 호출)을 그대로 재사용한다. 다른 PNG로 재조립하지 않는다 — render() 는
// state.scene === "birth" 일 때 mountInviteChog() 를 새 함수 없이 그대로 불러 붙인다.
// [A-633 A] `view` 기본값 = state(기존 호출과 byte-동일 markup). 앱 잠금(LOGIN_CHECKING)은 목적지 씬의
// message/detail 을 섞지 않도록 자기 표시값({authPhase, authCancelled, message, detail})을 넘기고, 두 가지만
// 더 켠다: `appLock`(section 의 data-app-lock 표식) · `chogTap`(카드 옆 **같은** Chog 를 탭 대상 button 으로 —
// 그림·자리·크기 그대로). 카드·문구·버튼은 기존 그대로다.
function renderAuthCard(view = state) {
  const blocked = !isAllowedPiggyRpId();
  const checking = !blocked && view.authPhase === "checking";
  const heading = checking ? view.message || "Checking…" : "Couldn't open Piggy";
  const body = checking
    ? view.detail || "Face ID may appear once."
    : view.authCancelled
      ? "Face ID was cancelled."
      : view.detail || "Try again, or use Check Piggy to recover.";
  // [A-391 §2 / A-389-a] Try again 은 실제 auth 호출이 없는 안전한 내비게이션(Invite/Face ID
  // 앞화면 복귀, main.js render() 의 #authTryAgainButton 배선 참고) — !isAllowedPiggyRpId() 로
  // 막을 이유가 없다. Check Piggy 는 실제 복구 호출이라 unsupported origin 에서 계속 막는다.
  const actions = checking
    ? ""
    : `
        <div class="authCard__actions">
          ${sendCardButtonMarkup({ id: "authTryAgainButton", label: "Try again", disabled: false })}
          ${sendCardButtonMarkup({ id: "checkButton", label: "Check Piggy", disabled: blocked })}
        </div>
      `;
  // [A-606 item3] Invite/Hatch/Name/Home(sendstay) 네 씬은 이미 공유 좌상단
  // `.arasoBrand`(A-603)을 쓴다 — Auth(birth)만 카드 안쪽 우상단의 옛
  // `.authCard__eyebrow`만 갖고 있었다(A-605 Lane A 가 확인·PASS 처리한 "의도된
  // 기존 차이"였지만, Owner 공통-셀 지시는 Araso 를 씬 제목이 아니라 공유 셸의
  // 제품 브랜드로 통일하라는 것이었다 — 이 카드가 그 통일을 맡는다). 다른 씬과
  // 같은 자리·같은 함수(arasoBrandMarkup())를 그대로 부른다 — 새 마크업/새 자리
  // 좌표를 만들지 않는다. 카드 안의 `.authCard__eyebrow`는 지우지 않고(마크업 삭제
  // 0, 카드 레이아웃 변경 0) style.css 에서 visibility:hidden 으로 시각적으로만
  // 숨긴다 — 두 표식이 동시에 보이는 중복을 막을 뿐, 자리(absolute, 다른 요소가
  // 그 공간에 의존하지 않음)는 그대로 남아 카드 레이아웃은 손대지 않는다.
  const chog = view.chogTap
    ? `<button class="authCard__chog authCard__chog--tap" id="loginChogButton" type="button" aria-label="Face ID">${chogInviteMarkup()}</button>`
    : `<div class="authCard__chog" aria-hidden="true">${chogInviteMarkup()}</div>`;
  return `
    <section class="stage" data-scene="birth"${view.appLock ? ` data-app-lock="${view.appLock}"` : ""}>
      ${buttonInkFilter()}
      ${arasoBrandMarkup()}
      <div class="authCard">
        ${chog}
        <div class="authCard__paper">
          <p class="authCard__eyebrow" aria-hidden="true">Araso</p>
          <h1 class="authCard__title">${heading}</h1>
          <p class="authCard__body">${body}</p>
          ${actions}
        </div>
      </div>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// [A-633 A] 잠긴 동안의 전체 그리기 — 목적지 씬은 그리지도 mount 하지도 않는다(state.scene 은 보존).
// LOGIN_CHECKING = **기존** 인증 카드의 checking 모습 그대로("Checking…" / "Face ID may appear once.", 버튼 0)
// + 카드 옆 기존 Chog(mountInviteChog) — 새 구도·새 그림 0(coordinator 결정: 가장 가벼운 재사용, Owner 시각
// 검토 OPEN). 그 Chog 가 탭 대상이다 → unlockApp(). 실패면 같은 카드의 기존 실패 모습(Couldn't open Piggy)을
// 쓰되, 두 버튼 모두 잠금 해제 경로에만 묶는다: Try again → LOGIN_CHECKING 으로(인증 호출 0), Check Piggy →
// unlockApp()(탭 안에서 곧장). 생성·Hatch·서명자 0.
function renderAppLock() {
  clearInviteTimers();
  const failed = state.appLock.phase === "failed";
  app.innerHTML = renderAuthCard({
    authPhase: failed ? "idle" : "checking",
    authCancelled: failed && !!state.appLock.cancelled,
    message: "",
    detail: "",
    appLock: state.appLock.phase,
    chogTap: !failed,
  });
  mountInviteChog();
  if (failed) {
    document.querySelector("#authTryAgainButton")?.addEventListener("click", () => {
      if (!state.appLock) return;
      state.appLock = { phase: "waiting", cancelled: false };
      render();
    });
    document.querySelector("#checkButton")?.addEventListener("click", unlockApp);
  } else {
    document.querySelector("#loginChogButton")?.addEventListener("click", unlockApp);
  }
  if (isDevDebugOptIn()) document.querySelector("#resetButton")?.addEventListener("click", resetLocalTest);
}

// =======================================================================
// 탄생 한 바퀴 — 해치 → Name it → Save → 숨은 Piggy → 첫 Home  (A-292)
//
// 그림·박자·파츠 좌표는 전부 확정 보관본
// `<private>`
// 에서 그대로 옮긴 것이다. 여기서 새로 그리거나 타이밍을 고치지 않는다.
// 옮겨온 자산은 `app/public/motion/` 에 있다(원본 벡터·폰트는 넣지 않았다 — A-013).
//
// 카드·노트패드 UI 는 보관본 스스로 NOT_APPROVED 라고 적었다. 확정된 것은 캐릭터와
// 모션뿐이고, 아래 배치는 그 모션을 걸어 두기 위한 자리에 불과하다.
// =======================================================================

const MOTION_DIR = "/motion";
// 카드·종이·버튼 자산은 캔버스 정본에서 온다(A-296 · A-300).
// 낱말 PNG 대응은 ButtonKit 의 img alt 에서 확인된 것이고 파일명을 바꾸지 않는다.
const CARD_DIR = "/card";

// ButtonKit 잉크 필터 — ButtonKit.dc.html :34–39 값 그대로.
// UI 필터 정의일 뿐이고 캐릭터 SVG 원본 이식과는 다른 것이다.
function buttonInkFilter() {
  return `
    <svg width="0" height="0" class="btnink-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="btnink" x="-20%" y="-30%" width="140%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="7" result="t"></feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="t" scale="1.5" xChannelSelector="R" yChannelSelector="G" result="w"></feDisplacementMap>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="t2"></feTurbulence>
          <feColorMatrix in="t2" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 5 0 0 0 -3.6" result="h"></feColorMatrix>
          <feComposite in="w" in2="h" operator="out"></feComposite>
        </filter>
      </defs>
    </svg>
  `;
}

// 해치 전체 길이 — 보관본 same-page-hatch-script 의 DURATION 그대로.
const HATCH_DURATION = 7200;
// 첫 Home 걷기 프레임 수. 박자·이동 시간은 아래 「씬 4 Home 구현 수치」 절에 있다.
const HOME_WALK_FRAMES = 48;
// Home 무입력 졸기 — 보관본 §3 「Home 무입력180000ms」.
const HOME_DROWSY_MS = 60000; // [A-421 Owner "일분으로 줄여" 2026-09-18] 180000 → 60000, chog-home SLEEP_IDLE_MS 와 동일

// public/ 의 조각은 한 번만 받아 두고 재사용한다. 씬을 여닫을 때마다 다시 받지 않는다.
const motionParts = new Map();

function loadMotionPart(name) {
  if (!motionParts.has(name)) {
    motionParts.set(
      name,
      fetch(`${MOTION_DIR}/${name}`)
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`${name} ${res.status}`))))
        // 보관본 마크업은 자기 폴더 기준 상대경로(assets/…)를 쓴다. 앱에서는 절대경로여야 한다.
        .then((html) => html.replace(/src="assets\//g, `src="${MOTION_DIR}/assets/`)),
    );
  }
  return motionParts.get(name);
}

// 지금 살아 있는 Home Chog 컨트롤러. 씬을 떠나면 정리에서 끊긴다.
let homeChog = null;
// 지금 살아 있는 Invite Chog. 씬을 떠나면 정리에서 끊긴다.
let inviteChog = null;
// 출발 파츠 중 못 받은 것(보고용). 정상이면 빈 배열이다.
let departAssetsMissing = [];
// 귀환 파츠 중 못 받은 것(보고용).
let returnAssetsMissing = [];

// [A-414-b/c] Send 카드의 work? 준비 반응 — piggy-depart.js 의 기존 mode:"work" 렌더러를
// 그대로 쓴다(새 모션/새 자산 0). 자산은 한 번만 받아 재사용(카드가 여러 번 다시 마운트돼도
// 다시 fetch 하지 않는다 — sendPiggy() 의 중간 상태 메시지들이 모두 setScene() 이라
// render()를 다시 부른다, §mountSendCardWorkPose 주석).
let workAssetsPromise = null;
function loadWorkAssetsCached() {
  if (!workAssetsPromise) workAssetsPromise = loadDepartAssets();
  return workAssetsPromise;
}
// 카드가 "새로" 뜬 시각(진짜 시계). 재렌더(같은 sendstay 안에서 메시지만 바뀌는 setScene)
// 마다 이 값을 다시 잡으면 작은 perk 가 매번 처음부터 다시 튄다 — 카드가 실제로
// 사라졌다 나타날 때(stayHome, 다음 Save)만 null 로 되돌린다.
let sendWorkStartedAt = null;
// [A-431] Second 카드 구간 work? 시계 — First(sendWorkStartedAt)와 분리. 같은 Explore 흐름
// 재렌더(관심→checking→후보→금액…)에서는 되감지 않고, explore 씬을 떠나면 비운다.
let secondWorkStartedAt = null;

let motionCssLinked = false;
function linkMotionCss() {
  if (motionCssLinked) return;
  motionCssLinked = true;
  for (const file of ["hatch.css", "name.css"]) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${MOTION_DIR}/${file}`;
    document.head.append(link);
  }
}

// --- 보관본 same-page-hatch-script 의 수치·보간 (좌표·박자 변경 0) ------
const hatchClamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const hatchMix = (a, b, p) => a + (b - a) * p;
const hatchOut = (p) => 1 - Math.pow(1 - hatchClamp(p), 3);
const hatchSmooth = (p) => {
  p = hatchClamp(p);
  return p * p * (3 - 2 * p);
};
const hatchSpan = (t, a, b) => hatchClamp((t - a) / (b - a));
const hatchFadeWindow = (t, a, b, c, d) =>
  t < a || t > d ? 0 : t < b ? hatchSpan(t, a, b) : t < c ? 1 : 1 - hatchSpan(t, c, d);
const hatchPulse = (t, a, d) => (t < a || t > a + d ? 0 : Math.sin((Math.PI * (t - a)) / d));
const HATCH_BOUNCE = [
  [0, 0, -112, 0.96, 1.08, -1.5],
  [360, 0, -18, 0.99, 1.02, -0.5],
  [520, 0, 14, 1.13, 0.86, 0],
  [730, 0, -31, 0.92, 1.12, 0.7],
  [960, 0, 9, 1.08, 0.92, 0],
  [1140, 0, -18, 0.96, 1.06, -0.4],
  [1360, 0, 5, 1.04, 0.96, 0],
  [1510, 0, -8, 0.985, 1.025, 0.25],
  [1690, 0, 2, 1.018, 0.985, 0],
  [1840, 0, 0, 1, 1, 0],
];
const HATCH_CHIPS = [
  { born: 2110, land: 2370, dx: -6, dy: 26, rot: -18 },
  { born: 2620, land: 2880, dx: 14, dy: 28, rot: 24 },
  { born: 2660, land: 2920, dx: -24, dy: 27, rot: -7 },
  { born: 3100, land: 3360, dx: 46, dy: 29, rot: 41, arc: 18 },
  { born: 3140, land: 3400, dx: -58, dy: 28, rot: -33, arc: 18 },
  { attach: 3380, drop: 3960, land: 4260, adx: 2, ady: -3, arot: 12, scale: 1, dx: -34, dy: 32, rot: 12 },
  { attach: 3380, drop: 4290, land: 4590, adx: 40, ady: 1, arot: -15, scale: 1, dx: 74, dy: 30, rot: -15 },
];
const HATCH_CRACK_WINDOWS = [
  [430, 720, 820, 1010],
  [840, 1050, 1160, 1320],
  [1180, 1400, 1510, 1660],
  [1510, 1700, 1950, 2140],
];
const hatchUX = (u) => ((u / 225) * 100).toFixed(4) + "%";
const hatchUY = (u) => ((u / 186) * 100).toFixed(4) + "%";
const hatchChipKick = (dx, t) =>
  dx < 0 ? hatchOut(hatchSpan(t, 5600, 6050)) : hatchOut(hatchSpan(t, 6000, 6450));

function hatchSample(keys, t) {
  if (t <= keys[0][0]) return keys[0];
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      const p = hatchSmooth((t - a[0]) / (b[0] - a[0]));
      return [
        t,
        hatchMix(a[1], b[1], p),
        hatchMix(a[2], b[2], p),
        hatchMix(a[3], b[3], p),
        hatchMix(a[4], b[4], p),
        hatchMix(a[5], b[5], p),
      ];
    }
  }
  return keys[keys.length - 1];
}

function hatchRigPose(t) {
  if (t <= 1840) return hatchSample(HATCH_BOUNCE, t);
  if (t < 2140) {
    const k = Math.floor((t - 1840) / 58) % 4;
    return [t, [-0.7, 0.65, -0.45, 0.45][k], [0.35, -0.45, -0.2, 0.3][k], 1, 1, 0];
  }
  return [t, 0, 0, 1, 1, 0];
}

// 원래 메인과 같은 착지: 포물선·회전 없이 제자리에서 -16 → 0 → -2.5 → 0 으로 툭.
function hatchDropY(e) {
  const D = 260;
  if (e < 0) return -16;
  if (e >= D) return 0;
  const p = e / D;
  if (p < 0.55) return -16 + 16 * (p / 0.55);
  if (p < 0.7) return 0 - 2.5 * ((p - 0.55) / 0.15);
  if (p < 0.85) return -2.5 + 2.5 * ((p - 0.7) / 0.15);
  return 0;
}

function hatchRenderChip(el, s, t, shY, shR) {
  const show = (opacity, transform) => {
    el.style.opacity = String(hatchClamp(opacity));
    if (transform !== undefined) el.style.transform = transform;
  };
  el.style.transformOrigin = "48% 64.516%";
  if (s.attach !== undefined) {
    if (t < s.attach) return show(0, `translate(0,0) scale(${s.scale})`);
    if (t < s.drop) {
      return show(
        1,
        `translate(${hatchUX(s.adx)},calc(${hatchUY(s.ady)} + ${(shY || 0).toFixed(2)}px)) rotate(${s.arot + (shR || 0)}deg) scale(${s.scale})`,
      );
    }
    const p = hatchOut(hatchSpan(t, s.drop, s.land));
    const pp = hatchSmooth(hatchSpan(t, 4900, 5400));
    const kk = hatchChipKick(s.dx, t);
    const sgn = s.dx < 0 ? -1 : 1;
    return show(
      hatchMix(1, 0.55, pp) * (1 - kk),
      `translate(${hatchUX(hatchMix(s.adx, s.dx, p) + sgn * 74 * kk)},${hatchUY(hatchMix(s.ady, s.dy, p) - 3 * pp - 14 * kk)}) rotate(${hatchMix(s.arot, s.rot, p) + sgn * 26 * kk}deg) scale(${s.scale * hatchMix(1, 0.82, pp)})`,
    );
  }
  if (t < s.born) return show(0, "translate(0,0)");
  const pp = hatchSmooth(hatchSpan(t, 4780, 5300));
  const kk = hatchChipKick(s.dx, t);
  const sgn = s.dx < 0 ? -1 : 1;
  return show(
    hatchMix(1, 0.55, pp) * (1 - kk),
    `translate(${hatchUX(s.dx + sgn * 74 * kk)},${hatchUY(s.dy + hatchDropY(t - s.born) - 3 * pp - 14 * kk)}) rotate(${s.rot + sgn * 26 * kk}deg) scale(${hatchMix(1, 0.82, pp)})`,
  );
}

// 보관본 render(t) 그대로. 다른 것은 두 가지뿐이다 — document.getElementById 대신
// 씬 안에서 찾는 것, 그리고 검토용 컨트롤(track/beat/time)이 없다는 것.
function makeHatchRenderer(stage) {
  const pick = (id) => stage.querySelector(`#${id}`);
  const els = {
    rig: pick("rig"),
    shadow: pick("shadow"),
    eggIntact: pick("eggIntact"),
    poses: [pick("posePlunge"), pick("poseSquash"), pick("poseStretch"), pick("poseIdle")],
    cracks: [pick("crack1"), pick("crack2"), pick("crack3"), pick("crack4")],
    holes: [pick("holeS"), pick("holeM"), pick("holeL")],
    leg: pick("leg"),
    peek: pick("seatBodyPeek"),
    seatBody: pick("seatBody"),
    seatHead: pick("seatHead"),
    breaks: [pick("break1"), pick("break2"), pick("break3")],
    shellL: pick("break4"),
    shellR: pick("break5"),
    standOhno: pick("standOhno"),
    standMid: pick("standMid"),
    standSmile: pick("standSmile"),
    chips: [...stage.querySelectorAll(".chip")],
  };
  const show = (el, opacity, transform) => {
    if (!el) return;
    el.style.opacity = String(hatchClamp(opacity));
    if (transform !== undefined) el.style.transform = transform;
  };
  const setPoseFace = (el, opacity) => {
    const face = el && el.querySelector(".poseFace");
    if (face) face.style.opacity = String(opacity);
  };
  return function drawHatch(raw) {
    const t = hatchClamp(raw, 0, HATCH_DURATION);
    const p = hatchRigPose(t);
    els.rig.style.transform = `translate(${p[1]}px,${p[2]}px) rotate(${p[5]}deg) scale(${p[3]},${p[4]})`;
    const height = Math.abs(p[2]);
    show(els.shadow, hatchClamp(0.34 - height / 420), `scaleX(${hatchClamp(1 - height / 260, 0.68, 1.06)})`);
    show(els.eggIntact, 0);
    const poseIndex = t < 420 ? 0 : t < 720 ? 1 : t < 1020 ? 2 : 3;
    const faceOpacity = [1, 0.6, 0.3, 0];
    els.poses.forEach((el, i) => {
      show(el, t < 2140 && i === poseIndex ? 1 : 0);
      setPoseFace(el, faceOpacity[i]);
    });
    els.cracks.forEach((el, i) => show(el, hatchFadeWindow(t, ...HATCH_CRACK_WINDOWS[i])));
    // 구멍 그림은 겹쳐 쓰는 오버레이가 아니라 각각 완성된 알 원본이다. 둘을 섞으면
    // 원본에 없는 회색 중간 자산이 생긴다 — 절대 블렌드하지 않는다.
    show(els.holes[0], t >= 2140 && t < 2340 ? 1 : 0);
    show(els.holes[1], t >= 2340 && t < 2620 ? 1 : 0);
    show(els.holes[2], t >= 2620 && t < 2900 ? 1 : 0);
    show(els.peek, 0, "none");
    // 툭 두 번 차고, 앉은 Piggy 가 나오는 3100ms 전에 다리를 집어넣는다.
    const legOut = t >= 2900 && t < 3060 ? 1 : 0;
    const legTap = hatchPulse(t, 2900, 80) + hatchPulse(t, 2980, 80);
    show(els.leg, legOut, `translateY(${-2 * legTap}px) rotate(0deg) scaleY(1)`);
    const seatedIn = t >= 3100 ? 1 : 0;
    const seatedOut = 1 - hatchSmooth(hatchSpan(t, 4780, 4940));
    const tapA = hatchPulse(t, 3900, 150);
    const tapB = hatchPulse(t, 4230, 145);
    const tapSum = tapA + tapB;
    const bodyTap = -2.7 * tapSum;
    const peekLift = -3.8 * hatchSmooth(hatchSpan(t, 3100, 3380));
    const peekBreathe = 0.012 * Math.sin(Math.max(0, t - 3100) / 115);
    const headTap = -4.7 * tapA + 5.6 * tapB;
    show(
      els.seatBody,
      seatedIn * seatedOut,
      `translateY(${bodyTap + peekLift}px) rotate(${headTap * 0.42}deg) skewX(${headTap * 0.16}deg) scale(${1 + peekBreathe}) scaleY(${1 - 0.022 * tapSum})`,
    );
    els.seatBody.style.filter =
      t >= 2140 && t < 3680 ? "drop-shadow(0 0 2px rgba(255,255,255,.58))" : "none";
    show(els.seatHead, 0, "none");
    const breakIndex = t < 3100 ? 0 : t < 3380 ? 1 : t < 3680 ? 2 : 3;
    const stage12P = hatchOut(hatchSpan(t, 3380, 3680));
    const depthP = hatchSmooth(hatchSpan(t, 3680, 5600));
    els.breaks.forEach((el, i) => {
      const active = t >= 2900 && i === breakIndex;
      show(el, active ? 1 : 0, `translateY(${i === 2 ? hatchMix(0, 7, stage12P) : 0}px)`);
    });
    // 커지는 동안 발로 툭툭 — 찰 때마다 껍질이 한 짝씩 날아간다.
    const back = t >= 3680 ? 1 : 0;
    const baseY = hatchMix(7, -10, depthP);
    const baseS = hatchMix(1, 0.62, depthP);
    const baseB = 1.8 * depthP;
    const kickA = hatchOut(hatchSpan(t, 5600, 6020));
    const kickB = hatchOut(hatchSpan(t, 6000, 6420));
    show(
      els.shellL,
      back * (1 - kickA),
      `translate(${-78 * kickA}px,${baseY - 30 * kickA}px) rotate(${-22 * kickA}deg) scale(${baseS})`,
    );
    els.shellL.style.filter = `blur(${baseB}px)`;
    show(
      els.shellR,
      back * (1 - kickB),
      `translate(${78 * kickB}px,${baseY - 30 * kickB}px) rotate(${22 * kickB}deg) scale(${baseS})`,
    );
    els.shellR.style.filter = `blur(${baseB}px)`;
    const footKick = hatchPulse(t, 5600, 150) + hatchPulse(t, 6000, 150);
    const rise = hatchOut(hatchSpan(t, 4780, 5420));
    show(
      els.standOhno,
      hatchFadeWindow(t, 4760, 4900, 5430, 5650),
      `translateY(${hatchMix(13, 0, rise) - 3 * footKick}px) rotate(${2.4 * footKick}deg) scale(${hatchMix(1.12, 1.2, rise)}) scaleY(${hatchMix(0.82, 1, rise) - 0.02 * footKick})`,
    );
    const grow = hatchSmooth(hatchSpan(t, 5500, 6480));
    show(
      els.standMid,
      hatchFadeWindow(t, 5480, 5620, 6400, 6600),
      `translateY(${hatchMix(7, -3, grow) - 3 * footKick}px) rotate(${2.4 * footKick}deg) scale(${hatchMix(1.2, 1.8, grow)}) scaleY(${1 - 0.02 * footKick})`,
    );
    show(els.standSmile, hatchSpan(t, 6420, 6620), "scale(1.80)");
    els.chips.forEach((el, i) => hatchRenderChip(el, HATCH_CHIPS[i], t, bodyTap, headTap * 0.42));
  };
}

// Invite Chog 를 초대 판에 붙인다. 앵커는 CSS 가 정한 자리(`.invite__chog` /
// `.invite__chogNative`)를 그대로 쓴다 — 아트보드 좌표를 여기서 다시 정하지 않는다.
function mountInviteChog() {
  const root = document.querySelector("[data-chog-invite]");
  if (!root) return;
  inviteChog = mountChogInvite(root, {
    reduced: prefersReducedMotion(),
    onFrame: (step) => runSceneFrames(step),
    onCleanup: (fn) => onSceneTeardown(fn),
    listen: (t, ty, h, o) => sceneListener(t, ty, h, o),
  });
  onSceneTeardown(() => {
    inviteChog = null;
  });
}

function renderHatch() {
  return `
    <section class="stage stage--hatch" data-scene="hatch">
      ${arasoBrandMarkup()}
      <div class="hatchStage" id="hatchStage" aria-hidden="true"></div>
      <div class="hatchChog" id="hatchChog" aria-hidden="true">${chogInviteMarkup()}</div>
      <button class="tiny skip" id="skipHatchButton" type="button">skip</button>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

async function mountHatch() {
  const host = document.querySelector("#hatchStage");
  if (!host) return;
  const token = sceneToken;

  let markup;
  try {
    markup = await loadMotionPart("hatch-stage.html");
  } catch {
    // 조각을 못 받으면 연출 없이 다음 칸으로 간다. 인증은 이미 성공한 사실이고,
    // 그림이 없다고 그 사실을 되돌리지 않는다.
    if (token === sceneToken) finishHatch();
    return;
  }
  // 받아오는 동안 사용자가 건너뛰었을 수 있다. 그러면 여기서 끝낸다.
  if (token !== sceneToken) return;
  host.innerHTML = markup;
  const stage = host.querySelector("#piggyHatchStage");
  if (!stage) {
    finishHatch();
    return;
  }
  stage.classList.add("is-live");
  const draw = makeHatchRenderer(stage);
  // 해치 옆의 Chog — 초대에서 이어진 같은 캐릭터다. 반응은 **해치 시계 t** 로만 돈다
  // (별도 wall clock 을 쓰지 않는다 — A-312 지적 8).
  const hatchChogRoot = document.querySelector("#hatchChog [data-chog-invite]");
  const chog = hatchChogRoot
    ? mountChogInvite(hatchChogRoot, {
        reduced: prefersReducedMotion(),
        onFrame: (step) => runSceneFrames(step),
        onCleanup: (fn) => onSceneTeardown(fn),
        listen: (tg, ty, h, o) => sceneListener(tg, ty, h, o),
      })
    : null;
  inviteChog = chog;
  onSceneTeardown(() => {
    inviteChog = null;
  });

  // reduced-motion 에서는 반복 움직임 대신 최종 포즈 한 장. 다음 칸으로 넘어가는 것은
  // 그대로 일어나고, 인증·Save 같은 게이트는 건드리지 않는다(번호 10).
  if (prefersReducedMotion()) {
    draw(HATCH_DURATION);
    chog?.syncHatch(HATCH_DURATION);
    sceneTimeout(finishHatch, 600);
    return;
  }

  let t = 0;
  let last = 0;
  draw(0);
  chog?.syncHatch(0);
  runSceneFrames((now) => {
    // 탭이 숨으면 시계를 멈춘다. 돌아왔을 때 몇 초를 건너뛰지 않게.
    const dt = last && !document.hidden ? Math.min(now - last, 50) : 0;
    last = now;
    t += dt;
    draw(t);
    chog?.syncHatch(t);
    if (t >= HATCH_DURATION) {
      finishHatch();
      return false;
    }
    return true;
  });
  sceneListener(document, "visibilitychange", () => {
    last = 0;
  });
}

function renderName() {
  // 이탈 후 복귀면 Piggy 는 숨은 상태로 기다린다. 다시 나오게 하는 입력은 Save 하나다
  // (A-288 · A-290). 일반 대기에서 숨기는 시간은 아직 정해지지 않았으므로 넣지 않는다.
  // [A-607 canon C/G/H] Chog is now a `.stage`-level sibling of `#nameScene` (same pattern
  // as `.hatchChog` in renderHatch()) — a direct `<img>` inside the scaled board used to
  // shrink to ~34% of Hatch/Auth's fixed apparent size at narrow viewports (master-size
  // break, see style.css `.nameScene__chog` comment). Class name kept unchanged — the
  // Save-time walk-start rect capture below still reads `.nameScene__chog` as-is.
  return `
    <section class="stage stage--name" data-scene="name">
      ${buttonInkFilter()}
      ${arasoBrandMarkup()}
      <div class="nameScene${state.nameResumed ? " is-hidden" : ""}" id="nameScene">
        <div class="nameScene__piggy" id="namePiggy" aria-hidden="true"></div>
        <img class="nameScene__chogWeb" src="${MOTION_DIR}/assets/chog_idle_fill.png" alt="" aria-hidden="true" />
        <div class="nameScene__pad">
          ${nameCardMarkup(
            // [A-626 B] 추가 Piggy(pendingNamePiggyId, admitAddedPiggy)는 첫 탄생 도착 카드("you've got /
            // the one piggy !" + ok)를 다시 틀지 않고 기존 "name" 단계로 곧장, 입력은 비워서 연다 — 첫
            // Piggy 이름(readPiggyName)이 새 Piggy 칸에 새지 않는다. 새 문구 0. 첫 Piggy 경로는 그대로.
            state.pendingNamePiggyId
              ? { phase: "name", name: "" }
              : { phase: state.nameResumed ? "name" : "arrival", name: readPiggyName() },
          )}
        </div>
      </div>
      <div class="nameScene__chog" aria-hidden="true">${chogInviteMarkup()}</div>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// 아트보드는 고정 크기다(1280×800). 화면이 그보다 작으면 그림을 다시 짜지 않고 판을
// 통째로 축소해 가운데에 넣는다 — fitInvite 와 같은 방법(§O).
// [A-605 repair · FAIL 2] "판 전체를 그대로 축소"만으로는 430/390 에서 카드/Piggy/Chog
// 가 다 같이 너무 작아진다(카드 실측: 자연 스케일 0.336@430/0.305@390 — SCENE_GEOMETRY.md
// §4). 내부 좌표(카드 612/292/460/300, Chog 196/556/104, Piggy pgwrap 380/252/230 등)는
// 단 하나도 새로 쓰지 않는다("기존 좌표 그대로, 바깥 배치/스케일만 정규화") — 대신 이미
// A-603 이 Home 캐릭터에 쓴 같은 방법(바닥값 아래로는 자연 스케일을 안 쓰고 바닥값을
// 쓴다, `HOME_CHAR_SCALE_FLOOR` 참고)을 판 전체 스케일에도 그대로 적용한다. 새 매직넘버를
// 또 만들지 않고 이미 Owner 승인을 받은 그 값(0.42)을 재사용한다. 1440 데스크톱은
// 자연 스케일(1.125, board/viewport 비율이 정확히 1.6:1 로 같아 여백 없이 꼭 맞는다)이
// 이 바닥보다 훨씬 커서 전혀 영향을 받지 않는다("web 1440 visually equivalent" 그대로,
// 바닥은 자연값이 그 밑으로 떨어질 때만 작동하는 no-op 가드다). 430/390 실측(바닥 적용
// 후, `.stage`(overflow:hidden) 안에서 카드/Chog 모두 화면 안, 잘림 없음 —
// `raw/*_facts.json`): 카드 우측 가장자리 390 폭에서도 뷰포트보다 13px 이상 안쪽,
// Chog 좌측 가장자리 390/430 모두 뷰포트 안쪽 8px 이상 — 자세한 표는 WRITER.md.
const NAME_SCENE_SCALE_FLOOR = 0.42;
function fitNameScene() {
  const board = document.querySelector("#nameScene");
  if (!board) return;
  const natural = Math.min(window.innerWidth / 1280, window.innerHeight / 800);
  const scale = Math.max(natural, NAME_SCENE_SCALE_FLOOR);
  board.style.transform = `translate(${(window.innerWidth - 1280 * scale) / 2}px, ${(window.innerHeight - 800 * scale) / 2}px) scale(${scale})`;
}

function mountName() {
  const token = sceneToken;
  fitNameScene();
  sceneListener(window, "resize", fitNameScene);
  // [A-607 canon C/G/H] Chog is the same chogInviteMarkup() component Invite/Hatch use
  // (moved out of the scaled #nameScene board — see renderName()/style.css). Mount it the
  // same way mountHatch() mounts `.hatchChog`'s own chog — reuses the shared `inviteChog`
  // module var (Name and Hatch are mutually exclusive scenes, same convention Hatch itself
  // already uses).
  const nameChogRoot = document.querySelector(".nameScene__chog [data-chog-invite]");
  const nameChog = nameChogRoot
    ? mountChogInvite(nameChogRoot, {
        reduced: prefersReducedMotion(),
        onFrame: (step) => runSceneFrames(step),
        onCleanup: (fn) => onSceneTeardown(fn),
        listen: (t, ty, h, o) => sceneListener(t, ty, h, o),
      })
    : null;
  inviteChog = nameChog;
  onSceneTeardown(() => {
    inviteChog = null;
  });
  loadMotionPart("name-piggy.html")
    .then((markup) => {
      if (token !== sceneToken) return;
      const host = document.querySelector("#namePiggy");
      if (host) host.innerHTML = markup;
    })
    .catch(() => {
      // Piggy 그림이 없어도 이름 칸은 그대로 쓸 수 있다. 저장을 막지 않는다.
    });
  // 첫 해치 뒤에는 도착 카드(ok)부터, 이름 미완 복귀는 도착 없이 바로 Name it(A-324 §6).
  // submit 은 render() 가 savePiggyName 에 이미 묶는다 — 여기서 두 번 묶지 않는다.
  mountNameCard(document.querySelector("#nameScene"), {
    listen: sceneListener,
    focus: !state.nameResumed,
  });
}

// --- 첫 Home 도착 (A-304) ----------------------------------------------
// 승인 연결본 `connected/index.html` :554–644 의 「씬 4 Home 구현 수치」 그대로.
// 좌표계는 1256×772 판이고, 화면이 작으면 판을 통째로 축소해 가운데 넣는다(§O).
// 프레임 48장·30ms·2.88초 이동·3.02초 착석·3.42초 털썩 완료는 정본 값이라 고치지 않는다.
const HOME_BOARD_W = 1256;
const HOME_BOARD_H = 772;
const HOME_FLOOR = 648;
const HOME_CENTER = 1041; // Piggy 잉크 중심 x
const HOME_WALK_W = 190 * 0.88;
const HOME_WALK_H = (HOME_WALK_W * 585) / 565; // 프레임 565×585
const HOME_WALK_FOOT = 555 / 585; // 바닥 잉크 y555
const HOME_SEAT_W = 150;
const HOME_SEAT_H = (HOME_SEAT_W * 551) / 528;
const HOME_SEAT_FOOT = 550 / 551;
const HOME_WALK_L = HOME_CENTER - 0.5133 * HOME_WALK_W;
const HOME_SEAT_L = HOME_CENTER - 0.4991 * HOME_SEAT_W;
// 타임라인(초) — 정본 그대로.
const HOME_T_BLEND = 0.12;
const HOME_T_WALK = 2.88;
const HOME_T_SWAP = 3.02;
const HOME_T_PLOP_END = 3.42;
const HOME_T_BREATHE = 4.0;
// 승인 원본 `frame()` 이 `Math.min((now-t0)/1000, 4.6)` 으로 시계를 4.6 에서 멈춘다.
// 그래서 숨쉬기는 4.0~4.6 한 구간이고, 그 뒤에는 4.6 의 모습으로 서 있는다.
const HOME_T_END = 4.6;
const HOME_FPS = 0.03;
// [A-356 §2] Save → 정착 완료 뒤 첫 Journey 카드까지의 대기. 정본 대기값이 없어 구현
// 초안으로 쓴다 — Owner 확정 초수 아님. mountHome() 의 settle() 이 이 표를 쓴다.
const HOME_FIRST_JOURNEY_CARD_MS = 1200;

// [A-603] 캐릭터 스케일 바닥 — A-602 Owner 프리뷰(Candidate C, receipts/
// A602_mobile_home_bc_preview/overrides/c_floor.js)가 측정·검증한 그 메커니즘을 값·
// 넛지까지 그대로 들여온다(재발명 0, "port the A-602 C mechanism into app properly").
// fitHomeBoard() 의 실측 s 가 이 값보다 작을 때만 #homeChar/#chogHome 을 감싸는 새
// 조상(.homeCharScaleFloor, style.css)에 scale(k)+작은 고정 넛지를 건다 — 두 자식
// 자신의 마크업·좌표계·chog-home.js 의 매 프레임 인라인 transform 은 그대로다(중첩
// transform 은 곱해질 뿐 덮어쓰지 않는다). 0.42 는 A-602 B/C 표의 세 후보(0.40/0.42/
// 0.44) 중 "충돌 B 이하 유지 + 발밑 고정" 을 만족한 가운데 값 — 카드 지시 "0.42 primary
// starting value" 그대로. 걷기 애니메이션 자체(ENTER_X/entryY/entryScale, 전부 s
// 하나만 기준)에는 걸지 않는다 — settle() 이후(정착)에만 적용해 도착 연출의 크기
// 산수를 바꾸지 않는다("location first, scale second").
// [A-606 OWNER ADDENDUM (2026-09-27) · pass2] "0.42 를 최종으로 굳히지 마라 — Owner
// 스크린샷에서 여전히 작게 읽힌다. 0.48/0.50/0.52 를 비교하고 0.50~0.52 를 우선한다."
// 세 값 실측 비교(Piggy 자신의 `#homeSeat` 박스 높이 ÷ 뷰포트 높이, 430×900 기준) —
// `screenshots/floor_compare/p2_home_settled_{430,390}.png` (각 후보 실행 시점에 저장,
// WRITER.md Pass 2 표에 세 값 전부 기록) + WRITER.md 참고: 0.48→8.3%, 0.50→8.7%,
// 0.52→9.0%(세 값 모두 목표 22–25% 밴드에 못 미친다 — 그 밴드에 실측으로 닿으려면
// 비교 대상 밖의 훨씬 큰 바닥값이 필요했다는 것도 WRITER.md 에 그대로 기록했다. 이
// 22–25%는 카드 자신의 표현대로 "where composition allows" 인 지향점이지 하드 게이트가
// 아니다). 셋 다 하단-고정 목표(bottomSafe+22px)는 동일하게 정확히 맞고(feetToBottom
// ≈73.9px 셋 다 동일), First-Job 카드와의 겹침도 셋 다 0% — 그래서 이 셋 사이의 선택은
// 순수히 "더 큰 쪽을 선호" 라는 Owner 지시를 그대로 따른다: 0.52 가 그 중 가장 크다.
// ("발밑 고정, 위로만 성장"은 세 값 모두 동일하게 유지됨 — 무엇을 골라도 걷기 연속성은
// 안 깨진다.)
const HOME_CHAR_SCALE_FLOOR = 0.52;
const HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX = { x: 6, y: 8 };
// [A-606 OWNER ADDENDUM · pass2 §3 BOTTOM ANCHOR] "character feet/group baseline should sit
// roughly bottom-safe + 20~24px above the physical bottom" — 20~24 의 중간값.
const HOME_CHAR_BOTTOM_ANCHOR_GAP_PX = 22;

// production 은 계속 env() 기반(`--mobile-bottom-safe` 등, style.css :root)이다 — 이
// 함수는 그 토큰의 **실제 계산된 px 값**을 읽을 뿐, 새 하드코딩 값을 만들지 않는다.
// (리뷰 하네스가 이 토큰을 오버라이드하면 이 함수도 오버라이드된 값을 그대로 읽는다 —
// "production stays env()-based, harness simulates" 을 그대로 만족한다.) 커스텀
// property 는 `getComputedStyle().getPropertyValue()` 로 읽으면 계산 전 원문 문자열
// ("calc(env(...) + 20px)")이 나오므로, 실제 요소에 길이로 걸어 computed px 를 읽는
// 표준 우회법을 쓴다.
function resolveCssLengthVarPx(varName, fallbackPx) {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.top = `var(${varName})`;
  document.body.appendChild(probe);
  const resolved = parseFloat(getComputedStyle(probe).top);
  probe.remove();
  return Number.isFinite(resolved) ? resolved : fallbackPx;
}

// 후버 노트패드에 넣을 실제 데이터 — Piggy 는 한 기기에 하나뿐이라 지금 어디 있는지는
// scene 하나로 정해진다(home-paper.js homeStatusFromScene). 샘플 이름/시간을 쓰지 않는다.
// [A-411-p] Owner 확정: Home 에는 "next errand" 버튼이 없다(A-411-n §1). 옛
// canOpenSecondJourney/nextErrandButton 삽입을 없앤다 — 버튼이 없어졌으므로 chog-home.js
// draw() 의 #nextErrandButton 참조도 함께 정리했다.
// [A-411-r] Second Journey 진입은 이제 settle() 의 조용한-뒤-Paper 자동전개(아래)
// 하나뿐이다 — A-411-p 가 걸었던 Chog 탭(onTap) 직행은 Owner 최신 규칙과 충돌해
// 되돌렸다(mountHome() onTap 주석 참고). Chog 탭은 원래 HOME 패드를 열 뿐이다.
// [A-412 §1] Money/Piggy 상세는 sendstay(=실제 Home 대시보드)안에서만 뜻이 있다. 다른
// 씬은 이 pad 를 그대로 재사용하지만(homeCharacter/renderAway/renderReturn 등) 그 안에서는
// 늘 "home" 두 카드만 보여준다 — state.homePaperMode 가 어쩌다 남아 있어도(§setScene 이
// 보통 지운다) 새지 않는다.
function homePaperEffectiveMode(scene) {
  return scene === "sendstay" ? state.homePaperMode : "home";
}

// [A-412 §3] MON/shMON 값 하나를 사람이 읽는 자릿수로 줄인다. 기존 formatMoney()(receiptRows
// 등)는 "$" 를 붙이는 옛 화면 전용 표기라 여기서 재사용하지 않는다 — MON 을 USD 로 쓰지
// 않는다(§forbidden). 값이 없으면(null/undefined) null 을 그대로 돌려줘 호출부가 미확인으로
// 그린다 — 0 을 대신 넣지 않는다.
function formatHomeMoneyAmount(wei) {
  if (wei === null || wei === undefined) return null;
  let value;
  try {
    value = Number(formatEther(wei));
  } catch {
    return null;
  }
  if (!Number.isFinite(value)) return null;
  const decimals = value !== 0 && Math.abs(value) < 0.001 ? 6 : 4;
  const fixed = value.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

// 지금 이 기기의 하나뿐인 Piggy가 실제로 밖에 나가 있는 중인가 — home-paper.js
// homeStatusFromScene() 과 같은 판정(scene==="away")을 여기서도 그대로 쓴다(판정 두 번 0).
function homeMoneyAwayNow() {
  return state.scene === "away";
}

// [A-412 §3/§4] Money 카드 본문 — "at home" / "with [이름]" / "actually away" 를 한 번에
// 두 줄만 켠다(같은 shMON 잔액을 소유(엔트러스트)와 상태(지금 밖) 양쪽으로 중복합산하지
// 않는다, canon "with 와 away 가 같은 돈이면 중복합산행 0"). 클릭 가능한 한 줄만
// #homePaperMoneyRow 로 Piggy 상세를 연다.
// [A-484 Lane C] Third Journey 임시 UI — 레지스트리에서 **읽기만** 한다.
// 돈을 쓰지 않는다. 레지스트리가 비어 있으면 기존 한 마리 화면이 **그대로** 나간다.
function secondPiggyRegistrySnapshot() {
  const scope = secondJourneyScope();
  if (!scope.accountId) return { piggies: [], totals: null };
  const { registry } = loadRegistry(safeLocalStorage(), scope);
  let piggies = registry.piggies;
  if (piggies.length === 0) {
    // 한 마리 시절 사용자를 잃지 않는다 — 저장된 정체성이 있으면 그것 하나로 읽는다.
    const { piggy } = migrateSinglePiggy({ address: state.address || "", name: state.piggyName || "" });
    piggies = piggy ? [piggy] : [];
  }
  return { piggies, totals: projectRegistryTotals({ piggies }) };
}

// 지금 오른쪽 HISTORY 가 어느 Piggy 의 기록을 보고 있나. null 이면 기존(전체) 동작이다.
function selectedHistoryPiggyId() {
  return state.historyPiggyId || null;
}

// [A-495 Lane B] 지금 실제로 쓸 수 있는 충전 어댑터.
// **비어 있다** — 제공자가 정해지기 전까지 어떤 방법도 available 이 아니다(A-494 조사).
// 제공자가 생기면 **여기에만** 한 줄 추가하면 된다. 화면은 이 상태를 그대로 읽는다.
const FUNDING_ADAPTERS = [];

function fundingMethods() {
  return listFundingMethods({ adapters: FUNDING_ADAPTERS });
}

// [A-510 Stream D-core] 어떤 Piggy 가 하려던 일에 **그 Piggy 자기 가용 돈(at home)** 이 모자랄 때,
// 쫓아내지 않고 그 자리에서 **바로 그 Piggy 를 받는 곳으로** 같은 충전을 연다.
// 받는 Piggy 는 **호출자가 넘긴다** — 여기서 두 번째 선택 상태를 만들지 않는다(여럿일 때는 Stream B 의 selectedPiggy).
// 이력: A-495 의 `beginFundingForShortfall` 은 **Home 부족분**(give some)을 기준으로 했다 — A-508 에서 제거.
// 지금 이 함수를 부르는 제품 UI 는 아직 없다(충전 진입 화면은 WAIT_DESIGN_MERGE) — 이 runtime
// seam 자체는 callable/testable 이다(funding-runtime-core.mjs).
function pieceHeld(piggy, asset) {
  return (piggy?.assets || []).find((a) => a && a.symbol === asset) || null;
}

// [A-555 S2] 이 충전 목적지가 **살아 있는 서명자가 실제로 증명한** Piggy 주소인지 검사하는
// 단일 nonce 소비 집합. 재생(같은 proof 두 번) 은 여기서 막힌다 — funding-runtime-core.mjs 가 이
// 계약을 잰다. 지금 이 함수의 제품 호출자는 없다(충전 진입 화면은 WAIT_DESIGN_MERGE) — 하지만
// state.activeSignerAddress 같은 주변 상태를 이 목적으로 읽지 않는다(S4 가 매 행동 끝에 세션을
// 닫으므로 그 값은 보통 비어 있다 — 여기 게이트는 그것과 무관하게 자기 proof 만 본다).
const consumedFundingProofNonces = new Set();

// [A-553 Lane A] 도착 체인은 더 이상 숨은 monad-mainnet 리터럴이 아니다 — **지금 이 세션의
// 실제 실행 체인**(secondJourneyScope().chainId)으로 FundingContext 를 만들고, 그 chainId 를
// 그대로 fundingRequestForShortfall 에 넘긴다. 체인이 런타임과 다르거나 자산이 allowlist 에
// 없으면(chain_scope_mismatch/asset_id_chain_mismatch) 여기서 열리지 않는다 — ack 로 넘어갈 수
// 있는 문이 아니다.
// [A-555 S2] `controlProof` 없이는 열리지 않는다 — 캐스팅 전에 verifyFundingTargetProof 로
// **서명으로 증명된** 목적지인지부터 본다. 호출자가 넘긴 signerAddress 문자열이나 로컬
// 인덱스 주소는 그 자체로 증명이 아니다(lane_b coordinator 교정) — 통과 못 하면 항상 같은
// 이유(funding_target_unproven) 하나로 닫힌다.
async function beginFundingForPiggy(piggy, { action = null, amount, asset = "USDC", controlProof = null } = {}) {
  if (!piggy || typeof piggy.id !== "string") return { opened: false, reason: "missing_piggy" };
  if (typeof piggy.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(piggy.address)) return { opened: false, reason: "missing_piggy_address" };
  const runtimeChainId = secondJourneyScope().chainId;
  const proofCheck = await verifyFundingTargetProof(controlProof, {
    piggy,
    chainId: runtimeChainId,
    now: Date.now,
    recover: ({ message, signature }) => recoverMessageAddress({ message, signature }),
    consumedNonces: consumedFundingProofNonces,
  });
  if (!proofCheck.ok) return { opened: false, reason: "funding_target_unproven" };
  const { context, error: contextError } = buildFundingContext({
    chainId: runtimeChainId,
    runtimeChainId,
    assetSymbol: asset,
    targetPiggyId: piggy.id,
    targetAddress: piggy.address,
  });
  if (contextError) return { opened: false, reason: contextError };
  // 그 Piggy 가 가진 것 중 **밖에 안 나간** 부분만 쓸 수 있다.
  const available = piggy.location === "home" ? (pieceHeld(piggy, asset)?.quantity ?? "0") : "0";
  const check = checkIntentFunding({ piggyId: piggy.id, action, amount, asset, decimals: context.decimals, available });
  if (check.error) return { opened: false, reason: check.error };
  if (check.sufficient) return { opened: false, reason: "sufficient" };
  const request = fundingRequestForShortfall(check, { target: piggy.address, chain: context.chainId });
  if (!request) return { opened: false, reason: "shortfall_request_failed" };
  state.funding = {
    state: FUNDING_STATE.CHOOSING,
    shortfall: check.shortfall,
    asset,
    targetPiggyId: piggy.id,
    context,
    // **원래 의도를 통째로 들고 간다.**
    resumeAfter: request.resumeAfter,
    request,
  };
  return { opened: true, shortfall: check.shortfall };
}

// [A-553 Lane C] 확인된 충전 하나가 재생(replay)돼도 재조정을 두 번 세지 않게 하는 세션 내
// 중복-방지 집합 — funding-reconcile.js reconcileConfirmedFunding() 의 seenEvidenceKeys.
const fundingReconcileSeenKeys = new Set();

// 확인-이후 절반을 따로 뺀 이유: settleFunding 자체는 항상 동기적인 계약(resumeAfterFunding)을
// 지키고, 이 함수만 비동기 읽기/저장을 한다 — 테스트가 이 부분만 잘라 재조정 계약을 잰다.
// **이 함수는 실제 잰 잔액만큼만** 레지스트리를 바꾼다. 절대 권한을 만들지 않는다(호출부 없음).
async function settleConfirmedFundingEvidence({ applied, context, client, storage, now, priceQuote }) {
  if (!context) return { ok: false, reason: "missing_funding_context" };
  const runtimeChainId = secondJourneyScope().chainId;
  const { ok: contextOk, error: contextError } = validateFundingContext(context, { runtimeChainId });
  if (!contextOk) return { ok: false, reason: contextError };

  const receipt = applied.receipt;
  const nowValue = typeof now === "function" ? now() : now;
  const typedReceipt = {
    kind: "add_money",
    chainId: context.chainId,
    token: context.assetId,
    amount: receipt.resolvedAmount,
    txHash: receipt.txHash,
    at: receipt.at || nowValue,
    ...(context.targetPiggyId ? { piggyId: context.targetPiggyId } : {}),
  };
  // 증거(영수증)는 잔액 재조정의 성패와 무관하게 항상 남긴다. 같은 tx 재생은
  // receipt-codec.js receiptIdentityKey 를 쓰는 rememberReceipt 의 dedupe 가 그대로 막는다 —
  // 여기서 새 판정을 만들지 않는다.
  rememberReceipt(typedReceipt);

  // **client 의 체인이 이 충전의 체인과 같을 때만** 재조정한다 — 다르면 fail-closed UNKNOWN.
  const clientScope = scopeForChainId(client?.chain?.id);
  if (clientScope !== context.chainId) {
    return { ok: false, reason: "client_chain_mismatch", state: FUNDING_STATE.UNKNOWN, receiptPersisted: true };
  }
  const scope = secondJourneyScope();
  if (!scope.accountId) return { ok: false, reason: "no_account_scope", receiptPersisted: true };

  const { registry } = loadRegistry(storage, scope);
  const evidence = {
    chainId: context.chainId,
    tokenAddress: context.assetId,
    targetAddress: context.targetAddress,
    targetPiggyId: context.targetPiggyId,
    txHash: receipt.txHash,
    decimals: context.decimals,
    assetSymbol: context.assetSymbol,
  };
  const outcome = await reconcileConfirmedFunding({
    evidence,
    piggies: registry.piggies,
    client,
    runtimeChainId: context.chainId,
    priceQuote,
    now: nowValue,
    seenEvidenceKeys: fundingReconcileSeenKeys,
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason, receiptPersisted: true };

  // **측정된 값으로만** 저장한다 — 요청/도착 금액을 더해 쓰지 않는다.
  const saved = saveRegistry(storage, scope, { ...registry, piggies: outcome.piggies });
  return {
    ok: saved.saved,
    reason: saved.saved ? null : saved.error,
    receiptPersisted: true,
    valuationKnown: outcome.valuationKnown,
  };
}

// 충전 결과 반영 → 원래 의도로 복귀. **권한은 주지 않는다.**
// [A-553 Lane C] 확인된(CONFIRMED + creditsTarget) 결과가 오면 typed 영수증을 남기고, 주입된
// 읽기전용 client 로 재조정한다(settleConfirmedFundingEvidence). 기본 client/storage 는 이 앱의
// 실제 publicClient/localStorage 다 — 테스트는 둘 다 주입해서 바꾼다(프로덕션 디버그 훅 0).
async function settleFunding(result, {
  available,
  client = publicClient,
  storage = safeLocalStorage(),
  now = () => new Date().toISOString(),
  priceQuote = null,
} = {}) {
  const f = state.funding;
  if (!f) return null;
  const applied = f.intent ? applyFundingResult(f.intent, result) : { state: result?.status ?? FUNDING_STATE.FAILED, creditsTarget: false };
  const resumed = resumeAfterFunding(applied, f.resumeAfter, {
    available,
    decimals: f.resumeAfter?.decimals,
  });
  let reconcile = null;
  if (applied.state === FUNDING_STATE.CONFIRMED && applied.creditsTarget === true && applied.receipt) {
    reconcile = await settleConfirmedFundingEvidence({ applied, context: f.context, client, storage, now, priceQuote });
  }
  // 충전이 끝나도 **원래 행동은 자기 권한을 새로 받아야 한다** — 여기서 권한을 만들지 않는다.
  state.funding = { ...f, state: applied.state, lastResult: applied, resumed, reconcile };
  return resumed;
}

// [A-492 Lane A] 실제 승인 경계. **기존 Mera/passkey 경로를 그대로 쓴다** — 두 번째 인증 스택 0.
// 성공하면 **이 행동 하나에만 묶인 봉투**가 생기고, 실패/취소는 아무것도 바꾸지 않는다.
const consumedPermissionNonces = new Set();

// [A-555 S2] `beginFundingForPiggy` 가 요구하는 controlProof 를 **실제로 만드는** 유일한 자리.
// 지금 이 함수를 부르는 제품 UI/캐시는 없다(충전 진입 화면 자체가 WAIT_DESIGN_MERGE) — 이
// helper 는 그 문이 열릴 때를 위한 callable/testable seam이다. authRequestForPiggy 로 이
// Piggy 자신의 locator 만 묻고, 파생된 서명자로 짧게 살아있는 세션을 하나 만들어 challenge 에
// 서명한 뒤 **바로** 그 세션을 끝낸다 — 이 함수가 끝나면 어떤 살아있는 서명 세션도 남기지 않는다.
async function proveFundingTargetControl(piggy) {
  const { request, error: authError } = authRequestForPiggy(piggy);
  if (authError) return { proof: null, error: authError };
  let address;
  try {
    const result = await requestPrf(request.credential, { prfSalt: request.prfSalt ?? null });
    ({ address } = activateSigningSession(result.prfOutput, { persistAddress: false }));
  } catch (error) {
    return { proof: null, error: "passkey_declined" };
  }
  try {
    // [A-558 Lane B] 파생된 서명자 주소가 **이 Piggy 주소와 같을 때만** 서명한다 — 이미
    // requestMoneyPermission 이 쓰는 것과 같은 Gate C 결합(bindSigner)이다. 다르면 challenge에
    // 서명조차 하지 않고 그 자리에서 멈춘다(신호=signer_mismatch 등 bindSigner 의 안정된
    // reason 하나 — 새 오라클을 만들지 않는다). downstream verifyFundingTargetProof 의 서명
    // 복구 검사는 그대로 남는다(방어의 두 번째 층, 대체가 아니라 심층방어).
    const bound = bindSigner(piggy, address);
    if (!bound.ok) return { proof: null, error: bound.reason };
    const chainId = secondJourneyScope().chainId;
    const issuedAt = Date.now();
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const { challenge, error: challengeError } = fundingTargetChallenge({ chainId, piggyId: piggy.id, address, issuedAt, nonce });
    if (challengeError) return { proof: null, error: challengeError };
    const signature = await activeAccount.signMessage({ message: challenge });
    return { proof: { chainId, piggyId: piggy.id, address, issuedAt, nonce, signature }, error: null };
  } catch (error) {
    return { proof: null, error: "sign_failed" };
  } finally {
    // [A-558 Lane B 교정] 증명이 나왔든 실패했든 이 짧은 서명자는 여기서 끝낸다 — 하지만
    // **서명자만** 끝낸다(endSignerSession), 앱 전체(endActiveSession = 서명자 + 10분 app-idle
    // 타이머)를 끝내지 않는다. A-556 정책의 결이 그렇다: "충전 목적지 증명 하나"는 앱을
    // 잠그는 사건(Piggy 전환·app-idle 만료·beforeunload·dev reset)이 아니다 — 다른 이유로
    // 이미 살아 있던 앱-idle 카운트를 이 증명 호출이 조용히 리셋/정지시키면 안 된다. (이전:
    // A-555 가 만들 때부터 A-556 PHASE 2 가 이 자리를 검토했지만 그때는 "바꾸지 않는다"였다 —
    // A-558 카드가 그 판단을 다시 열어 여기서 뒤집는다.) 이 함수 자신이 부르는
    // activateSigningSession() 은 항상 먼저 endActiveSession() 을 불러 **이전에 살아 있던
    // 서명자**(다른 Piggy/행동 것일 수 있다)를 이미 갈아치운다 — 그건 이 helper 가 아니라
    // activateSigningSession 의 기존 계약이고 A-558 범위 밖이다. 즉 "선택된 Piggy에 이미 살아
    // 있던 서명자가 있었다면 이 helper 호출이 그것을 대체한다"는 그대로 남는다 — 받아들일 수
    // 있는 fail-safe다(다음 돈 행동은 다시 인증하면 된다).
    endSignerSession();
  }
}

// [A-512 Gate C] 고른 Piggy 의 locator 로만 묻고, 파생된 서명자가 **그 Piggy 주소와 같을 때만** 봉투를 만든다.
// 전역 `state.credential` 로 떨어지지 않는다. 한 마리 경로의 저장 scope(state.address)도 바꾸지 않는다.
function selectedRegistryPiggy() {
  const sel = state.selectedPiggy;
  if (!sel) return null;
  return moneyPiggiesSnapshot().piggies.find((p) => p.id === sel.id) || null;
}

async function requestMoneyPermission() {
  const intent = state.moneyIntent;
  if (!intent || intent.status !== PERMISSION_STATE.AWAITING) return;
  const fail = (reason) => {
    state.moneyIntent = { ...intent, status: PERMISSION_STATE.FAILED, permissionError: reason, permission: null };
    render();
  };
  const sel = state.selectedPiggy;
  if (!sel || sel.id !== intent.piggyId) return fail("selected_piggy_mismatch");
  const { request, error: authError } = authRequestForPiggy(selectedRegistryPiggy());
  if (authError) return fail(authError);   // locator 없음 → 묻지 않는다(전역 credential 대체 0)

  let verifiedAt = null;
  let signerAddress = null;
  try {
    // 여기서 실제로 Face ID/passkey 가 뜬다. 이 호출 없이는 봉투가 만들어지지 않는다.
    const result = await requestPrf(request.credential, { prfSalt: request.prfSalt ?? null });
    ({ address: signerAddress } = activateSigningSession(result.prfOutput, { persistAddress: false }));
    verifiedAt = Date.now();
  } catch {
    // 취소/실패 — **돈도 투영도 건드리지 않는다.**
    const cancelled = cancelPermission("passkey_declined");
    state.moneyIntent = { ...intent, status: cancelled.state, permission: null };
    render();
    return;
  }
  // 기다리는 동안 선택이 바뀌었거나, 파생된 서명자가 고른 Piggy 가 아니면 **그 서명자를 버린다.**
  const bound = state.selectedPiggy === sel ? bindSigner(sel, signerAddress) : { ok: false, reason: "selection_changed" };
  if (!bound.ok) {
    endActiveSession();
    return fail(bound.reason);
  }
  const at = new Date(verifiedAt).toISOString();
  const base = {
    piggyId: intent.piggyId,
    signerAddress: bound.signerAddress,
    action: intent.action,
    asset: intent.asset || "USDC",
    amount: intent.amount,
    chain: secondJourneyScope().chainId,
    destination: intent.destination || null,
    destinationRequired: Boolean(intent.destination),
  };
  const { envelope, error } = issuePermission({
    intent: base,
    auth: { method: "passkey", verified: true, verifiedAt, credentialId: request.credential.credentialId },
    nonce: permissionNonce({ ...base, at }),
    nowMs: verifiedAt,
  });
  // 봉투를 만들어 **보관만** 한다. 실행은 별도 단계이며 이 칸에서는 fork 하네스가 증명했다.
  state.moneyIntent = envelope
    ? { ...intent, status: PERMISSION_STATE.PERMITTED, permission: envelope }
    : { ...intent, status: PERMISSION_STATE.FAILED, permissionError: error, permission: null };
  render();
}

// 실행 직전 대조. 봉투가 지금 하려는 일과 정확히 같을 때만 통과한다.
function authorizeMoneyAction(request) {
  return authorize(state.moneyIntent?.permission ?? null, request, {
    nowMs: Date.now(),
    consumedNonces: consumedPermissionNonces,
    // [A-512] 지금 고른 Piggy 와 살아 있는 서명자 — 봉투와 전부 같아야 한다.
    context: selectionContext(state.selectedPiggy, activeAccount?.address ?? state.activeSignerAddress),
  });
}

// [A-512 Gate C] 고른 Piggy 바꾸기. **다른 Piggy 로 가면 이전 권한이 먼저 죽는다**:
// 세션 종료 · 쓰지 않은 봉투 폐기(nonce 소비 처리) · 의도/충전 초기화. 그 뒤에야 새 선택이 선다.
function applyPiggySelection(piggy) {
  const out = switchSelection(state.selectedPiggy, piggy, { heldEnvelope: state.moneyIntent?.permission ?? null });
  if (out.error) {
    // 주소가 없는 Piggy 는 돈 동작의 선택이 될 수 없다 — 이전 권한도 남기지 않는다.
    endActiveSession();
    if (state.moneyIntent?.permission?.nonce) consumedPermissionNonces.add(state.moneyIntent.permission.nonce);
    state.moneyIntent = null;
    state.funding = null;
    state.selectedPiggy = null;
    return out;
  }
  if (out.invalidate) {
    endActiveSession();
    if (out.revokeNonce) consumedPermissionNonces.add(out.revokeNonce);
    state.moneyIntent = null;
    state.funding = null;
  }
  state.selectedPiggy = out.selection;
  return out;
}

// [A-556 Owner bank-style session policy — supersedes A-533 Lane C · S4] 봉투는 한 번 쓰면
// 끝이지만(nonce 소비, 재사용 불가), **서명자는 여기서 끝나지 않는다** — 살아 있는 서명자
// 세션이 남는다고 옛 권한이 되살아나는 건 아니다(카드 §3). 같은 Piggy 로 5분 절대 창 안의
// 다음 송금은 서명자를 재사용할 수 있고, 그 행동은 여전히 자기 몫의 새 확인/권한을 거친다.
function consumeMoneyPermission() {
  return consume(state.moneyIntent?.permission ?? null, consumedPermissionNonces);
}

// [A-486 Lane B] 지금 고르고 있는 금액/대기 중인 권한 요청을 같은 종이에 그린다.
// **이 화면 어디에서도 실행 권한이 생기지 않는다** — 최종 승인은 Face ID/passkey 다.
function moneyIntentMarkup(piggy) {
  const intent = state.moneyIntent;
  if (!intent || intent.piggyId !== piggy.id) return "";
  const held = (piggy.assets || [])[0] || null;
  // 얼마까지 고를 수 있나 — **그 Piggy 가 든 돈**뿐이다. Home 잔액은 없다(A-510 Stream A).
  const availability = held?.quantity ?? null;
  if (availability === null) return "";
  const choices = amountChoices(availability);
  const valid = intent.amount !== null && intent.amount !== undefined && intent.amount !== "custom" && Number(intent.amount) > 0;
  const permissionLine = intent.status === PERMISSION_STATE.AWAITING
    ? `<p class="homePaper__note">확인이 필요해 — 아직 아무것도 보내지 않았어.</p>
       <button class="homePaper__records" id="homePermissionApprove" type="button">&gt; Face ID 로 확인</button>`
    : intent.status === PERMISSION_STATE.PERMITTED
      ? `<p class="homePaper__note">확인됐어. 이 한 번에만 쓸 수 있어.</p>`
      : intent.status === PERMISSION_STATE.CANCELLED
        ? `<p class="homePaper__note">확인을 멈췄어 — 아무것도 바뀌지 않았어.</p>`
        : "";
  return `<div class="homePaper__intent">
    ${amountChoiceMarkup(choices, { selected: intent.amount })}
    ${confirmButtonMarkup({ enabled: valid && intent.status !== "awaiting_permission" })}
    ${permissionLine}
  </div>`;
}

function homeMoneyBodyMarkup(name) {
  const time = homeTimeNow();
  if (state.homeMoneyStatus === "idle" || state.homeMoneyStatus === "loading") {
    return homeMoneyMarkup({
      title: "MY MONEY",
      time,
      rows: [
        { label: "at home", checking: true },
        { id: "homePaperMoneyRow", label: `with ${name}`, checking: true },
      ],
    });
  }
  if (state.homeMoneyStatus === "error") {
    return homeMoneyMarkup({
      title: "MY MONEY",
      time,
      status: {
        text: state.homeMoneyErrorText || "couldn't read the balance.",
        retryLabel: "try reading again",
      },
    });
  }
  const awayNow = homeMoneyAwayNow();
  const nativeAmount = formatHomeMoneyAmount(state.homeMoneyNativeWei);
  const shmonAmount = formatHomeMoneyAmount(state.homeMoneyShmonWei);

  // [A-484 Lane C] Piggy 가 둘 이상일 때만 레지스트리 행으로 바꾼다.
  // 한 마리일 때는 **기존 화면 그대로** 둔다(First/Second 회귀 0).
  const snapshot = moneyPiggiesSnapshot();
  if (snapshot.piggies.length > 1) {
    // [A-510 Stream A] 별도 `at home` 합계 행 0 — `at home` 은 각 Piggy 안의 상태다(A-508).
    const rows = homeMoneyPiggyRows({
      totals: snapshot.totals,
      piggies: snapshot.piggies,
      selectedPiggyId: selectedHistoryPiggyId(),
    });
    // [A-510 Stream A] 고른 Piggy 아래의 give/bring 인라인 동작은 걷어냈다(A-486 이력).
    const selected = snapshot.piggies.find((p) => p.id === state.selectedPiggy?.id) || null;
    const intentMarkup = selected ? moneyIntentMarkup(selected) : "";
    // [A-495 Lane B] 충전이 열려 있으면 그 자리에서 방법을 보여준다(새 종이 0). 받는 곳은 그 Piggy 다.
    const fundingMarkup = state.funding ? fundingMethodsMarkup(fundingMethods()) : "";
    return homeMoneyMarkup({ title: "MY MONEY", time, rows, note: homeMoneyTotalsNote(snapshot.totals) }) + intentMarkup + fundingMarkup;
  }

  return homeMoneyMarkup({
    title: "MY MONEY",
    time,
    rows: [
      { label: "at home", amount: nativeAmount, unit: nativeAmount === null ? undefined : "MON" },
      {
        id: "homePaperMoneyRow",
        label: `with ${name}`,
        amount: awayNow ? HOME_NOT_APPLICABLE_LABEL : shmonAmount,
        unit: awayNow || shmonAmount === null ? undefined : "shMON",
        clickable: !awayNow && shmonAmount !== null,
      },
      {
        id: "homePaperMoneyRow",
        label: "actually away",
        amount: awayNow ? shmonAmount : HOME_NOT_APPLICABLE_LABEL,
        unit: awayNow && shmonAmount !== null ? "shMON" : undefined,
        clickable: awayNow && shmonAmount !== null,
      },
    ],
  });
}

// [A-412-b §2] Piggy 상세 — 실제 확인 가능한 필드만 채운다. 근거 없는 필드는 null(미확인),
// 이 Piggy/이번 트립에 구조적으로 없는 값은 HOME_NOT_APPLICABLE_LABEL(해당없음)로 갈라
// 쓴다. "changed"/"work state"/"expected back" 은 현재 이 앱에 그 값을 뜻이 갈리지 않게
// 알려주는 원천이 없어(§보고 "미확인 필드") null 로 둔다 — receipt-paper.js 가 "kept" 를
// 같은 이유로 비워 두는 것과 같은 판단이다. "went out with"/"cost so far" 는 마지막
// 실제 receipt(state.receipts[0])에 있는 그대로다(sent/gas, main.js settleSend()가 이미
// 만든 값 — 새로 계산하지 않는다).
function homePiggyDetailBodyMarkup(name) {
  const time = homeTimeNow();
  if (state.homeMoneyStatus === "idle" || state.homeMoneyStatus === "loading") {
    return homePiggyDetailMarkup({ name, time, status: { text: "checking…", retryLabel: "try reading again" } });
  }
  if (state.homeMoneyStatus === "error") {
    return homePiggyDetailMarkup({
      name,
      time,
      status: {
        text: state.homeMoneyErrorText || "couldn't read the balance.",
        retryLabel: "try reading again",
      },
    });
  }
  const shmonAmount = formatHomeMoneyAmount(state.homeMoneyShmonWei);
  const receipt = state.receipts[0] || null;
  const sentAmount = receipt ? formatHomeMoneyAmount(receipt.sent) : null;
  const gasAmount = receipt ? formatHomeMoneyAmount(receipt.gas) : null;
  return homePiggyDetailMarkup({
    name,
    time,
    wentOutWith: receipt ? (sentAmount === null ? null : `${sentAmount} MON`) : HOME_NOT_APPLICABLE_LABEL,
    now: shmonAmount === null ? null : `${shmonAmount} shMON`,
    changed: null,
    workState: null,
    expectedBack: null,
    costSoFar: receipt ? (gasAmount === null ? null : `${gasAmount} MON`) : HOME_NOT_APPLICABLE_LABEL,
  });
}

// [A-522 B2a] MY PIGGIES 색인 = **제품 읽기 원천**. 읽어도 서명 세션·권한·잔액·충전·Job·복구 증명이 생기지 않는다.
// 손상/미증명 줄은 A-520 규칙대로 이미 버려져 온다.
function indexedResidents() {
  try { return loadMyPiggiesIndex(safeLocalStorage(), secondJourneyScope().chainId).index.piggies; } catch { return []; }
}

// Visual projection only. The existing First/Second route still belongs to state.address;
// HISTORY selection and MY MONEY intent must never silently choose the animated Piggy.
function currentScenePiggyId() {
  const address = String(state.address || "").toLowerCase();
  if (!address) return null;
  return indexedResidents().find((piggy) => String(piggy.address || "").toLowerCase() === address)?.id
    || indexedPiggyId(address);
}

function applyHomeResidentMotionStates(paper) {
  const residents = indexedResidents();
  const affectedPiggyId = state.scene === "sendstay" && state.sendCardVisible ? currentScenePiggyId() : null;
  const states = buildPiggyMotionStateMap(residents, {
    affectedPiggyId,
    cue: affectedPiggyId ? PIGGY_MOTION_STATE.WORK : PIGGY_MOTION_STATE.IDLE,
  });
  paper.querySelectorAll(".homePaper__card--piggy[data-piggy-id]").forEach((card) => {
    const projected = piggyMotionStateFromMap(states, card.dataset.piggyId);
    card.dataset.motionState = projected.state;
    card.toggleAttribute("data-motion-active", projected.active);
  });
}

// MY MONEY 행 = 레지스트리 투영(돈) + 색인(정체성·locator). **돈은 색인에서 오지 않는다** —
// 색인에만 있는 Piggy 는 평가 없음 = 모름(가짜 $0 0). 순서는 색인 순서.
function moneyPiggiesSnapshot() {
  const snap = secondPiggyRegistrySnapshot();
  const rows = indexedResidents();
  if (rows.length === 0) return snap;
  const byId = new Map(snap.piggies.map((p) => [p.id, p]));
  const merged = [];
  for (const row of rows) {
    const base = byId.get(row.id);
    if (base) {
      merged.push({ ...base, name: base.name || row.name, address: base.address || row.address, locator: row.locator });
      byId.delete(row.id);
    } else {
      const { piggy } = normalizePiggy({ id: row.id, name: row.name, address: row.address, locator: row.locator, location: "unknown" });
      if (piggy) merged.push(piggy);
    }
  }
  for (const rest of byId.values()) merged.push(rest);
  return { piggies: merged, totals: projectRegistryTotals({ piggies: merged }) };
}

// HOME 주민 카드 — 색인에 둘 이상일 때만. 지금 이 기기의 Piggy(state.address) 만 scene 에서 온 상태를 갖고,
// 나머지는 **상태를 지어내지 않는다**(빈 줄).
// [A-540] `recordsEnabled` 일 때만(Home 대시보드, scene sendstay) 카드마다 자기 records
// entry 를 채운다 — away/explore/secondAway/secondReturn 은 지금까지처럼 records 자체가
// 없다(§homePadMarkup 아래). count 는 그 Piggy 것만(filterHistory), 다른 Piggy·주인 없는
// 옛 기록은 절대 섞이지 않는다(A-485 계약 그대로).
function homeResidents(currentLabel, recordsEnabled) {
  const rows = indexedResidents();
  if (rows.length < 2) return null;
  const here = String(state.address || "").toLowerCase();
  return rows.map((r) => ({
    id: r.id,
    name: r.name || "Piggy",
    label: String(r.address).toLowerCase() === here ? currentLabel : "",
    recordsEntryMarkup: recordsEnabled
      ? homePaperRecordsEntryMarkup(filterHistory(state.receipts, r.id).rows.length, r.id)
      : "",
  }));
}

// [A-522] `+ Piggy` 는 Second Journey 가 닫힌 뒤, Home 대시보드의 home 모드에서만.
function showAddPiggyTab(scene, mode) {
  return scene === "sendstay" && mode === "home" && state.secondJourneyCompletedOnce === true;
}

// [A-531 · 모델 A] 추가 Piggy 의 루트 = **첫 Piggy 가 이미 쓰는 그 패스키 하나**.
// 색인의 첫 Piggy 행 locator 와 저장된 credential 이 **둘 다 있으면 같아야 한다** — 다르면 루트가 모호하므로 멈춘다.
// 어느 것도 없으면 멈춘다(새 패스키를 만들지 않는다 · "아무 패스키나" 로 떨어지지 않는다).
// (이력: A-522 에서는 이 자리가 `ADD_PIGGY_AUTH_PROVIDER = null` — 모델 결정 전 비워 둔 자리였다.)
function modelARootCredential() {
  if (!state.address) return { credential: null, reason: "missing_root_credential" };
  const here = String(state.address).toLowerCase();
  const row = indexedResidents().find((r) => String(r.address).toLowerCase() === here && !r.sequence) || null;
  const saved = readCredential();
  const fromIndex = row?.locator?.credentialId ? { credentialId: row.locator.credentialId, ...(row.locator.transports?.length ? { transports: row.locator.transports } : {}) } : null;
  const fromSaved = saved?.credentialId ? { credentialId: saved.credentialId, ...(Array.isArray(saved.transports) && saved.transports.length ? { transports: saved.transports } : {}) } : null;
  if (fromIndex && fromSaved && fromIndex.credentialId !== fromSaved.credentialId) return { credential: null, reason: "root_credential_ambiguous" };
  const credential = fromIndex || fromSaved;
  return credential ? { credential, reason: null } : { credential: null, reason: "missing_root_credential" };
}

function webLocks() {
  try { return globalThis.navigator?.locks ?? null; } catch { return null; }
}

async function beginAddPiggy() {
  if (!state.secondJourneyCompletedOnce) return { started: false, reason: "second_journey_not_closed" };
  if (state.addPiggy?.status === "authenticating") return { started: false, reason: "already_running" };
  const root = modelARootCredential();
  if (!root.credential) {
    state.addPiggy = { status: "failed", reason: root.reason };
    return { started: false, reason: root.reason };
  }
  state.addPiggy = { status: "authenticating" };
  // [A-579 Lane G] 평범한 +Piggy 는 Gift 를 받지 않는다(A-566 오배정 수리) — pendingGiftClaim 은 그대로 남는다.
  const out = await runModelAAdmission(root.credential);
  if (!out.ok) {
    state.addPiggy = { status: "failed", reason: out.reason };
    return { started: false, reason: out.reason };
  }
  return admitAddedPiggy(out.piggy);
}

// [A-531 → A-579 Lane G] 모델 A 새 Piggy 입장 — beginAddPiggy 와 beginGiftPiggy 가 함께 쓰는 **하나의** 경로.
// `onAdmitted(piggy)` 는 입장이 성공했을 때, 탄생용 세션(= 방금 그 새 Piggy 의 서명자)이 끝나기 **전에** 한 번
// 불린다(Gift 전용 — 평범한 +Piggy 는 넘기지 않는다).
async function runModelAAdmission(rootCredential, { onAdmitted = null } = {}) {
  let out;
  try {
    out = await admitModelAPiggy({
      storage: safeLocalStorage(),
      chainId: secondJourneyScope().chainId,
      locks: webLocks(),
      rootCredential,
      // 고정된 기존 패스키로 **assertion 한 번**. 생성 경로(createPasskeyWithPrfOutput) 를 부르지 않는다.
      requestPrf: (credential, prfSalt) => requestPrf(credential, { prfSalt }),
      // 서명자만 세운다 — 첫 Piggy 의 저장 scope(state.address)는 바꾸지 않는다.
      deriveAddress: (prfOutput) => activateSigningSession(prfOutput, { persistAddress: false }).address,
    });
    if (out.ok && typeof onAdmitted === "function") await onAdmitted(out.piggy);
  } finally {
    // 탄생용 세션은 통제 증명 뒤 쓸 데가 없다 — 성공이든 실패든 여기서 끝낸다(S4 돈 동작 정책과는 별개).
    endActiveSession();
  }
  return out;
}

// [A-531] 통제 증명과 함께 색인에 **이미 들어온** 추가 Piggy 를 $0 탄생으로 투영하고 Name it 으로 보낸다.
// 순서: 소유(색인) 먼저 → 그다음 $0 투영. 투영 저장이 실패하면 돈을 지어내지 않는다 —
// 색인 행만 남아 MY MONEY 에서 "모름" 으로 보인다(수리 가능한 상태). Hatch 반복 0 · 충전 0.
function projectBirthUnfunded(piggy) {
  try {
    const storage = safeLocalStorage();
    const scope = secondJourneyScope();
    const { registry } = loadRegistry(storage, scope);
    let rows = registry.piggies;
    if (rows.length === 0) {
      // 한 마리 시절 사용자를 잃지 않는다 — 첫 Piggy 를 함께 적어 둔다(돈은 모름 그대로).
      const { piggy: legacy } = migrateSinglePiggy({ address: state.address || "", name: state.piggyName || "" });
      rows = legacy ? [legacy] : [];
    }
    if (rows.some((p) => p.id === piggy.id)) return { saved: true, reason: "already_projected" };
    const born = createPiggy({ piggies: rows, newPiggy: { id: piggy.id, address: piggy.address, locator: piggy.locator }, at: piggy.createdAt || new Date().toISOString() });
    if (!born.ok) return { saved: false, reason: born.reason };
    return saveRegistry(storage, scope, { piggies: born.piggies });
  } catch {
    return { saved: false, reason: "projection_failed" };
  }
}

function admitAddedPiggy(piggy) {
  if (!piggy || typeof piggy.id !== "string") {
    state.addPiggy = { status: "failed", reason: "missing_piggy" };
    return { started: false, reason: "missing_piggy" };
  }
  const projection = projectBirthUnfunded(piggy);
  state.addPiggy = projection.saved ? null : { status: "projection_failed", reason: projection.reason || projection.error || "unknown" };
  state.pendingNamePiggyId = piggy.id;
  setScene("name", "", "");
  return { started: true, reason: null, piggyId: piggy.id, projected: !!projection.saved };
}

// [A-579 Lane G] **Gift 을 받을 새 Gift Piggy** — 이미 Piggy 가 있는 기기에서 받는 사람이 Gift 를 받는 유일한 길.
// 기존 Piggy(되찾기·평범한 +Piggy)에는 Gift 가 붙지 않는다. 흐름: pending 없음 → 인증 0 · 아무것도 안 함.
// 있으면 **시작에서** intent 를 꺼내고(다른 경로가 못 가져간다) 시작 전 주소 목록을 적어 둔 뒤, 모델 A 로 새 Piggy
// 하나를 입장시키고, 그 입장 직후(탄생 세션이 살아 있는 동안) 그 새 주소에만 묶어 claim 을 시도한다. 입장이
// 안 되면 intent 를 되돌린다. Second Journey 완료를 요구하지 않는다(A-567: Gift 수령은 Journey 와 독립 — OWNER Q2).
// **UI 진입점 0** — 어떤 버튼도 이것을 부르지 않는다(DESIGN gate: Open 탭 배치). 새 문구·씬 0(admitAddedPiggy 그대로).
async function beginGiftPiggy() {
  if (!pendingGiftClaim) return { started: false, reason: "no_gift_intent" };
  if (state.addPiggy?.status === "authenticating") return { started: false, reason: "already_running" };
  const root = modelARootCredential();
  if (!root.credential) return { started: false, reason: root.reason };
  // 인증·생성 **전에** 레코드를 읽기 전용으로 먼저 연다 — 열 수 없는 링크(원천 없음·모름·만료·폐기·토큰 불일치·
  // 이미 받음)는 새 Piggy 를 0 개 만들고 인증 0 으로 멈춘다(intent 는 메모리에 그대로). 이미 이 기기의 Piggy 가
  // 받은 링크면 그 사실(already_claimed_by_same)만 알린다 — 새 Piggy 로 다시 받지 않는다.
  const preExisting = knownPiggyAddresses();
  const preflight = await beginGiftClaim({
    pending: { status: GIFT_ENTRY_STATUS.READY, giftId: pendingGiftClaim.giftId, token: pendingGiftClaim.token },
    recordSource: GIFT_RECORD_SOURCE,
    now: new Date().toISOString(),
  });
  if (preflight.status !== GIFT_ENTRY_STATUS.READY) {
    const mine = preflight.reason === CLAIM_RESULT.ALREADY_CLAIMED_BY_OTHER
      && preExisting.has(String(preflight.record?.recipientAddress || "").toLowerCase());
    lastGiftClaimSettlement = mine
      ? { status: GIFT_ENTRY_STATUS.REFUSED, reason: CLAIM_RESULT.ALREADY_CLAIMED_BY_SAME, giftId: preflight.giftId }
      : { status: preflight.status, ...(preflight.reason ? { reason: preflight.reason } : {}), giftId: preflight.giftId };
    return { started: false, reason: lastGiftClaimSettlement.reason || preflight.status };
  }
  if (!pendingGiftClaim) return { started: false, reason: "no_gift_intent" }; // 읽는 사이 다른 흐름이 가져갔다
  const intent = takePendingGiftClaim();
  let attempted = false;
  let out;
  state.addPiggy = { status: "authenticating" };
  try {
    out = await runModelAAdmission(root.credential, {
      onAdmitted: async (piggy) => {
        const bound = bindGiftToNewPiggy({ intent, piggy, preExistingAddresses: preExisting, signerAddress: state.activeSignerAddress, requireSequence: true });
        if (!bound.ok) {
          lastGiftClaimSettlement = { status: GIFT_ENTRY_STATUS.REFUSED, reason: bound.reason };
          return;
        }
        attempted = true;
        try {
          lastGiftClaimSettlement = await settleBoundGiftClaim(bound.binding, intent);
        } catch {
          lastGiftClaimSettlement = { status: "claim_settle_failed" };
        }
      },
    });
  } finally {
    if (!attempted) restorePendingGiftClaim(intent);
  }
  if (!out.ok) {
    state.addPiggy = { status: "failed", reason: out.reason };
    return { started: false, reason: out.reason };
  }
  return { ...admitAddedPiggy(out.piggy), giftAttempted: attempted };
}

function homePadMarkup(scene) {
  const mode = homePaperEffectiveMode(scene);
  const name = displayPiggyName();
  // [A-377 §2] 기록 보기 entry 는 Home 대시보드(scene "sendstay")의 "home" 모드에서만
  // 실제로 채운다. 다른 씬/모드에서는 이 pad 자체가 opacity 0 이거나(chog-home.js
  // cardClaimed) Money/Piggy 상세 본문이 대신 그 자리를 쓰므로(§home-paper.js
  // homePaperMarkup mode!=="home" 분기) 빈 문자열을 주고, 자동으로 기록이 열리는 경로를
  // 만들지 않는다(§5).
  const recordsEnabled = mode === "home" && scene === "sendstay";
  const recordsEntryMarkup = recordsEnabled ? homePaperRecordsEntryMarkup(state.receipts.length, null) : "";
  const base = {
    name,
    time: homeTimeNow(),
    recordsEntryMarkup,
    ...homeStatusFromScene(scene),
  };
  if (mode === "home") {
    const residents = homeResidents(base.label, recordsEnabled);
    return homePaperMarkup({ mode: "home", ...base, residents });
  }
  const bodyMarkup = mode === "money" ? homeMoneyBodyMarkup(name) : homePiggyDetailBodyMarkup(name);
  return homePaperMarkup({ mode, ...base, bodyMarkup });
}

// [A-412 §3] 실제 읽기(publicClient.getBalance/readShmonBalance)만 — write/서명/tx 는
// 여기 없다. 이미 진행 중이면(requestId 로 판정) 겹쳐 부르지 않는다. state.address 가
// 없으면(이론상 sendstay 는 인증된 뒤에만 뜬다) 새 인증/wallet-connect 흐름을 걸지 않고
// 그냥 에러 상태로 남긴다(§forbidden "auth 재시도 프롬프트 0") — 재시도 버튼은 이
// 함수를 다시 부를 뿐이다.
let homeMoneyRequestSeq = 0;
async function fetchHomeMoneyData() {
  const requestId = ++homeMoneyRequestSeq;
  if (!state.address) {
    state.homeMoneyStatus = "error";
    state.homeMoneyErrorText = "no saved account to read from yet.";
    refreshHomePaperMount();
    return;
  }
  state.homeMoneyStatus = "loading";
  refreshHomePaperMount();
  let nativeWei = null;
  let shmonWei = null;
  let readFailed = false;
  try {
    [nativeWei, shmonWei] = await Promise.all([
      publicClient.getBalance({ address: state.address }),
      readShmonBalance(state.address),
    ]);
  } catch (error) {
    // [A-454] error.message 원문(RPC URL·요청 등)을 화면에 쓰지 않는다 — 안전 기록 한 건만.
    recordSafeError("home-money", error);
    readFailed = true;
  }
  if (requestId !== homeMoneyRequestSeq) return; // 더 최신 요청이 이미 떴다.
  if (readFailed) {
    state.homeMoneyStatus = "error";
    // null → 렌더가 기존 비기술 문구 "couldn't read the balance." 를 쓴다(새 문구 0).
    state.homeMoneyErrorText = null;
  } else {
    state.homeMoneyStatus = "ready";
    state.homeMoneyErrorText = null;
    state.homeMoneyNativeWei = nativeWei;
    state.homeMoneyShmonWei = shmonWei;
  }
  refreshHomePaperMount();
}

// homePaperMarkup() 이 돌려주는 것은 `.homePaperMount` 통째다. chog-home.js layout() 이
// 이 wrapper **자신**(padChild)의 left/top/width/height 를 한 번만 재는데, wrapper 를
// 통째로 새 노드로 갈면 그 참조가 끊긴다 — 그래서 wrapper 는 그대로 두고 **안의
// `#homePaper` 부분만** 꺼내 innerHTML 로 바꿔 끼운다(render() 를 다시 부르지 않는다 —
// 그러면 mountChogHome() 이 처음부터 다시 돌아 손끝-고정 상태가 끊긴다, §openRecordsCard
// 주석과 같은 이유).
function extractHomePaperInner(markup) {
  const temp = document.createElement("div");
  temp.innerHTML = markup;
  return temp.querySelector("#homePaper")?.outerHTML || "";
}

// [A-540] home-peek.js(피크 + 1마리 `+ Piggy`) / home-paper-multi.js(2+ 접힘·펼침·창
// 스크롤 + `+ Piggy`) 를 실제 `.homePaper` DOM 위에 얹는다 — Home 모드(mode "home")에서만,
// 렌더될 때마다(최초 render() 와 refreshHomePaperMount() 둘 다) 다시 붙인다. 두 모듈 다
// `.homePaper` 자식을 옮기거나 감싸므로(창으로 wrap, peek svg 형제 삽입) `mount.innerHTML =`
// 교체(refreshHomePaperMount, 위)가 그 DOM 을 통째로 지운다 — 그래서 교체 **전** 반드시
// teardown 하고, 새 markup 이 붙은 **뒤** 다시 mount 한다(패키지가 원래 om으로 열어 둔
// `off()` 계약 그대로, 새 되감기 로직 0).
let homeResidentModule = null;
let homeResidentModuleSeq = 0;
let homeResidentPaperEl = null;
let homeResidentClickHandler = null;
let homeResidentKeyHandler = null;
let homeResidentResizeHandler = null;

// parent decision 3 이 고른 fold 트리거: 펼쳐진 상태에서 카드/records/+Piggy/플랩/집도장
// 같은 인터랙티브 자손 **밖**의 빈 Home 종이를 누르면 접힌다. 이 셀렉터가 "인터랙티브
// 자손"의 전부다 — 늘어나면 여기만 고친다.
const HOME_RESIDENT_INTERACTIVE_SELECTOR =
  ".homePaper__card--piggy, .homePaper__records, .homePlusPiggyTab, .homeFlap, .homePaper__mark, .homePaper__markButton, button, a, input, textarea, select";

function teardownHomeResidentModule() {
  homeResidentModuleSeq += 1; // 진행 중인 비동기 mount(있다면)를 stale 로 만든다.
  if (homeResidentPaperEl && homeResidentClickHandler) {
    homeResidentPaperEl.removeEventListener("click", homeResidentClickHandler);
  }
  if (homeResidentKeyHandler) {
    window.removeEventListener("keydown", homeResidentKeyHandler);
  }
  // [A-624] 같은 .homePaper 에 다시 mount 하는 경로(remountHomeResidentsForBreakpoint)가 생겼으니
  // homepaper:resize 리스너도 짝을 맞춰 뗀다 — 안 떼면 다시 붙일 때마다 쌓인다.
  if (homeResidentPaperEl && homeResidentResizeHandler) {
    homeResidentPaperEl.removeEventListener("homepaper:resize", homeResidentResizeHandler);
  }
  homeResidentResizeHandler = null;
  homeResidentPaperEl = null;
  homeResidentClickHandler = null;
  homeResidentKeyHandler = null;
  if (homeResidentModule) {
    try {
      homeResidentModule.off();
    } catch {
      // 되돌리기는 최선 노력이다 — 다음 markup 교체가 어차피 DOM 을 지운다.
    }
    homeResidentModule = null;
  }
}

// [A-626 E] Home 종이가 실제로 펼쳐져 보이는가 — chog-home.js 의 hover 진행값(progress, 0 = 손끝
// 크기로 접힘, 1 = 공통 카드 자리에 도킹)이 유일한 소유자다. 거의 끝(≥0.99)만 "열림"으로 본다.
function homePaperVisiblyOpen() {
  const progress = homeChog?.state?.progress;
  return typeof progress === "number" && progress >= 0.99;
}

function mountHomeResidentModule({ reopen = false } = {}) {
  teardownHomeResidentModule();
  // 다음 render() 의 teardownScene() 이(=씬이 통째로 바뀔 때) 이 mount 도 함께 정리한다.
  // refreshHomePaperMount() 같은 씬-내부 갱신은 스스로 teardownHomeResidentModule() 을
  // 직접 부른다(위) — 여기 등록은 "씬이 바뀌는데 다음 mount 가 없는" 경로(예: sendstay ->
  // away)만을 위한 안전망이다. 이미 정리됐으면 no-op(idempotent).
  onSceneTeardown(teardownHomeResidentModule);
  const paper = document.querySelector('.homePaper[data-paper-mode="home"]');
  if (!paper) return; // Money/Piggy 상세 모드 — 이 회차 모듈은 Home 모드에서만(§integrate).
  applyHomeResidentMotionStates(paper);
  const seq = homeResidentModuleSeq;
  mountResidentPaper(paper, {
    onAdd: () => {
      // [A-626 E] Home 종이가 손끝 크기로 접혀 보이지 않는 동안에는 `+ Piggy` 가 아무것도 시작하지
      // 않는다. 포인터로는 닿지 않았지만(pre sweep 0 hit), 키보드 Tab 이 접힌 종이 안의 탭에 닿아
      // Enter 한 번으로 패스키 assertion 이 시작됐다(A-626 preE: credentials.get 0→1, 390/1440).
      // 모든 탭(1마리 탭 · 접힘용 복제 · 창 안 탭)과 pointer/touch/keyboard 가 이 콜백 하나로 모이므로
      // 여기서 막는다 — 픽셀·위치·열린 종이 동작 변화 0.
      if (!homePaperVisiblyOpen()) return;
      // [A-531] 그대로 재사용 — 새 인증/탄생 경로 0.
      beginAddPiggy().then(() => render()).catch(() => render());
    },
  })
    .then((api) => {
      if (seq !== homeResidentModuleSeq || !api) return; // 그 사이 teardown/다른 mount 가 먼저 왔다.
      homeResidentModule = api;
      // [A-540 §7 records → A-607 REWORK → A-608 web freeze] Records used to resize with
      // `.homePaper` (this listener kept it in sync) — reinstated for web, since Records is
      // once again `.homePaper`-derived there (`alignRecordsCardToHomePaper()` itself no-ops
      // at ≤640px, so this is harmless/no-op at narrow too).
      homeResidentResizeHandler = () => {
        if (state.recordsCardVisible) alignRecordsCardToHomePaper();
      };
      paper.addEventListener("homepaper:resize", homeResidentResizeHandler);
      homeResidentPaperEl = paper;
      // [A-540 parent decision 3] 인터랙티브 자손 밖의 빈 종이를 누르면 접힌다.
      homeResidentClickHandler = (event) => {
        if (!paper.classList.contains("isResOpen")) return;
        if (event.target.closest(HOME_RESIDENT_INTERACTIVE_SELECTOR)) return;
        api.fold();
      };
      paper.addEventListener("click", homeResidentClickHandler);
      // Escape 도 같은 규율: Home 종이가 펼쳐져 있을 때만, 다른 입력을 가로채지 않는다.
      homeResidentKeyHandler = (event) => {
        if (event.key !== "Escape") return;
        if (!paper.isConnected || !paper.classList.contains("isResOpen")) return;
        // [A-624] 모바일 HISTORY 가 열려 배경 Home 이 inert(A-623 syncRecordsViewportState)인
        // 동안에는 접지 않는다 — 이전에는 Escape 가 배경 주민 창을 접어 Home 높이 419.75→364,
        // 그 rect 를 따르는 HISTORY 도 같이 줄었다(A-624 pre histm390 S1).
        if (paper.closest("[inert]")) return;
        api.fold();
      };
      window.addEventListener("keydown", homeResidentKeyHandler);
      // [A-522 flag semantics, A-540/A-543/A-544 완료] `+ Piggy` 탭과 그것에 딸린 peek(빼꼼)은
      // 패키지 안에서 항상 mount 된다 — 옛 addPiggyTab 마크업 플래그가 하던 product 게이트
      // (showAddPiggyTab)를 그대로 지키려면 조건이 거짓일 때 mount 된 탭/peek DOM 을 전부
      // 뗀다. 1마리 경로(mountHomePeek+mountPlusPiggyTab)와 2+ 경로(접힘용 clone + 펼침용
      // tab, peek 은 win 전체에 붙는다) 모두 이 셀렉터로 찾긴다. [A-544 Repair B] `+ Piggy`
      // 탭만 떼고 peek(.homePeekBody/.homePeekHandClip)을 남겨 두면 A-515 §11/A-543 이
      // 요구하는 "Second 완료 전엔 +Piggy 도 peek 도 없다"를 어긴다 — 둘 다 뗀다. `.hasPeek`
      // 는 순수 z-index 표시라 남아도 시각적으로 무해하지만(그 위에 그릴 게 없다), 스펙이
      // "stale .hasPeek 제거"를 명시하므로 같이 지운다.
      if (!showAddPiggyTab(state.scene, "home")) {
        paper.querySelectorAll(".homePlusPiggyTab, .homePeekBody, .homePeekHandClip").forEach((el) => el.remove());
        paper.querySelectorAll(".hasPeek").forEach((el) => el.classList.remove("hasPeek"));
      }
      // [A-624] 폭 경계를 넘은 재mount 는 펼침 상태를 그대로 되살린다(1마리 모듈은 open() no-op).
      if (reopen) api.open();
    })
    .catch(() => {
      // 피크 svg fetch 실패 등 — 모듈 없이도 카드 자체는 이미 정상 마크업으로 그려져 있다.
    });
}

// [A-624] home-paper-multi.js(확정 패키지, byte-identical — 손대지 않는다)는 카드 높이 H 를
// mount 때 한 번만 잰다. 모바일 카드(records 18px, A-623)는 로컬 108px, 웹은 101px 이라, 다시
// 그리지 않고 640px 를 넘는 라이브 리사이즈는 창을 옛 높이로 남겼다(390→1440: 108, 플랩이 새
// 웹 mount 보다 4.486px 아래 · 1440→390: 101 로 108px 카드를 7px 자름 — A-624 pre liveresize).
// 1마리 `+ Piggy` 탭 자리(--tab-top, card.offsetHeight)도 같은 이유로 낡는다. 폭 경계를
// 넘을 때만 모듈을 앱 쪽에서 다시 mount 해 새 H 로 재게 한다(펼침 상태 유지).
function remountHomeResidentsForBreakpoint() {
  const paper = document.querySelector('.homePaper[data-paper-mode="home"]');
  if (!paper || !homeResidentModule) return;
  mountHomeResidentModule({ reopen: paper.classList.contains("isResOpen") });
}

function refreshHomePaperMount() {
  const mount = document.querySelector(".homePaperMount");
  if (!mount) return;
  teardownHomeResidentModule();
  const inner = extractHomePaperInner(homePadMarkup(state.scene));
  if (inner) mount.innerHTML = inner;
  mountHomeResidentModule();
}

// [A-412 §1] 집도장 클릭 — HOME 이면 Money 를 열고(그리고 아직 안 읽었으면/실패했으면
// 곧장 읽는다), 그 밖(Money/Piggy 상세)이면 곧장 HOME 으로 되돌린다(home-paper.js 의
// stampLabel "Back to home" 과 같은 계약). sendstay 가 아니면(다른 씬에서 우연히 눌려도)
// 아무 것도 하지 않는다 — Money 개념 자체가 sendstay 안에서만 있다.
function toggleHomePaperMoneyMode() {
  if (state.scene !== "sendstay") return;
  if (state.homePaperMode === "home") {
    state.homePaperMode = "money";
    refreshHomePaperMount();
    if (state.homeMoneyStatus === "idle" || state.homeMoneyStatus === "error") fetchHomeMoneyData();
  } else {
    state.homePaperMode = "home";
    refreshHomePaperMount();
  }
}

// [A-412 §1] 같은 왼쪽 종이 안 위임 클릭 하나 — `.homePaperMount` 는 chog-home.js 가
// 참조를 쥐고 있는 안정된 노드라(위 refreshHomePaperMount 주석) render() 를 다시 부르지
// 않는 내부 전환에도 매번 새로 붙일 필요가 없다(§recordsCard 델리게이션과 같은 자리 규율,
// render() 의 #recordsCard 리스너 참고).
function handleHomePaperMountClick(event) {
  if (state.scene !== "sendstay") return;
  // [A-623] mobile + HISTORY open = HOME is background, close-only (syncRecordsViewportState()
  // makes `.homePaperMount` inert; this guard also covers synthetic/programmatic clicks). Only
  // HISTORY's own close/back/list act until it closes. Web is untouched (HOME live, identity
  // switching by another Piggy's records still works there).
  if (state.recordsCardVisible && window.innerWidth <= 640) return;
  // [A-510 Stream A] A-486 의 `homePiggyAction--` (give/bring) 분기는 걷어냈다 — 그 버튼을 그리는 곳이 없다.
  const choiceButton = event.target.closest('[id^="homeAmountChoice--"]');
  if (choiceButton && state.moneyIntent) {
    state.moneyIntent = { ...state.moneyIntent, amount: choiceButton.id.split("--")[1] };
    render();
    return;
  }
  if (event.target.closest("#homeActionOk") && state.moneyIntent) {
    const intent = state.moneyIntent;
    // **여기서 돈이 움직이지 않는다.** 권한 대기 상태로만 넘어간다.
    state.moneyIntent = { ...intent, status: PERMISSION_STATE.AWAITING };
    render();
    return;
  }
  // [A-492 Lane A] `awaiting_permission` → `permitted` 로 가는 **유일한 통로**.
  // 실제 Face ID/passkey 를 부른다. 취소·실패는 아무것도 바꾸지 않는다.
  if (event.target.closest("#homePermissionApprove") && state.moneyIntent?.status === PERMISSION_STATE.AWAITING) {
    requestMoneyPermission();
    return;
  }

  // [A-484 Lane C] MY MONEY 의 Piggy 행 → **오른쪽 HISTORY 의 정체성만** 바꾼다.
  // 새 종이를 만들지 않는다. 다른 행을 고르면 정체성이 교체될 뿐이다.
  const moneyPiggyRow = event.target.closest('[id^="homeMoneyPiggyRow--"]');
  if (moneyPiggyRow) {
    state.historyPiggyId = moneyPiggyRow.id.slice("homeMoneyPiggyRow--".length) || null;
    // [A-512] 행을 고르면 그 Piggy 가 돈 동작의 선택이 된다 — 바뀌면 이전 권한부터 죽인다.
    applyPiggySelection(moneyPiggiesSnapshot().piggies.find((p) => p.id === state.historyPiggyId) || null);
    openRecordsCard();
    return;
  }
  if (event.target.closest("#homeRecordsButton")) {
    // HOME 의 records 는 지금까지처럼 전체 기록을 연다 — 정체성 필터를 걸지 않는다(A-483 §7).
    state.historyPiggyId = null;
    openRecordsCard();
    return;
  }
  // [A-540] 둘 이상의 Piggy 카드가 있으면 카드마다 자기 것 하나 — `.homePaper__records`
  // 클래스는 Money/Piggy 상세의 다른 버튼(ok/retry/back/funding/amount 선택)에도
  // 재사용되므로, 그 버튼들은 각각 자기 고유 id 로 이미 위에서 걸러지고 `return` 됐다(§순서
  // — moneyIntent/homeActionOk/homePermissionApprove 는 이 체크보다 먼저다). 여기서는 정확히
  // `data-piggy-id` 가 있는 resident records 버튼만 본다 — **historyPiggyId 만** 바꾼다.
  // applyPiggySelection()/서명자/세션/권한/moneyIntent 는 절대 건드리지 않는다(§records contract).
  const residentRecordsButton = event.target.closest(".homePaper__records[data-piggy-id]");
  if (residentRecordsButton) {
    state.historyPiggyId = residentRecordsButton.dataset.piggyId || null;
    openRecordsCard();
    return;
  }
  // [A-531] `+ Piggy` 탭 — 모델 A: 기존 패스키 고정 assertion 1회 → 통제 증명 → 색인 → Name it. 새 패스키 생성 0.
  // [A-540] `+ Piggy` 탭은 더 이상 여기(homePadMarkup 고정 마크업)에 없다 — home-peek.js /
  // home-paper-multi.js 가 렌더 뒤 DOM 에 button 을 직접 붙이고, `onClick`/`onAdd` 콜백을
  // mountHomeResidentModule() 에서 이 함수와 똑같이 `beginAddPiggy().then(render)` 로
  // 배선한다(아래). 그 버튼 자신의 리스너가 이미 처리하므로 여기서 `.homePlusPiggyTab` 를
  // 다시 델리게이션으로 잡으면 버블링으로 **두 번** 불린다 — 그래서 잡지 않는다. 이 id 체크는
  // 옛 정적 마크업이 남아 있던 시절의 안전망으로만 남긴다(지금은 절대 매치되지 않는다).
  if (event.target.closest("#homeAddPiggy")) {
    beginAddPiggy().then(() => render()).catch(() => render());
    return;
  }
  if (event.target.closest("#homePaperMoneyToggle")) {
    toggleHomePaperMoneyMode();
    return;
  }
  if (event.target.closest("#homePiggyDetailBack")) {
    state.homePaperMode = "money";
    refreshHomePaperMount();
    return;
  }
  if (event.target.closest("#homeMoneyRetry") || event.target.closest("#homePiggyDetailRetry")) {
    fetchHomeMoneyData();
    return;
  }
  if (event.target.closest("#homePaperMoneyRow")) {
    if (state.homePaperMode === "money" && state.homeMoneyStatus === "ready") {
      state.homePaperMode = "piggyDetail";
      refreshHomePaperMount();
    }
  }
}

// [A-356 §1 → A-359 §1 교정] cardAnchorMarkup 은 이제 여기(#homeBoard 안)에 얹지
// 않는다 — #homeBoard 는 fitHomeBoard() 의 translate+scale(s) 를 받는데, 승인
// 285×364 는 **실제 뷰포트 CSS px** 값이라, board 좌표계 안에 두면 s 만큼 한 번 더
// 줄어 실측이 틀어졌다(A358_checks.json 재현: 997×717 에서 147.05×288.94 → §1 로 폭만
// 교정해도 226.23×288.94, board 단위라 여전히 s 배). 카드는 이제 `.stage` 의 직계
// 자식(renderSendStay() 참조) — 무대 밖 뷰포트 좌표계라 s 의 영향을 받지 않는다.
// [A-358 §2] #homeBoard 자체에 aria-hidden 을 걸면 그 안의 Chog 클릭 버튼
// (chog-home.js #chogHomeHit)까지 AX 트리에서 통째로 빠진다 — 자손에
// aria-hidden="false" 를 줘도 조상의 true 를 못 이긴다(ARIA 1.2). 그래서 숨김을
// 조상이 아니라 장식 캐릭터(#homeChar, 앉아있는/걷는 Piggy 그림) 쪽으로 내린다 —
// 장식은 계속 숨겨도 되고, Chog 는 상속을 끊는다.
function homeCharacter(name) {
  return `
    <div class="homeBoard" id="homeBoard">
      <div class="homeChar" id="homeChar" data-arrival="0" data-drowsy="0" aria-hidden="true">
        <img class="homeChar__walk" id="homeWalk" src="${MOTION_DIR}/walk/f00.svg" alt="" />
        <img class="homeChar__seat" id="homeSeat" src="${MOTION_DIR}/seat.svg" alt="" />
        <span class="homeChar__name" id="homeName">${name}</span>
      </div>
      ${chogHomeMarkupForExplore()}
    </div>
  `;
}

// [Owner 2026-09-19 "선택에 따라 초그 발화해야"] Explore 선택 반응은 카드가 아니라 Chog
// 발화 — 귀환 알람과 같은 .chogCheckLine 자리·글꼴을 재사용한다(새 CSS 0).
function chogHomeMarkupForExplore() {
  const markup = chogHomeMarkup({ padMarkup: homePadMarkup(state.scene) });
  const sj = state.secondJourney;
  if (state.scene !== "explore" || sj?.step !== "candidates" || !sj.chogSay) return markup;
  // [Owner 2026-09-19 "초그 발화 위치 머리 위에" · A-429] 머리 위 좌표는 이제 .chogCheckLine
  // 한 곳(style.css)에 있다 — 귀환 알람과 같은 자리. 값 = INFERRED.
  // [A-431] A-429 가 없앤 인라인 transform 만 되돌린다 — Explore 발화 글자 비율(scaleY 없음) 보존.
  const say = `<span class="chogCheckLine" id="exploreChogSay" style="transform:translateX(-50%)">${escapeHtml(sj.chogSay)}</span>`;
  return markup.replace('<div class="chogHome__hit"', `${say}<div class="chogHome__hit"`);
}

// [A-359 §1] .cardAnchor 는 이제 무대(#homeBoard) 밖, `.stage` 의 뷰포트 좌표계에 있어
// fitHomeBoard() 의 축척을 받지 않는다 — 그래서 승인 285×364 가 실측 뷰포트에 그대로
// 나온다. 다만 아주 좁은 화면(명세 "작은 화면만 contain-fit")에서는 그 고정 px 가 화면
// 밖으로 나갈 수 있어, 카드 자신만의 등축 안전축소(--cardShrink)를 따로 둔다 —
// fitHomeBoard() 의 s 와는 다른 값이다(그걸 다시 쓰면 옛 이중축소 버그로 되돌아간다).
// 글자/버튼은 여전히 .cardAnchor__fit 의 단일 scale() 하나만 받는다(비균등 0).
function fitCardAnchor() {
  const el = document.querySelector("#sendCardAnchor");
  if (!el) return;
  const w = 285, h = 364, offX = 32, offY = 48, margin = 12;
  const shrinkW = (window.innerWidth / 2) / (w / 2 + offX + margin);
  const shrinkH = (window.innerHeight / 2) / (h / 2 + offY + margin);
  el.style.setProperty("--cardShrink", String(Math.min(1, shrinkW, shrinkH)));
}

// 판을 뷰포트에 통째로 맞춘다. s = min(w/1256, h/772), 가운데 정렬.
// 환산에 쓰는 값은 **계산값이 아니라 실제 `getBoundingClientRect()`** 다 — 둘이 다르면
// 화면에 있는 쪽이 근거다(A-306 지적 3).
function fitHomeBoard() {
  const board = document.querySelector("#homeBoard");
  if (!board) return null;
  const s = Math.min(window.innerWidth / HOME_BOARD_W, window.innerHeight / HOME_BOARD_H);
  board.style.transform = `translate(${(window.innerWidth - HOME_BOARD_W * s) / 2}px, ${(window.innerHeight - HOME_BOARD_H * s) / 2}px) scale(${s})`;
  const rect = board.getBoundingClientRect();
  return { s: rect.width / HOME_BOARD_W, left: rect.left, top: rect.top, rect };
}

// [A-603] .homeCharScaleFloor 를 지우고 #homeChar/#chogHome 을 #homeBoard 의 직계
// 자식으로 되돌린다 — 매 호출을 항상 "실제 언랩된 상태"에서 다시 계산하게 해 리사이즈를
// 반복해도 누적(compound)되지 않는다(A-602 c_floor.js unwrap() 과 같은 계약).
function unwrapHomeCharacterScaleFloor() {
  const board = document.querySelector("#homeBoard");
  const group = document.querySelector(".homeCharScaleFloor");
  if (!group) return;
  const parent = board || group.parentElement;
  if (!parent) return;
  while (group.firstChild) parent.insertBefore(group.firstChild, group);
  group.remove();
}

// [A-603] fit(있으면 fitHomeBoard() 의 결과, 없으면 다시 실측)의 s 가 바닥값보다 작을
// 때만 #homeChar+#chogHome 을 새 조상(.homeCharScaleFloor)으로 감싸 scale(k)+고정
// 넛지를 건다 — A-602 overrides/c_floor.js 의 window.__a602ApplyCFloor 와 같은 측정
// 방법·같은 넛지를 쓰되, 원점만 이 앱에 맞게 고쳤다: A-602 스크립트는 #homeChar/
// #chogHome 의 getBoundingClientRect() 합집합으로 원점을 구했는데, 그 프리뷰가 실제로
// 쓴 값을 재현해 보면(A602 raw facts) 두 요소가 전부 board 와 같은 1256×772 로컬
// 박스(style.css .homeChar{inset:0}/.chogHome{width:1256px;height:772px})라 그 합집합은
// **항상 board 자신의 rect** 다 — 원점이 매번 board 가운데(로컬 628, 바닥 772)로 나와
// 실제 캐릭터 자리(HOME_CENTER=1041, 판 오른쪽 83%)와 무관해진다. 이 앱에서 실측으로
// 확인한 결과(A603_layout_normalization/raw/390x844_facts.json 등) 그 원점으로 스케일을
// 걸면 캐릭터 무리가 board 가운데에서 먼 오른쪽으로 더 밀려나 390/430 뷰포트에서
// 화면 오른쪽 밖으로 실제 잉크가 잘렸다(overflow:hidden — scrollWidth 로는 안 잡힌다,
// Pillow 픽셀 스캔으로 확인). 그래서 여기서는 이미 이 파일에 있는 실제 정박 상수
// (HOME_CENTER/HOME_FLOOR, layoutHomeCharacter() 가 걷기/앉기를 앉히는 바로 그 값)를
// 원점으로 쓴다 — 캐릭터 자신의 발밑 자리이니 스케일을 키워도 화면 안쪽으로 자라지,
// 가장자리로 밀리지 않는다("발밑 고정, 위쪽으로 성장" 원칙을 근사가 아니라 실좌표로).
// s>=바닥이면(예: 1440 데스크톱) 아무것도 하지 않고 언랩 상태로 둔다.
// [A-605 repair · FAIL 4] 좁은 화면에서 First Job("send?") 카드가 뜨면 그 공통 카드
// 자리(`.cardAnchor`/`#sendCardAnchor`, 뷰포트 중앙 기준 절대좌표, 판 스케일과 무관)와
// 이 스케일 바닥 무리(캐릭터 그룹, 발밑 기준 원점에서 화면 안쪽으로만 자란다)가 화면
// 중앙 부근에서 겹친다(SCENE_GEOMETRY.md §7 실측: 430 폭에서 Chog 박스의 ≈96% 가 카드
// 밑에 깔린다). Owner 확정 우선순위(A-604 OWNER CLARIFICATION)는 "①카드 기하 유지
// ②캐릭터 스케일 유지 ③그래도 겹치면 캐릭터 무리를 우측/하단으로 재배치 ④그래도
// 안 되면만 축소" 다 — 축소가 아니라 재배치가 먼저다. 카드 자신은 CSS 쪽에서 좌측으로
// 옮긴다(`.stage[data-scene="sendstay"] .cardAnchor`, 아래 narrow 규칙) — 여기서는
// 캐릭터 무리(Piggy+Chog, 같은 그룹이라 상대 위치·비율은 그대로 유지된다)에 기존
// 클리핑 방지 넛지(6/8px) 위에 **추가로** 우측/하단 오프셋을 더한다. First Job 카드가
// 떠 있지 않을 때(일반 Home 정착·Records·Explore 등, 전부 PASS 항목)는 이 추가 오프셋을
// 걸지 않는다 — 그 상태들은 이 카드의 FAIL 목록에 없고, 실측상 겹침도 없다
// (SCENE_GEOMETRY.md §7 "Records 는 재현되지 않는다"). 새 캐릭터 자산·포즈·비율 0 — 그룹
// 전체를 옮기기만 한다("do not move only Chog arbitrarily", 카드 지시 그대로).
const HOME_CHAR_COLLISION_NUDGE_VIEWPORT_PX = { x: 96, y: 40 };
function homeCharacterCollisionActive() {
  return state.scene === "sendstay" && !!state.sendCardVisible;
}

function applyHomeCharacterScaleFloor(fit) {
  const board = document.querySelector("#homeBoard");
  if (!board) return null;
  unwrapHomeCharacterScaleFloor();
  const homeChar = document.querySelector("#homeChar");
  const chogHome = document.querySelector("#chogHome");
  if (!homeChar) return null;
  const boardRect = board.getBoundingClientRect();
  const s = fit && fit.s > 0 ? fit.s : boardRect.width / HOME_BOARD_W;
  if (!(s > 0) || !Number.isFinite(s)) return null;
  // [A-605 repair] 겹침 재배치는 이 바닥 자체가 이미 작동 중인 좁은 화면(s < FLOOR)
  // 에서만 얹는다 — 실측(SCENE_GEOMETRY.md §7)상 겹침이 나온 430/390 이 정확히 이
  // 구간이고, 1440(s=1.1465>FLOOR)은 애초에 겹침이 없다("PASS 항목은 다시 그리지
  // 않는다"). s>=FLOOR 인데 collision 만 켜졌다는 이유로 이 그룹을 새로 만들면 데스크톱
  // 에서 안 겹치던 캐릭터를 이유 없이 옮기게 된다 — 그래서 이 가드는 바꾸지 않는다.
  if (s >= HOME_CHAR_SCALE_FLOOR) return { applied: false, s };
  const collisionActive = homeCharacterCollisionActive();

  const k = HOME_CHAR_SCALE_FLOOR / s;
  const parts = [homeChar, chogHome].filter(Boolean);
  const originLocalX = HOME_CENTER;
  const originLocalY = HOME_FLOOR;

  const group = document.createElement("div");
  group.className = "homeCharScaleFloor";
  group.setAttribute("data-scale-floor", String(HOME_CHAR_SCALE_FLOOR));
  if (collisionActive) group.setAttribute("data-collision-reflow", "1");
  board.insertBefore(group, board.firstChild);
  parts.forEach((el) => group.appendChild(el));

  // [A-606 OWNER ADDENDUM · pass2 §3 BOTTOM ANCHOR / §E] "character group feet/baseline
  // should visually anchor near the bottom safe frame, not float in the vertical middle...
  // avoid leaving a large unused black area below characters." Root cause of that complaint:
  // the OLD fixed y-nudge (below, `.y` fields on both nudge constants — kept as literal
  // declarations so A-605's own locked contract test still passes unchanged, but no longer
  // summed into the Y nudge) only ever added a small 8/40px fudge on top of whatever position
  // `fitHomeBoard()`'s own *aspect-fit* centering happened to leave the character's foot at —
  // and since the 1256×772 board's aspect ratio rarely matches the viewport's, that natural
  // foot position often lands well above the vertical middle (measured: ~540px of an 900px
  // viewport before this fix — ~360px of empty space below, exactly the Owner's complaint).
  // Fix: derive the Y nudge from an explicit **target** (bottom-safe token + 20-24px gap,
  // `HOME_CHAR_BOTTOM_ANCHOR_GAP_PX`) instead of a fixed offset from whatever the natural
  // position happens to be. `originLocalY` (=HOME_FLOOR) is still the transform-origin — the
  // foot's own LOCAL point never moves under `scale(k)` — so "foot anchor stable, grow
  // upward" holds exactly as before; only the *translate* component's Y is now computed
  // rather than a magic number. Same `fit`/`s` at walk-start and settle (A-605's own
  // no-jump guarantee) ⇒ this Y nudge is byte-identical across the whole walk→settle
  // sequence, same as before.
  const bottomSafePx = resolveCssLengthVarPx("--mobile-bottom-safe", 20);
  const boardTop = fit && Number.isFinite(fit.top) ? fit.top : boardRect.top;
  const naturalFootViewportY = boardTop + originLocalY * s;
  const targetFootViewportY = window.innerHeight - bottomSafePx - HOME_CHAR_BOTTOM_ANCHOR_GAP_PX;
  // [A-608 OWNER CORRECTION — MOBILE HOME CHARACTER CLUSTER MUST NOT MOVE BETWEEN CARDS,
  // 2026-09-27] the collision term used to add 96px here whenever First Job's card was up,
  // shifting Chog (and, before it was split out, Piggy) right to dodge the card. The Owner's
  // own acceptance now requires the OPPOSITE: "Chog anchor x/y = same within optical
  // tolerance" across Home settled / First Job / Records, and "card state does not shift the
  // group." Measured check (this card): at the CURRENT bottom-anchor position (unlike when
  // this nudge was first added in A-605, well before the A-606 bottom-anchor rewrite), the
  // card (y≈220–584 at 430×900) and the character cluster (y≈745–837, bottom-anchored) never
  // share a vertical band — zero real-ink overlap with or without this nudge (pixel-scan
  // confirmed, see WRITER.md Pass-2 self-audit) — so removing it does not reintroduce the
  // occlusion A-605 originally fixed; it only removes an now-unnecessary position shift.
  // `collisionActive`/`data-collision-reflow` are kept (harmless, informational — some other
  // reader may still want to know a card is up) but no longer feed the nudge itself.
  const nudgeViewportX = HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX.x;
  const nudgeViewportY = targetFootViewportY - naturalFootViewportY;
  const nudgeLocalX = nudgeViewportX / s;
  const nudgeLocalY = nudgeViewportY / s;
  group.style.transformOrigin = `${originLocalX}px ${originLocalY}px`;
  group.style.transform = `translate(${nudgeLocalX}px, ${nudgeLocalY}px) scale(${k})`;

  return { applied: true, s, k, effectiveScale: s * k, collisionActive };
}

// [A-610 repair] Read-only twin of the k/nudge math inside applyHomeCharacterScaleFloor()
// (above) — deliberately NOT refactored to share code with it, so that function's existing
// source-shape contract test (app/test/home-character-scale-floor.mjs, A-603/A-606) stays
// byte-for-byte untouched. This copy exists only so a caller can learn "what WILL the floor
// group's transform be" *before* that function actually runs and mutates the DOM — needed
// because, on the real-arrival walk path, chog-home.js's own `mountChogHome()` (main.js:~5287)
// runs and sets `#chogHome`'s walk-start transform BEFORE `applyHomeCharacterScaleFloor(fit)`
// itself is called (main.js:5455, `mountHome()`'s real-arrival branch) — see
// chogWalkStartBoardRect()'s comment for what this is used for. Same formulas, same order,
// same `{applied:false,s}` no-op shape at s>=FLOOR (1440) — if the two ever need to diverge,
// that is a sign applyHomeCharacterScaleFloor()'s own math changed and this copy needs the
// same edit.
function computeHomeCharScaleFloorPlan(fit) {
  const board = document.querySelector("#homeBoard");
  if (!board) return null;
  const boardRect = board.getBoundingClientRect();
  const s = fit && fit.s > 0 ? fit.s : boardRect.width / HOME_BOARD_W;
  if (!(s > 0) || !Number.isFinite(s)) return null;
  if (s >= HOME_CHAR_SCALE_FLOOR) return { applied: false, s };
  const k = HOME_CHAR_SCALE_FLOOR / s;
  const originLocalX = HOME_CENTER;
  const originLocalY = HOME_FLOOR;
  const bottomSafePx = resolveCssLengthVarPx("--mobile-bottom-safe", 20);
  const boardTop = fit && Number.isFinite(fit.top) ? fit.top : boardRect.top;
  const naturalFootViewportY = boardTop + originLocalY * s;
  const targetFootViewportY = window.innerHeight - bottomSafePx - HOME_CHAR_BOTTOM_ANCHOR_GAP_PX;
  const nudgeViewportX = HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX.x;
  const nudgeViewportY = targetFootViewportY - naturalFootViewportY;
  const nudgeLocalX = nudgeViewportX / s;
  const nudgeLocalY = nudgeViewportY / s;
  return { applied: true, s, k, originLocalX, originLocalY, nudgeLocalX, nudgeLocalY };
}

// [A-610 repair] `applyHomeCharacterScaleFloor()` re-parents `#chogHome` into
// `.homeCharScaleFloor` *after* chog-home.js's own `mountChogHome()` (allowlist boundary —
// not editable here) has already set `#chogHome`'s walk-START transform from the raw,
// un-wrapped `board` rect (chog-home.js:661-668, `place(start.x,start.y,start.scale)`). Once
// wrapped, that already-applied transform gets the floor group's own
// translate(nudge)+scale(k) (transform-origin HOME_CENTER/HOME_FLOOR) composed ON TOP of it —
// a composition chog-home.js's formula never accounts for — which is exactly why Chog's
// walk-start renders off-screen at 430/390 while Piggy (whose own ENTER_X/entryY/entryScale,
// main.js:5415-5417, are expressed as offsets from that SAME HOME_CENTER/HOME_FLOOR anchor)
// is unaffected, and why 1440 (floor never applies, s>=FLOOR) is unaffected too.
//
// Fix (layout-only, this file only — chog-home.js is not in this card's allowlist): feed
// `mountChogHome()` a *pre-distorted* `board` rect instead of the real one, chosen so that
// chog-home.js's own unmodified formula — run on this fake board — outputs a `start` that is
// exactly the F⁻¹ (inverse of the floor group's transform, around the same anchor) of what it
// would have computed from the real board. Composing that with the floor group's real
// transform then exactly cancels back out to the original, correct, un-wrapped placement —
// for every point `mountChogHome()` places relative to `start` (the Chog ink itself AND the
// Name→walk handoff freeze-frame overlay, chog-home.js:684-693, since both are positioned
// purely as functions of `board`/`start` inside that same file). Solving
// F(place(board_fake)) = place(board_real) for board_fake (fixed anchor+uniform-scale F)
// gives the closed form below; `k=1,nudgeLocalX=nudgeLocalY=0` (no floor) reduces it to
// `fit.rect` exactly, so this is a strict no-op whenever the floor doesn't apply (1440, or a
// narrow revisit where `computeHomeCharScaleFloorPlan()` still returns `applied:false`).
// CORNER_TX/CORNER_TY (the walk's fixed settle target) are untouched — they're already
// hand-calibrated against the floor-wrapped rendering (A610_chog_auth_position lane_chog
// CHOG_TRAJECTORY_DRAFT.md), so this only corrects the dynamic start point, never settle.
function chogWalkStartBoardRect(fit, plan) {
  if (!fit || !fit.rect) return fit && fit.rect;
  if (!plan || !plan.applied) return fit.rect;
  const { k, nudgeLocalX, nudgeLocalY } = plan;
  return {
    left: fit.rect.left + fit.s * (HOME_CENTER * (1 - k) + nudgeLocalX),
    top: fit.rect.top + fit.s * (HOME_FLOOR * (1 - k) + nudgeLocalY),
    width: fit.rect.width * k,
  };
}

// 정본 배치 — 걷기와 앉기를 각자의 발밑 기준으로 같은 바닥선에 놓는다.
function layoutHomeCharacter() {
  const walk = document.querySelector("#homeWalk");
  const seat = document.querySelector("#homeSeat");
  if (!walk || !seat) return;
  walk.style.width = `${HOME_WALK_W}px`;
  walk.style.left = `${HOME_WALK_L}px`;
  walk.style.top = `${HOME_FLOOR - HOME_WALK_H * HOME_WALK_FOOT}px`;
  walk.style.transformOrigin = `51.33% ${HOME_WALK_FOOT * 100}%`;
  seat.style.width = `${HOME_SEAT_W}px`;
  seat.style.left = `${HOME_SEAT_L}px`;
  seat.style.top = `${HOME_FLOOR - HOME_SEAT_H * HOME_SEAT_FOOT}px`;
  const tag = document.querySelector("#homeName");
  if (tag) {
    tag.style.left = `${HOME_CENTER - 60}px`;
    tag.style.top = `${HOME_FLOOR + 6}px`;
  }
}

// [A-360 §3] cardClaimedOverride — explore 씬도 이 함수로 Home 판을 그대로 붙인다
// (걷기 없는 정착뿐이라 state.homeArrival=false 경로 그대로 재사용된다). explore 에서는
// 공통 카드 자리를 Second Journey 카드가 쓰므로 손끝-노트패드를 늘 닫아 둔다
// (cardClaimed:true) — sendstay 는 기존과 같이 state.sendCardVisible 을 그대로 쓴다.
function mountHome({ cardClaimed = state.sendCardVisible } = {}) {
  const host = document.querySelector("#homeChar");
  if (!host) return;
  // [A-356 §2] 이 mountHome() 진입이 Save 직후 첫 Home 도착인지 여기서 한 번 동결한다.
  // state.homeArrival 은 이 함수 안에서 곧 false 로 내려가므로, settle() 안에서 다시 읽으면
  // 재방문·Stay 재진입(둘 다 애초에 homeArrival=false)과 구분이 안 된다. reduced-motion·
  // !fit 로 걷기연출을 건너뛴 경우에도 "도착이라는 사실"은 그대로다(아래 settle 분기 주석).
  const isFirstArrival = state.homeArrival;
  const walk = host.querySelector("#homeWalk");
  const seat = host.querySelector("#homeSeat");

  const fit = fitHomeBoard();
  layoutHomeCharacter();
  fitCardAnchor();
  // [A-607 REWORK → A-608 web freeze] Records is a fixed CSS left-rail anchor at narrow, but
  // reinstated as `.homePaper`-derived at web (see `alignRecordsCardToHomePaper()`'s own
  // comment) — re-align here and on resize, matching pre-A-607 behavior at web (no-op at
  // narrow, that function's own width guard).
  if (state.recordsCardVisible) alignRecordsCardToHomePaper();
  let residentsMobile = window.innerWidth <= 640;
  sceneListener(window, "resize", () => {
    const freshFit = fitHomeBoard();
    layoutHomeCharacter();
    fitCardAnchor();
    // [A-624] 640px 경계를 넘을 때만 주민 모듈을 다시 잰다(remountHomeResidentsForBreakpoint 주석).
    const mobileNow = window.innerWidth <= 640;
    if (mobileNow !== residentsMobile) {
      residentsMobile = mobileNow;
      remountHomeResidentsForBreakpoint();
    }
    // [A-603] 걷기 도중(host.dataset.arrival==="1")에는 재적용하지 않는다 — 걷기 자체의
    // ENTER_X/entryY/entryScale 산수가 이 바닥 스케일을 모르는 값이라, 도중에 걸면
    // 크기가 한 프레임에서 튄다("location first, scale second" 원칙 그대로 유지).
    if (host.dataset.arrival !== "1") applyHomeCharacterScaleFloor(freshFit);
    if (state.recordsCardVisible) alignRecordsCardToHomePaper();
  });

  // Home Chog — Piggy 와 같은 판·같은 발선. 같은 Save 전환에서 함께 출발한다.
  const chogRoot = document.querySelector("#chogHome");
  // [A-614 repair] 두 캐릭터가 mid-walk 에 130~220px 벌어져 보이는 것(A-612 BEFORE.md §B)
  // 을 고치는 pairConvergenceEase() 는 플로어가 실제로 걸리는 좁은 화면(430/390,
  // computeHomeCharScaleFloorPlan(fit).applied)에서만 켠다 — 1440(플로어 미적용)에서는
  // 아래에서 이 값이 그냥 false 로 남아 Piggy/Chog 둘 다 원래 선형 `u` 를 그대로 쓴다
  // (카드 지시 "1440: 코드 경로는 no-op·byte-identical"). A-610 의 `chogBoardRect` 줄은
  // 그 자신의 계약 테스트(a610-chog-walk-start-floor.mjs)가 원문을 그대로 고정하고
  // 있어 손대지 않는다 — 같은 순수함수를 한 번 더 부르는 것뿐이라 비용은 무시할 만하다.
  const pairConvergeActive = !!(fit && computeHomeCharScaleFloorPlan(fit)?.applied);
  if (chogRoot && fit) {
    const chogStart = state.homeArrival ? state.chogStartRect : null;
    state.chogStartRect = null;
    // [A-610 repair] Only a REAL walk (real startRect, motion not reduced) ever reaches
    // chog-home.js's board-relative `start` math (chog-home.js:661, `if (startRect &&
    // !reduced)`) — the static/no-motion path below just re-applies the already-correct,
    // hand-calibrated CORNER_TX/CORNER_TY immediately (chog-home.js:349) and never touches
    // `board` again. So the pre-distorted rect is only computed (and only matters) for that
    // one real-arrival case; every other mount here keeps passing `fit.rect` unchanged.
    const chogWillWalk = !!(chogStart && !prefersReducedMotion());
    const chogBoardRect = chogWillWalk
      ? chogWalkStartBoardRect(fit, computeHomeCharScaleFloorPlan(fit))
      : fit.rect;
    homeChog = mountChogHome(chogRoot, {
      startRect: chogStart,
      // Name it 에 있던 그 그림 — 걷기 첫 120ms 를 그것에서 이어받는다.
      startSrc: chogStart ? `${MOTION_DIR}/assets/chog_idle_fill.png` : null,
      board: chogBoardRect,
      reduced: prefersReducedMotion(),
      // [A-614 repair] 실제로 걷는 경우에만, 그리고 플로어가 걸리는 화면에서만 켠다.
      pairConverge: chogWillWalk && pairConvergeActive,
      // [A-359 §3] 공통 카드 자리(.cardAnchor)는 한 번에 카드 하나만 — Send 카드가 이미
      // 떠 있으면(state.sendCardVisible) Home 노트패드가 손끝-고정(pinned)으로 같은 자리에
      // 도킹하지 못하게 한다(chog-home.js sharedCardPadTarget). DEV 경로만이 아니라 이
      // 값 자체가 실제 sendCardVisible 상태라 실제 Send 진입에도 그대로 적용된다.
      cardClaimed,
      onFrame: (step) => runSceneFrames(step),
      onCleanup: (fn) => onSceneTeardown(fn),
      listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
      // [A-411-r] A-411-p 회귀 교정 — Chog 탭(onTap)을 openSecondJourneyExplore 로 배선한
      // 것은 Owner 의 최신 확정과 충돌했다: 졸던 Chog 를 깨우는 탭은 기존 손올리기
      // 모션과 함께 "원래 HOME 패드"(homePadMarkup, 기존 HOME 현황 그대로)를 여는
      // 계약으로 되돌린다. 그 여닫음 자체는 이 콜백과 무관하게 chog-home.js 의
      // pinned/progress(위 draw()) 가 이미 하고 있으므로, onTap 은 다시 no-op 이면
      // 된다 — Chog 클릭을 Explore 직행으로 재활용하지 않는다(A-411-r 스펙). Second
      // Journey 자동 진입은 settle() 의 state.homeQuietForExplore 분기(아래)로만 남는다.
      onTap: () => {},
    });
    onSceneTeardown(() => {
      homeChog = null;
    });
  }

  // 도착해서 앉은 자리 — 이동이 없을 때의 기본 모습이기도 하다.
  // 이동을 끝내고 부를 때는 마지막 프레임의 `transform` 을 **지우지 않는다.**
  // 지우면 4.6 초의 모습이 사라지고 한 번 튄다(A-306 지적 4).
  const settle = ({ keepPose = false } = {}) => {
    host.dataset.arrival = "0";
    // [A-603] 정착한 뒤에만 캐릭터 스케일 바닥을 건다(위 HOME_CHAR_SCALE_FLOOR 주석 —
    // 걷기 산수에는 걸지 않는다). settle() 은 재방문/reduced-motion/걷기완료 세 경로
    // 전부를 지나므로 여기 한 곳이면 충분하다(resize 재계산은 위 리스너가 이어받는다).
    applyHomeCharacterScaleFloor(fit);
    // [A-447 Owner "이름은 Piggy 가 Home 으로 이동·정착한 뒤"] 걷기 도중 숨긴 이름표를 정착에서 보인다.
    host.querySelector("#homeName")?.style.removeProperty("visibility");
    if (!keepPose) {
      if (walk) walk.style.removeProperty("transform");
      if (seat) seat.style.removeProperty("transform");
    }
    startHomeDrowsyTimer();
    // [A-624] 첫 도착 가르침 신호 B — 정착 뒤 한 번. 같은 1회 사실(isFirstArrival, 새 저장 키 0)
    // 과 같은 조건(아직 Send 카드가 자리를 쥐지 않음)으로만 부른다. 추가 Piggy 의 Name → Home
    // (saveName() 의 pendingNamePiggyId 분기)은 homeArrival 을 세우지 않으므로 반복하지 않는다.
    // Home 종이를 스스로 열지 않는다 — 여는 것은 사용자의 실제 Chog 탭뿐이다.
    if (isFirstArrival && !state.sendCardVisible) homeChog?.startTapCue?.();
    // [A-356 §2] A354 회귀 교정 — state.sendCardVisible 이 설 자리가 없어 첫 Journey 카드가
    // 영영 안 열리던 것. 이 정착이 Save 직후 첫 도착일 때만, 잠깐(위 상수) 뒤 카드를 연다.
    // 재방문·Stay 재진입은 isFirstArrival 이 false 라 여기 오지 않는다. 씬을 떠나면(다음
    // render() 의 teardownScene()) sceneTimeout 이 예약을 스스로 지운다 — 반복 강제 표시 0.
    // [A-411-g] 이 타이머가 기록 카드(records)가 열려 있는 동안 울리면, 아래 render() 가
    // mountHome() 을 cardClaimed:true(=state.sendCardVisible) 로 다시 마운트해 Home
    // 노트패드(.homePaper) 를 영구히 접어(chog-home.js draw() 의 cardClaimed 분기, progress
    // 0 고정) 버린다 — 기록 카드는 alignRecordsCardToHomePaper() 로 그 접힌 .homePaper rect
    // 를 그대로 물려받아 두 카드가 같이 손끝 크기(≈9×13)로 굳는다(감독 실측). 기록 카드는
    // 별도 자리(.recordsCardAnchor)라 공통 카드 자리 다툼과 무관하니, 그 자리를 넘기는 이
    // 타이머만 기록이 열려 있는 동안 미룬다 — 기록을 닫으면 바로 이어서 연다(반복 강제 표시
    // 없이, 다음 render() 의 teardownScene() 이 여전히 예약을 지운다).
    if (isFirstArrival && !state.sendCardVisible) {
      const revealSendCard = () => {
        if (state.recordsCardVisible) {
          sceneTimeout(revealSendCard, HOME_FIRST_JOURNEY_CARD_MS);
          return;
        }
        // [A-624 → A-626 A] 첫 도착 신호가 아직 등장 중이거나 완전 가시 유지(1.2s) 중이면 그 남은
        // 신호 시간만큼 정확히 미룬다(1200ms 배수 재시도는 유지가 0.57s 또는 1.73s 로 떨어졌다).
        // 신호 시계는 그려진 프레임으로만 흐르므로 숨은 탭에서는 다시 미뤄질 뿐이다. 두 번째 카드
        // 자리·새 저장 키 0. 최소 50ms — 0ms 재귀 방지.
        const cueWait = homeChog?.tapCueHoldRemainingMs || 0;
        if (cueWait > 0) {
          sceneTimeout(revealSendCard, Math.max(50, cueWait));
          return;
        }
        // [A-359 §3] Send 카드가 공통 자리를 넘겨받기 직전, 아직 pinned 로 열려 있을 수
        // 있는 Home 노트패드를 먼저 닫는다 — render() 의 전체 다시그리기가 곧 이 인스턴스를
        // 치우지만, 그 사이 한 프레임이라도 두 카드가 같은 자리에서 겹치지 않게 한다.
        homeChog?.closeCard?.();
        state.sendCardVisible = true;
        render();
      };
      sceneTimeout(revealSendCard, HOME_FIRST_JOURNEY_CARD_MS);
    }
    // [A-411-p] "First Receipt filed → 정착 → 잠깐 조용 → Paper" — Home next errand 버튼을
    // 없앤 대신, 이 정착 신호(=settle 호출 그 자체, First 도착 걷기연출의 revealSendCard 와
    // 같은 자리) 뒤에 기존 Second Journey 진입 함수(openSecondJourneyExplore)를 그대로
    // 부른다. 새 대기 초수를 만들지 않는다 — 위 HOME_FIRST_JOURNEY_CARD_MS 를 그대로 쓴다
    // (이미 EXPLORE_NOTE_MS 도 "새 타이밍 발명 0" 근거로 같은 1200ms 를 재사용한 값이다).
    // state.homeQuietForExplore 는 1회용 표라 여기서 곧장 끈다 — goHomeFromFilebox()/초기
    // scene 계산에서만 다시 서므로, Send 실패 메시지 등 다른 sendstay 재진입에서는 반복
    // 강제 표시가 없다. 기록 카드가 열려 있으면 revealSendCard 와 같은 이유로 미룬다
    // (자리 다툼, 위 A-411-g 주석 참고).
    if (state.scene === "sendstay" && state.homeQuietForExplore) {
      state.homeQuietForExplore = false;
      const revealExplorePaper = () => {
        if (state.recordsCardVisible) {
          sceneTimeout(revealExplorePaper, HOME_FIRST_JOURNEY_CARD_MS);
          return;
        }
        // [A-411-n §2] Second 를 이미 끝냈으면(=완료) 자동 재실행 0 — 조용한 Home 만 남긴다.
        if (state.scene !== "sendstay" || state.secondJourneyCompletedOnce) return;
        openSecondJourneyExplore();
      };
      sceneTimeout(revealExplorePaper, HOME_FIRST_JOURNEY_CARD_MS);
    }
  };

  const startRect = state.homeStartRect;
  const startPose = state.homeStartPose;
  state.homeStartRect = null;
  state.homeStartPose = null;

  // 도착 연출은 Save 직후 한 번뿐이다. 새로고침·재방문·Stay 는 이동 없이 같은 자리에 앉아 있다.
  // reduced-motion 도 마찬가지 — 이동을 빼도 도착이라는 사실은 그대로다.
  if (!state.homeArrival || prefersReducedMotion() || !fit) {
    state.homeArrival = false;
    settle();
    return;
  }
  state.homeArrival = false;

  // 출발 rect 가 없으면 화면 밖에서 끌어오지 않는다 — 재방문처럼 정지 포즈로 두고 보고한다.
  // (`-46vw` 같은 임의 시작점은 정상 흐름에서 쓰지 않는다.)
  if (!startRect) {
    settle();
    return;
  }

  // [A-447] 실제 첫 도착 걷기에서만 이름표를 숨긴다 — settle() 이 다시 보인다. reduced-motion·
  // startRect 없음·재방문/Stay 는 위에서 곧장 settle() 하므로 처음부터 보인다.
  host.querySelector("#homeName")?.style.setProperty("visibility", "hidden");

  // 미리 구워 둔다 — 걷는 도중에 프레임이 비면 발이 끊긴다.
  for (let i = 0; i < HOME_WALK_FRAMES; i += 1) {
    const img = new Image();
    img.src = `${MOTION_DIR}/walk/f${String(i).padStart(2, "0")}.svg`;
  }

  // 화면 rect → 판 좌표계. 승인 `beginHome()` 의 세 식 그대로.
  const { s, left, top } = fit;
  const ENTER_X = (startRect.left + startRect.width * 0.5133 - left) / s - HOME_CENTER;
  const entryScale = startRect.width / s / HOME_WALK_W;
  const entryY = (startRect.bottom - top) / s - HOME_FLOOR;

  // 동결한 포즈를 Name it 에 있던 **그 화면 자리에** 그대로 얹는다. 판 안에 넣되
  // 좌표는 판 기준으로 환산해 두 번 이동하지 않게 한다. 120ms 동안 이것이 사라지고
  // 걷기가 나타난다 — 첫 프레임부터 무언가 보이고, 같은 Piggy 가 둘로 보이지 않는다.
  let snapshot = null;
  if (startPose) {
    snapshot = startPose;
    Object.assign(snapshot.style, {
      position: "absolute",
      left: `${(startRect.left - left) / s}px`,
      top: `${(startRect.top - top) / s}px`,
      width: `${startRect.width / s}px`,
      height: `${startRect.height / s}px`,
      pointerEvents: "none",
      opacity: "1",
    });
    host.append(snapshot);
    onSceneTeardown(() => snapshot?.remove());
  }

  host.dataset.arrival = "1";
  // [A-605 repair · FAIL 3] 지금까지는 걷기 도중(dataset.arrival==="1") 캐릭터 스케일
  // 바닥을 아예 걸지 않고 정착(settle()) 에서만 걸었다 — 그래서 걷는 동안은 자연 스케일
  // 그대로(430/390 에서 ≈61–80px, 카드 지시 "too small") 있다가 정착 순간 갑자기
  // 0.42 로 커지는 한 프레임 점프가 있었다. 여기서 거는 것은 안전하다: 이 바닥은
  // `#homeChar`+`#chogHome` 을 감싸는 **바깥** 조상(`.homeCharScaleFloor`)에 걸리는
  // 상수 scale(k) 다 — `walk.style.transform` 이 매 프레임 쓰는 `ENTER_X`/`entryY`/
  // `entryScale` 산수는 이 안쪽 좌표계(발밑 원점 HOME_CENTER/HOME_FLOOR 기준 로컬 px)만
  // 다루고 바깥 조상의 transform 값을 전혀 몰라도 된다 — CSS 는 조상·자손 transform 을
  // 곱해서 합성할 뿐이다(정착 때 이미 같은 방식으로 검증됨, GRID.md §3). 걷기 시작부터
  // settle() 까지 같은 `fit`(이 함수 진입 시 한 번 잰 값, 재실측 없음)을 쓰므로 k 가
  // 걷기 내내·정착 순간까지 상수로 고정된다 — "점프 없이 매끈하게" 는 이 상수성에서
  // 나온다(값이 안 바뀌면 튈 것이 없다). 리사이즈 도중(`host.dataset.arrival==="1"`)
  // 재계산을 건너뛰는 기존 가드(위 resize 리스너)는 그대로 둔다 — 그 가드가 막는 것은
  // "걷는 중간에 k 가 바뀌는" 경우이고, 여기서 하는 것은 "걷기 시작부터 같은 k 를 쓰는"
  // 것이라 서로 다른 문제다. 자연 스케일이 바닥보다 크면(예: 1440) 이 호출은 그대로
  // no-op(§applyHomeCharacterScaleFloor 자신의 `s >= FLOOR` 가드)이라 데스크톱은 무변경.
  applyHomeCharacterScaleFloor(fit);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);

  let elapsed = 0; // ms
  let last = 0;
  runSceneFrames((now) => {
    const dt = last && !document.hidden ? Math.min(now - last, 50) : 0;
    last = now;
    elapsed += dt;
    const t = elapsed / 1000;

    if (t < HOME_T_SWAP) {
      host.dataset.phase = "walk";
      if (seat) seat.style.opacity = "0";
      const k = Math.min(Math.max(0, t - HOME_T_BLEND), HOME_T_WALK);
      const u = k / HOME_T_WALK;
      // [A-614 repair] Chog 와 같은 근거·같은 게이트로 위치/스케일 lerp 진행률만
      // 앞당긴다(pairConvergenceEase, chog-home.js — 두 파일이 같은 함수를 공유해
      // "shared progress/convergence target" 를 실제로 같게 만든다). 프레임 인덱스는
      // 바로 위에서 이미 `k`(원래 선형 시간)를 그대로 쓴다 — 다리 애니 타이밍 불변.
      const posU = pairConvergeActive ? pairConvergenceEase(u) : u;
      if (walk) {
        walk.src = `${MOTION_DIR}/walk/f${String(Math.floor(k / HOME_FPS) % HOME_WALK_FRAMES).padStart(2, "0")}.svg`;
        walk.style.transform = `translate(${lerp(ENTER_X, 0, posU)}px, ${lerp(entryY, 0, posU)}px) scale(${lerp(entryScale, 1, posU)})`;
        // 동결 포즈 → 걷기. 120ms 동안 한쪽이 지고 한쪽이 뜬다. 합이 항상 1이라
        // 빈 화면이 생기지 않고, 끝나면 동결 포즈를 치워 둘이 남지 않는다.
        const blend = Math.min(1, t / HOME_T_BLEND);
        walk.style.opacity = String(blend);
        if (snapshot) {
          snapshot.style.opacity = String(1 - blend);
          if (blend >= 1) {
            snapshot.remove();
            snapshot = null;
          }
        }
      }
    } else {
      host.dataset.phase = "seat";
      if (seat) seat.style.opacity = "1";
      let sx = 1;
      let sy = 1;
      if (t < HOME_T_PLOP_END) {
        // 털썩
        const p = (t - HOME_T_SWAP) / (HOME_T_PLOP_END - HOME_T_SWAP);
        if (p < 0.33) {
          const q = ease(p / 0.33);
          sx = lerp(1.1, 0.97, q);
          sy = lerp(0.88, 1.04, q);
        } else {
          const q = ease((p - 0.33) / 0.67);
          sx = lerp(0.97, 1, q);
          sy = lerp(1.04, 1, q);
        }
      } else if (t > HOME_T_BREATHE) {
        // 숨쉬기 — 승인 원본은 시계를 4.6 에서 멈춘다. 그래서 4.0~4.6 한 구간만 돌고
        // 4.6 의 모습으로 선다. 무한 진동으로 새로 설계하지 않는다.
        const b = Math.sin((Math.min(t, HOME_T_END) - HOME_T_BREATHE) * 1.9);
        sx = 1 - 0.008 * b;
        sy = 1 + 0.014 * b;
      }
      if (seat) seat.style.transform = `scale(${sx}, ${sy})`;
      if (t >= HOME_T_END) {
        settle({ keepPose: true });
        return false;
      }
    }
    return true;
  });
  sceneListener(document, "visibilitychange", () => {
    last = 0;
  });
}

// [A-414-b/c] Send 카드가 실제로 떠 있는 동안 원본 work? 준비 반응(위 보기/작은
// perk/기다림)을 켠다. piggy-depart.js 는 **새로 건드리지 않는다** — 이미 있는
// createDepartRenderer(mode:"work")를 그대로 부른다.
//
// [보고할 남은 문제] piggy-depart.js drawAt()의 mode==="work" 분기는 확정 원본
// (`<private>
// departure.js:79` `source=.15+.65*ease(elapsed/.55)`)과 달리 scene 진행값 `t`를 그
// 홀드식으로 다시 누르지 않고 `elapsed`를 그대로 t로 흘려보낸다(app/src/
// piggy-depart.js:190 `const source = mode === "send" ? sendSourceOf(e) : e;`). 그
// 결과 같은 파일 268~278행의 눈 깜빡임(work-half/shut, `elapsed % 3.6` 이 1.65~2.16
// 구간일 때만 등장)은 t 도 함께 1.65 이상으로 밀어 올려 rise(1행 위 정의)가 1이 되고
// 걷기 프레임(stepping)까지 돈다 — "출발하지 않는다"는 주석과 어긋난다. 이 함수는
// 그 상한(source가 0.8에서 멈추게 하는 홀드)을 호출부에서 흉내내 "출발 금지"
// 쪽을 지켰고, 그 대가로 실제 반짝임(half/shut)은 지금 못 보여준다 — 눈 깜빡임을
// 살리려면 app/src/piggy-depart.js:190,266-281 의 mode==="work" 분기를 원본 홀드식으로
// 고쳐야 한다(내가 건드릴 파일 밖이라 고치지 않고 여기 보고한다).
// [A-431] canvasId/active/clock 만 주입 가능하게 넓혔다 — 기본 인자는 First Send 카드 그대로.
function mountSendCardWorkPose({
  canvasId = "sendCardWorkStage",
  active = state.sendCardVisible,
  clock = "send",
  piggyId = currentScenePiggyId(),
  affectedPiggyId = piggyId,
} = {}) {
  const getStart = () => (clock === "second" ? secondWorkStartedAt : sendWorkStartedAt);
  const setStart = (v) => {
    if (clock === "second") secondWorkStartedAt = v;
    else sendWorkStartedAt = v;
  };
  if (!active) {
    setStart(null);
    return;
  }
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas) return;
  const projected = resolvePiggyMotionState({ piggyId, affectedPiggyId, cue: PIGGY_MOTION_STATE.WORK });
  // Existing one-Piggy recovery/DEV paths can lack an indexed id; preserve their current visual.
  // With an id present, a non-affected Piggy never receives the work renderer.
  if (projected.piggyId && !projected.active) return;
  if (projected.piggyId) canvas.dataset.piggyId = projected.piggyId;
  canvas.dataset.motionState = projected.piggyId ? projected.state : PIGGY_MOTION_STATE.WORK;
  const seatImg = document.querySelector("#homeSeat");
  const token = sceneToken;
  let stopped = false;
  onSceneTeardown(() => {
    stopped = true;
  });
  const alive = () => !stopped && token === sceneToken;

  // [A-607 canon K — First Job Piggy+Chog cohesion] This canvas (Piggy's "work?" reaction,
  // drawn by piggy-depart.js's own renderer — outside this card's allowed files) used to
  // stay centered on the raw 1256×772 board at NATURAL scale `s` alone. `#chogHome`/
  // `#homeChar` (Chog + Piggy's OWN idle/seat sprites) get wrapped by
  // `applyHomeCharacterScaleFloor()` whenever `s < HOME_CHAR_SCALE_FLOOR` — floor-scaled AND
  // bottom-anchored — but this canvas is a separate sibling, never wrapped, so it kept
  // rendering Piggy at the small natural scale, anchored to the viewport's own center
  // instead of the bottom-safe target. Measured (430×900, First Job, real flow): Piggy (this
  // canvas) at y≈436-520 near the card's own vertical band while Chog (floor-scaled,
  // bottom-anchored) sat at y≈767-823 near the physical bottom — real ink, confirmed by a
  // Pillow pixel scan of the actual screenshot, not just DOM bboxes — reading as two
  // characters in different places rather than one resident cluster (canon K: "Piggy and
  // Chog are too far apart... bring closer together").
  // Fix, entirely within this file (no piggy-depart.js edit): when the floor would apply,
  // reposition/rescale the WHOLE canvas (this mode draws only Piggy on an otherwise
  // transparent buffer — pixel-sampled, confirmed) so the SAME board point that anchors
  // Piggy/Chog's own group (HOME_CENTER, HOME_FLOOR) maps to the SAME viewport target
  // `applyHomeCharacterScaleFloor()` computes — same `k`/bottom-anchor/collision-nudge
  // formulas, not reinvented. Scoped to `clock === "send"` only (First Job) — Explore's
  // `clock === "second"` reaction doesn't share `#homeBoard`/this collision concept, and is
  // left on its original simple centered fit to avoid touching an out-of-scope flow.
  const fit = () => {
    const s = Math.min(window.innerWidth / HOME_BOARD_W, window.innerHeight / HOME_BOARD_H);
    const board = document.querySelector("#homeBoard");
    if (clock === "send" && board && s > 0 && s < HOME_CHAR_SCALE_FLOOR) {
      const k = HOME_CHAR_SCALE_FLOOR / s;
      const fitLeft = (window.innerWidth - HOME_BOARD_W * s) / 2;
      const fitTop = (window.innerHeight - HOME_BOARD_H * s) / 2;
      const bottomSafePx = resolveCssLengthVarPx("--mobile-bottom-safe", 20);
      const naturalFootViewportY = fitTop + HOME_FLOOR * s;
      const targetFootViewportY = window.innerHeight - bottomSafePx - HOME_CHAR_BOTTOM_ANCHOR_GAP_PX;
      // [A-608 OWNER CORRECTION — MOBILE HOME CHARACTER CLUSTER MUST NOT MOVE BETWEEN CARDS,
      // 2026-09-27] earlier attempts here tried to compensate for the fact that the REAL
      // group (Chog) got a +96px "collision" push while this canvas (Piggy) did not (or got a
      // different, hand-tuned push) whenever First Job's card was up — the two characters
      // ended up in DIFFERENT slots depending on whether a card was open, sometimes
      // overlapping, sometimes clipping at the viewport edge. The Owner's own correction
      // removes the root cause instead of compensating for it:
      // `applyHomeCharacterScaleFloor()` (this file) no longer adds any collision term to
      // Chog's own nudge — Chog now sits at the exact same slot in Home settled / First Job /
      // Records. This canvas mirrors that exactly: the SAME base-only nudge formula, same
      // origin (HOME_CENTER/HOME_FLOOR), same bottom-anchor target — so Piggy's canvas lands
      // in the literal same resident slot `#homeSeat` itself would occupy, not a
      // separately-tuned approximation of it. No card-state-dependent term of any kind.
      const nudgeViewportX = HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX.x;
      const nudgeViewportY = targetFootViewportY - naturalFootViewportY;
      const effW = HOME_BOARD_W * s * k;
      const effH = HOME_BOARD_H * s * k;
      const left = fitLeft + s * HOME_CENTER * (1 - k) + nudgeViewportX;
      const top = fitTop + s * HOME_FLOOR * (1 - k) + nudgeViewportY;
      canvas.width = Math.round(effW * (window.devicePixelRatio || 1));
      canvas.height = Math.round(effH * (window.devicePixelRatio || 1));
      canvas.style.width = `${effW}px`;
      canvas.style.height = `${effH}px`;
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.style.transform = "none";
      return;
    }
    // Desktop / floor-not-active / Explore's "second" clock: unchanged simple centered fit
    // (`.departStage`'s own CSS left:50%/top:50%/translate(-50%,-50%) still applies whenever
    // these inline overrides are cleared — same as before this card for these paths).
    canvas.style.left = "";
    canvas.style.top = "";
    canvas.style.transform = "";
    canvas.width = Math.round(HOME_BOARD_W * s * (window.devicePixelRatio || 1));
    canvas.height = Math.round(HOME_BOARD_H * s * (window.devicePixelRatio || 1));
    canvas.style.width = `${HOME_BOARD_W * s}px`;
    canvas.style.height = `${HOME_BOARD_H * s}px`;
  };
  fit();

  // 카드가 이번에 처음 뜬 것이면 지금을 0초로 잡는다. 같은 카드가 떠 있는 채로
  // sendPiggy() 의 중간 메시지(setScene("sendstay", "Piggy is asking to go out.", …))가
  // 다시 render() 를 부르면 이 함수도 다시 불리지만, sendWorkStartedAt 이 이미 있으니
  // perk 를 처음부터 다시 재생하지 않는다(재렌더당 중복 준비모션 0).
  if (getStart() === null) setStart(performance.now());
  const workStartedAt = getStart();
  const reduced = prefersReducedMotion();

  loadWorkAssetsCached().then((res) => {
    if (!alive()) return;
    const images = res && res.images;
    // 자산이 없거나 깨졌으면 이번 반응만 접는다 — 기존 seat.svg 를 그대로 둔다
    // (Away 의 asset-missing 처리와 같은 원칙, mountAway() onStatus 참고).
    if (!images || (res && res.missing && res.missing.length)) {
      departAssetsMissing = (res && res.missing) || departAssetsMissing;
      return;
    }
    if (!alive()) return;
    const renderer = createDepartRenderer(canvas, { images, mode: "work" });
    // 캔버스가 실제로 그릴 준비가 된 지금에서야 옛 seat.svg 를 숨긴다 — 자산이
    // 늦게 오는 동안은 seat.svg 가 계속 보여서 "Piggy 없음" 프레임이 생기지 않는다.
    if (seatImg) seatImg.style.visibility = "hidden";
    onSceneTeardown(() => {
      if (seatImg) seatImg.style.removeProperty("visibility");
    });

    // [A-419] 홀드식이 이제 원본 자리(piggy-depart.js drawAt, mode "work")에 있다 —
    // 여기서 흉내내던 mapped 변환은 제거한다. 그 흉내가 elapsed 를 0.8 로 얼려서
    // 눈 깜박임(work-half/shut)이 한 번도 안 나오던 원인이었다(A-414-b/c 정정).
    // 이제 **실제 경과 그대로** 넘긴다: 씬 시계는 렌더러가 0.8 에서 홀드해 출발하지
    // 않고, 깜박임은 실제 시계로 3.6초 주기(1.65s·1.98s)로 계속 돈다.
    const draw = () => {
      if (!alive()) return false;
      renderer.drawAt((performance.now() - workStartedAt) / 1000);
      return true; // 깜박임이 계속 돌아야 하므로 카드가 살아 있는 동안 계속 그린다.
    };

    if (reduced) {
      // 원본도 reduced 에서는 깜박임을 끄고 한 장만 둔다 — 새 식에서 0.6 은 이미
      // source 0.8(정착)이고 눈은 open 단계다(깜박임 창 1.65/1.98 밖).
      renderer.drawAt(0.6);
      return;
    }
    draw();
    sceneListener(window, "resize", () => {
      fit();
      draw();
    });
    runSceneFrames(draw);
  });
}

// Home 3분 무입력 졸기 타이머. 도착한 그 시점에 시작하고, 입력이 있으면 다시 센다.
// Home 을 떠나면 씬 정리에서 함께 사라진다.
// UNKNOWN: 졸기 파츠 연출(보관본 sleep 패키지)은 이번 묶음에서 연결하지 않았다 —
// A-292 번호 6은 「타이머를 이 시점에 시작한다」까지다.
function startHomeDrowsyTimer() {
  const host = document.querySelector("#homeChar");
  if (!host) return;
  let timer = 0;
  const arm = () => {
    clearTimeout(timer);
    host.dataset.drowsy = "0";
    timer = setTimeout(() => {
      host.dataset.drowsy = "1";
    }, HOME_DROWSY_MS);
  };
  for (const type of ["pointerdown", "pointermove", "keydown"]) {
    sceneListener(window, type, arm, { passive: true });
  }
  onSceneTeardown(() => clearTimeout(timer));
  arm();
}

// A-336: 어두운 note/Send/Stay 텍스트버튼을 확정 SendCard 껍질로 바꾼다. sendButton/
// stayButton/checkButton 의 id·행동·금융 검증 순서는 그대로다 — send-card.js 는 마크업만
// 만들고, 배선은 여전히 render() 하나가 한다(§구현경계 5).
function renderSendStay() {
  const blocked = !isAllowedPiggyRpId();
  const piggyName = displayPiggyName();
  // [A-354-b] Home 대기(초그 + HomeNotepad, 클릭 가능)와 Send 카드 표시를 분리한다.
  // state.sendCardVisible 이 설 때만 카드를 낀다 — 도착·stay 직후에는 항상 꺼져 있다.
  // [A-356 §1/§7 → A-359 §1] 공통 카드 자리(.cardAnchor, style.css) 안에 얹는다 — 이
  // 카드만의 임의 좌표가 아니다. `.stage` 의 직계 자식으로 반환한다(아래) — #homeBoard
  // 안이 아니다(무대 축척을 받으면 실제 px 가 틀어진다, homeCharacter() 위 주석).
  // terms 는 BUILD_PLAN.md:95–99 승인 문구 그대로다(옛 rough "Can go out once/call home
  // anytime" 대치, A-354-c).
  const cardAnchorMarkup = state.sendCardVisible
    ? `<div class="cardAnchor" id="sendCardAnchor">
        <div class="cardAnchor__fit">
          ${sendCardMarkup({
            // [A-407-e] 막힌 상태의 카드 문구도 같은 기준 — 내부 origin 노출 0, 실행 가능
            // 한 것처럼 보이지 않게. blocked 자체(버튼 비활성)는 그대로 둔다.
            message: blocked ? "Not from here." : state.message || "Piggy is home.",
            detail: blocked ? "Piggy can only go out from the real app." : state.detail,
            // [A-454 Owner "자기 주소는 홈 기록 보기에서"] Send 카드(시각·접근성 DOM)에는 주소 0.
            // 주소는 내부 state 에만 — auth/tx 동작 무변경.
            address: "",
            terms: ["$5 limit", "Ask me every time", "One-time"],
            blocked,
            busy: sendBusy(),
          })}
        </div>
      </div>`
    : "";
  // [A-414-b] 원본 work? 렌더러(piggy-depart.js mode:"work")를 얹을 자리 — away 씬의
  // .departStage 와 같은 클래스를 그대로 써서(style.css 새 규칙 0) 같은 1256×772 판
  // 중앙정렬을 물려받는다. 카드가 떠 있을 때만 존재 — 사라지면 DOM 자체가 없어져
  // mountSendCardWorkPose() 가 다음 렌더에서 다시 만든다.
  const sendWorkStageMarkup = state.sendCardVisible
    ? `<canvas class="departStage" id="sendCardWorkStage" aria-hidden="true"></canvas>`
    : "";
  return `
    <section class="stage" data-scene="sendstay">
      ${buttonInkFilter()}
      ${arasoBrandMarkup()}
      ${corner("sendstay")}
      ${sendWorkStageMarkup}
      ${homeCharacter(piggyName)}
      ${cardAnchorMarkup}
      ${recordsCardMarkup()}
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// 출발 모션 — away 진입에서 **한 번만**. 이 함수는 모션만 돌린다.
// 완료 콜백은 「애니메이션이 끝났다」는 뜻이고 거래 완료가 아니다.
function mountAway() {
  // [A-318 교정 3] Home 의 확정 Chog 를 away 에서도 **같은 판 좌표로** 유지한다.
  // 원본 flow.js 의 Send 는 출발 overlay 만 얹고 Chog 는 건드리지 않는다.
  // 도착해 있는 idle 상태로 mount — 시작/도착 모션은 재생하지 않는다(startRect 없음).
  // 모션을 재생하지 않는 재방문·새로고침에서도 Chog 는 있어야 하므로 아래 플래그 검사보다 먼저 한다.
  const chogRoot = document.querySelector("#chogHome");
  const boardFit = fitHomeBoard();
  if (chogRoot && boardFit) {
    homeChog = mountChogHome(chogRoot, {
      startRect: null,
      startSrc: null,
      board: boardFit.rect,
      reduced: prefersReducedMotion(),
      onFrame: (step) => runSceneFrames(step),
      onCleanup: (fn) => onSceneTeardown(fn),
      listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
    });
    onSceneTeardown(() => {
      homeChog = null;
    });
  }
  // 판 다시 맞추기는 아래 `fit()` 이 함께 한다. canvas 가 없는 경우만 여기서 건다.
  const canvas = document.querySelector("#departStage");
  if (!canvas) { sceneListener(window, "resize", () => { fitHomeBoard(); }); return; }

  // 이번 진입에서 재생할 것이 아니면 캔버스를 비워 둔다(재방문·새로고침 재생 0).
  if (!state.departureArrival) return;
  state.departureArrival = false;

  // 이 인스턴스의 표. 씬이 바뀌면 teardownScene 이 sceneToken 을 올려 무효가 된다.
  const token = sceneToken;
  let stopped = false;
  onSceneTeardown(() => {
    stopped = true;
  });

  const fit = () => {
    const s = Math.min(window.innerWidth / 1256, window.innerHeight / 772);
    canvas.width = Math.round(1256 * s * (window.devicePixelRatio || 1));
    canvas.height = Math.round(772 * s * (window.devicePixelRatio || 1));
    canvas.style.width = `${1256 * s}px`;
    canvas.style.height = `${772 * s}px`;
    fitHomeBoard();
  };
  fit();
  sceneListener(window, "resize", fit);

  // reduced-motion 이면 마지막 상태 한 장만. 게이트·문구는 그대로다.
  const reduced = prefersReducedMotion();

  // [A-318 교정 5] 재생 lifecycle 은 모듈이 갖는다. 하네스도 **이 함수**를 시험한다.
  const playback = createDepartPlayback({
    canvas,
    isValid: () => !stopped && token === sceneToken,
    schedule: (step) => runSceneFrames(step),
    reduced,
    onStatus: (st) => {
      // 자산이 없거나 깨졌으면 이번 모션만 접는다. Away 문구·Chog·금융 결과는 그대로.
      if (st.phase === "asset-missing" || st.phase === "asset-error") {
        departAssetsMissing = st.missing;
      }
    },
  });
  onSceneTeardown(() => playback.stop());
  // canvas 크기 대입은 내용을 지운다 — 다시 맞춘 뒤 마지막 시각을 다시 그린다.
  sceneListener(window, "resize", () => playback.redraw());
  playback.start();
}

// [A-633 D] AWAY_RESTORE_CHECKING — reentry_preview.html §3: 기존 Away 장면(Chog 혼자 Home, Piggy 없음) 위에
// 귀환 알람과 **같은** `.chogCheckLine`(자리·글꼴·색) 한 줄만 끼운다 — 새 캐릭터·새 화면 0. 조회 중이
// 아닐 때(state.awayRestore null — 평소 Send 직후 Away)는 지금과 byte-동일한 markup 이다.
// `coming home` 은 여기서 그리지 않는다: 성공 확정은 finishTrip() → 기존 returnArrivalAlarm/귀환 씬이다.
function chogHomeMarkupForAway() {
  let markup = chogHomeMarkup({ padMarkup: homePadMarkup("away") });
  if (state.awayRestore) {
    const line = `<span class="chogCheckLine" id="awayRestoreLine" role="status">${awayRestoreLineMarkup(state.awayRestore)}</span>`;
    markup = markup.replace('<div class="chogHome__hit"', `${line}<div class="chogHome__hit"`);
  }
  return markup;
}

function renderAway() {
  return `
    <section class="stage" data-scene="away">
      <canvas class="departStage" id="departStage" aria-hidden="true"></canvas>
      <div class="homeBoard" id="homeBoard">
        ${chogHomeMarkupForAway()}
      </div>
      ${corner("away")}
      ${
        // [A-415 §4 / A-414-a] 가운데 독립 문구 제거. A-411-i 가 renderReturn 만 비워서
        // Away 에는 "I'll check it." 이 그대로 남아 있었다(Owner 12:24 스크린샷). 이 씬의
        // 체킹은 초그 역할이고 귀환 쪽은 A-415-f 로 발화 자체를 없앴으므로, 여기서도 중앙
        // 카드를 띄우지 않는다 — 다만 금융/실패 상태 문구(state.message/detail 계열)를
        // 지우는 것이 아니라, 이 자리에 있던 awayLine 한 줄만 그리지 않는다.
        ""
      }
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// 확대된 종이 위에 올라가는 것 — 정본 receiptPaper(Receipt.dc.html, A-346)에 **현재 앱의
// 실제 영수증 데이터**를 채운 것이다. 미리보기의 임시 문구("Receipt · 미리보기", 고정
// Honeybun, Unknown 샘플)는 쓰지 않는다. 정본 없는 값은 receipt-paper.js 의 "—" 규칙
// 그대로 둔다(없는 값을 만들지 않는다). finishTrip 은 trip.receipt 가 있을 때만 이 씬으로
// 들어오므로(§main.js finishTrip) 보통 "done" 이지만, receipt 가 비어 있으면 그대로
// "came back empty" 로 뜬다 — 두 상태 다 이 함수 하나로 잰다.
function returnReceiptRows() {
  const receipt = state.receipts[0] || null;
  return receiptPaperMarkup(receiptPaperFields({ receipt, name: displayPiggyName() }));
}

// [A-415-f] Owner 최종합의: 귀환/최종수납씬의 체킹 발화("checking...", A-411-i 가 옮겨
// 놓았던 "초그 옆 체킹")는 문서 수령 전/후 어느 쪽도 남기지 않는다 — returnCheckingLine()
// 자체와 c81c05b 의 "received 뒤에만 삽입" 배선을 전부 걷어냈다. 그 삽입을 완성 정본으로
// 보지 않는다. Second Journey Paper 자신의 "checking…" 상태(receipt-paper.js)는 이
// 카드와 무관한 다른 상태라 건드리지 않는다.
//
// chogHomeMarkup() 이 돌려주는 것은 `.chogHome` 그 자신이다 — place(CORNER_TX,CORNER_TY,
// HOME_SCALE)(chog-home.js) 변환이 이 요소 하나에 걸리므로, 발화를 그 **안**(마지막 자식
// .chogHome__hit 바로 앞)에 끼우면 별도 좌표 계산 없이 캐릭터와 같은 변환을 그대로
// 받는다 — "캐릭터 따라 위치" 요구를 새 산수 없이 만족한다. INK box(chog-home.js 351..
// 548,276..527)보다 오른쪽에 두어 얼굴·몸을 가리지 않는다(스타일은 style.css
// .chogCheckLine, 기존 .notice 노란(var(--gold)) 텍스트 톤 재사용 — 새 그래픽/모션 0).
//
// [A-413 §4 / A-415-f] 이 씬에 남는 유일한 발화 — 작은 노란 "[이름] is coming home"
// 알람. 승인 원본(<private>:10 "0.7–1.8 |
// Alarm: Honeybun is coming back. / Chog만 짧게 반응", 같은 파일 §38 "실제 알림음은
// 확정 자산이 없어 넣지 않음")에서 Alarm 구간의 시각 요소는 이 문구 카드 하나와 Chog의
// 짧은 반응(hop)뿐이다 — 별도 벨/링 그래픽은 canon 에 없다(portal-ring 은 그 뒤
// "Returning" 구간에 Piggy 가 나오는 포털이고 다른 자산·다른 구간이다, piggy-return.js
// stateAt() phase 표). [주의] 위 문장 "별도 벨/링 그래픽은 canon 에 없다"는 A-413
// 당시(그 시점 canon) 기준이다 — Owner 가 그 뒤(2026-09-18 채팅)에 실제 알람 종 그래픽을
// 새로 지시했다(piggy-return.js BELL_* 참고, 그 파일이 그린다). 여기 문장은 그 지시
// 이전 기록이라 갱신하지 않고 그대로 두되(이 발화 span 의 히스토리 문맥은 바뀌지 않았다)
// 이 주석으로 바로잡는다 — [A-415-e 흔적 정리, 다음 main.js 에이전트가 또 헷갈리지 않게].
// Chog 의 반응(hop)은 이미 알람 구간(0.7–2.8s)에 걸려 있다
// (piggy-return.js alertHop → return-view.js placeChog(), 이 파일 범위 밖, 그대로 둔다).
// state.returnArrivalAlarm 은 finishTrip() 이 실제 단수 귀환에서만 세우고, mountReturn()
// 이 이 씬의 표시 생명주기(파일링 완료/씬 이탈)가 끝날 때만 지운다.
//
// [Owner GO, 채팅 2026-09-18] 순서 확정: "알람 표시 → (살짝 늦게) 초그 발화 → 초그
// 들어오기." — 발화(이 span)가 알람 종보다 늦게 떠야 한다. markup 은 mount 시 한 번만
// 만들어지므로(§render()) "늦게 붙이기"는 여기서 span 자체를 `hidden` 으로 먼저 심어
// 두고, mountReturn() 이 sceneTimeout() 으로 그 hidden 만 나중에 벗기는 방식으로 푼다
// (style.css 에 `.chogCheckLine{display:...}` 오버라이드가 없어 `[hidden]` UA 규칙이
// 그대로 먹는다 — style.css 는 이번 dispatch 허용 파일이 아니라 확인만 하고 손대지
// 않았다). 정확한 지연 값·근거는 mountReturn() 주석 참고. received/필드를 기다리지
// 않는다(옛 체킹줄과 달리 "수령 확인" 신호가 필요 없다).
function chogHomeMarkupForReturn(scene) {
  let markup = chogHomeMarkup({ padMarkup: homePadMarkup(scene) });
  if (state.returnArrivalAlarm) {
    const alarm = `<span class="chogCheckLine" id="returnArrivalAlarm" hidden>${escapeHtml(displayPiggyName())} is coming home</span>`;
    markup = markup.replace('<div class="chogHome__hit"', `${alarm}<div class="chogHome__hit"`);
  }
  return markup;
}

// [A-421] 알람 발화의 생명주기 — 아래 mountReturn()(First) 과 mountSecondReturn()(Second,
// §1709 이하) 이 **같은 구현 하나**를 쓴다. Owner 지시("첫 Journey 및 Second Journey 귀환
// 까지 앱 연결")대로 Second 도 같은 축(벨 → 한 박자 뒤 Chog 발화 → Piggy 등장)을 타야
// 하는데, 두 번째 알람 구현/새 문구/새 자산을 만들지 않기 위해 mountReturn() 안에 있던
// 코드를 그대로 이 두 함수로 옮겼다 — 값·순서·주석 근거는 모두 mountReturn() 쪽 원문과
// 동일하다(새 리터럴 0: 지연은 여전히 RETURN_VIEW_GEOMETRY.alarmBell 의 start/fade 에서
// 파생된다).
function beginReturnArrivalAlarm(valid) {
  // [A-413 §4] 안전망 — 이 귀환 씬을 어떤 경로로 떠나든(파일링/실패 폴백/재방문 즉시
  // 이탈) 알람 표는 다음 씬으로 새지 않는다.
  const hadAlarm = !!state.returnArrivalAlarm;
  onSceneTeardown(() => { state.returnArrivalAlarm = false; });
  // [Owner GO, 채팅 2026-09-18] "알람 표시 → (살짝 늦게) 초그 발화 → 초그 들어오기" —
  // chogHomeMarkupForReturn() 이 span 을 `hidden` 으로 심어 두고, 여기서 그 hidden 을
  // 벗기는 시점만 늦춘다. 알람 종(piggy-return.js BELL_START_S=0.7, BELL_FADE_S=0.15 —
  // RETURN_VIEW_GEOMETRY.alarmBell 로 재노출된 원본값)이 다 떠오르는 0.85s 에서 같은
  // 페이드 한 번(0.15s)을 더 기다린 t=1.0s. Piggy 가 보이기 시작하는 t=3.15s
  // (piggyVisible)보다 한참 이르다. reduced-motion 은 재생 시계가 곧장 t=7.0 으로 뛰어
  // 종 자체가 그려지지 않으므로 지연 0 으로 즉시 보여준다.
  if (hadAlarm) {
    const bell = RETURN_VIEW_GEOMETRY.alarmBell; // {start:0.7, fade:0.15, ...}
    const reveal = () => { if (valid()) document.querySelector("#returnArrivalAlarm")?.removeAttribute("hidden"); };
    if (prefersReducedMotion()) reveal();
    else sceneTimeout(reveal, (bell.start + bell.fade * 2) * 1000);
  }
  return hadAlarm;
}

// [A-413 §4 / A-415-f] 파일링(File it) 완료는 return-view.js 소유(onFiled, 그 파일이 재렌더
// 없이 DOM 만 고친다)라 이 파일이 다시 그리지 않는다. 완료를 이 파일 쪽에서 알 방법은
// mountReturnView() 가 돌려주는 `filed` 게터뿐이라, 씬 lifecycle 에 이미 있는
// runSceneFrames() 로 매 프레임 한 번 확인해 알람만 지운다 — 새 폴링 장치 0.
function endReturnArrivalAlarmWhenFiled(hadAlarm, returnView, valid) {
  if (!hadAlarm || !returnView) return;
  runSceneFrames(() => {
    if (!valid()) return false;
    // [A-429 Owner "Receipt 넘기는 순간 꺼짐"] Chog 가 Receipt 를 받는 순간(received)에 끈다 —
    // filed 는 그 뒤라 받는 쪽이 먼저 온다. 둘 다 보는 것은 received 신호를 못 받은 경로 대비.
    if (returnView.received || returnView.filed) {
      document.querySelector("#returnArrivalAlarm")?.remove();
      state.returnArrivalAlarm = false;
      return false;
    }
    return true;
  });
}

// 장면 — 귀환. 화면 바인딩은 `return-view.js` 가 갖는다 —
// 앱과 로컬 검토 하네스가 **같은 것**을 쓰기 위해서다(A-322 교정 7).
// 여기서 넘기는 것은 화면 입력뿐이다. finance 는 이 파일에 남는다.
function renderReturn() {
  return returnSceneMarkup({
    // [A-411-i] 가운데 독립 문구 제거 — 같은 텍스트는 이제 초그 옆 발화만 맡는다.
    // return-view.js #returnLine 은 그대로 두되(그 파일은 이번 수정 범위 밖) 빈 문자열만
    // 넘긴다 — 광역 CSS 로 그 줄 자체를 숨기지 않으므로 다른 필수 상태 문구엔 영향 0.
    line: "",
    receiptRowsMarkup: returnReceiptRows(),
    name: displayPiggyName(),
    homeChogMarkup: chogHomeMarkupForReturn("return"),
    devExtra: isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : "",
  });
}

// 귀환 연출 — `finishTrip` 이 성공 + 실제 영수증을 확인한 **뒤에만** 한 번.
// 이 함수는 돈을 만들지 않는다. 둘째 탭도 저장이 아니라 UI 정리 입력이다.
function mountReturn() {
  const token = sceneToken;
  let stopped = false;
  onSceneTeardown(() => { stopped = true; });
  const valid = () => !stopped && token === sceneToken;

  // 이번 진입에서 재생할 것인지 — transient 표. 새로고침·재방문은 재생 0.
  const play = state.returnArrival;
  state.returnArrival = false;

  // [A-413 §4] 안전망 — 이 return 씬을 어떤 경로로 떠나든(파일링/실패 폴백/재방문 즉시
  // filebox 행) 알람 표는 다음 씬으로 새지 않는다. 정상 경로(파일링 완료)는 아래
  // endReturnArrivalAlarmWhenFiled() 감시가 더 먼저(같은 씬 안에서 DOM만) 지우고 이 값도
  // 같이 비운다 — teardown 은 그 감시가 못 미친 나머지 이탈 경로(에러 폴백/즉시 filebox
  // 등)를 덮는 마지막 안전망이다.
  // [A-421] teardown 등록·hadAlarm 판독·발화 지연 공개는 beginReturnArrivalAlarm() 한
  // 군데로 모았다(Second 와 같은 구현). 순서·값 변화 0.

  // [A-413 §4 / A-415-f] 알람 발화가 이번 진입에 실제로 붙었는지 — "파일링이 끝나면 같은
  // 씬 안에서 곧장 지운다"는 규율. 체킹 발화(hadCheckLine/insertCheckLine, A-411-i~A-415)는
  // Owner 최종합의로 완전히 걷어냈다 — 수령 전/후 어느 쪽도 "checking..." 을 남기지 않는다.
  const hadAlarm = beginReturnArrivalAlarm(valid);

  let errored = false;
  const returnView = mountReturnView({
    isValid: valid,
    schedule: (step) => runSceneFrames(step),
    listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
    onCleanup: (fn) => onSceneTeardown(fn),
    fitBoard: () => fitHomeBoard(),
    mountHomeChog: (chogRoot, o) => {
      homeChog = mountChogHome(chogRoot, {
        startRect: null, startSrc: null, board: o.board,
        reduced: prefersReducedMotion(),
        // [A-359 §3] 귀환 씬의 공통 카드 자리는 처음부터 끝까지 Receipt 몫이다
        // (piggy-return.js anchorCenter — 같은 뷰포트 중앙-32/-48 자리). Home 노트패드가
        // 이 씬에서 Chog 탭으로 열려도 그 자리에 도킹하지 않는다 — 한 자리 한 카드.
        cardClaimed: true,
        onFrame: (step) => runSceneFrames(step),
        onCleanup: (fn) => onSceneTeardown(fn),
        listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
      });
      return homeChog;
    },
    reduced: prefersReducedMotion(),
    play,
    // [A-466] 첫 결과에서는 숨기고, 그 뒤 Return 부터 보인다.
    allowSkip: state.resultMotionSeen === true,
    // 사용자가 명시적으로 눌렀을 때만 기존 파일함(실제 Receipt 읽기)으로 간다.
    // 파일 정리가 끝났다고 자동으로 옛 화면으로 넘어가지 않는다(A-322 교정 3).
    onOpenFilebox: () => { if (valid()) setScene("filebox"); },
    // 자산 실패 — graceful fallback **한 번만**(A-322 교정 4).
    onError: (st) => {
      if (errored || !valid()) return;
      errored = true;
      returnAssetsMissing = st.missing;
      setScene("filebox");
    },
    // 재방문·새로고침 진입 — 저장된 Receipt 로 바로 간다.
    // raw setTimeout 이 아니라 씬 lifecycle 에 등록된 타이머다(A-322 교정 5).
    onIdleEnter: () => { sceneTimeout(() => { if (valid()) setScene("filebox"); }, 0); },
  });

  // [A-421] 파일링 완료 시 알람 제거 — Second 와 같은 구현 하나
  // (endReturnArrivalAlarmWhenFiled, §3669 이하). 동작 변화 0.
  endReturnArrivalAlarmWhenFiled(hadAlarm, returnView, valid);
}

// [A-383] filebox 는 First/Second Journey 의 귀환 직후 화면(mountReturn onOpenFilebox/
// onError, DEV 씬점프)에서만 온다 — 이번 회차는 이 흐름을 바꾸지 않는다(§5). 전체
// 기록목록/기록카드는 이제 Home 카드 오른쪽 기록 카드(recordsCardMarkup 이하)로
// 옮겨갔으므로 여기의 옛 "all records" 지름길(구 records 전체화면)은 없앴다 — 목적지
// 화면 자체가 없어졌기 때문이다. 남는 것은 "home" 복귀뿐이다.
//
// [A-381 §1/§2] Owner 가 거부한 옛 껍질(겹친 folder--1/2/3 + tape/tag + filebox 큰외곽
// border + filebox 전용 corner 장식(피기 대역))은 전부 뺐다 — 새 자산 0, 승인된
// receiptPaperMarkup + 실제데이터만 기존 공통카드 자리(filebox__paper)에서 그대로 연다.
// 기록이 없거나(state.receipts 비었거나) receiptIndex 가 가리키는 실제 receipt 가 없으면
// (예: 빈 배열에 index 0, 지운 적 없는데 범위 밖) 빈 Unknown 영수증을 합성하지 않는다 —
// 이 경로는 방어적 예외 상태라 다음 render() 에서 바로 Home 으로 되돌린다(옛 records
// 전체화면 폴백은 그 화면 자체가 없어져 더 이상 쓸 수 없다).
function renderFileBox() {
  // 최신이 0번(내림차순 저장). state.receiptIndex 는 여기서 새로 계산하거나 저장하지
  // 않는다(읽기 전용 진입, §3 "반복탭이 새로 저장하지 않게").
  const receipt = state.receipts[state.receiptIndex] ?? null;
  if (!receipt) {
    queueMicrotask(() => setScene("sendstay", "Piggy is home.", ""));
    return `<section class="stage" data-scene="filebox"></section>`;
  }
  const rows = receiptRows(receipt);
  const rowsMarkup = rows
    .map(
      (row) =>
        `<p class="receipt-row"><span class="label">${row.label}</span><span class="value">${row.value}</span></p>`,
    )
    .join("");
  // [A-346] 귀환 두 번째 탭에서 정착한 것과 **같은 종이**(receipt-paper.js)를 여기서도 쓴다 —
  // 파일 정리 뒤에도 같은 영수증이 이어져 보이게. 아래 Sent/Cost/Left/Tx/Block 상세 증거줄은
  // 지우지 않고 그대로 둔다(§2 「읽기상세에 보존」) — 이 종이는 그 요약일 뿐이다.
  const paperMarkup = receiptPaperMarkup(receiptPaperFields({ receipt, name: displayPiggyName() }));
  return `
    <section class="stage" data-scene="filebox">
      <article class="filebox">
        <div class="filebox__paper">${paperMarkup}</div>
        <div class="receipt">${rowsMarkup}${receiptCheck(receipt)}</div>
      </article>
      <!-- [A-360 §3] filebox 에는 다음 진입이 없었다 — Home 복귀와 Explore 진입을
           연결하는 첫 걸음. Home 에 도착한 뒤 Chog 탭이 Explore 를 연다. -->
      <button class="tiny home" id="fileboxHomeButton" type="button">home</button>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// [A-383 §1/§2/§4 → A-387 교정] Home 카드 오른쪽에 펼치는 기록 카드 — 별도 records
// 전체화면 대신 같은 sendstay 렌더 안에 늘 그려 두고(hidden) recordsCardVisible 로만
// 보인다. 바탕은 HomeNotepad/현재 home-paper 종이(#EBE3D5 + paper_tex_ivory.png,
// radius 3, 그림자 0 14px 30px — .homePaper 와 같은 값, style.css)를 그대로 쓴다. 검정
// .note 패널·노란 RECEIPTS 제목(옛 renderRecords(), Owner FAIL)은 쓰지 않는다. [A-387]
// 크기는 더 이상 여기 상수로 미리 계산하지 않는다 — Codex 실화면검토가 "공통 Send
// 앵커(285×364)가 곧 Home 종이" 가정이 실측과 다르다고 밝혀서(실측 x695,y350,w136,
// h185), alignRecordsCardToHomePaper() 가 실제 `.homePaper` rect 를 그대로 물려받는다
// (아래). 간격만 이 상수를 유지한다.
const RECORDS_CARD_GAP = 24;

// [A-411] Owner "두 카드 열릴 때 묶음 왼쪽 이동" — 감독 실측(1335×717, A-410-a)에서
// 기록 카드 우하단이 Piggy 왼쪽 귀와 겹친다. 캐릭터 좌표는 그대로 두고(금지) 카드 두 장만
// 옮긴다. 최소 이동량은 실측 + 코드 상수에서 역산했다(화면 실행으로 잰 값이 아니라 기하
// 계산 — 이 회차 재검토는 브라우저를 새로 못 띄운다):
//   · 기록 카드 우측단(실측) = 787.664 + 256.336 = 1044.000
//   · Piggy 왼쪽 귀 bbox 는 seat.svg 원본 path(1056×1102 로컬)에서 좌상단 귀 조각만
//     추출(minX 306.726/minY 17.815/maxX 468.426/maxY 253.008) → main.js layoutHomeCharacter()
//     의 HOME_SEAT_W/HOME_SEAT_L/HOME_FLOOR·HOME_SEAT_FOOT로 Home 판(1256×772) 좌표로,
//     다시 fitHomeBoard() 의 s(=717/772, 감독 뷰포트 1335×717 고정폭 가정)·boardLeft 로
//     뷰포트 px 로 환산(같은 s·boardLeft 를 chog-home.js CORNER_TX/CORNER_TY·HOME_SCALE
//     로 역산한 감독 Chog hit 실측(868.653/491.980/86.220/109.854)과 대조해 s=0.928752,
//     boardLeft=84.24 로 교차검증 — 오차 <0.01px).
//     → 귀 좌측단 ≈ x1022.010, 귀 하단 ≈ y490.094(귀 상단 y459.067) — 기록 카드 y구간
//     (128.492–492.492) 안에 완전히 들어가 y는 항상 겹친다.
//   · 최소 이동량 = 기록카드 우측단 − (귀 좌측단 − 안전간격24) = 1044.000 − (1022.010−24)
//     = 45.99px → 46px 로 올림(반올림 여유로 24px 안전간격을 항상 채운다).
// 이 46px 는 실제 화면(뷰포트) px 목표값이다 — RECORDS_CARD_GAP 과 같은 성격(고정 px).
const HOME_TWO_CARD_SHIFT_VIEWPORT_PX = 46;

// [A-607 REWORK — SUPERSEDED, kept unused rather than deleted] this whole mechanism only
// ever existed to dodge the OLD records-card position (to the right of `.homePaper`, see
// style.css `.recordsCardAnchor`'s own history comment). Records is now a fixed left-rail
// anchor with no spatial relationship to `.homePaper` at all, so there is nothing left for
// this shift to dodge — no call site remains (`openRecordsCard()`/`closeRecordsCard()` no
// longer call `setHomeTwoCardShift()`). Left defined only so a revert doesn't need to
// reconstruct this math from scratch.
// 카드 두 장(홈 종이+기록 카드)만 왼쪽으로 옮긴다 — 캐릭터(Chog/Piggy)는 손대지 않는다.
// `.homePaperMount` 는 chog-home.js mount() 가 한 번 left/top/width/height 를 인라인으로
// 앉히기만 하고 transform 은 건드리지 않는 요소라, 여기서 transform 을 얹어도 draw() 의
// 매 프레임 pad.style.transform(부모 #chogHomePad) 과 겹치지 않는다(서로 다른 요소·다른
// 자식 체인) — 단 `.homePaperMount` 자신은 그 부모 pad 의 scale(finalScale) **안쪽**이라
// 여기 넣는 translateX 는 뷰포트px 가 아니라 로컬px 다. chog-home.js 의 도킹 완료 상태
// (anchorBlend=1, sharedCardPadTarget().scale 그대로)에서는
//   pad.finalScale × chogHome.HOME_SCALE × homeBoard.s
//     = finalPaperScale / PAPER_BASE_SCALE  (s 가 분모·분자에 한 번씩 있어 상쇄, 뷰포트
//       크기 무관하게 고정)
// 이고, finalPaperScale = min(CARD_ANCHOR_W/PAPER_W, CARD_ANCHOR_H/PAPER_H) = min(285/400,
// 364/568) = 364/568(세로 기준) — chog-home.js mountChogHome() 안의 그 상수들 그대로다
// (정본값이라 여기서 다시 바꾸지 않는다 — 바뀌면 이 비율도 같이 바뀌어야 한다는 뜻).
// 그래서 로컬px = −목표뷰포트px ÷ (finalPaperScale/PAPER_BASE_SCALE) 로 계산해 CSS 변수로
// 넘긴다 — 매직넘버를 두 파일에 따로 박지 않는다.
const HOME_PAPER_DOCK_RATIO = Math.min(285 / 400, 364 / 568) / 0.275; // ≈2.330346
const HOME_TWO_CARD_SHIFT_LOCAL_PX = -(HOME_TWO_CARD_SHIFT_VIEWPORT_PX / HOME_PAPER_DOCK_RATIO); // ≈-19.74

function setHomeTwoCardShift(active) {
  const mount = document.querySelector(".homePaperMount");
  if (!mount) return;
  mount.style.setProperty("--twoCardShiftLocalPx", `${HOME_TWO_CARD_SHIFT_LOCAL_PX}px`);
  mount.classList.toggle("homePaperMount--twoCardShift", Boolean(active));
}

// [A-459 Lane C] 오른쪽 HISTORY 종이 머리 — Explore(secondJourney) masthead 와 같은 paper
// language 를 재사용한다. 날짜/요일 문자열 생성은 second-journey-view.js mastheadMarkup() 과
// 같은 방식(en-US long month/day + weekday, 대문자)이고, 폰트/자간 수치는 style.css 에서
// 기존 .secondJourney__masthead / .secondJourney__date 룰에 records 선택자를 덧붙여 **같은 값을
// 공유**한다 — 새 수치 발명 0.
// identity 는 목록 맨 위에 한 번만: Piggy 이름 + 자기 address. 새 라벨 copy 0(값만 조용히).
// Job 행마다 주소를 반복하지 않는다. Send 카드 주소 0 은 그대로(A-454).
function recordsMastheadMarkup() {
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase();
  const weekdayLabel = today.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  // [A-485 Lane A] 머리글의 이름은 **지금 보고 있는 기록의 주인**이다.
  // 전체 경로면 지금까지처럼 현재 Piggy 이름이 나온다.
  const name = historyIdentityName();
  // 주소가 아직 없으면(무계정 DEV 등) 줄 자체를 비운다 — 가짜 값 0.
  // 특정 Piggy 를 보고 있을 때는 **그 Piggy 가 아닌 주소를 빌려 쓰지 않는다**.
  const address = state.historyPiggyId ? "" : (typeof state.address === "string" ? state.address : "");
  const identityMarkup = `
        <p class="recordsCard__identity">
          <span class="recordsCard__identityName">${escapeHtml(name)}</span>
          ${address ? `<span class="recordsCard__identityAddress">${escapeHtml(address)}</span>` : ""}
        </p>`;
  return `
      <div class="recordsCard__masthead">
        <span class="recordsCard__dot" aria-hidden="true"></span>
        <span class="recordsCard__date">${escapeHtml(dateLabel)}<small>${escapeHtml(weekdayLabel)}</small></span>
        <span class="recordsCard__page" aria-hidden="true"></span>
      </div>
      <p class="recordsCard__tier">HISTORY</p>${identityMarkup}`;
}

// [A-485 Lane A] 지금 오른쪽 종이가 보여줄 기록 줄들. 고른 Piggy 가 레지스트리에서
// 사라졌으면 **다른 Piggy 를 대신 보여주지 않고** 전체 경로로 되돌린다.
function historyRows() {
  // 전체 경로는 **새 코드에 전혀 기대지 않는다** — 레지스트리도 필터도 부르지 않는다.
  // 그래야 First/Second 의 기존 동작이 바뀌지 않았음이 증명 가능하다.
  if (!state.historyPiggyId) return state.receipts.map((receipt, index) => ({ receipt, index }));
  const piggies = secondPiggyRegistrySnapshot().piggies;
  const resolved = resolveHistorySelection(state.historyPiggyId, piggies);
  if (resolved !== state.historyPiggyId) state.historyPiggyId = resolved;
  return filterHistory(state.receipts, resolved).rows;
}

// 오른쪽 종이 머리글의 정체성 — 이름을 모르면 지어내지 않는다.
function historyIdentityName() {
  if (!state.historyPiggyId) return displayPiggyName();
  // [A-551] 재정 레지스트리(secondPiggyRegistrySnapshot)만으로는 이름을 못 찾는다 — 추가
  // Piggy 는 createPiggy() 가 name 을 절대 안 받기 때문이다(이름은 renameIndexedPiggy() 로
  // MY PIGGIES 색인에만 쓰인다). moneyPiggiesSnapshot() 은 그 색인을 **정확히 같은 id** 로
  // 병합해 이미 MY MONEY 행 선택(applyPiggySelection 호출부)이 쓰는 것과 같은 이름을 준다 —
  // 다른 매칭 방식(자리·주소 유사)을 새로 만들지 않는다. 못 찾으면 여전히 id 그대로(폴백).
  const piggies = moneyPiggiesSnapshot().piggies;
  return historyIdentityLabel({ piggyId: state.historyPiggyId, piggies, fallbackName: displayPiggyName() });
}

function recordsCardListMarkup() {
  const name = displayPiggyName();
  const receipts = historyRows();
  if (!receipts.length) {
    // §4 "무기록은 같은 종이에 짧은 빈 상태만, 합성 Unknown receipt 생성 금지".
    // [A-459] 기록이 없어도 같은 identity/masthead 껍데기는 보인다 — 가짜 receipt 0.
    return `
      ${recordsMastheadMarkup()}
      <div class="recordsCard__panel recordsCard__panel--empty">
        <p class="recordsCard__empty">No records yet. They'll show up here after a real trip.</p>
      </div>
      <button class="recordsCard__close" id="recordsCardClose" type="button">close</button>
    `;
  }
  // [A-460 Owner] 기록 보기는 **텍스트 전용**이다 — folder-back/front 그림과 recordsFolder slip
  // 미리보기를 HISTORY 경로에서 걷어냈다(그 그림들은 piggy-return 캔버스 연출에만 남는다).
  // 데이터는 전과 같이 **전부** 보관·열람 가능하고, 최근 기록이 위다. 미리보기 3장 규칙은
  // folder 그림에 딸린 표시 규칙이었으므로 함께 사라진다 — 그래서 캡션도 보관 수만 말한다.
  // [A-485 Lane A] 고른 Piggy 가 있으면 그 기록만. 없으면 지금까지의 전체 동작 그대로.
  // 원래 인덱스를 그대로 실어 보내 상세 보기가 어긋나지 않게 한다.
  const rowsMarkup = historyRows()
    .map(({ receipt, index }) => {
      const fields = receiptPaperFields({ receipt, name });
      return `
        <button class="recordsCard__row" type="button" data-receipt-index="${index}">
          <span class="recordsCard__rowDate">${escapeHtml(fields.date)}</span>
          <span class="recordsCard__rowStatus">&gt; ${escapeHtml(fields.statusLabel)}</span>
        </button>
      `;
    })
    .join("");
  return `
    ${recordsMastheadMarkup()}
    <div class="recordsCard__panel recordsCard__panel--list">
      <div class="recordsCard__list">${rowsMarkup}</div>
      <p class="recordsCard__caption">kept ${receipts.length}</p>
    </div>
    <button class="recordsCard__close" id="recordsCardClose" type="button">close</button>
  `;
}

// 선택한 영수증 상세 — 같은 카드 영역에서 목록을 대체한다(§4). filebox 와 같은
// [A-460 으로 갱신] 예전에는 filebox 와 같은 receiptPaperMarkup(종이 그림)을 함께 썼으나,
// 이제 HISTORY 상세는 텍스트만 쓴다. receiptRows/receiptCheck 는 그대로다(재디자인 0).
function recordsCardDetailMarkup(index) {
  const receipt = state.receipts[index] ?? null;
  if (!receipt) return recordsCardListMarkup();
  const name = displayPiggyName();
  // [A-460 Owner] Receipt 종이(receiptPaperMarkup) 그림을 재사용하지 않는다 — 같은 오른쪽
  // 종이 안에서 **텍스트 상세**로 교체한다. 보여주는 값은 이미 화면에 있던 것과 같다:
  // receiptPaperFields 의 사람 말 요약 + 기존 receiptRows/receiptCheck. 내부 tx/raw 정보를
  // 여기서 새로 넓히지 않는다(현재 user-facing 경계 유지).
  const fields = receiptPaperFields({ receipt, name });
  const summary = [
    ["went out", fields.wentOut],
    ["came back", fields.cameBack],
    ["kept", fields.kept],
  ]
    .map(
      ([label, value]) =>
        `<p class="receipt-row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></p>`,
    )
    .join("");
  const rowsMarkup = receiptRows(receipt)
    .map(
      (row) =>
        `<p class="receipt-row"><span class="label">${row.label}</span><span class="value">${row.value}</span></p>`,
    )
    .join("");
  return `
    ${recordsMastheadMarkup()}
    <div class="recordsCard__panel recordsCard__panel--detail">
      <p class="recordsCard__detailHead">
        <span class="recordsCard__rowDate">${escapeHtml(fields.date)}</span>
        <span class="recordsCard__rowStatus">&gt; ${escapeHtml(fields.statusLabel)}</span>
      </p>
      <div class="recordsCard__detailRows">${summary}${rowsMarkup}${receiptCheck(receipt)}</div>
    </div>
    <button class="recordsCard__back" id="recordsCardBack" type="button">back to list</button>
    <button class="recordsCard__close" id="recordsCardClose" type="button">close</button>
  `;
}

function recordsCardBodyMarkup() {
  return state.recordsDetailIndex == null
    ? recordsCardListMarkup()
    : recordsCardDetailMarkup(state.recordsDetailIndex);
}

// openRecordsCard()/showRecordDetail()/showRecordsList() 가 render() 를 다시 부르지 않고
// 이 함수로 카드 내용만 바꾼다 — Home 카드(chogHome pinned 상태)를 건드리지 않는다.
function renderRecordsCardBody() {
  const body = document.querySelector("#recordsCardBody");
  if (body) body.innerHTML = recordsCardBodyMarkup();
}

// [A-383 §3 → A-607 REWORK] used to sit right of the hand-pinned `.homePaper`, gap-derived
// (see style.css `.recordsCardAnchor` comment for the full history). Now a fixed left-rail
// anchor (285×364, CSS-only position) — `renderRecordsCardMarkup()`'s own JS adds nothing
// but the `hidden` toggle; no rect math needed any more (`alignRecordsCardToHomePaper()`
// below is superseded, kept only as a disclosed dead function). The `__peek` div is the
// OWNER ADDENDUM's rear/peeked paper — same 285×364 footprint (parent's own size, `width:
// 100%; height:100%`), depth via CSS offset/z-index only (no size reduction). Always
// rendered (matches the foreground card's own always-in-DOM/hidden convention) so it hides
// automatically via `.recordsCardAnchor[hidden]` — no separate visibility state needed.
function recordsCardMarkup() {
  return `
    <div class="recordsCardAnchor" id="recordsCardAnchor" ${state.recordsCardVisible ? "" : "hidden"}>
      <div class="recordsCardAnchor__peek" aria-hidden="true"></div>
      <div class="recordsCard" id="recordsCard">
        <div class="recordsCard__body" id="recordsCardBody">${
          state.recordsCardVisible ? recordsCardBodyMarkup() : ""
        }</div>
      </div>
    </div>
  `;
}

// [A-387] Codex 실화면검토(Chrome 127.0.0.1:5173, 1335×717) FAIL 교정 — 옛
// fitRecordsCard() 는 "공통 Send 앵커(.cardAnchor, 중앙 -32/-48, 285×364)가 곧 실제
// Home 종이"라고 가정했다. 실측은 달랐다: 실제 `.homePaper` 는 x695,y350,w136,h185인데
// 그 가정으로 그린 기록 카드는 x802,y129,w256,h364 — Home 위에 부분 겹치고 크기·높이도
// 다르다(전체 PASS 아님). 이 함수는 그 가정을 버리고 열려 있는 실제 `.homePaper` DOM
// 요소의 getBoundingClientRect() 를 그대로 읽어 기록 카드를 그 오른쪽·같은 top·같은
// 크기·24px 간격(RECORDS_CARD_GAP)으로 맞춘다. Home 종이는 chog-home.js draw() 가 매
// 프레임 pad.style.transform 을 직접 쓰는 손끝-도킹 애니메이션이라(그 파일은 allowlist
// 밖이라 고치지 않고 읽기만 확인했다) 고정 CSS 식으로 흉내낼 수 없다 — 그래서 열려
// 있는 동안은 실측을 계속 반복한다(아래 startRecordsAlignLoop). 종이 자체가 이미 작은
// 화면에서 줄어든 실측 크기를 그대로 물려받으므로, 기록 카드만 따로 등축 축소하던 옛
// --recordsShrink 계산은 더 이상 필요하지 않다(같은 값을 두 번 줄이지 않는다).
// [A-607 REWORK — briefly superseded, RE-ACTIVATED for web by A-608 OWNER CORRECTION —
// FREEZE ALL WEB, MOBILE-ONLY LAYOUT CHANGES, 2026-09-27] "Records left-rail rebuild and
// 285×364 anchor on web" is one of that correction's own named revert candidates —
// "Home+Records web is also reference/frozen." So this function is real again, but ONLY at
// web widths — at ≤640px this now defers entirely to stackMobileRecordsOverHome() (below;
// [A-621] it replaced A-618's fitMobileTwoPaperGroup() side-by-side group-fit).
// [A-618, 2026-09-28] The old ≤640px branch here used to no-op and let style.css's fixed
// left-rail/285×364 `.recordsCardAnchor` rule (A-607 STEP-22) take over. That rule and the
// mobile `.recordsCardAnchor__peek`/`--opening` overrides are removed below (A-618 card §7,
// A-616's own RECORDS_TARGET.md names the left-rail rule as superseded drift) — mobile now
// gets its geometry the same way web already does here: live-measured, inline left/top/
// width/height, just via a different formula (group-fit, not a single live `.homePaper` rect
// — A-616's own measured-fit-conflict STOP found the live `.homePaper` rect already wider
// than the mobile viewport and partially off-screen, so it cannot be the size reference at
// ≤640px — see fitMobileTwoPaperGroup()'s own comment). [A-621] that premise ended with A-620's
// sharedCardPadTarget() repair: the live mobile `.homePaper` rect is now the corrected in-frame
// HOME, and the mobile branch reads it again (stackMobileRecordsOverHome()).
function alignRecordsCardToHomePaper() {
  const anchor = document.querySelector("#recordsCardAnchor");
  if (!anchor) return;
  // [A-623] shift/inert follow the CURRENT breakpoint before the live `.homePaper` is measured.
  syncRecordsViewportState();
  if (window.innerWidth <= 640) {
    stackMobileRecordsOverHome();
    return;
  }
  const stage = document.querySelector('.stage[data-scene="sendstay"]');
  const paper = document.querySelector(".homePaper");
  if (!stage || !paper) return;
  const paperRect = paper.getBoundingClientRect();
  if (!paperRect.width || !paperRect.height) return;
  const stageRect = stage.getBoundingClientRect();
  const left = paperRect.right - stageRect.left + RECORDS_CARD_GAP;
  const top = paperRect.top - stageRect.top;
  anchor.style.left = `${left}px`;
  anchor.style.top = `${top}px`;
  anchor.style.width = `${paperRect.width}px`;
  anchor.style.height = `${paperRect.height}px`;
}

// [A-621 OWNER CONFIRMED · MOBILE RECORDS STACK, 2026-09-28 — Candidate B] supersedes the
// A-618 mobile side-by-side two-paper group-fit (computeMobileSafeFrame/
// computeTwoPaperGroupFit/rectsOverlap/fitMobileTwoPaperGroup/restoreMobileTwoPaperGroup and
// the runtime `.homeTwoPaperFrame` proxy that re-parented/re-scaled `#homePaper` — all removed;
// A-618 stays as failure history: A-620 measured its text at 4.5–7.8px and its controls at
// ~15×8px, unusable at phone scale). Since A-620's sharedCardPadTarget() parent-frame repair
// (chog-home.js), the live `.homePaper` rect at ≤640px IS the corrected, in-frame, readable
// HOME (256.338×364 at 390/430, same size as web) — so, exactly like the web branch above,
// HISTORY is derived from that live rect and HOME itself is never touched:
//   - same outer size as HOME (live `.homePaper` width/height),
//   - same top as HOME,
//   - right edge on the mobile safe rail (`innerWidth − --mobile-inset`), so HISTORY stacks
//     OVER HOME from viewer-right and HOME's viewer-left edge stays deliberately visible
//     (edge width = HISTORY.left − HOME.left; never negative — clamped to HOME.left),
//   - z-order above HOME and entry/exit direction = style.css ≤640px rules
//     (`.recordsCardAnchor` z-index, `--opening`/`--closing` translateX(+12px)).
// One formula at every ≤640px width — no 390/430 constants. HISTORY content renders at
// native size (`.recordsCard` inset:0, no `--recordsShrink`), same as web.
function stackMobileRecordsOverHome() {
  const anchor = document.querySelector("#recordsCardAnchor");
  const stage = document.querySelector('.stage[data-scene="sendstay"]');
  const paper = document.querySelector(".homePaper");
  if (!anchor || !stage || !paper) return;
  const paperRect = paper.getBoundingClientRect();
  if (!paperRect.width || !paperRect.height) return;
  const stageRect = stage.getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-inset")) || 24;
  const left = Math.max(paperRect.left, window.innerWidth - inset - paperRect.width);
  anchor.style.left = `${left - stageRect.left}px`;
  anchor.style.top = `${paperRect.top - stageRect.top}px`;
  anchor.style.width = `${paperRect.width}px`;
  anchor.style.height = `${paperRect.height}px`;
}

// 기록 카드가 열려 있는 동안 실제 Home 종이를 계속 따라간다(리사이즈·도킹 애니메이션·
// 등축 축소 전부 이 하나로 커버된다 — 개별 이벤트를 추측해 걸지 않는다). closeRecordsCard()
// 또는 다음 setScene() 이 stopRecordsAlignLoop() 로 반드시 멈춘다.
let recordsAlignFrame = 0;

function startRecordsAlignLoop() {
  stopRecordsAlignLoop();
  const tick = () => {
    alignRecordsCardToHomePaper();
    recordsAlignFrame = requestAnimationFrame(tick);
  };
  recordsAlignFrame = requestAnimationFrame(tick);
}

function stopRecordsAlignLoop() {
  if (recordsAlignFrame) cancelAnimationFrame(recordsAlignFrame);
  recordsAlignFrame = 0;
}

// [A-628 A] 전체 다시그리기의 불변식 — render() 는 teardownScene() 으로 Home/Chog 를 통째로 새로
// 마운트하고, 새 mountChogHome() 은 Home 종이를 progress 0(손끝 크기로 접힘)에서 시작한다. 그런데
// HISTORY 열림(recordsCardVisible)·상세(recordsDetailIndex)·정렬 루프는 setScene() 만 닫고 있었다 —
// render() 를 직접 부르는 길(예: +Piggy onAdd `beginAddPiggy().then/catch(render)`)에서는 HISTORY 가
// 열린 채 그 접힌 종이 rect 를 따라가 손끝 크기로 남고 close·Chog 둘 다 닿지 않았다(A-626 관측,
// A-628 pre 실측 390 4.8×6.9 / 1440 10.7×15.2). 그래서 모든 전체 render() 가 옛 DOM 을 치우기
// **전에** 이 하나로 HISTORY 를 닫힌 상태로 되돌린다. setScene() 도 같은 헬퍼를 부른다.
// render() 를 부르지 않는 HISTORY 동작(openRecordsCard/showRecordDetail/showRecordsList/정체성
// 전환 — renderRecordsCardBody()/정렬만)은 이 경로를 지나지 않으므로 그대로 열려 있다.
// 새 상태·저장 키·문구 0. 여러 번 불러도 같은 결과(idempotent).
function resetRecordsForFullRender() {
  state.recordsCardVisible = false;
  state.recordsDetailIndex = null;
  stopRecordsAlignLoop();
}

function render() {
  resetRecordsForFullRender();
  teardownScene();
  // [A-633 A] 잠긴 동안은 목적지 대신 LOGIN_CHECKING(또는 해제 실패 카드)만 — 목적지 mount·1회용 표 소비 0.
  if (state.appLock) {
    renderAppLock();
    return;
  }
  const markup =
    state.scene === "received"
      ? renderReceived()
      : state.scene === "hatch"
        ? renderHatch()
        : state.scene === "name"
          ? renderName()
      : state.scene === "sendstay"
      ? renderSendStay()
      : state.scene === "away"
        ? renderAway()
      : state.scene === "return"
        ? renderReturn()
        : state.scene === "filebox"
          ? renderFileBox()
          : state.scene === "explore"
            ? renderExplore()
            : state.scene === "secondAway"
              ? renderSecondAway()
              : state.scene === "secondReturn"
                ? renderSecondReturn()
                : renderAuthCard();
  // 장면이 바뀌면 Invite 의 예약된 단계 전환은 전부 버린다 — 화면이 없는데 타이머만 남으면
  // 엉뚱한 시점에 Birth 로 넘어간다.
  if (state.scene !== "received") clearInviteTimers();
  app.innerHTML = markup;

  document.querySelector("#inviteFaceButton")?.addEventListener("click", openInvite);
  if (state.scene === "received") {
    fitInvite();
    mountInviteChog();
  }
  // [A-391 / A-391-a] 승인 인증실패 카드(birth)의 옆 Chog — Invite/Hatch 와 똑같이
  // mountInviteChog() 를 그대로 불러 [data-chog-invite] 를 붙인다. 새 mount 로직 0.
  if (state.scene === "birth") mountInviteChog();
  // [A-389 §2] Try again → 정본 Invite/Face ID 화면(즉시 새 패스키 생성 0 — 사용자가
  // 다시 탭해야 startPiggyOpen() 이 돈다). Check Piggy → 기존 복구(checkPiggy, 생성 폴백 0).
  document.querySelector("#authTryAgainButton")?.addEventListener("click", () => setScene("received", "", ""));
  document.querySelector("#checkButton")?.addEventListener("click", checkPiggy);
  document.querySelector("#skipHatchButton")?.addEventListener("click", finishHatch, { once: true });
  document.querySelector("#nameForm")?.addEventListener("submit", savePiggyName);
  document.querySelector("#sendButton")?.addEventListener("click", sendPiggy);
  // [A-441] 렌더마다 다시 붙는 버튼도 진행 중·미확정이면 잠긴 채로 그린다.
  syncSendButton();
  document.querySelector("#stayButton")?.addEventListener("click", stayHome);
  document.querySelector("#fileboxHomeButton")?.addEventListener("click", goHomeFromFilebox);
  // [A-411-p] "next errand" 버튼 제거.
  // [A-411-r] Second Journey 진입은 settle() 자동전개뿐이다 — Chog 탭(onTap)은 다시
  // 원래 HOME 패드를 여닫을 뿐, Explore 직행이 아니다(위 homePadMarkup/mountHome 주석).
  // [A-383 §1] Home 카드 오른쪽 기록 카드 — 별도 화면 전환 없이 같은 sendstay DOM 안에서
  // 열림/목록/상세/닫힘을 전부 위임 클릭 하나로 배선한다(카드 내용은 render() 를 다시
  // 부르지 않고 renderRecordsCardBody() 가 innerHTML 만 바꾸므로, 매번 다시 부를 필요가
  // 없다 — 이 델리게이션은 이번 sendstay 마운트 동안 계속 유효하다).
  // A-419: records clicks are delegated through the stable Home mount below.
  // [A-412 §1] Money/Piggy 상세 내부 전환 — `.homePaperMount` 는 render() 를 다시 부르지
  // 않는 내부 갱신(refreshHomePaperMount)에도 살아남는 안정된 노드라 위임 클릭 하나로
  // 충분하다(§recordsCard 와 같은 자리 규율, 바로 아래 리스너 참고).
  document.querySelector(".homePaperMount")?.addEventListener("click", handleHomePaperMountClick);
  document.querySelector("#recordsCard")?.addEventListener("click", (event) => {
    if (event.target.closest("#recordsCardClose")) {
      closeRecordsCard();
      return;
    }
    if (event.target.closest("#recordsCardBack")) {
      showRecordsList();
      return;
    }
    const row = event.target.closest(".recordsCard__row");
    if (row) showRecordDetail(row.dataset.receiptIndex);
  });
  if (isDevDebugOptIn()) {
    document.querySelector("#resetButton")?.addEventListener("click", resetLocalTest);
  }

  // 씬이 실제로 DOM 에 올라간 뒤에 모션을 건다. 여기서 건 RAF·타이머·리스너는
  // 전부 sceneCleanups 에 등록되고, 다음 render() 의 teardownScene() 이 푼다.
  if (state.scene === "hatch" || state.scene === "name" || state.scene === "sendstay") {
    linkMotionCss();
  }
  if (state.scene === "hatch") mountHatch();
  if (state.scene === "name") mountName();
  if (state.scene === "sendstay") {
    mountHome();
    mountSendCardWorkPose();
  }
  if (state.scene === "away") mountAway();
  if (state.scene === "return") mountReturn();
  // [A-360] explore 는 mountHome() 을 카드 자리 고정(cardClaimed:true)으로 재사용한다
  // (걷기 없는 정착 경로 그대로) — 그 뒤에 Second Journey 카드 버튼을 배선한다.
  if (state.scene === "explore") {
    mountHome({ cardClaimed: true });
    wireExploreCard();
    // [A-431 Owner "선택할 때까지 Piggy 는 올려다보며 웃음"] 카드가 떠 있는 Explore 전 구간에
    // First Send 카드의 원본 work? 렌더러(올려다보기·웃는 입·실제 시계 눈 깜박임)를 재사용.
    mountSendCardWorkPose({ canvasId: "secondWorkStage", active: true, clock: "second" });
    // [A-405-a] 종결 note("okay./maybe later." 류)만 씬에 묶인 타이머로 한 걸음
    // 넘긴다 — 다음 render()(카드 이탈·다른 클릭)가 오면 teardownScene() 이 이 예약을
    // 지워 뒤늦은 덮어쓰기를 막는다(기존 sceneTimeout 패턴, 새 타이머 체계 0).
    if (state.secondJourney.step === "note") {
      sceneTimeout(advanceExploreNote, EXPLORE_NOTE_MS);
    }
    if (state.secondJourney.step === "candidates" && !state.secondJourney.candidatesRevealed) {
      const picks = [...document.querySelectorAll(".secondJourney__pick")];
      picks.forEach((btn) => { btn.hidden = true; });
      sceneTimeout(() => {
        state.secondJourney.candidatesRevealed = true;
        picks.forEach((btn) => { btn.hidden = false; });
      }, CANDIDATES_REVEAL_MS);
    }
  }
  if (state.scene !== "explore") secondWorkStartedAt = null;
  if (state.scene === "secondAway") mountSecondAway();
  if (state.scene === "secondReturn") mountSecondReturn();
  // [A-540] `.homePaper` 는 위 분기들이 이미 DOM 에 올린 뒤다(homePadMarkup 이 모든
  // Home-pad 씬에서 공유하는 셸) — mode "home" 일 때만 실제로 mount 된다(함수 내부 가드).
  mountHomeResidentModule();
}

// 돌아온 사용자는 Received 에 갇히지 않는다 — 이미 credential 이나 주소가 있으면 Birth 로 연다.
// (Received 는 "아직 아무것도 열지 않은" 첫 진입 전용)
if (state.scene === "received" && (readCredential() || state.address)) {
  state.scene = "birth";
}

// [A-633 A/C] 모바일/app 표면에서 저장된 credential 로 돌아온 사람(목적지 Name/Home)은 목적지를 보존한 채
// LOGIN_CHECKING 으로 연다 — 부팅 때 WebAuthn 호출 0(사용자가 Chog 를 눌러야 한다). 첫 Invite·새 기기·
// 웹(641+)·인증 불가 origin 은 지금 그대로다. First Send 미확정 기록이 있으면 목적지는 Away(checking…)이고,
// 그 hash 의 결과를 **공개 읽기로만** 잠금과 병렬로 조회한다(reconcileSendPending — 서명·전송 0).
if (state.credential && (state.scene === "name" || state.scene === "sendstay") && appLockSurface()) {
  const bootPending = state.scene === "sendstay" ? readSendPending() : null;
  if (bootPending) {
    state.scene = "away";
    state.homeQuietForExplore = false;
    state.awayRestore = "checking";
  }
  state.appLock = { phase: "waiting", cancelled: false };
  if (bootPending) reconcileSendPending(bootPending);
}

// [A-559 PHASE S1] Gift 링크 fragment 를 부팅 시 **한 번만** 읽어 둔다. scene 전환 0 · Piggy
// 생성 0 · 인증 호출 0 — readClaimFragment()는 파싱만 한다(parseClaimUrl, A-495). 링크가 없거나
// 형식이 깨졌으면 pendingGiftClaim 은 null 로 남는다(다음 아래 코드 경로들과 동일하게 0 Piggies),
// 그리고 주소창은 손대지 않는다(변경 없음, malformed/no-fragment 는 그대로).
// 실제 claim 시도는 이 아래 어디서도 일어나지 않는다 — 새 Gift Piggy 흐름(settleBoundGiftClaim)이 인증이
// 성공한 뒤(openPiggy 첫 탄생 · beginGiftPiggy 새 Gift Piggy 경계 — 되찾기·평범한 +Piggy 는 아님)에만 한다.
// [A-563 LANE B] 원문 토큰은 그래도 이 READY 분기에서 메모리에 들어오는 즉시 주소창에서
// 지운다(stripClaimFragmentFromUrl(), 바로 아래) — 인증까지 기다리지 않는다. 인증 전까지 토큰이
// 그대로 노출돼 있던 잔여 구간(A-559 review residual)을 닫는 것이 이 레인의 목적이다.
// pendingGiftClaim(메모리)은 그대로 남아 나중의 새 Gift Piggy 흐름(openPiggy·beginGiftPiggy 시작점)이 쓴다 —
// 저장소·로그에는 어디에도 쓰지 않는다.
if (typeof location !== "undefined") {
  const pendingRead = readClaimFragment(location.href);
  if (pendingRead.status === GIFT_ENTRY_STATUS.READY) {
    pendingGiftClaim = { giftId: pendingRead.giftId, token: pendingRead.token };
    stripClaimFragmentFromUrl();
  }
}

render();

window.addEventListener("resize", fitInvite);
window.addEventListener("beforeunload", endActiveSession);
// [A-565] 한 번만 붙는 module-scope 캡처 리스너 — render() 안 리스너처럼 씬마다 다시 붙지 않는다.
// capture:true 는 앱 안 아무 화면에서 눌러도(하위 요소가 stopPropagation 해도) 잡히게 하려는
// 것뿐이고, passive:true 는 activity 훅이 스크롤/탭을 막을 이유가 없어서다(preventDefault 0).
window.addEventListener("pointerdown", handleTrustedAppActivity, { capture: true, passive: true });
window.addEventListener("keydown", handleTrustedAppActivity, { capture: true, passive: true });

// @DEV_ONLY — 로컬 검토용 씬 점프. localhost 는 rpId 가 허용 목록 밖이라 실제 패스키를
// 탈 수 없고(isAllowedPiggyRpId), 그래서 해치·Name it·첫 Home 을 실제 앱에서 눈으로
// 확인할 방법이 달리 없다. 인증·저장·게이트는 건드리지 않는다 — 화면만 띄운다.
// 프로덕션 번들에는 실리지 않는다(import.meta.env.DEV).
if (import.meta.env.DEV) {
  // [A-421] 졸기 검토용 — 1분 무입력을 기다리지 않고 바로 앉혀 졸기를 시작한다(chog-home previewSit, 수식 동일).
  window.__arasoChogSit = () => homeChog?.previewSit?.();
  window.__arasoScene = (
    scene,
    { arrival = false, resumed = false, secondJourneyPreview = false, reason } = {},
  ) => {
    // [A-387-a/b] 이 콘솔 도우미는 683783b 도입 때부터 scene 인자를 검증 없이 그대로
    // setScene() 에 넘겼다. 오타·옛 이름(예: "home")을 주면 render() 의 마지막 else
    // 분기가 조용히 옛 Open/Check Piggy 패널을 그려, 검토자가 마치 그 패널이 정상 화면
    // 사이에 끼어든 것처럼 착각하게 만든다(Owner screenshot 의심 경로 중 하나, A-387-a §2).
    // 인증·rpId·저장은 건드리지 않는다 — scene 문자열만 막는다.
    if (!KNOWN_SCENES.includes(scene)) {
      console.warn(`[__arasoScene] unknown scene "${scene}" — ignored, staying on "${state.scene}". Valid: ${KNOWN_SCENES.join(", ")}`);
      return state.scene;
    }
    // [A-389, Owner 승인 2026-09-18] localhost 는 isAllowedPiggyRpId() 밖이라 실제 Face ID 를
    // 켤 수 없다 — 그래서 승인된 인증실패 카드(birth/renderAuthCard)도 실제 앱에서 눈으로
    // 볼 방법이 없었다. 이 분기는 **화면만** 띄운다: 실제 WebAuthn 호출 0, 패스키 생성 0,
    // localStorage 쓰기 0(BIRTH_PLAYED_KEY/PIGGY_RECEIVED_KEY/이름 전부 0), finishHatch 0,
    // 금융 호출 0 — openPiggy()/checkPiggy() 를 부르지 않고 카드가 읽는 표시 상태
    // (authPhase/authCancelled/detail)만 직접 만든다. 콘솔:
    //   window.__arasoScene("authfail", { reason: "cancelled" | "notfound" | "unsupported" })
    // reason 이 없거나 모르는 값이면 "notfound"(일반 실패 문구)로 본다. isAllowedPiggyRpId·
    // PRODUCTION_RP_ID·getRpId 는 그대로다 — "unsupported" 도 그 실제 판정을 덮지 않고,
    // 버튼에 문구만 맞춰 보여준다.
    if (scene === "authfail") {
      const AUTH_FAIL_PREVIEWS = {
        cancelled: { cancelled: true, detail: "" },
        notfound: { cancelled: false, detail: "PASSKEY_OPERATION_FAILED: Passkey assertion failed (DEV preview — no real auth call)" },
        // [A-407-f] DEV 재생용 detail 도 사용자 표시 규칙을 따른다(도메인 노출 0).
        unsupported: { cancelled: false, detail: "Piggy opens in the real app. (DEV preview — no real auth call)" },
      };
      const preview = AUTH_FAIL_PREVIEWS[reason] || AUTH_FAIL_PREVIEWS.notfound;
      state.authPhase = "idle";
      state.authCancelled = preview.cancelled;
      setScene("birth", "", preview.detail);
      return state.scene;
    }
    state.homeArrival = arrival;
    state.nameResumed = resumed;
    // [A-358 §5] DEV 전용 fixture — arrival 을 away/return 씬의 기존 1회성 모션 표
    // (state.departureArrival/returnArrival, sendPiggy()/finishTrip() 이 실제로 쓰는 그
    // 표 그대로)에도 연결해 실거래 없이 출발/귀환 연출을 로컬에서 재생한다. 이 표를
    // 켜는 것 말고는 아무것도 하지 않는다 — receipt 생성/저장, 서명, broadcast 호출 0,
    // 기존 금융 가드(sendPiggy 순서·rpId·grant·simulate) 불변.
    if (scene === "away") state.departureArrival = arrival;
    // [A-415-f] Owner 실화면 지적("알람이 안 뜬다")의 실제 원인 — 이 DEV 미리보기로
    // "return" 씬을 열면 finishTrip() 이 실제 단수 귀환에서 항상 같이 세우는 두 표
    // (returnArrival/returnArrivalAlarm, §963-967) 중 returnArrivalAlarm 은 세우지
    // 않았다. chogHomeMarkupForReturn() 은 그 표만 보고 알람 span 을 markup 에 붙이므로
    // (§3441 이하), 이 경로로 들어오면 render() 가 만드는 첫 markup 자체에 알람이 없어
    // "마운트했는데 안 보인다"로 나타난다 — 실제 성공 경로와 parity 를 맞춘다.
    if (scene === "return") { state.returnArrival = arrival; state.returnArrivalAlarm = arrival; }
    // [A-421] Second 귀환도 같은 parity — DEV 씬점프로 "secondReturn" 을 열면 실제 진입
    // 경로(mountSecondAway advanceToReturn, §1716 근방)가 세우는 것과 같은 알람 표를
    // 세운다. mountSecondReturn 은 play:true 고정이므로 returnArrival 은 건드리지 않는다.
    if (scene === "secondReturn") state.returnArrivalAlarm = arrival;
    // [A-360 §7] "UI preview — no transaction" — 이 함수 자체가 이미 import.meta.env.DEV
    // 안에만 있다(production 진입 0). secondJourneyPreview:true 를 명시적으로 넘겼을 때만
    // recomputeSecondJourneyFlow()가 fixture evidence/overrides를 쓰게 된다(§devPreview
    // 게이트, main.js 위 recomputeSecondJourneyFlow 주석). 이 표를 켜는 것 말고는 아무것도
    // 하지 않는다 — 그 뒤로는 사용자가 select/check/permission/amount/Send 를 기존 버튼
    // 그대로 눌러 두 번째 출발→Away→귀환→Receipt→Home 까지 씬 점프 없이 이어간다.
    if (secondJourneyPreview) state.secondJourney.devPreview = true;
    if (scene === "explore") {
      recomputeSecondJourneyFlow();
    }
    setScene(scene, "", "");
    return state.scene;
  };
}
