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
  assignHomeAmbient,
  buildPiggyMotionStateMap,
  fitWideSlot,
  hashSeed,
  homeSlotBand,
  isRuntimeMotionState,
  orderHomeResidents,
  PIGGY_MOTION_STATE,
  piggyMotionStateFromMap,
  planHomeSlots,
  rect as slotRect,
  rectsTouch,
  resolvePiggyMotionState,
  seededRandom,
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
  controlModeChoicesMarkup,
  addMoneyEntryMarkup,
  addMoneySingleMarkup,
  addMoneyAllocationMarkup,
  addMoneyPlanMarkup,
  piggyMoneyStateMarkup,
  HOME_NOT_APPLICABLE_LABEL,
} from "./home-paper.js";
import { createPiggy, loadRegistry, migrateSinglePiggy, normalizePiggy, projectRegistryTotals, saveRegistry, quantityToUnits, unitsToQuantity } from "./piggy-registry.js";
import {
  newPlanId, buildAllocationPlan, approvalForPlan, percentBpsFromAmount, amountFromPercentBps,
  loadLastSplit, saveLastSplit, prefillFromLastSplit,
} from "./add-money.js";
import { CONTROL_MODE_OPTIONS, isControlMode, loadControlMode, saveControlMode } from "./piggy-control-mode.js";
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
import { admitModelAPiggy, loadMyPiggiesIndex, markBornPiggyIssuance, registerControlledPiggy, renameIndexedPiggy } from "./piggy-index.js";
import { recoverProductList } from "./gate-b-recovery.js";
import { listFundingMethods, startFunding, applyFundingResult, FUNDING_STATE } from "./funding-entry.js";
import { checkIntentFunding, fundingRequestForShortfall, resumeAfterFunding, markPlanApproved } from "./funding-intent-bridge.js";
import { buildFundingContext, validateFundingContext, scopeForChainId, FUNDING_CONTEXT_TOKEN_ALLOWLIST } from "./funding-context.js";
import { legacyTestnetPathOpen, profileScope, resolveChainProfile } from "./chain-profile.js";
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
import { commitSecondJourneyReceipt, isDevMockReceipt } from "./second-journey-receipt-bridge.js";
// [A-663] Second-owned testnet execution plumbing proof — LOCAL_ONLY harness call site only
// (see runLocalSecondPlumbingProofIfHarnessed below). Never imported by Explore/candidates/
// handleSecondSend/canSend. Per Owner correction: shMON is First-lineage plumbing proof, not a
// Second Journey product destination.
import { reconcileSecondPendingOnBoot, runSecondPlumbingProof } from "./second-execution-adapter.js";
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
// (the confirmed home-peek and home-paper-multi design packages, kept outside this repo). CSS is
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
// Chain profile (chain-profile.js): testnet unless the build config names the mainnet profile
// id exactly; any other value is blocked (scope "", nothing persists, nothing sends).
const CHAIN_PROFILE = resolveChainProfile(import.meta.env.VITE_ARASO_CHAIN_PROFILE);
const RUNTIME_CHAIN_SCOPE = profileScope(CHAIN_PROFILE);
// The first shMON send, the relayer grant, the testnet RPC client and the legacy receipt rows
// (which carry no chain id) exist on testnet only. On any other profile they stay sealed:
// not read, not written, not reconciled, so testnet state is never shown as this chain's.
const LEGACY_TESTNET_PATH = legacyTestnetPathOpen(CHAIN_PROFILE);
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
  mark: LEGACY_TESTNET_PATH ? localStorage.getItem("araso.mark") || "" : "",
  txHash: LEGACY_TESTNET_PATH ? localStorage.getItem("araso.txHash") || "" : "",
  grantTxHash: "",
  // settle() 이 만든 receipt 를 최근 것부터 2건. 세션 메모리가 아니라 저장소에 남는다 —
  // 2회차에서는 새 영수증을 받은 뒤에도 직전 바퀴를 다시 열어봐야 한다(A-015).
  receipts: LEGACY_TESTNET_PATH ? readReceipts() : [],
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
  tripClosed: LEGACY_TESTNET_PATH ? computeTripClosed({
    tripClosedFlag: localStorage.getItem(TRIP_CLOSED_KEY),
    txHash: localStorage.getItem("araso.txHash"),
    pending: readSendPending(),
  }) : false,
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

const publicClient = LEGACY_TESTNET_PATH
  ? createPublicClient({
    chain: MONAD_TESTNET,
    transport: http(MONAD_TESTNET_RPC),
  })
  : sealedTestnetClient();

// Outside the testnet profile nothing may read testnet state and show it as this chain's.
// Every method rejects (callers already treat a failed read as "couldn't read / unknown");
// `chain` is null, so every chain-scope check on this client fails closed.
function sealedTestnetClient() {
  const refuse = () => Promise.reject(new Error("testnet client sealed on this chain profile"));
  return new Proxy({ chain: null }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return refuse;
    },
  });
}

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
// legacy 이력은 지워지지 않는다(감사 버그 2 · A-553 결함 1 수리).
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
  } else {
    state.receipts = [receipt, ...state.receipts];
    state.receiptIndex = 0;
  }
  // The legacy receipt store holds testnet rows (the legacy rows carry no chain id). Off the
  // testnet profile it is never read (state init) and never rewritten here, so a testnet row is
  // neither shown as this chain's nor dropped. `typeof`: existing tests run this function cut
  // out on stubs where the module const does not exist; in the app it always does.
  if (typeof LEGACY_TESTNET_PATH === "boolean" && LEGACY_TESTNET_PATH !== true) return true;
  // [A-699 M2-alpha] Durable save, merged against STORAGE (not this tab's memory), never over a store it
  // cannot fully read, and verified by a re-read. Returns true only when the row is provably in storage;
  // throws otherwise (callers that need a boolean — finishTrip — catch). The pending Send record is
  // never cleared on a throw here.
  const unsound = () => new Error("receipt_store_unsound");
  let raw;
  try {
    raw = localStorage.getItem(RECEIPTS_KEY);
  } catch {
    throw unsound();
  }
  let stored = [];
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      throw unsound(); // unparseable store: never overwrite it with a one-row array
    }
    if (!Array.isArray(stored)) throw unsound();
  }
  let present = false;
  for (const row of stored) {
    let decoded;
    try {
      decoded = decodeReceiptRow(row);
    } catch {
      // Same tolerance as readReceipts: a broken add_money row alone is skipped (and kept verbatim below);
      // a broken legacy row means the store is not fully readable -> refuse to rewrite it.
      if (row && row.kind === RECEIPT_KIND.ADD_MONEY) continue;
      throw unsound();
    }
    if (key && receiptIdentityKey(decoded) === key) present = true;
  }
  // Already durable (live settle + reconcile + another tab all converge here): nothing to write.
  if (present) return true;
  const json = JSON.stringify([serializeReceiptRow(receipt), ...stored]);
  try {
    localStorage.setItem(RECEIPTS_KEY, json);
  } catch {
    throw unsound();
  }
  let back;
  try {
    back = localStorage.getItem(RECEIPTS_KEY);
  } catch {
    throw unsound();
  }
  if (back === json) return true;
  // Another tab wrote in between: accept only if this receipt's identity is provably in what is stored now.
  if (key) {
    try {
      const rows = JSON.parse(back);
      if (Array.isArray(rows) && rows.some((row) => { try { return receiptIdentityKey(decodeReceiptRow(row)) === key; } catch { return false; } })) return true;
    } catch {
      /* falls through */
    }
  }
  throw unsound();
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

// [A-687] 시도 **전** 능력 점검 — 동기·읽기 전용. `kind` = 그 경로가 실제로 부르는 WebAuthn 함수("get": 잠금
// 해제·Check Piggy / "create": Open). 보안 컨텍스트·PublicKeyCredential·navigator.credentials·필요한 함수 중
// 하나라도 없으면 true(= 이 기기에선 시도할 수 없다). 하네스가 자기 지원 client 를 직접 넘긴 로컬 테스트
// 경로(localTestWebAuthnClient)는 막지 않는다. 브라우저 컨텍스트 증거가 없으면(window/document/navigator 없음) false —
// 모르면 막지 않고 기존 경로에 맡긴다. credential 을 만들거나 묻지 않고, await·타이머·상태 변경이 없다.
function webAuthnUnsupported(kind) {
  try {
    if (localTestWebAuthnClient()) return false;
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    if (!window.document) return false; // 실제 브라우저 창이 아니다(비브라우저 하네스/스텁) — 양의 증거 없음
    if (window.isSecureContext === false) return true;
    if (typeof window.PublicKeyCredential !== "function") return true;
    const creds = navigator.credentials;
    return !creds || typeof creds[kind === "create" ? "create" : "get"] !== "function";
  } catch {
    return false;
  }
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
  // [A-669] 잠그든(모바일) 쉬게 하든(웹) 앱 세션은 이미 끝났다 — 진행 중 인증 시도의 늦은 결과가 이 전환을 덮지 못하게 먼저 무효화.
  invalidateLiveAuthAttempt();
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
// [A-667 R3] 서명자를 세운 뒤 어느 단계든(계정 파생·주소 저장) 던지면 그 서명자를 그 자리에서 끝내고 다시 던진다 —
// 만료 타이머(armSignerExpiry)·app-idle(touchAppSession) 없이 살아 있는 서명자가 남지 않게. 저장 주소는 setItem 이
// 성공한 뒤에만 state 로 올라간다(실패 시 state.address 불변).
function activateSigningSession(prfOutput, { persistAddress = true } = {}) {
  endActiveSession();
  activeSession = createSecp256k1SigningSession({ privateKey: prfOutput });
  try {
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
  } catch (error) {
    endActiveSession();
    throw error;
  }
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

// [A-666 §2, coordinator repair pass] iOS Safari fires `resize` repeatedly, with intermediate
// window.innerHeight values, WHILE its toolbar chrome is animating open/closed (known iOS
// behavior, DIAGNOSIS.md §2) — same innerWidth, only innerHeight moving, by an amount far
// smaller than a real viewport change (orientation flip, split-screen resize). Every Home
// geometry consumer (fitHomeBoard/fitCardAnchor/applyHomeCharacterScaleFloor, main.js
// ~7570-7804) reads window.innerWidth/innerHeight live at call time and is unchanged by this
// card — this wraps only the resize LISTENER call site.
//
// First pass of this helper also SKIPPED the handler entirely whenever the final settled
// delta was toolbar-sized — the coordinator's real-browser run caught two real regressions
// from that: (a) it added artificial lag even to genuine width-driven resizes (desktop must
// recompute immediately, no debounce — only a pure-height toolbar-style delta should ever
// wait), and (b) several EXISTING tests (e.g. a654-living-home.mjs B7) drive this exact
// listener with `dispatchEvent(new Event("resize"))` and NO real size change at all, relying
// on the handler's OTHER bundled side effects (remountHomeResidentsForBreakpoint,
// mountHomeAmbientResidents, alignRecordsCardToHomePaper) always eventually firing — "skip
// when zero/toolbar-sized" silently dropped those too. Fixed shape: a real resize (width
// changed, or a height delta at/above the threshold) now recomputes SYNCHRONOUSLY, same as
// before this card existed — zero added lag. A toolbar-sized (or exactly zero) delta is
// coalesced via a short trailing debounce so an iOS resize-event burst collapses into one
// recompute after it settles, but it is NEVER permanently skipped — anything relying on the
// handler eventually running (including a synthetic no-op resize) still gets it, just after
// `wait`ms instead of synchronously. Threshold matches the ±100px toolbar-shown simulation
// the A-665 Part B harness already uses (app/test/a665-real-iphone-safari.mjs
// TOOLBAR_DELTA=100), with headroom above it.
const HOME_TOOLBAR_RESIZE_DELTA_PX = 150;
function isToolbarOnlyResizeDelta(prevW, prevH, nextW, nextH) {
  if (!Number.isFinite(prevW) || !Number.isFinite(prevH)) return false;
  if (!Number.isFinite(nextW) || !Number.isFinite(nextH)) return false;
  if (prevW !== nextW) return false;
  return Math.abs(nextH - prevH) < HOME_TOOLBAR_RESIZE_DELTA_PX;
}
function debouncedHomeResizeListener(handler, wait = 160) {
  let timer = null;
  let baseW = window.innerWidth;
  let baseH = window.innerHeight;
  const wrapped = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!isToolbarOnlyResizeDelta(baseW, baseH, w, h)) {
      // Real resize (width changed, or a height delta at/above the threshold) — recompute
      // immediately, exactly as before this card. No debounce lag for desktop/orientation.
      clearTimeout(timer);
      timer = null;
      baseW = w;
      baseH = h;
      handler();
      return;
    }
    // Toolbar-sized (or zero/no-op) delta — coalesce a burst into ONE call after `wait`ms of
    // quiet, keyed off whatever the values are once it settles. Always fires eventually.
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      baseW = window.innerWidth;
      baseH = window.innerHeight;
      handler();
    }, wait);
  };
  onSceneTeardown(() => clearTimeout(timer));
  return wrapped;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// [A-684] 실패 문구의 증거 등급 매핑 — 고정(pin)된 송금/인증 함수를 건드리지 않으려고 문구를 그리는 자리(setScene)에서
// 붙인다. 기존 등급만: nothing moved / still out. / can't tell yet. 사용자 화면에 "relayer" 낱말 0. 새 재시도 0.
function sendFailureCopy(scene, message, detail) {
  if (scene !== "sendstay" || detail) return { message, detail };
  if (message === "relayer unreachable") return { message: "Piggy can't go out yet.", detail: "nothing moved." };
  if (message === "Piggy can't go out yet.") return { message, detail: "nothing moved." };
  if (message === "Piggy could not get ready.") {
    // 전송이 시작되지 않았으면(미확정 기록 없음) nothing moved. · deposit 확정 뒤 redeem 이 나간 기록만 still out. ·
    // 그 밖(deposit 전송/미확정 — 돈이 움직였을 수 있다)은 can't tell yet.
    const pending = typeof readSendPending === "function" ? readSendPending() : { stage: "unknown" };
    return { message, detail: !pending ? "nothing moved." : pending.stage === "redeem-broadcast" ? "still out." : "can't tell yet." };
  }
  if (message === "couldn't finish this one.") {
    // finishTrip 이 setScene 직전에 세운 state.tripReason: deposit 확정 뒤 redeem 미확정·실패만 still out.,
    // 그 밖(reverted 포함 — 어느 단계인지 모름)은 can't tell yet. reverted deposit 도 broadcast 됐으므로 nothing moved 아님.
    return { message, detail: state.tripReason === "redeem-unconfirmed-or-reverted" ? "still out." : "can't tell yet." };
  }
  return { message, detail };
}

function setScene(scene, message = "", detail = "") {
  ({ message, detail } = sendFailureCopy(scene, message, detail));
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

// [A-695 SEQ-5=A] 메모리뿐(저장 0) — commitIdentity(received:true) = 생성 경로가 세우고, indexControlledPiggy 가 한 번 쓰고 지운다.
let bornPiggyPending = null;

function indexControlledPiggy({ address, credentialId, transports = null, prfSaltHex = null }) {
  const born = bornPiggyPending !== null && bornPiggyPending === String(address).toLowerCase();
  bornPiggyPending = null;
  try {
    const out = registerControlledPiggy(safeLocalStorage(), secondJourneyScope().chainId, {
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
    // 발급 출처 표식은 **생성 경로가 방금 만든 그 주소**의 행에만 — 되찾기(born=false)는 표식을 만들지 않는다.
    if (born && out.ok) markBornPiggyIssuance(safeLocalStorage(), secondJourneyScope().chainId, { address });
    return out;
  } catch {
    return { ok: false, reason: "index_write_failed" };
  }
}

// ── [A-667 R1–R6] 되찾기(Check Piggy)·새로 열기(Open) 공용 안전장치 ─────────────────────────────────────
// 이름 붙은 오류만 쓴다(화면 문구는 기존 실패 카드 그대로 — 새 문구 0). recordSafeError 는 name 만 남긴다.
function namedAuthError(name, message, cause = undefined) {
  const error = new Error(message);
  error.name = name;
  if (cause !== undefined) error.cause = cause;
  return error;
}

// [R2] 신원 = 이 네 저장값 + state.credential/state.address. 쓰기 전 그대로 떠 두고, 하나라도 실패하면 **이전 값으로
// 되돌린다**(원래 없던 키는 없던 상태로 — 이번 시도가 막 쓴 것만 되돌리는 것이고, 이전 credential 은 지우지 않는다).
// 읽지 못한 키(undefined)는 건드리지 않는다.
function identityStorageKeys() {
  return [PASSKEY_STORAGE_KEY, "araso.address", "araso.prfSalt", PIGGY_RECEIVED_KEY];
}
function snapshotIdentity() {
  const keys = {};
  for (const key of identityStorageKeys()) {
    try { keys[key] = localStorage.getItem(key); } catch { keys[key] = undefined; }
  }
  return { keys, credential: state.credential, address: state.address };
}
function restoreIdentity(snapshot) {
  for (const key of identityStorageKeys()) {
    const prior = snapshot.keys[key];
    if (prior === undefined) continue;
    try {
      if (prior === null) localStorage.removeItem(key);
      else localStorage.setItem(key, prior);
    } catch {
      /* 되돌리기도 실패하면 더 할 수 있는 것이 없다 — 아래 state 는 이전 값으로 돌린다 */
    }
  }
  state.credential = snapshot.credential;
  state.address = snapshot.address;
}
// [R2/R3] 신원 저장은 한 덩어리로만 성공한다. 실패하면 이전 신원으로 되돌리고, 이번 인증이 막 연 서명자를 즉시
// 끝낸 뒤(endActiveSession) 재시도 가능한 실패로 던진다.
function commitIdentity({ credential, address, prfSaltHex = null, received = false }) {
  const snapshot = snapshotIdentity();
  try {
    localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(credential));
    localStorage.setItem("araso.address", address);
    if (prfSaltHex !== null) localStorage.setItem("araso.prfSalt", prfSaltHex);
    if (received) localStorage.setItem(PIGGY_RECEIVED_KEY, "1");
  } catch (error) {
    restoreIdentity(snapshot);
    endActiveSession();
    throw namedAuthError("PiggyIdentityWriteFailed", "identity write failed", error);
  }
  state.credential = credential;
  state.address = address;
  // [A-695 SEQ-5=A] `received: true` 는 openPiggy 생성 경로만 넘긴다(checkPiggy/recoverPiggy 는 false) → 생성 직후 표식 후보를 메모리에만 둔다.
  if (received) bornPiggyPending = String(address).toLowerCase();
}

// [R5] Check Piggy / Open 시도 하나 = 토큰 하나(unlockApp 의 attempt 와 같은 모양). 한 번에 하나만 살아 있다.
// `live` 가 false 가 된 시도의 결과는 서명자·저장·화면 어느 것도 바꾸지 못한다. 상한은 잠금 해제와 같은 값.
let authAttempt = null;
// [A-667 CREATE_RETRY_RACE] "화면 시도 끝남"(authAttempt/live)과 "플랫폼 요청 아직 열림"은 다르다. 이 값은 Check Piggy/
// Open 이 낸 WebAuthn 프라미스가 **실제로 settle 될 때까지** 남는다(시간초과·bfcache 만료와 무관). 남아 있는 동안 새
// create/get 을 시작하지 않는다. 플랫폼이 끝내 settle 하지 않으면 reload 가 유일한 탈출구(iOS 동작 UNKNOWN/HUMAN).
let platformAuthInflight = null;
function trackPlatformAuth(promise) {
  const token = {};
  platformAuthInflight = token;
  const clear = () => { if (platformAuthInflight === token) platformAuthInflight = null; };
  promise.then(clear, clear);
  return promise;
}
// 시간초과 뒤 늦게 만들어진(앱이 버린) 패스키 — 다음 find-first 가 이것 하나로만 묻게 하는 메모리 표식. 저장 0.
let lateCreatedCredential = null;
function beginAuthAttempt(kind) {
  const attempt = { kind, live: true, timer: null, deadline: Date.now() + UNLOCK_UI_WAIT_MS, expire: null };
  authAttempt = attempt;
  return attempt;
}
function boundAuthAttempt(attempt, work) {
  return new Promise((resolve, reject) => {
    attempt.expire = (error) => {
      if (!attempt.live) return;
      attempt.live = false;
      clearTimeout(attempt.timer);
      reject(error);
    };
    attempt.timer = setTimeout(() => attempt.expire(namedAuthError("AuthWaitTimeout", "auth wait elapsed")), UNLOCK_UI_WAIT_MS);
    work.then(resolve, reject);
  });
}
// [A-667 R6] 복원·복귀 때 메모리에 남은 인증 시도를 다시 판정한다. 새 WebAuthn 호출 0.
//  · bfcache 복원(restored=true): 얼어 있던 시도는 결과를 믿을 수 없다 → Check Piggy/Open 시도와 잠금 해제 시도를
//    모두 기존 실패 카드로 fail-closed(재시도는 사용자가 다시 누를 때만). 늦은 결과는 각 토큰으로 버려진다.
//  · 백그라운드 → 화면 복귀(restored=false): 백그라운드 동안 타이머가 늦어졌을 수 있다 → 상한이 이미 지난
//    Check Piggy/Open 시도만 지금 끝낸다. 아직 상한 안이면 그대로 둔다(시트가 아직 떠 있을 수 있다 — 실기기 UNKNOWN).
function expireStaleAuthState({ restored }) {
  if (authAttempt && authAttempt.expire && (restored || Date.now() >= authAttempt.deadline)) {
    authAttempt.expire(namedAuthError("AuthWaitTimeout", restored ? "auth attempt restored from page cache" : "auth wait elapsed"));
  }
  const lock = state.appLock;
  if (restored && lock && lock.attempt) settleUnlock(null, unlockWaitTimeoutError(), state.credential, lock.attempt);
}

// UI 를 이 시도가 아직 쥐고 있으면 놓는다(true). 이미 다른 시도/정리로 넘어갔으면 false — 호출자는 아무것도 바꾸지 않는다.
function finishAuthAttempt(attempt) {
  if (authAttempt !== attempt) return false;
  attempt.live = false;
  clearTimeout(attempt.timer);
  authAttempt = null;
  return true;
}

// [A-669 IDLE_AUTH_ORDERING] 앱 세션이 끝나는 순간(app-idle 만료 → lockAppAfterIdle) 살아 있는 Check/Open 시도(authAttempt)를
// 그 자리에서 무효로 만든다. 화면 소유를 먼저 놓고(authAttempt=null) 시도를 죽인다(live=false · 상한 타이머 해제 ·
// 대기 중인 호출자에게 StaleAuthAttempt). 그래서 늦게 온 결과는 recoverPiggy 의 isCurrent 에서 서명자·저장 전에 버려지고,
// 호출자는 finishAuthAttempt=false 로 화면·서명자·저장·돈 흐름을 건드리지 않는다. 새 WebAuthn 0 · 자동 재시도 0.
// platformAuthInflight 는 건드리지 않는다 — 플랫폼 요청은 실제로 아직 열려 있다(settle 될 때까지 새 create/get 0).
function invalidateLiveAuthAttempt() {
  const attempt = authAttempt;
  if (!attempt) return false;
  authAttempt = null;
  if (attempt.expire) attempt.expire(namedAuthError("StaleAuthAttempt", "app session ended"));
  attempt.live = false;
  clearTimeout(attempt.timer);
  return true;
}

// [R1] 저장된 credential 로 묻다가 실패하면 그 패스키가 사라졌을 수 있다 — 그때만 지정을 빼고 딱 한 번 다시 묻는다.
// 단, NotAllowedError(사용자 취소 — iOS/Chromium 은 "없음"·WebAuthn 시간초과도 같은 이름)는 다시 묻지 않는다:
// 그냥 취소한 사람에게 두 번째 선택창을 띄우지 않는다. 어느 응답이든 **저장 전에** 기존 신원과 대조한다 —
// 이미 알려진 주소가 있으면 파생 주소가 같아야 하고, 저장된 credential 과 다른 패스키인데 대조할 주소가 없으면
// 거절한다. 불일치 = 신원 쓰기 0 · 방금 연 서명자 즉시 정리. PRF 출력은 파생 직후 0 으로 지우고 돌려주지 않는다(R4).
// `isCurrent` = 이 결과를 아직 받아도 되는지(Check Piggy 시도 토큰). 돈 경로(sendPiggyOnce)는 인자 없이 부른다.
async function recoverPiggy(options = {}) {
  const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : () => true;
  // [A-667 CREATE_RETRY_RACE] `pin` = 저장 credential 이 없을 때만 checkPiggy 가 넘기는 "시간초과 뒤 늦게 만들어진 패스키".
  // 그 하나로만 묻고, 다른 패스키가 오면 아래 대조에서 거절된다(묶이지 않은 신원 채택 0).
  const pinned = options.pin || state.credential;
  const expectedAddress = typeof state.address === "string" ? state.address : "";
  const prfSalt = storedPrfSalt();
  let result;
  try {
    result = await requestPrf(pinned, { prfSalt });
  } catch (error) {
    // 어느 경우에도 새 패스키를 만들지 않는다. localStorage 가 비어도 마찬가지다.
    const mayBeGone = isMeraError(error) && error.code === "PASSKEY_OPERATION_FAILED" && !isCancelledAuthError(error);
    if (!pinned || !mayBeGone || !isCurrent()) throw error;
    result = await requestPrf(null, { prfSalt });
  }
  const prfOutput = result.prfOutput;
  try {
    if (!isCurrent()) throw namedAuthError("StaleAuthAttempt", "auth attempt no longer current");
    // 어떤 패스키가 선택됐는지 기억해 둔다. 다음부터는 그 하나로 고정된다.
    // transports 는 assertion 결과에 없으므로(Result = credentialId + prfOutput)
    // 같은 credential 로 돌아왔을 때만 이어붙인다.
    const sameAsPinned = pinned?.credentialId === result.credentialId;
    const { account, address } = activateSigningSession(prfOutput, { persistAddress: false });
    const addressMatches = !expectedAddress || address.toLowerCase() === expectedAddress.toLowerCase();
    if (!addressMatches || (pinned && !sameAsPinned && !expectedAddress)) {
      endActiveSession();
      throw namedAuthError("PiggyIdentityMismatch", "recovered passkey is not the stored Piggy");
    }
    commitIdentity({
      credential: {
        credentialId: result.credentialId,
        ...(sameAsPinned && pinned.transports ? { transports: pinned.transports } : {}),
      },
      address,
    });
    // 저장 salt 로 열었으면 그 salt, 아니면 Mera 기본 salt(= locator 에 salt 필드 없음).
    indexControlledPiggy({
      address,
      credentialId: result.credentialId,
      transports: sameAsPinned ? pinned?.transports ?? null : null,
      prfSaltHex: prfSalt ? toHex(prfSalt) : null,
    });
    return { credentialId: result.credentialId, account, address };
  } finally {
    if (prfOutput instanceof Uint8Array) prfOutput.fill(0);
  }
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

  // [A-667 R5] 한 번에 한 시도만 — 이미 Check Piggy/Open 이 진행 중이면 새 생성 요청을 만들지 않는다.
  if (authAttempt) return;
  // [A-667 CREATE_RETRY_RACE] 화면 쪽 시도는 시간초과로 끝났어도 **플랫폼 요청**(이전 create/get)이 아직 settle 되지
  // 않았으면 두 번째 create 를 시작하지 않는다. 자동 생성 0 — 기존 실패 카드(기존 문구)로 fail-closed, 재시도 가능.
  if (platformAuthInflight) {
    state.authPhase = "idle";
    state.authCancelled = false;
    recordSafeError("open", namedAuthError("PlatformAuthPending", "previous platform request still pending"));
    setScene("birth", "Piggy could not open here.", "");
    return;
  }
  // [A-687 capability preflight] create 를 못 쓰는 기기면 beginAuthAttempt 전에 기존 실패 카드로 — 토큰·타이머 0, 생성·fallback 0.
  if (typeof webAuthnUnsupported === "function" && webAuthnUnsupported("create")) {
    state.authPhase = "idle";
    state.authCancelled = false;
    setScene("birth", "Not from here.", "This device can't use Face ID or a passkey here.");
    return;
  }
  const attempt = beginAuthAttempt("open");
  state.authPhase = "checking";
  state.authCancelled = false;
  setScene("birth", "The egg is checking this device.", "Face ID may appear once.");

  // [A-579 Lane G] Gift 은 **시작 시점에** 이 생성 흐름에 묶인다 — 흐름이 도는 동안 다른 경로(checkPiggy 등)가
  // 같은 pending 을 가져가지 못한다. 묶일 수 있는 것은 **이 흐름이 방금 만든** Piggy 뿐이다(시작 전 주소 목록에
  // 없던 주소 + 그 주소의 살아 있는 서명자). 생성이 안 되면(취소·실패) pending 을 되돌려 놓는다.
  const giftIntent = takePendingGiftClaim();
  const giftPreExisting = giftIntent ? knownPiggyAddresses() : null;
  let giftAttempted = false;
  let committed = false;

  try {
    const creating =createPasskeyWithPrfOutput({
      rp: { id: getRpId(), name: "Araso" },
      user: { name: "araso-owner", displayName: "Araso" },
      timeout: 120_000,
      // LOCAL_ONLY. 둘 다 잠금이 걸리면 빈 객체 → 기존 경로·기본 salt 그대로.
      ...localTestWebAuthnOption(),
      ...localTestPrfSaltOption(),
    });
    // [A-667 R5] 시간이 다 된(또는 bfcache 복원으로 만료된) 뒤 늦게 온 생성 성공: 화면·서명자·저장 0, PRF 는 지운다.
    // 남는 부작용(정직 기록): 플랫폼에는 패스키가 **이미 만들어져** 있다. 그래서 이번 세션의 다음 Open 이 곧바로 또
    // 만들지 않도록 find-first 를 다시 켠다(freshRecoveryTried=false, 메모리만) — 다음 Open 은 먼저 그 패스키를 찾는다.
    trackPlatformAuth(creating);
    creating.then((late) => {
      if (attempt.live) return;
      if (late?.prfOutput instanceof Uint8Array) late.prfOutput.fill(0);
      state.freshRecoveryTried = false;
      // [A-667 CREATE_RETRY_RACE] 다음 find-first 는 **이 패스키 하나로만** 묻는다(메모리만, 비밀 아님) — 아무 패스키나
      // 묶이지 않은 채 채택하지 않게. 저장·state.credential·색인은 건드리지 않는다.
      if (late && typeof late.credentialId === "string" && late.credentialId) {
        lateCreatedCredential = { credentialId: late.credentialId, ...(Array.isArray(late.transports) && late.transports.length ? { transports: late.transports } : {}) };
      }
    }, () => {});
    const result = await boundAuthAttempt(attempt, creating);

    const credential = {
      credentialId: result.credentialId,
      transports: result.transports,
    };
    let address;
    try {
      ({ address } = activateSigningSession(result.prfOutput, { persistAddress: false }));
      // [A-667 R2] credential·address·prfSalt·받음 표시는 한 덩어리로만 저장된다(실패 시 이전 신원 그대로 + 서명자 정리).
      commitIdentity({ credential, address, prfSaltHex: toHex(result.prfSalt), received: true });
    } catch (error) {
      // 패스키는 플랫폼에 이미 만들어졌다 — 다음 Open 이 또 만들지 않고 **그 패스키로** 먼저 찾게 한다(위와 같은 이유).
      state.freshRecoveryTried = false;
      lateCreatedCredential = credential;
      throw error;
    } finally {
      if (result.prfOutput instanceof Uint8Array) result.prfOutput.fill(0);
    }
    // 신원이 온전히 저장된 뒤에는 이 시도의 대기 상한을 거둔다(아래 Gift 정산은 기존 그대로 — 이 상한 밖).
    committed = true;
    lateCreatedCredential = null;
    finishAuthAttempt(attempt);
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
    // [A-667 R5] 이 시도가 더는 화면을 쥐고 있지 않으면(이미 정리됨) 아무것도 바꾸지 않는다.
    if (!committed && !finishAuthAttempt(attempt)) return;
    // [A-667 R3] 저장까지 끝난 뒤 이어진 단계가 실패했다면 방금 연 서명자를 남기지 않는다(신원은 온전히 저장됨).
    if (committed) endActiveSession();
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

  // [A-667 R5] 한 번에 한 시도만 — 진행 중이면 두 번째 WebAuthn 요청을 만들지 않는다.
  if (authAttempt) return { ok: false, cancelled: false, reason: "attempt_active" };
  // [A-667 CREATE_RETRY_RACE] 앞선 플랫폼 요청(create/get)이 아직 settle 되지 않았으면 새 get 을 겹쳐 내지 않는다.
  // 기존 실패 카드(기존 문구)로 fail-closed — 재시도 가능, 자동 호출 0.
  if (platformAuthInflight) {
    state.authPhase = "idle";
    state.authCancelled = false;
    setScene("birth", "Chog could not find Piggy here.", "Couldn't find your Piggy.");
    return { ok: false, cancelled: false, reason: "platform_pending" };
  }
  // [A-687 capability preflight] get 을 못 쓰는 기기면 beginAuthAttempt 전에 기존 실패 카드로 — 토큰·요청 0, 생성 폴백 0.
  if (typeof webAuthnUnsupported === "function" && webAuthnUnsupported("get")) {
    state.authPhase = "idle";
    state.authCancelled = false;
    setScene("birth", "Not from here.", "This device can't use Face ID or a passkey here.");
    return { ok: false, cancelled: false, reason: "webauthn_unsupported" };
  }
  const attempt = beginAuthAttempt("check");
  // 시간초과 뒤 늦게 만들어진 패스키가 있고 이 기기에 저장된 credential 이 없으면, find-first 는 그 패스키 하나로만 묻는다.
  const pin = !state.credential && lateCreatedCredential ? lateCreatedCredential : null;
  let recovered = false;
  let released = false;
  // 생성 폴백 없음 — 이 버튼은 절대 새 패스키를 만들지 않는다.
  state.authPhase = "checking";
  state.authCancelled = false;
  setScene("birth", "Chog is checking if this is the same Piggy.", "Face ID may appear once.");

  try {
    // [A-667 R5] 대기 상한 + 시도 토큰: 시간이 다 된 뒤의 늦은 결과는 recoverPiggy 안에서 서명자·저장 전에 버려진다.
    await boundAuthAttempt(attempt, trackPlatformAuth(recoverPiggy({ isCurrent: () => attempt.live, pin })));
    recovered = true;
    if (pin && lateCreatedCredential === pin) lateCreatedCredential = null;
    clearTimeout(attempt.timer);
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
    // [A-667 R2] 받음 표시는 보조 표식이다 — 신원(credential·address)은 recoverPiggy 가 이미 한 덩어리로 저장했다.
    // 이 쓰기 하나가 실패했다고 되찾은 Piggy 를 "못 찾음" 으로 바꾸고 서명자를 남기지 않는다.
    try { localStorage.setItem(PIGGY_RECEIVED_KEY, "1"); } catch { /* credential 표식만으로 충분 */ }
    if (!finishAuthAttempt(attempt)) return { ok: false, cancelled: false, reason: "superseded" };
    released = true;
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
    // [A-667 R5] 이미 정리된(만료·대체된) 시도의 실패는 더 새로운 화면·서명자를 건드리지 않는다.
    if (!released && !finishAuthAttempt(attempt)) return { ok: false, cancelled: false, reason: "superseded" };
    // [A-667 R3] 되찾기가 성공한 뒤 이어진 단계가 실패했다면 방금 연 서명자를 남기지 않는다.
    if (recovered) endActiveSession();
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
// [A-667] 한 탭 = 한 시도(attempt 토큰). requestPrf 를 **부른 뒤에만** 화면 대기 상한 타이머를 걸고 확인 중 모습을
// 그린다(render) — WebAuthn 호출 앞 동기 체인은 그대로다. 시도는 성공 또는 재시도 가능한 실패 카드로 반드시 끝난다.
function unlockApp() {
  const lock = state.appLock;
  if (!lock || lock.phase === "checking") return;
  const pinned = state.credential;
  if (!pinned || typeof pinned.credentialId !== "string" || !pinned.credentialId || !isAllowedPiggyRpId()) {
    settleUnlock(null, null, pinned);
    return;
  }
  // [A-687 capability preflight] get 을 못 쓰는 기기면 lock.phase/attempt/requestPrf 전에 같은 fail-closed 실패 카드(Try again 하나)로.
  // 취소가 아니다 — 이름이 NotAllowedError 가 아니므로 cancelled 로 읽히지 않는다.
  if (typeof webAuthnUnsupported === "function" && webAuthnUnsupported("get")) {
    const unsupported = new Error("webauthn unsupported");
    unsupported.name = "WebAuthnUnsupported";
    settleUnlock(null, unsupported, pinned);
    return;
  }
  const attempt = { timer: null };
  lock.phase = "checking";
  lock.cancelled = false;
  lock.attempt = attempt;
  requestPrf(pinned, { prfSalt: storedPrfSalt() }).then(
    (result) => settleUnlock(result, null, pinned, attempt),
    (error) => settleUnlock(null, error, pinned, attempt),
  );
  attempt.timer = setTimeout(() => settleUnlock(null, unlockWaitTimeoutError(), pinned, attempt), UNLOCK_UI_WAIT_MS);
  render();
}

// [A-667] 잠금 해제 시도 하나의 화면 대기 상한. iOS Safari 는 WebAuthn publicKey.timeout(120s)을 시트가 아예 안 뜬
// 경우에 지키지 않을 수 있다(A-665 실기기: 탭 후 "Checking…" 영구 정지). 그래서 앱이 직접 끝을 낸다 — 45s 는
// Face ID 두 번 실패 → 기기 암호 입력까지 끝낼 만큼 길고, WebAuthn 120s 보다 짧아 앱이 늘 먼저 통제를 되찾는다.
// 시간이 다 되면 기존 실패 카드(Try again 하나)로 fail-closed. 그 뒤 늦게 온 결과는 attempt 가 달라 무시된다.
const UNLOCK_UI_WAIT_MS = 45_000;
function unlockWaitTimeoutError() {
  const error = new Error("unlock wait elapsed");
  error.name = "UnlockWaitTimeout";
  return error;
}

function settleUnlock(result, error, pinned, attempt = null) {
  const same = !!result && !!pinned && typeof result.credentialId === "string" && result.credentialId === pinned.credentialId;
  if (result && result.prfOutput instanceof Uint8Array) result.prfOutput.fill(0);
  const lock = state.appLock;
  if (!lock) return;
  // [A-667] 시간이 다 됐거나 새 시도로 대체된 시도의 결과는 잠금을 풀지도, 상태를 바꾸지도 못한다.
  if ((lock.attempt || null) !== attempt) return;
  if (attempt) clearTimeout(attempt.timer);
  lock.attempt = null;
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
  // [A-699 M2-alpha] The receipt save is verified (rememberReceipt re-reads storage) and can no longer throw out of
  // here: money that already moved must not turn into "couldn't finish" because a storage write failed.
  let receiptSaved = false;
  if (trip.receipt) {
    try {
      receiptSaved = rememberReceipt(trip.receipt) === true;
    } catch {
      receiptSaved = false;
    }
  }
  if (trip.outcome !== "done") {
    // 돌아왔다고 말하지 않는다 — 실패 경로에서는 "성공 귀환" 쪽 상태를 하나도 세우지 않는다.
    setScene("sendstay", "couldn't finish this one.");
    return;
  }
  // [A-699 M2-alpha] State order on success: execution truth (done) -> durable receipt -> verified re-read -> pending clear.
  // The pending Send record is cleared only after the receipt is verified in storage AND only if it is still the very
  // record this receipt belongs to (stage redeem-broadcast with the same redeem hash) — compare-and-clear. No verified
  // receipt (none could be built, save/verify failed) = pending stays; the lock holds and the next reconcile retries.
  if (receiptSaved) {
    try {
      const stored = readSendPending();
      const doneHash = trip.receipt.redeemTxHash || trip.receipt.txHash;
      if (stored && stored.stage === "redeem-broadcast" && doneHash && stored.redeemTxHash === doneHash) {
        localStorage.removeItem(SEND_PENDING_KEY);
      }
    } catch {
      /* the record stays; reconcile will compare again */
    }
  }
  state.tripClosed = true;
  try {
    localStorage.setItem(TRIP_CLOSED_KEY, "1");
  } catch {
    /* in-memory flag stands; the verified receipt / pending record carry the durable truth */
  }
  // [이번 dispatch, Owner GO 2026-09-18 "다른 건 지우라고. 지금 승인한 최신 게 확정"]
  // 여기 있던 `state.awayLine = "It's back.";` 를 지웠다 — 이 값은 어디에서도 렌더되지
  // 않는 죽은 대입이었다(renderReturn() 은 `line: ""` 만 넘긴다 — 3611행 근방 A-411-i
  // 주석; renderAway() 도 그 자리를 `""` 로 비운다 — A-415/A-414-a). 이 씬에 남는 유일한
  // 발화는 아래 returnArrivalAlarm 의 "[이름] is coming home" 한 줄뿐이다(단일 발화 증거
  // 는 grep, OUTBOX/보고 참고).
  // [A-320] 실제 영수증이 있는 성공에서만 귀환 연출로 들어간다.
  // 영수증이 없으면 기존 「확인 중」 경로를 그대로 둔다 — 없는 값을 만들지 않는다.
  // transient 플래그라 새로고침·재방문에서는 다시 재생되지 않는다.
  if (trip.receipt && receiptSaved) {
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
    // [A-699 M2-alpha] An unreadable store is NOT "nothing in flight" (that let a second Send start with a possibly
    // live record behind the read error). Unreadable = unconfirmed, same fail-closed shape as an unrecognizable record.
    return { stage: "unknown" };
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
  const json = JSON.stringify({ ...entry, at: Date.now() });
  // [A-699 M2-alpha] Verified write: a record that did not land must not be treated as written. A throw here is
  // the existing "stop" contract (before the deposit it means nothing is sent). One retry, then read back.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      localStorage.setItem(SEND_PENDING_KEY, json);
      if (localStorage.getItem(SEND_PENDING_KEY) === json) return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error("send_pending_unverified");
}

function computeTripClosed({ tripClosedFlag, txHash, pending }) {
  if (tripClosedFlag === "1") return true;
  if (pending) return false;
  return !!txHash; // 옛 txHash-only 사용자 다리(A-048) — 새 코드는 확정 전 txHash 를 쓰지 않는다.
}

function sendBusy() {
  return sendInFlight || !!readSendPending();
}

// 확정 성공 뒤에만: txHash 확정값 저장. 미확정 기록 제거는 finishTrip 이 영수증 저장·재읽기 확인 뒤에 한다([A-699]). tripClosed 는 finishTrip 이 세운다.
function commitSendSuccess(redeemTxHash) {
  // [A-699 M2-alpha] No longer clears the pending record: the clear moved behind the verified receipt save
  // (finishTrip success branch, compare-and-clear). A storage failure here must not read as a failed trip.
  try {
    localStorage.setItem("araso.txHash", redeemTxHash);
  } catch {
    /* durable truth stays in the pending record until the receipt is saved */
  }
  state.txHash = redeemTxHash;
}

// [A-444] 실제 Send 버튼 상태는 이 한 곳에서 정한다 — origin 막힘·진행 중·미확정 기록 중 하나라도
// 있으면 잠그고, 모두 없으면 푼다(broadcast 전 안전 실패 뒤 다시 쓸 수 있게). 새 렌더·문구 0.
function syncSendButton() {
  const btn = document.querySelector("#sendButton");
  if (!btn) return;
  // The first send is a testnet-only path (see LEGACY_TESTNET_PATH). `typeof`: existing tests run
  // this function cut out on stubs where the module const does not exist; in the app it always does.
  const sealed = typeof LEGACY_TESTNET_PATH === "boolean" && LEGACY_TESTNET_PATH !== true;
  const locked = sealed || !isAllowedPiggyRpId() || sendBusy();
  btn.disabled = locked;
  if (locked) btn.setAttribute("aria-disabled", "true");
  else btn.removeAttribute("aria-disabled");
}

async function sendPiggy() {
  // [A-441] 두 번째 호출·미확정 기록이 있으면 아무것도 시작하지 않는다.
  if (sendInFlight) return;
  // Testnet-only path: off the testnet profile nothing starts — no grant, no auth prompt, no
  // sign, no send, and the testnet pending record is not read. Existing copy, no new words.
  if (typeof LEGACY_TESTNET_PATH === "boolean" && LEGACY_TESTNET_PATH !== true) {
    setScene("sendstay", "Piggy can't go out yet.", "");
    return;
  }
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
    // [A-698 M3] Send 복구는 Check/Open 과 같은 시도 칸(authAttempt)·플랫폼 요청 표(platformAuthInflight)를 나눠 쓴다 —
    // 이미 살아 있는 시도나 아직 안 끝난 플랫폼 요청이 있으면 두 번째 WebAuthn get 을 겹쳐 내지 않고 기존 실패 문구로
    // fail-closed(자동 재시도 0 · 새 문구 0). get 을 못 쓰는 기기도 시도 토큰 전에 같은 실패로(A-687).
    if (authAttempt || platformAuthInflight || (typeof webAuthnUnsupported === "function" && webAuthnUnsupported("get"))) {
      state.authPhase = "idle";
      state.authCancelled = false;
      setScene("birth", "Chog could not wake Piggy.", "");
      return;
    }
    const attempt = beginAuthAttempt("send");
    setScene("sendstay", "Piggy is waking up.", "Face ID may appear once.");
    try {
      // 대기 상한 + 시도 토큰: 앱 세션이 끝난(idle 잠금) 뒤 늦게 온 패스키는 recoverPiggy 안에서 서명자·저장 전에 버려진다.
      await boundAuthAttempt(attempt, trackPlatformAuth(recoverPiggy({ isCurrent: () => attempt.live })));
    } catch (error) {
      // 이미 무효가 된(idle 잠금·대체) 시도의 실패는 화면·서명자·돈 흐름을 건드리지 않는다.
      if (!finishAuthAttempt(attempt)) return;
      noteRecoverFailure();
      state.authPhase = "idle";
      state.authCancelled = isCancelledAuthError(error);
      recordSafeError("recover", error);
      setScene("birth", "Chog could not wake Piggy.", "");
      return;
    }
    // 늦은 성공도 마찬가지 — 시도가 이미 무효면 grant·simulate·서명으로 넘어가지 않는다.
    if (!finishAuthAttempt(attempt)) return;
    noteRecoverSuccess();
  }

  // [A-698 M3] 최소 잠금 가드: 앱이 잠겨 있으면 돈 실행(grant·simulate·서명·broadcast)으로 넘어가지 않는다.
  // 기존 실패 경로·기존 문구 그대로. 남은 서명자가 있으면 함께 정리한다.
  if (state.appLock) {
    endActiveSession();
    state.authPhase = "idle";
    state.authCancelled = false;
    setScene("birth", "Chog could not wake Piggy.", "");
    return;
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
    // [A-499 Lane R / A-663] 실행 어댑터가 채우는 자리 — commitSecondReceiptIfReal() 이 이
    // 값을 second-journey-receipt-bridge.js 로 넘긴다. 오늘 이 값을 실제로 채우는 유일한
    // 경로는 A-663 LOCAL_ONLY harness(runLocalSecondPlumbingProofIfHarnessed/
    // reconcileLocalSecondPlumbingProofIfHarnessed, LOCAL_DEV_ENTRY 밖에서는 존재조차 않음)
    // 뿐이다 — Explore/candidates/handleSecondSend 는 이 필드를 절대 건드리지 않는다(Owner
    // 교정: shMON 은 Second 제품 목적지가 아니다). renderSecondReturn() 이 mockReceipt 보다
    // 우선해서 읽는다 — 있으면 실제 값, 없으면(모든 제품 경로) 기존 동작 그대로.
    executionReceipt: null,
    awayLine: "",
    // [A-405/A-405-a, 라운드 수 일반화 A-663] seedStage: 0 | 1 | … | "done" — 최초 seed
    // (관심0/이벤트0)만 라운드 0 부터 차례로(한 라운드당 MAX_EXPLORE_VISIBLE개) 거친다.
    // 반복 방문·edit interests 는 항상 "done"(단일 bounded 세트). 새 persisted 필드를
    // 추가하지 않는다 — ensureSecondJourneyDomainState() 가 이미 들고 있는
    // domainState.interests/processedEventIds 에서 매번 다시 유추한다(inferSeedStage).
    // 그래서 새로고침해도 "이미 관심이 있다/이미 라운드 0 을 한 번 none 했다"는 사실은
    // 살아남는다 — 다만 "마지막 라운드까지 갔었다"는 이 세션 메모리에만 있고 새로고침
    // 중간에 끊기면 done(반복 모드)으로 떨어진다(§UNKNOWN, OUTBOX 보고, 라운드가 2→3개로
    // 늘며 더 뚜렷해진 기존 한계 — PREWRITE_REVIEW §2(f)).
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
// 그대로 두고, 이 view/delivery 경계에서만 자른다(§success_criteria "표시 개수와 실제
// 선택가능 ids 일치, all=현재 제시목록"). job-feed.js 는 고치지 않는다.
// [A-663 OWNER UX CORRECTION/DESIGN RESOLUTION, 2026-10-01] 5 → 3 — "이 구현에서는 한 번에
// 최대 3개"(전체 Job 우주가 3개라는 뜻이 아니다). 옛 A-405 "최대 5개" 는 이 값으로 대체된다.
const MAX_EXPLORE_VISIBLE = 3;
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

// [A-663] seedStage 는 이제 **라운드 인덱스**(0, 1, 2, … — 세트 하나당 MAX_EXPLORE_VISIBLE
// 개) 또는 "done" 이다. 옛 이름("A"/"B" 두 세트짜리 이원 모델)을 그대로 쓰지 않는다 — 8개
// 정본에 3개 cap 이면 세트가 3개(0/1/2)가 되고, 둘로는 전체 공간을 못 덮는다. 세트 수는
// job-feed.js 의 8개 정본을 다시 세지 않고 매번 buildVisibleLaneChoices().length 에서
// 구한다(§A-663 ROTATION CONTRACT "성명/개수를 다시 발명하지 않는다"). 라운드 자체는
// 새 persisted 필드를 추가하지 않고(Q2 기본값의 "가능하면 기존 필드로" 쪽) 여전히
// domainState.interests/processedEventIds 에서 매번 다시 유추한다 — 그래서 새로고침해도
// "이미 관심이 있다/이미 한 세트를 none 했다"는 사실은 살아남는다. 다만 "세트 1 을 넘어
// 세트 2 까지 갔었다"는 사실 자체는 세션 메모리에만 있고(옛 A/B 때도 같은 한계였다,
// NOTES_explore_page.md §18.3) 새로고침이 세트 0→1→2 진행 중간에 끊기면 그 라운드부터
// 다시 유추한다 — processedEventIds.length 가 라운드 수를 그대로 센다(라운드가 늘어난
// 만큼 더 뚜렷해진 한계일 뿐, 새로 만든 결함은 아니다. PREWRITE_REVIEW §2(f) 참고).
function exploreRoundCount() {
  const total = buildVisibleLaneChoices().length;
  return Math.max(1, Math.ceil(total / MAX_EXPLORE_VISIBLE));
}

// domainState 가 진짜 "한 번도 Explore 선택을 한 적 없는" 상태인지, 있다면 몇 번째
// 라운드인지 본다. 새 persisted 필드를 추가하지 않고 이미 있는 두 필드로만 유추한다:
//   interests.length>0            → 이미 뭔가 골랐다 — seed 대상 아님(done)
//   processedEventIds.length===0  → 이 계정/체인 scope 에서 저장 이벤트 자체가 0 —
//                                    최초 세트(라운드 0)
//   processedEventIds.length===N  → interests 가 비었는데 이벤트가 N 개 있다 = 라운드
//                                    0..N-1 을 차례로 none 으로 처리했다(현재 코드 경로에서
//                                    interests 가 비어 있는 동안 processedEventIds 를
//                                    늘리는 곳은 applyExploreSelection 의 none/unsure
//                                    분기뿐이다) — 라운드 N (N < 전체 라운드 수일 때만)
//   그 외                          → 이미 모든 라운드를 거쳤거나 반복 방문 — done
function inferSeedStage(domainState) {
  if (!domainState) return 0;
  if ((domainState.interests || []).length > 0) return "done";
  // [A-663 state/receipt review fix 2] processedEventIds is a SHARED counter across every
  // receipt kind this account/chain ever commits — second-journey-state.js's own
  // markProcessed helper (called from the receipt-bridge's commit path and from
  // applyExploreSelection alike) pushes the eventId of any receipt — the existing A-579
  // action-0 decision receipt, and now the A-663 plumbing-proof receipt — into that exact
  // same array. Counting all of them would let an unrelated receipt commit (e.g. a LOCAL_ONLY
  // harness plumbing-proof run that has nothing to do with Explore) silently advance the
  // Explore round the user never asked to leave. Only Explore's own "none" events are counted
  // here — they are the only events exploreEventId("none", …) ever produces, always prefixed
  // "explore-none-".
  const noneEvents = (domainState.processedEventIds || []).filter(
    (id) => typeof id === "string" && id.startsWith("explore-none-"),
  ).length;
  if (noneEvents <= 0) return 0;
  if (noneEvents < exploreRoundCount()) return noneEvents;
  return "done";
}

// 지금 이 순간 카드에 실제로 그려질(=선택 가능한) errand 목록. job-feed.js 의 8개 정본
// 순서(baseScore desc)는 그대로 인용만 하고 여기서 최대 MAX_EXPLORE_VISIBLE(3)개로 자른다.
//   seedStage 가 숫자(라운드 인덱스) → 그 라운드의 연속 슬라이스 — 모자라도(마지막
//                    라운드가 3개보다 적을 수 있다) 다른 걸 더 넣거나 합성하지 않는다
//                    ("never fabricate filler", A-663 ROTATION CONTRACT)
//   그 외("done"/edit) → 이미 선택된 id 를 먼저 지키고, 남는 자리를 정본 순서로 채운다
//                    (edit interests 로 돌아왔을 때 이미 체크된 항목이 화면 밖으로
//                    밀려나 "표시id != 선택가능id" 가 되는 것을 막는다)
function computeExploreDisplayErrands(sj) {
  const all = buildVisibleLaneChoices();
  if (typeof sj?.seedStage === "number") {
    const numRounds = exploreRoundCount();
    // 범위를 벗어난 라운드(손상된 값)는 마지막 라운드로 접는다 — 빈 목록을 내지 않는다.
    const round = Math.min(Math.max(sj.seedStage, 0), numRounds - 1);
    const start = round * MAX_EXPLORE_VISIBLE;
    return all.slice(start, start + MAX_EXPLORE_VISIBLE);
  }
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
  // RUNTIME_CHAIN_SCOPE comes from the chain profile ("" when blocked: every store refuses it).
  // `typeof`: existing tests run this function cut out on stubs where the module const does not
  // exist (testnet semantics there); in the app it is always declared, so this never falls back.
  return { accountId: state.address || "", chainId: typeof RUNTIME_CHAIN_SCOPE === "string" ? RUNTIME_CHAIN_SCOPE : "monad-testnet" };
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
  // [A-663] 옛 2라운드 시절의 draft.seedStage("A"/"B")를 새 라운드 인덱스(0/1)로만
  // 치환해서 읽는다 — 저장 포맷 자체는 바꾸지 않는다(second-journey-state.js 는 이
  // 필드를 불투명하게 그대로 저장/복원한다). `0`은 falsy 라 `||` 로 기본값을 잡으면
  // 라운드 0 이 사라지므로 `!= null` 로 명시한다.
  const legacySeedStage = draft.seedStage === "A" ? 0 : draft.seedStage === "B" ? 1 : draft.seedStage;
  const displayedIds = computeExploreDisplayErrands({ ...sj, seedStage: legacySeedStage, selectedIds: draft.selectedIds })
    .map((errand) => errand.id);
  const known = new Set(buildVisibleLaneChoices().map((choice) => choice.id));
  const selected = (draft.selectedIds || []).filter((id) => known.has(id));

  sj.seedStage = draft.seedStage != null ? legacySeedStage : sj.seedStage;
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
  // [A-663] seedStage 가 이제 숫자(라운드 0 포함)일 수 있다 — `||` 는 0 을 falsy 로 접어
  // "a" 로 뭉개버리므로 null/undefined 일 때만 그 자리표시자를 쓴다.
  const stage = seedStage === null || seedStage === undefined ? "a" : seedStage;
  return `explore-${action}-${stage}-${[...ids].sort().join(",")}`;
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

// [A-663 OWNER UX CORRECTION — LEARNING SEMANTICS] none 은 항상 weak hint 만 남긴다
// (applyExploreSelection 의 addsInterest 는 kind:"none" 에서 false — 기존 관심 삭제0/
// 신규 관심 추가0). "다른 세트 보기"는 회전 요청이지 취향 비선호가 아니다("Do NOT
// increment reasonDislike simply because the user asks to see more") — 보여준 세트
// 전부에 reasonDislike 를 올리던 옛 "none" 신호 대신 중립 신호 "explore_rotation"을
// updatePreference 에 보낸다. job-selector.js updatePreference()는 "select" 가 아닌
// kind 를 그대로 통과시키고(normalizeSignal), "none"/"unsure"/"one"/"multi"/"all" 중
// 어디에도 안 걸리는 kind 는 confidence/explorationWidth/reasonDislike 어디에도 손대지
// 않는다(job-selector.js 자체는 고치지 않았다 — 새 kind 문자열 하나만 쓴다, 기존 중립
// 통로 재사용). rule_nah/safety_nah/eligibility_nah/unavailable/unknown 은 애초에 이
// 함수를 거치지 않는다(§second-job-readiness.js 게이트가 그 전에 걸러낸다) — 취향
// 학습으로 전혀 섞이지 않는다. applyExploreSelection 의 selection.kind 는 여전히
// "none"이다 — 저장 스키마·processedEventIds 카운트(라운드 유추의 근거)는 그대로다.
// 그 다음 어디로 가는지만 seedStage(라운드 인덱스 또는 "done")로 갈린다:
//   아직 안 보여준 라운드가 있음 → Chog "…none?"(최초 라운드, 정본 그대로) /
//                "not these?"(그 다음부터) · Paper "okay. one more." 를 같은 interests
//                화면에 얹고 다음 라운드로 목록만 교체(타이머 없음 — 카드 이탈 전까지
//                그대로 보인다)
//   더 볼 라운드가 없음(마지막 라운드) → 종결 note("okay."/"maybe later.") 뒤 Home
//   그 외(반복 방문, seedStage "done") → 종결 note 두 걸음("not these?"/"for now." 뒤
//                "maybe later.") 뒤 Home
function handleExploreNone() {
  const sj = state.secondJourney;
  const domainState = ensureSecondJourneyDomainState();
  const selection = { kind: "none", errandIds: [], errands: [] };
  // [A-472] none 도 같은 규율 — 보여준 세트만 evidence 로 쓴다(안 보여준 항목 0).
  const displayedNone = computeExploreDisplayErrands(sj);
  const preferenceUpdate = updatePreference(domainState.preference, {
    kind: "explore_rotation",
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

  if (typeof sj.seedStage === "number") {
    const numRounds = exploreRoundCount();
    if (sj.seedStage < numRounds - 1) {
      const isFirstRound = sj.seedStage === 0;
      sj.seedStage += 1;
      sj.interestsNote = { chogLine: isFirstRound ? "…none?" : "not these?", paperLine: "okay. one more." };
      sj.step = "interests";
      recomputeSecondJourneyFlow();
      render();
      return;
    }
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

// [A-663] LOCAL_ONLY harness-only entry point for the Second-owned execution PLUMBING PROOF
// (second-execution-adapter.js). Same first lock as the two hooks above: outside
// LOCAL_DEV_ENTRY this is never reachable, so the production/default app never runs it. Unlike
// the two hooks above (which only ever hand back passive config data the product's own code
// path reads), this one is itself the entry point a coordinator-driven browser test calls
// directly (`window.__ARASO_LOCAL_TEST_SECOND_PLUMBING_RUN__`) against a local/mock RPC —
// there is no product UI path to it (not Explore, not candidates, not handleSecondSend/canSend)
// because, per the A-663 Owner correction, this lane is never a Second Journey product
// destination. `request.deps` supplies every live client (account/walletClient/publicClient/
// signDigest, and optional requestGrant/waitForGrantBalance) — this function opens no network
// connection and holds no credential of its own. On a real `outcome:"done"` it feeds the result
// into the existing Second receipt bridge via commitSecondJourneyReceipt() — a new,
// testnet-actual call site the card asks for (distinct from the existing J2-6 mainnet-fork
// decision path call site above, untouched; reconcileLocalSecondPlumbingProofIfHarnessed
// below has its own third call site for the reload/reopen path, same reason First has two —
// commitSendSuccess is called both from the direct success path and from reconcileSendPending).
async function runLocalSecondPlumbingProofIfHarnessed(request = {}) {
  if (!LOCAL_DEV_ENTRY) return { ran: false, reason: "not_local_dev_entry" };
  const deps = request && typeof request === "object" ? request.deps : null;
  if (
    !deps ||
    typeof deps.walletClient?.sendTransaction !== "function" ||
    typeof deps.publicClient?.waitForTransactionReceipt !== "function" ||
    typeof deps.publicClient?.readContract !== "function" ||
    !deps.account?.address
  ) {
    return { ran: false, reason: "invalid_deps" };
  }
  const scope = secondJourneyScope();
  if (validatePersistenceScope(scope).error) return { ran: false, reason: "invalid_scope" };
  const piggyId = typeof indexedPiggyId === "function" ? indexedPiggyId(deps.account.address) : "";
  const outcome = await runSecondPlumbingProof({
    storage: safeLocalStorage(),
    scope,
    piggyId,
    amountWei: request.amountWei,
    confirm: request.confirm === true,
    account: deps.account,
    walletClient: deps.walletClient,
    publicClient: deps.publicClient,
    signDigest: deps.signDigest,
    requestGrant: deps.requestGrant,
    waitForGrantBalance: deps.waitForGrantBalance,
  });
  if (outcome.outcome === "done" && outcome.receipt) {
    const sj = state.secondJourney;
    // [A-663 state/receipt review fix 3] set BEFORE the bridge call so a product render of
    // secondReturn (never triggered by this harness itself — no setScene here) would already
    // see the real result if something else drove the scene there.
    sj.executionReceipt = outcome.receipt;
    const out = commitSecondJourneyReceipt({
      state: sj.domainState || ensureSecondJourneyDomainState(),
      receipt: outcome.receipt,
      scope,
      storage: safeLocalStorage(),
      context: { devPreview: false },
    });
    sj.domainState = out.state;
    return { ran: true, outcome, committed: out.persisted, duplicate: out.duplicate, commitReason: out.reason };
  }
  return { ran: true, outcome, committed: false, duplicate: false };
}
// [A-663] LOCAL_ONLY harness-only reload/reopen reconcile for the same plumbing-proof lane.
// Read-only (no sendTransaction/signDigest) — a coordinator browser test writes a pending
// record (simulating a reload mid-flow), reloads, then calls this to prove reconcile never
// re-broadcasts and only clears the record on a confirmed success.
async function reconcileLocalSecondPlumbingProofIfHarnessed(request = {}) {
  if (!LOCAL_DEV_ENTRY) return { ran: false, reason: "not_local_dev_entry" };
  const deps = request && typeof request === "object" ? request.deps : null;
  if (!deps || typeof deps.readTxReceipt !== "function" || !deps.account?.address) {
    return { ran: false, reason: "invalid_deps" };
  }
  const scope = secondJourneyScope();
  if (validatePersistenceScope(scope).error) return { ran: false, reason: "invalid_scope" };
  const piggyId = typeof indexedPiggyId === "function" ? indexedPiggyId(deps.account.address) : "";
  const result = await reconcileSecondPendingOnBoot({ storage: safeLocalStorage(), scope, piggyId, readTxReceipt: deps.readTxReceipt });
  if (result.kind === "success" && result.receipt) {
    const sj = state.secondJourney;
    sj.executionReceipt = result.receipt; // [A-663 state/receipt review fix 3], same reasoning as above
    const out = commitSecondJourneyReceipt({
      state: sj.domainState || ensureSecondJourneyDomainState(),
      receipt: result.receipt,
      scope,
      storage: safeLocalStorage(),
      context: { devPreview: false },
    });
    sj.domainState = out.state;
    return { ran: true, result, committed: out.persisted, duplicate: out.duplicate };
  }
  return { ran: true, result, committed: false, duplicate: false };
}
if (LOCAL_DEV_ENTRY) {
  try {
    window.__ARASO_LOCAL_TEST_SECOND_PLUMBING_RUN__ = runLocalSecondPlumbingProofIfHarnessed;
    window.__ARASO_LOCAL_TEST_SECOND_PLUMBING_RECONCILE__ = reconcileLocalSecondPlumbingProofIfHarnessed;
  } catch {
    /* no window (non-browser harness) — nothing to expose */
  }
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
    // [A-656 decision 3] Chog does not move because Piggy is Away — keep it at the same Home
    // anchor (mobile floor / mid-band) the settled Home cluster uses.
    applyHomeFloorToChogOnly(boardFit);
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
      applyHomeFloorToChogOnly(fitHomeBoard());
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
    // [A-656 OWNER CORRECTION] Departure start must share the same Home floor/mid-band
    // baseline Return already carries — see applyHomeFloorToDepartCanvas() above.
    applyHomeFloorToDepartCanvas(canvas);
    // [A-656 decision 3] Chog does not move because Piggy is Away — same Home anchor on resize.
    applyHomeFloorToChogOnly(fitHomeBoard());
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

// [A-663 state/receipt review fix 3] card success criteria "Return/Receipt consumes actual
// execution result when present and dev/mock remains isolated". `state.secondJourney.
// executionReceipt` is set ONLY by the A-663 LOCAL_ONLY harness (never by Explore/candidates/
// handleSecondSend — shMON stays non-Send-visible per the Owner correction), so on every
// product path today this is null and the branch below is a no-op: byte-identical mockReceipt
// behavior. `receiptPaperFields()` is the EXISTING real-receipt formatter First Journey's own
// Receipt/filebox already use (receipt-paper.js:77) — no new markup/copy, same Receipt slots.
function renderSecondReturn() {
  const actual = state.secondJourney.executionReceipt;
  const hasRealReceipt = !!actual && typeof actual === "object" && !isDevMockReceipt(actual);
  return returnSceneMarkup({
    // [A-421] Owner 승인 "가운데 문구가 남으면 안돼" — First(line: "")와 동일, 발화는 알람 한 줄뿐.
    line: "",
    receiptRowsMarkup: receiptPaperMarkup(
      hasRealReceipt
        ? receiptPaperFields({ receipt: actual, name: displayPiggyName() })
        : secondJourneyReceiptFields(state.secondJourney.mockReceipt, displayPiggyName()),
    ),
    name: displayPiggyName(),
    // [A-421] First 와 **같은** 귀환 markup 경로 — 알람 발화 span(#returnArrivalAlarm)이
    // 여기서만 붙는다. 이전에는 plain chogHomeMarkup() 이라 Second 는 어떤 상태에서도
    // 알람 DOM 자체가 없었다(감독 OUTBOX 지적). 새 문구/새 자산 0 — 같은 함수 재사용.
    homeChogMarkup: chogHomeMarkupForReturn("return"),
    // 실제 receipt 가 있으면 "UI preview — no transaction" 은 더 이상 사실이 아니다 — 그
    // 문구만 숨긴다(새 문구를 더하지 않는다, 기존 reset 버튼 줄은 유지).
    devExtra: hasRealReceipt
      ? (isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : "")
      : `<p class="secondJourney__mockTag">UI preview — no transaction</p>${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}`,
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
    // [A-656 decision 4] Same Home anchor math (mobile floor / mid-band) as Home settled —
    // wraps #returnChogHop + #returnName, and hands the canvas consumer (return-view.js fit())
    // the viewport-space k/nudge it needs to resize/reposition itself the same way.
    fitBoard: () => {
      const fit = fitHomeBoard();
      const plan = applyHomeFloorToReturnCluster(fit);
      return { ...fit, floor: computeHomeFloorViewportNudge(plan, fit.s) };
    },
    // [A-681 FINAL CLOSEOUT A] mobile-only Receipt rail target (null at >640 -> legacy anchor).
    getReceiptRail: homeReturnReceiptRail,
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
    // [A-662] geometry-fit decision replaces the old flat `window.innerWidth <= 640` — see
    // computeHistoryFitMode().
    if (computeHistoryFitMode() === "stacked" && !anchor.hidden && !prefersReducedMotion()) {
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
  // [A-662] geometry-fit decision replaces the old flat `window.innerWidth <= 640` — see
  // computeHistoryFitMode(). Variable kept as a boolean "is HISTORY in stacked mode" (the
  // shift/inert branches below only ever cared about stacked-vs-not, never the raw width).
  const stackedMode = computeHistoryFitMode() === "stacked";
  const mount = document.querySelector(".homePaperMount");
  if (!mount) return;
  const shift = open && !stackedMode;
  if (mount.classList.contains("homePaperMount--twoCardShift") !== shift) setHomeTwoCardShift(shift);
  const background = open && stackedMode;
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

// [A-684] 옛 First/testnet 영수증의 값은 MON(wei)이다 — USD 평가 근거가 없으므로 "$" 를 붙이지 않고
// 정확한 토큰 단위로 그대로 보인다(없는 달러 환산 0). USD 평가가 생기는 최종 제품 정본(USD/USDC 우선)을
// 대체하지 않는 임시 fallback 이다. 값이 읽히지 않으면 "Unknown".
function formatMoney(wei) {
  // 자기 완결(다른 함수에 기대지 않는다) — 이 구역은 텍스트로 잘려 격리 컨텍스트에서도 돈다.
  let value;
  try {
    value = Number(formatEther(wei));
  } catch {
    return "Unknown";
  }
  if (!Number.isFinite(value)) return "Unknown";
  const fixed = value.toFixed(value !== 0 && Math.abs(value) < 0.001 ? 6 : 4);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return `${trimmed} MON`;
}

// File Box 3칸: settle() receipt 위에서만 그린다. 화면은 숫자를 따로 계산하지 않는다.
// [A-553 Lane B] add_money 영수증은 BigInt sent/gas/after 필드가 아예 없다 — 옛 필드로
// formatEther()를 부르면 던진다(감사 버그 3). **기존에 있던 라벨만** 보수적으로
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
// 원본 = 비공개 디자인 원본(이 저장소 밖).
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
// 원본(폰트 otf·풀사이즈 PNG)은 비공개 디자인 원본에만 둔다. 손글씨 두 줄은
// 폰트 파일을 배포하지 않으려고 낱말만 그림으로 렌더한 것이다.
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
  // [A-667] 실패 카드의 행동은 문맥마다 **하나**다(Owner: 두 버튼을 같은 문맥에 함께 두지 않는다).
  //  · 잠금 해제 실패/취소/시간초과(view.unlockRetry, renderAppLock 만 켬) → Try again 하나(#unlockRetryButton,
  //    renderAppLock 이 unlockApp 에 직결). Check Piggy 0.
  //  · 이 기기에 Piggy 표식(credential·받음·주소 — startPiggyOpen 과 같은 판정)이 있는 복구 문맥 → Check Piggy 하나.
  //    여기서 옛 Try again(→ Invite → startPiggyOpen)은 결국 같은 checkPiggy 라 같은 의도의 중복이었다.
  //  · 표식 없는 새 기기(find-first 되찾기 실패·취소 뒤, 또는 새 Piggy 만들기 실패 뒤) → Make new 하나
  //    (Owner 결정 2026-10-02 "같은 포맷으로 버튼은 하나인데 make new"). id 는 기존 #authTryAgainButton 그대로 —
  //    render() 의 기존 배선(→ setScene("received") = Invite)을 byte 동일하게 재사용한다. 거기서 사용자가 Open 을
  //    **다시 눌러야** startPiggyOpen → openPiggy(A-533 의 명시적 새 Piggy 경로)가 돈다. 자동 생성·credential 삭제 0.
  const recoveryOnly = !view.unlockRetry && !!(readCredential() || hasReceivedPiggy() || state.address);
  const body = checking
    ? view.detail || "Face ID may appear once."
    : view.authCancelled
      ? "Face ID was cancelled."
      : view.detail || "";
  // [A-391 §2 / A-389-a] Try again 은 실제 auth 호출이 없는 안전한 내비게이션(Invite/Face ID
  // 앞화면 복귀, main.js render() 의 #authTryAgainButton 배선 참고) — !isAllowedPiggyRpId() 로
  // 막을 이유가 없다. Check Piggy 는 실제 복구 호출이라 unsupported origin 에서 계속 막는다.
  const actions = checking
    ? ""
    : view.unlockRetry
      ? `
        <div class="authCard__actions">
          ${sendCardButtonMarkup({ id: "unlockRetryButton", label: "Try again", disabled: false })}
        </div>
      `
      : recoveryOnly
        ? `
        <div class="authCard__actions">
          ${sendCardButtonMarkup({ id: "checkButton", label: "Check Piggy", disabled: blocked })}
        </div>
      `
        : `
        <div class="authCard__actions">
          ${sendCardButtonMarkup({ id: "authTryAgainButton", label: "Make new", disabled: false })}
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
// + 카드 옆 기존 Chog(mountInviteChog) — 새 구도·새 그림 0(가장 가벼운 재사용, Owner 시각
// 검토 OPEN). 그 Chog 가 탭 대상이다 → unlockApp(). 실패면 같은 카드의 기존 실패 모습(Couldn't open Piggy)을
// 쓰되, 두 버튼 모두 잠금 해제 경로에만 묶는다: Try again → LOGIN_CHECKING 으로(인증 호출 0), Check Piggy →
// unlockApp()(탭 안에서 곧장). 생성·Hatch·서명자 0.
// [A-667] 위 두 버튼 배선은 바뀌었다 — 잠금 실패/취소/시간초과 카드에는 **Try again 하나만**(#unlockRetryButton)
// 있고, 그 클릭이 곧장 같은 unlockApp() 을 부른다(중간 대기 화면 0 · Piggy 복구/생성 0 · 탭 안에서 동기 호출).
// Check Piggy 는 이 카드에 그리지 않는다(복구 문맥 전용). 대기/확인 중 구분은 기존 data-app-lock 표식 + CSS 뿐.
// [A-640/A-642 Lane V] 대기(waiting/checking) 모습만 reentry_preview.html §1 모바일 구도로 바꾼다 — 카드 대신
// 큰 Chog 얼굴(기존 chogInviteMarkup() 파츠 중 머리+두 눈만, 몸·팔은 CSS 로 숨김) · 그 아래 Araso(기존
// arasoBrandMarkup(), 이 화면에서만 한 번) · Checking… · Face ID may appear once.(기존 문구 그대로). 탭 대상은
// 여전히 #loginChogButton → unlockApp() 하나(아래 배선 불변). 실패 모습은 기존 카드 그대로(renderAuthCard).
// 좌표 = §1 390 프리뷰 값(style.css .stage--loginCheck). 잠금은 appLockSurface()(≤640)에서만 생기므로 웹 0.
function loginCheckingMarkup(phase) {
  return `
    <section class="stage stage--loginCheck" data-scene="birth" data-app-lock="${phase}">
      <button class="loginCheck__face" id="loginChogButton" type="button" aria-label="Face ID">${chogInviteMarkup()}</button>
      ${arasoBrandMarkup()}
      <h1 class="loginCheck__title">Checking…</h1>
      <p class="loginCheck__body">Face ID may appear once.</p>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

function renderAppLock() {
  clearInviteTimers();
  const failed = state.appLock.phase === "failed";
  app.innerHTML = failed
    ? renderAuthCard({
        authPhase: failed ? "idle" : "checking",
        authCancelled: failed && !!state.appLock.cancelled,
        message: "",
        detail: "Face ID may appear once.",
        appLock: state.appLock.phase,
        chogTap: !failed,
        unlockRetry: true,
      })
    : loginCheckingMarkup(state.appLock.phase);
  mountInviteChog();
  if (failed) {
    document.querySelector("#unlockRetryButton")?.addEventListener("click", unlockApp);
  } else {
    document.querySelector("#loginChogButton")?.addEventListener("click", unlockApp);
  }
  if (isDevDebugOptIn()) document.querySelector("#resetButton")?.addEventListener("click", resetLocalTest);
}

// =======================================================================
// 탄생 한 바퀴 — 해치 → Name it → Save → 숨은 Piggy → 첫 Home  (A-292)
//
// 그림·박자·파츠 좌표는 전부 확정 보관본(비공개 모션 디자인 원본, connected 미리보기)
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
  // [A-662 OWNER DECISION — NAME/HATCH → HOME ENDPOINT CONTINUITY] see applyOnboardingPhoneFoot().
  applyOnboardingPhoneFoot();
  sceneListener(window, "resize", applyOnboardingPhoneFoot);

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
// [A-681 FINAL CLOSEOUT E — NAME IT: enlarge the COMPOSITION, not just the card] On a phone the whole
// 1280x800 board sits at the 0.42 floor, so the 460x300 card reads ~193x126 — far lighter than the
// First Send / Explore card (285x364). The card and the motion Piggy live in ONE scaled board
// (#nameScene) with authored coordinates (Piggy wrapper left 380 — name-piggy.html inline;
// card `.nameScene__pad` left 612 width 460 — style.css), and the peek/clip line, the arrival
// "standing" slide and the Save->Home start rect (read LIVE from `#namePiggy .pgsvg`) all depend on
// that relation. So the fix is a single mobile-only OUTER transform on the board — scale up and
// re-anchor — and NO internal coordinate or per-part size changes: card and Piggy grow by the
// same factor, Piggy stays the same secondary peek behind the card (ratio unchanged).
//   Fit rule (derived, not a px constant): the composition's authored horizontal extent
//   [NAME_COMP_LEFT, NAME_COMP_RIGHT] = [Piggy wrapper left, card right] must fit the mobile
//   content rail [--mobile-inset, vw - --mobile-inset]: scale = (vw - 2*inset)/(RIGHT-LEFT)
//   (390: 0.506, 430: 0.552 vs the old 0.42), capped by the board's natural HEIGHT fit (vh/800)
//   so short landscape phones never exceed the screen. Left-anchored on the rail
//   (tx = inset - LEFT*scale) so the card's right edge lands on the right rail margin. Only used
//   when it beats the existing floor scale; above 640 this whole block is skipped (identity).
//   Chog is a stage-level sibling on the separate onboarding anchor (applyOnboardingPhoneFoot): if
//   the grown card's bottom edge would run into Chog's box, the board is lifted by exactly the
//   overlap + one grid step (--grid-2), never above the Piggy wrapper's top reaching the top-safe.
const NAME_COMP_LEFT = 380;
const NAME_COMP_RIGHT = 612 + 460;
const NAME_CARD_BOTTOM = 292 + 300;
const NAME_PIGGY_WRAP_TOP = 252;
function nameCompositionFit(base) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!(vw <= 640)) return null;
  const inset = resolveCssLengthVarPx("--mobile-inset", 20);
  const comp = Math.min((vw - 2 * inset) / (NAME_COMP_RIGHT - NAME_COMP_LEFT), vh / 800);
  if (!(comp > base)) return null;
  const out = { scale: comp, tx: inset - NAME_COMP_LEFT * comp, ty: (vh - 800 * comp) / 2 };
  applyOnboardingPhoneFoot();
  const chog = document.querySelector(".nameScene__chog");
  const cr = chog ? chog.getBoundingClientRect() : null;
  if (cr && cr.width > 0 && cr.right > out.tx + 612 * comp) {
    const overlap = out.ty + NAME_CARD_BOTTOM * comp - (cr.top - resolveCssLengthVarPx("--grid-2", 8));
    if (overlap > 0) {
      const topSafe = resolveCssLengthVarPx("--mobile-top-safe", 14);
      out.ty = Math.max(out.ty - overlap, Math.min(out.ty, topSafe - NAME_PIGGY_WRAP_TOP * comp));
    }
  }
  return out;
}
function fitNameScene() {
  const board = document.querySelector("#nameScene");
  if (!board) return;
  const natural = Math.min(window.innerWidth / 1280, window.innerHeight / 800);
  const scale = Math.max(natural, NAME_SCENE_SCALE_FLOOR);
  board.style.transform = `translate(${(window.innerWidth - 1280 * scale) / 2}px, ${(window.innerHeight - 800 * scale) / 2}px) scale(${scale})`;
  // [A-681 FINAL CLOSEOUT E] mobile-only composition override of the line above (null = identity).
  const composed = nameCompositionFit(scale);
  if (composed) board.style.transform = `translate(${composed.tx}px, ${composed.ty}px) scale(${composed.scale})`;
  // [A-662 OWNER DECISION — NAME/HATCH → HOME ENDPOINT CONTINUITY] see applyOnboardingPhoneFoot().
  // `.nameScene__chog` is a `.stage`-level sibling of `#nameScene` (not inside this scaled board),
  // so it needs its own placement call here — piggybacking this function's existing mount+resize
  // wiring rather than adding a 2nd listener.
  applyOnboardingPhoneFoot();
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

// [A-603] 캐릭터 스케일 바닥 — A-602 Owner 프리뷰(Candidate C, c_floor.js)가 측정·검증한 그 메커니즘을 값·
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

// [A-681 OWNER DIRECTION 2026-10-03 item 1 — "enlarge the whole Chog+Piggy group"] Mobile-only
// (<=640) multiplier applied ON TOP of the existing HOME_CHAR_SCALE_FLOOR-derived k, everywhere
// that k feeds a transform/canvas size for the character group (applyHomeCharacterScaleFloor(),
// its read-only twin computeHomeCharScaleFloorPlan(), applyHomeFloorToDepartCanvas(), and
// mountSendCardWorkPose()'s fit()). HOME_CHAR_SCALE_FLOOR itself (0.52) is left untouched — three
// independent pre-existing contract tests (home-character-scale-floor.mjs, a605, a607, a610,
// a620, a656) lock its exact source text and value, and rewriting that shared literal is outside
// this card's scope. This boost is a separate, additive layer instead: every one of those
// consumers derives its own foot-anchor target via computeHomeFootTargetViewportY()
// independently of k (see each site's own `nudgeViewportY = target - natural`), so multiplying k
// by a constant factor cannot move the foot away from its already-correct target — only the
// cluster's size grows from that fixed foot ("foot anchor, grow upward", unchanged). Candidate
// value only — Iteration 1, picked as a conservative middle of a 0.70-0.90-equivalent effective-
// floor search range (0.52*1.5=0.78) pending the coordinator's real-browser measurement (this
// writer has no browser access); see receipts/A681_mobile_scale/VERIFY.md for the derivation and
// any later re-tune.
const HOME_CHAR_MOBILE_GROUP_BOOST = 1.5;
function homeCharMobileBoost() {
  return window.innerWidth <= 640 ? HOME_CHAR_MOBILE_GROUP_BOOST : 1;
}

// [A-681 iteration 2 — coordinator AFTER1 real-browser measurement] The floor transform anchors
// at the LOCAL point (HOME_CENTER,HOME_FLOOR), but the actually-drawn ink extends measurably
// BELOW that point (shoe/shadow) — empirically **12.48px, exactly consistent at both 390 and
// 430** in the pre-A-681 BEFORE capture (844-corrected: 716.17−703.69=12.48; 900-corrected:
// 762.86−750.38=12.48 — identical because `s·k_raw` is always exactly `HOME_CHAR_SCALE_FLOOR`
// whenever the floor is active, regardless of viewport). This overhang is part of the same
// scaled group `homeCharMobileBoost()` grows, so iteration 1's un-corrected
// `vh-bottomSafeMinPx` anchor target measured a 23.3px real ink-bottom gap instead of the
// planned ~42px (AFTER1: Home 23px, matches 42−12.48·1.5=23.3 algebraically). Subtracting the
// BOOSTED overhang from the anchor target cancels exactly this growth for any boost value
// (verified: at boost=1 it reduces to 42−12.48+12.48=42, i.e. a no-op had this always been
// here — it is only introduced now because only now does a boost make the gap drift).
// Zero at width>640, matching `homeCharMobileBoost()`'s own gate exactly, so the pre-existing
// 641–653 ratio-branch sliver is untouched.
const HOME_CHAR_FLOOR_INK_OVERHANG_PX = 12.48;
// [A-681 FINAL CLOSEOUT B — RIGHT SAFE RAIL] Coordinator pixel measure: the rightmost character
// ink sat 2px (390) / 12px (430 Home) / 9px (430 First Send, Explore) from the right edge vs the
// mobile rail (--mobile-inset 20/24). Owner: no <=5px edge kiss; solve by GROUP PLACEMENT, not by
// shrinking. The floor transform puts a board-local point P at viewport
//   x(P) = fitLeft + s*HOME_CENTER*(1-kb) + s*kb*P + nudgeX      (kb = k*boost, s*kb = FLOOR*boost)
// The rightmost character leaf is Piggy's seat box, P = HOME_SEAT_L + HOME_SEAT_W (un-trimmed
// leaf box, the same seatB edge placeHomeAmbientResidents uses; measured leaf right 387.8 @390
// == x(P) with nudgeX 6, so box ≈ ink). The nudge is therefore
//   nudgeX = min(HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX.x, (vw - --mobile-inset) - x(P)|nudgeX=0)
// i.e. never right of the old 6px, only pulled left as far as needed (≈ -18px @390 -> nudge -11.8,
// ≈ -15px @430 -> nudge -9.1). ONE helper feeds every consumer of the floor transform (Home, Chog-only
// Away/Return, Return cluster + canvas via computeHomeFloorViewportNudge, depart canvas, work-pose
// canvas) so continuity and the seat->Home foot relation hold. Scale untouched; y untouched. Identity
// when boost===1 (every width >640 / 641-653 sliver) -> returns the old constant exactly.
function homeFloorNudgeViewportX(s) {
  const base = HOME_CHAR_SCALE_FLOOR_NUDGE_VIEWPORT_PX.x;
  const boost = homeCharMobileBoost();
  if (!(boost > 1) || !(s > 0) || !(s < HOME_CHAR_SCALE_FLOOR)) return base;
  const kb = (HOME_CHAR_SCALE_FLOOR / s) * boost;
  const vw = window.innerWidth;
  const fitLeft = (vw - HOME_BOARD_W * s) / 2;
  const rightAtZeroNudge = fitLeft + s * HOME_CENTER * (1 - kb) + s * kb * (HOME_SEAT_L + HOME_SEAT_W);
  const inset = resolveCssLengthVarPx("--mobile-inset", 20);
  return Math.min(base, vw - inset - rightAtZeroNudge);
}
function homeCharFloorInkOverhangCorrectionPx() {
  return window.innerWidth <= 640 ? HOME_CHAR_FLOOR_INK_OVERHANG_PX * homeCharMobileBoost() : 0;
}

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
// 등)는 옛 화면 전용 표기(A-684 이후 "MON" 단위 접미, "$" 아님)라 여기서 재사용하지 않는다 — MON 을 USD 로 쓰지
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
// 인덱스 주소는 그 자체로 증명이 아니다 — 통과 못 하면 항상 같은
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
  let result = null;
  try {
    result = await requestPrf(request.credential, { prfSalt: request.prfSalt ?? null });
    ({ address } = activateSigningSession(result.prfOutput, { persistAddress: false }));
  } catch (error) {
    return { proof: null, error: "passkey_declined" };
  } finally {
    // [A-669] PRF 출력은 서명자 파생(activateSigningSession — Mera 가 키를 복사한다)에만 쓰고 성공·실패 모두 여기서 0 으로 지운다.
    if (result && result.prfOutput instanceof Uint8Array) result.prfOutput.fill(0);
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
  let result = null;
  try {
    // 여기서 실제로 Face ID/passkey 가 뜬다. 이 호출 없이는 봉투가 만들어지지 않는다.
    result = await requestPrf(request.credential, { prfSalt: request.prfSalt ?? null });
    ({ address: signerAddress } = activateSigningSession(result.prfOutput, { persistAddress: false }));
    verifiedAt = Date.now();
  } catch {
    // 취소/실패 — **돈도 투영도 건드리지 않는다.**
    const cancelled = cancelPermission("passkey_declined");
    state.moneyIntent = { ...intent, status: cancelled.state, permission: null };
    render();
    return;
  } finally {
    // [A-669] PRF 출력은 서명자 파생에만 쓰고(Mera 가 키를 복사한다) 성공·실패 모두 여기서 0 으로 지운다. 돌려주거나 보관 0.
    if (result && result.prfOutput instanceof Uint8Array) result.prfOutput.fill(0);
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
    ? `<p class="homePaper__note">Needs your OK — nothing has been sent yet.</p>
       <button class="homePaper__records" id="homePermissionApprove" type="button">&gt; Confirm with Face ID</button>`
    : intent.status === PERMISSION_STATE.PERMITTED
      ? `<p class="homePaper__note">Confirmed. Good for this one time only.</p>`
      : intent.status === PERMISSION_STATE.CANCELLED
        ? `<p class="homePaper__note">Confirmation stopped — nothing changed.</p>`
        : "";
  return `<div class="homePaper__intent">
    ${amountChoiceMarkup(choices, { selected: intent.amount })}
    ${confirmButtonMarkup({ enabled: valid && intent.status !== "awaiting_permission" })}
    ${permissionLine}
  </div>`;
}

// [A-644 2C] MY MONEY 에서 "고른 Piggy" = 사용자가 **행을 탭해** 고른 그 한 마리 — 행 탭은
// historyPiggyId(오른쪽 HISTORY)와 selectedPiggy(A-512 정본 선택)를 같은 id 로 함께 세운다.
// 둘이 같을 때만 고른 것으로 본다 → 표시된 고른 행 · 조작 깊이 · HISTORY 가 항상 같은 Piggy.
// (HOME 의 resident records 는 historyPiggyId 만 바꾸므로 여기서 "고름"이 되지 않는다.)
function myMoneySelectedPiggyId(piggies) {
  const id = selectedHistoryPiggyId();
  if (!id || state.selectedPiggy?.id !== id) return null;
  return piggies.some((p) => p.id === id) ? id : null;
}

// [A-644 2A/2B] 조작 깊이를 보여 줄 Piggy — **확정된 Second 완료 뒤에만**, 그리고 고른 Piggy
// 한 마리가 있을 때만. 둘 이상: MY MONEY 에서 고른 행. 한 마리: 그 행을 눌러 연 Piggy 상세.
// 그 밖(Second 전·실패·미확정, HOME 면, 선택 없음)은 null → 선택지 자체가 없다.
function controlModePiggyId() {
  if (state.secondJourneyCompletedOnce !== true || state.scene !== "sendstay") return null;
  const { piggies } = moneyPiggiesSnapshot();
  if (state.homePaperMode === "money" && piggies.length > 1) return myMoneySelectedPiggyId(piggies);
  if (state.homePaperMode === "piggyDetail" && piggies.length === 1) return piggies[0].id;
  return null;
}

function controlModeScope(piggyId) {
  return { ...secondJourneyScope(), piggyId };
}

// 선호(설정)만 읽어 그린다 — 권한·서명·tx·충전·Job 과 무관하다(A-644 forbidden).
function controlModeMarkupFor(piggyId) {
  if (!piggyId) return "";
  const { mode } = loadControlMode(safeLocalStorage(), controlModeScope(piggyId));
  return controlModeChoicesMarkup(CONTROL_MODE_OPTIONS, { selected: mode, piggyId });
}

// ─────────────────────────────────────────────────────────────────────────────
// [A-646 phase B] Add money — A-645 NEXT_APP_INPUT S1·S2·S4(UI)·S8·S9.
// 입구는 MY MONEY 안에만, **확정된 Second 뒤 + 조용한 Home(sendstay)** 에서만(Slice 1 과 같은 게이트).
// 한 마리 → 그 Piggy 로 곧장(A-508 picker skip). 둘 이상 → 한 화면 나눔 미리보기.
// 이 화면 어디서도 보내기 0 · 서명 0 · WebAuthn 0 · tx 0. 레일 0 → ok 뒤에는 기존 방법 목록이 정직하게 전부 비활성.
// 나눔 기억은 **미리 채우기**만(실행·확인 생략·추천 0). Home 은 돈·서명자를 갖지 않는다 — 받는 곳은 레지스트리의 각 Piggy.
// 상태는 이 종이가 MY MONEY 인 동안만 산다: 다른 면으로 가면 homePadMarkup 이 지운다(Gate Q4).
const ADD_MONEY_ASSET = "USDC";

function addMoneyEntryAllowed() {
  return state.secondJourneyCompletedOnce === true && state.scene === "sendstay" && state.homePaperMode === "money";
}

function addMoneyDecimals() {
  return FUNDING_CONTEXT_TOKEN_ALLOWLIST[secondJourneyScope().chainId]?.[ADD_MONEY_ASSET]?.decimals ?? null;
}

// 받을 수 있는 Piggy = 레지스트리/색인에 주소가 있는 Piggy. 목적지는 여기서만 온다(주소 입력 0).
function addMoneyPiggies() {
  return moneyPiggiesSnapshot().piggies.filter((p) => typeof p.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(p.address));
}

function bpsToPercentText(bps) {
  if (!Number.isInteger(bps)) return "";
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

function percentTextToBps(text) {
  const t = String(text ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  const bps = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return bps <= 10000 ? bps : null;
}

function addMoneyUnits(text) {
  const d = addMoneyDecimals();
  const t = String(text ?? "").trim();
  if (d === null || t === "") return null;
  return quantityToUnits(t, d);
}

function openAddMoney() {
  if (!addMoneyEntryAllowed()) return;
  const piggies = addMoneyPiggies();
  if (piggies.length <= 1) {
    const only = piggies[0] || null;
    state.addMoney = { kind: "single", piggyId: only?.id ?? null, name: only?.name || displayPiggyName() };
    return;
  }
  // 기억이 있으면 그 비율을 퍼센트 칸에 **숫자로만** 채운다. 없으면 모든 칸이 빈다(미리 고름 0).
  const { ratios } = loadLastSplit(safeLocalStorage(), secondJourneyScope());
  const byId = new Map((ratios || []).map((r) => [r.piggyId, r.bps]));
  const rows = {};
  for (const p of piggies) {
    const bps = byId.get(p.id);
    rows[p.id] = bps ? { amount: "", percent: bpsToPercentText(bps), lead: "percent" } : { amount: "", percent: "", lead: null };
  }
  state.addMoney = { kind: "allocation", planId: newPlanId(), total: "", rows, memory: ratios || null, touched: false };
}

// total 이 바뀌거나 한 칸이 바뀐 뒤 나머지 칸을 다시 센다. 진실은 금액(정수 최소 단위), 퍼센트는 표시.
function recomputeAddMoney(changedId = null) {
  const am = state.addMoney;
  if (!am || am.kind !== "allocation") return;
  const T = addMoneyUnits(am.total);
  const valid = T !== null && T > 0n;
  const d = addMoneyDecimals();
  const piggies = addMoneyPiggies();
  // 기억에서 온 비율을 사용자가 아직 건드리지 않았고 모두 그대로 있으면 — 최대 나머지로 Σ = total 을 정확히.
  if (valid && am.memory && !am.touched) {
    const pre = prefillFromLastSplit(am.memory, piggies, T.toString());
    if (pre.rows && pre.dropped.length === 0) {
      for (const r of pre.rows) if (am.rows[r.piggyId] && am.rows[r.piggyId].lead === "percent") am.rows[r.piggyId].amount = unitsToQuantity(BigInt(r.amount), d);
      return;
    }
  }
  for (const [id, row] of Object.entries(am.rows)) {
    if (changedId && id !== changedId) continue;
    if (row.lead === "percent") {
      const bps = percentTextToBps(row.percent);
      row.amount = valid && bps !== null ? unitsToQuantity(BigInt(amountFromPercentBps(bps, T.toString())), d) : "";
    } else if (row.lead === "amount") {
      const u = addMoneyUnits(row.amount);
      const bps = valid && u !== null ? percentBpsFromAmount(u.toString(), T.toString()) : null;
      row.percent = bps === null ? "" : bpsToPercentText(bps);
    }
  }
}

// ok 가 열리는 조건: total > 0 · 모든 칸이 비었거나 유효 · Σ = total. (남는 돈을 몰래 어디에 두지 않는다.)
function addMoneyPlanRows() {
  const am = state.addMoney;
  if (!am || am.kind !== "allocation") return null;
  const T = addMoneyUnits(am.total);
  if (T === null || T <= 0n) return null;
  const rows = [];
  let sum = 0n;
  for (const [piggyId, row] of Object.entries(am.rows)) {
    const text = String(row.amount ?? "").trim();
    const u = text === "" ? 0n : addMoneyUnits(text);
    if (u === null) return null;
    sum += u;
    rows.push({ piggyId, amount: u.toString() });
  }
  return sum === T && sum > 0n ? { total: T.toString(), rows } : null;
}

function confirmAddMoney() {
  const ready = addMoneyPlanRows();
  const am = state.addMoney;
  if (!ready || !am) return;
  const scope = secondJourneyScope();
  const built = buildAllocationPlan({
    planId: am.planId, chainId: scope.chainId, accountId: scope.accountId,
    asset: { symbol: ADD_MONEY_ASSET, decimals: addMoneyDecimals() }, total: ready.total, rows: ready.rows, piggies: addMoneyPiggies(),
  });
  if (!built.ok) return;
  const { approval } = approvalForPlan(built.plan);
  const approved = markPlanApproved(built.plan, approval);
  if (!approved.ok) return;
  // 확인한 나눔의 **비율만** 기억한다 — 다음 미리보기 채우기용. 권한·금액·주소는 남기지 않는다.
  saveLastSplit(safeLocalStorage(), scope, approved.plan, approval);
  state.addMoney = { kind: "plan", plan: approved.plan };
}

function addMoneyBodyMarkup() {
  const am = state.addMoney;
  const methodsMarkup = fundingMethodsMarkup(fundingMethods());
  if (am.kind === "single") return addMoneySingleMarkup({ name: am.name, methodsMarkup });
  const d = addMoneyDecimals();
  if (am.kind === "plan") {
    return addMoneyPlanMarkup({
      unit: ADD_MONEY_ASSET,
      legs: am.plan.legs.map((l) => ({ piggyId: l.piggyId, name: l.name, amount: unitsToQuantity(BigInt(l.amount), d) })),
      methodsMarkup,
    });
  }
  const names = new Map(addMoneyPiggies().map((p) => [p.id, p.name || p.id]));
  return addMoneyAllocationMarkup({
    total: am.total,
    unit: ADD_MONEY_ASSET,
    rows: Object.entries(am.rows).map(([piggyId, r]) => ({ piggyId, name: names.get(piggyId) || piggyId, amount: r.amount, percent: r.percent })),
    canConfirm: addMoneyPlanRows() !== null,
  });
}

// 입력 중에는 다시 그리지 않는다(초점 유지) — 바뀐 **다른** 칸의 값과 ok 상태만 고친다.
function handleAddMoneyInput(event) {
  const am = state.addMoney;
  const el = event.target;
  if (!am || am.kind !== "allocation" || !(el instanceof HTMLInputElement)) return;
  let changedId = null;
  if (el.id === "homeAddMoneyTotal") {
    am.total = el.value;
  } else if (el.id.startsWith("homeAddMoneyAmount--")) {
    changedId = el.id.slice("homeAddMoneyAmount--".length);
    if (!am.rows[changedId]) return;
    am.rows[changedId] = { ...am.rows[changedId], amount: el.value, lead: "amount" };
    am.touched = true;
  } else if (el.id.startsWith("homeAddMoneyPercent--")) {
    changedId = el.id.slice("homeAddMoneyPercent--".length);
    if (!am.rows[changedId]) return;
    am.rows[changedId] = { ...am.rows[changedId], percent: el.value, lead: "percent" };
    am.touched = true;
  } else {
    return;
  }
  recomputeAddMoney(changedId);
  for (const [id, row] of Object.entries(am.rows)) {
    const a = document.getElementById(`homeAddMoneyAmount--${id}`);
    const pc = document.getElementById(`homeAddMoneyPercent--${id}`);
    if (a && a !== el) a.value = row.amount;
    if (pc && pc !== el) pc.value = row.percent;
  }
  const ok = document.getElementById("homeAddMoneyOk");
  if (ok) ok.disabled = addMoneyPlanRows() === null;
}
// 문서에 한 번만 거는 위임 — render()(A-633/A-642 byte-stable)를 건드리지 않는다. Add money 칸 밖 입력은 무시.
if (typeof document?.addEventListener === "function") {
  document.addEventListener("input", (event) => {
    if (event.target?.closest?.(".homePaper__addMoney")) handleAddMoneyInput(event);
  });
}

// [A-646 S8] 고른 Piggy 안의 돈 상태(상세 자리에서만). 모든 Piggy 같은 규칙:
// at home = 집에 있는 Piggy 의 확인된 평가만(모르면 unknown, $0 아님) · working with = 나가 있는 Piggy 의
// 확인된 평가만(없으면 줄 0) · returning = 실제 원천 없음 → 그리지 않는다.
function piggyMoneyStateMarkupFor(piggyId) {
  if (!piggyId) return "";
  const piggy = moneyPiggiesSnapshot().piggies.find((p) => p.id === piggyId) || null;
  if (!piggy) return "";
  const usd = piggy.valuation && typeof piggy.valuation.usd === "string" ? `$${piggy.valuation.usd}` : null;
  return piggyMoneyStateMarkup({
    atHomeValue: piggy.location === "home" ? usd : null,
    workingWithValue: piggy.location === "away" ? usd : null,
  });
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
  // [A-646] Add money 가 열려 있으면 행 카드 자리를 그 한 화면이 쓴다(새 종이 0). 닫히면 그 자리는 원래 행으로.
  if (state.addMoney && addMoneyEntryAllowed()) {
    return homeMoneyMarkup({ title: "MY MONEY", time, rows: [], afterRowsMarkup: addMoneyBodyMarkup() });
  }
  const addMoneyEntry = addMoneyEntryAllowed() ? addMoneyEntryMarkup() : "";
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
      // [A-644] 보이는 "고른 행" = 행 탭으로 고른 그 Piggy(myMoneySelectedPiggyId). 전에는 이 값이
      // homeRowMarkup 에서 버려져 화면에 아무 표시도 없었다(Lane U) — 이제 --on 으로 보인다.
      selectedPiggyId: myMoneySelectedPiggyId(snapshot.piggies),
    });
    // [A-510 Stream A] 고른 Piggy 아래의 give/bring 인라인 동작은 걷어냈다(A-486 이력).
    const selected = snapshot.piggies.find((p) => p.id === state.selectedPiggy?.id) || null;
    const intentMarkup = selected ? moneyIntentMarkup(selected) : "";
    // [A-495 Lane B] 충전이 열려 있으면 그 자리에서 방법을 보여준다(새 종이 0). 받는 곳은 그 Piggy 다.
    const fundingMarkup = state.funding ? fundingMethodsMarkup(fundingMethods()) : "";
    // [A-644 2B] 고른 Piggy 의 조작 깊이 — Second 확정 뒤 + 고른 행이 있을 때만(controlModePiggyId).
    // [A-646] 고른 Piggy 의 돈 상태(S8) + Add money 입구(S1)가 같은 자리 뒤에 이어진다.
    const selectedForSettings = controlModePiggyId();
    const afterRowsMarkup = controlModeMarkupFor(selectedForSettings) + piggyMoneyStateMarkupFor(selectedForSettings) + addMoneyEntry;
    return homeMoneyMarkup({ title: "MY MONEY", time, rows, note: homeMoneyTotalsNote(snapshot.totals), afterRowsMarkup }) + intentMarkup + fundingMarkup;
  }

  return homeMoneyMarkup({
    title: "MY MONEY",
    time,
    afterRowsMarkup: addMoneyEntry,
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
    // [A-644 2B] 한 마리 경로: 이 상세 면이 "고른 Piggy" 다. Second 확정 전이면 빈 문자열.
    afterRowsMarkup: controlModeMarkupFor(controlModePiggyId()) + piggyMoneyStateMarkupFor(controlModePiggyId()),
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
  // [A-654] same projection map, one more tier: runtime truth (away) and the stage's current
  // Home-life ambient assignment. Visual only — the cards just mirror what Home is drawing.
  const states = buildPiggyMotionStateMap(residents, {
    affectedPiggyId,
    cue: affectedPiggyId ? PIGGY_MOTION_STATE.WORK : PIGGY_MOTION_STATE.IDLE,
    runtime: homeResidentRuntimeStates(residents),
    ambient: homeAmbient.assignment,
  });
  paper.querySelectorAll(".homePaper__card--piggy[data-piggy-id]").forEach((card) => {
    const projected = piggyMotionStateFromMap(states, card.dataset.piggyId);
    card.dataset.motionState = projected.state;
    card.toggleAttribute("data-motion-active", projected.active);
  });
}

// ═══ [A-654] Multi-Piggy living Home ═══════════════════════════════════════════════════════════
// With two or more indexed Piggies, every Home-present Piggy lives on a measured safe slot with one
// Owner-confirmed ambient motion (Home motion freeze 2026-09-26; its preview renderer math is ported
// below, the SVG parts are served unchanged from /motion/home-ambient/). With one Piggy nothing here
// runs, so the single-Piggy Home stays exactly as it was.
// Visual only: this reads the index, the registry location and the scene; it never writes money,
// job, permission, selection or signer state. The one thing it keeps is a non-secret Home-life nonce
// in sessionStorage, so a reload inside the same session shows the same slots and motions.
const HOME_LIFE_KEY = "araso.homeLife.v1";
const HOME_LIFE_SCENES = ["sendstay", "explore"];
const HOME_AMBIENT_DIR = "home-ambient"; // under MOTION_DIR (joined at use: this slice is also evaluated alone by tests)
// Paper+HISTORY maximum footprint height (A-654 geometry lane, residents window expanded at 3+
// Piggies): mobile stack 467.8, web 456.9. Slots are chosen once against this maximum so opening
// HISTORY, MY MONEY or the residents window never moves a Piggy.
const HOME_AMBIENT_FOOT_H = Object.freeze({ mobile: 467.8, web: 456.9 });
let homeLifeLeft = false;
let homeLife = null;
let homeAmbientResizeTimer = 0;
const homeAmbient = { assignment: null, layer: null, cleanup: null, seq: 0 };

function readHomeLife() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(HOME_LIFE_KEY) || "null");
    if (raw && /^[0-9a-f]{16}$/.test(String(raw.nonce)) && Number.isFinite(raw.startedAt)) return { nonce: raw.nonce, startedAt: raw.startedAt };
  } catch {
    // No session storage: the cycle stays memory-only.
  }
  return null;
}

function startHomeLife() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const life = { nonce: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""), startedAt: Date.now() };
  try {
    sessionStorage.setItem(HOME_LIFE_KEY, JSON.stringify(life));
  } catch {
    // Memory-only cycle.
  }
  return life;
}

// A new Home-life cycle starts only on a genuine Home re-entry: arriving at Home from a non-Home
// scene (a trip, a return, Name, the file box). Paper/HISTORY/MY MONEY toggles, selection changes
// and plain re-renders keep the cycle; a reload keeps it through the session value.
// Called from the Home mount (settle / resize) — render() itself is untouched. Leaving Home is seen
// by a scene-teardown watcher: when the next render tears Home down for a non-Home scene, the next
// Home mount begins a new cycle. A page that boots outside Home starts outside the cycle (see boot).
function syncHomeLifeCycle() {
  if (!homeLife) homeLife = readHomeLife();
  if (!homeLife || homeLifeLeft) homeLife = startHomeLife();
  homeLifeLeft = false;
  onSceneTeardown(() => {
    if (!HOME_LIFE_SCENES.includes(state.scene)) homeLifeLeft = true;
  });
}

// Runtime truth per Piggy id (never invented): the scene Piggy works while its card is up / in
// Explore, and is away or returning in the trip scenes; any other Piggy is away only when its own
// registry location says so. Everything else is Home-present.
function homeResidentRuntimeStates(residents = indexedResidents()) {
  const runtime = new Map();
  let registry = [];
  try {
    registry = secondPiggyRegistrySnapshot().piggies;
  } catch {
    registry = [];
  }
  const where = new Map(registry.map((p) => [p.id, p.location]));
  for (const r of residents) {
    if (where.get(r.id) === "away") runtime.set(r.id, PIGGY_MOTION_STATE.AWAY);
  }
  const sceneId = currentScenePiggyId();
  if (sceneId) {
    if ((state.scene === "sendstay" && state.sendCardVisible) || state.scene === "explore") runtime.set(sceneId, PIGGY_MOTION_STATE.WORK);
    else if (state.scene === "away" || state.scene === "secondAway") runtime.set(sceneId, PIGGY_MOTION_STATE.AWAY);
    else if (state.scene === "return" || state.scene === "secondReturn") runtime.set(sceneId, PIGGY_MOTION_STATE.RETURN);
  }
  return runtime;
}

// Chog ink = union of every Chog part (awake and dozing) trimmed to its drawn pixels, so the slot
// set does not change when Chog falls asleep or wakes.
const chogInkFractions = new Map();
function chogPartInk(img) {
  const key = img.currentSrc || img.src;
  if (chogInkFractions.has(key)) return chogInkFractions.get(key);
  if (!img.complete || !img.naturalWidth) return null;
  let f = { x0: 0, y0: 0, x1: 1, y1: 1 };
  try {
    const W = 200;
    const H = Math.max(1, Math.round((W * img.naturalHeight) / img.naturalWidth));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (d[(y * W + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    f = x1 < 0 ? null : { x0: x0 / W, y0: y0 / H, x1: (x1 + 1) / W, y1: (y1 + 1) / H };
  } catch {
    // Unreadable pixels: keep the whole part box (never smaller than the ink).
  }
  chogInkFractions.set(key, f);
  return f;
}

function chogInkRect(root) {
  let out = null;
  let pending = false;
  root.querySelectorAll(".chogHome__stack img, .chogHome__sleep img").forEach((img) => {
    if (img.classList.contains("chogHome__walk")) return;
    const b = img.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const f = chogPartInk(img);
    if (f === null && !(img.complete && img.naturalWidth)) pending = true;
    const ink = f ? slotRect(b.left + f.x0 * b.width, b.top + f.y0 * b.height, b.left + f.x1 * b.width, b.top + f.y1 * b.height)
      : !(img.complete && img.naturalWidth) ? slotRect(b.left, b.top, b.right, b.bottom) : null;
    if (!ink) return;
    out = out ? slotRect(Math.min(out.x, ink.x), Math.min(out.y, ink.y), Math.max(out.r, ink.r), Math.max(out.b, ink.b)) : ink;
  });
  return out ? { ...out, pending } : null;
}

// Live anchors → the measured slot formulas (piggy-motion-state.js planHomeSlots).
function homeAmbientAnchors() {
  const seat = document.querySelector("#homeSeat");
  const name = document.querySelector("#homeName");
  const chog = document.querySelector("#chogHome");
  if (!seat || !name || !chog) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const toRect = (b) => slotRect(b.left, b.top, b.right, b.bottom);
  const seatImg = toRect(seat.getBoundingClientRect());
  const nameR = toRect(name.getBoundingClientRect());
  if (!(seatImg.w > 0 && seatImg.h > 0)) return null;
  const S = slotRect(Math.min(seatImg.x, nameR.x), seatImg.y, Math.max(seatImg.r, nameR.r), Math.max(seatImg.b, nameR.b));
  const C = chogInkRect(chog);
  if (!C) return null;
  // Paper open = the shared card anchor chog-home.js docks it to (viewport centre −32/−48).
  const paperScale = Math.min(285 / 400, 364 / 568);
  const paperW = 400 * paperScale;
  const paperH = 568 * paperScale;
  const px = vw / 2 - 32 - paperW / 2;
  const py = vh / 2 - 48 - paperH / 2;
  const P = slotRect(px, py, px + paperW, py + paperH);
  const band = homeSlotBand(vw);
  let F;
  if (band === "mobile") {
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-inset")) || 24;
    const historyRight = Math.max(P.x, vw - inset - paperW) + paperW;
    F = slotRect(P.x, P.y, Math.max(P.r, historyRight), P.y + HOME_AMBIENT_FOOT_H.mobile);
  } else {
    const x = P.x - HOME_TWO_CARD_SHIFT_VIEWPORT_PX;
    F = slotRect(x, P.y, x + paperW + RECORDS_CARD_GAP + paperW, P.y + HOME_AMBIENT_FOOT_H.web);
  }
  const brandEl = document.querySelector(".arasoBrand");
  const brandBox = brandEl ? brandEl.getBoundingClientRect() : null;
  const brand = brandBox && brandBox.width ? toRect(brandBox) : null;
  const mobile = band === "mobile";
  const top = mobile ? resolveCssLengthVarPx("--mobile-top-safe", 14) : 16;
  const bottom = mobile ? resolveCssLengthVarPx("--mobile-bottom-safe", 20) : 16;
  const safe = slotRect(16, top, vw - 16, vh - bottom);
  return { vw, vh, seat: S, seatImg, name: nameR, chog: C, paper: P, foot: F, brand, safe };
}

// Growth of the wide lying poses beyond the seat box, as fractions of the slot size, at the approved
// scale (the preview draws Watching in the same box height as the seated pose; Flop→sleep footprint
// measured from the ported rig over its whole sequence, A-654 VERIFY).
const HOME_AMBIENT_WIDE = Object.freeze({
  // keys = PIGGY_MOTION_STATE.WATCHING / .FLOP_SLEEP values (see HOME_AMBIENT_NEEDS on why literal)
  watching: Object.freeze({ left: ((1981 * 1102) / (1229 * 1056) - 1) / 2, right: ((1981 * 1102) / (1229 * 1056) - 1) / 2, top: 0, bottom: 0 }),
  // Flop→roll→sleep: rendered-ink union over the whole sequence (A-654 VERIFY, 1440 WA2, 142 frames:
  // left .31 · right .28 · top .16 · bottom .21 of the slot) plus a small stroke margin.
  // [A-656 P5] bottom widened .25 → .40 — measured unclipped ink bottom is .383–.394 (plus the
  // dropped name label, main.js ambFlopSleep() name-offset below), so the eligibility fit check
  // now matches what actually renders once `.homeAmbient__flop{overflow:visible}` (style.css)
  // stops clipping it. Re-fit gives the SAME eligible slot set (900 WN1; 1200 WA1/WA2; 1440 W2/
  // WA1/WA2, A-656 P45 raw/p5_refit.json) — no slot newly gained or lost.
  "flop-sleep": Object.freeze({ left: 0.36, right: 0.33, top: 0.2, bottom: 0.4 }),
});

// [A-656 P4] Stable seeded-random slot PREFERENCE — a Fisher–Yates shuffle of the free slot
// NAMES (not just who sits where), driven by the Home-life nonce + Piggy id. This is what makes
// the multi-Piggy fill less grid-like: which measured SAFE slot each Piggy prefers, not just the
// id→slot pairing order. No new zones, no continuous x/y — only `planHomeSlots()`'s own measured
// slot set is ever shuffled.
function homeSlotPreference(nonce, id, names) {
  const list = [...names].sort();
  const rng = seededRandom(hashSeed(`${nonce}|${id}|slot`));
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Place + assign one resident set against one slot plan. Pure over its inputs.
// [A-656 P4] `keep` (optional): a Map(id -> slot) from the FULL-cycle placement — when present,
// a resident already in `keep` at a still-free slot stays there instead of being reshuffled, so a
// Piggy going to WORK/AWAY/RETURN never shifts anyone else on screen. Only an over-capacity
// resident (one `keep` did not seat) may then claim the slot that Piggy vacated.
function placeHomeAmbientSet(plan, anchors, ids, sceneId, nonce, keep = null) {
  const order = orderHomeResidents(ids, nonce, sceneId);
  const free = new Map(plan.slots.filter((s) => !s.seat).map((s) => [s.name, s]));
  const taken = new Set();
  if (keep) {
    for (const id of ids) {
      const k = keep.get(id);
      if (k && !k.seat && free.has(k.name)) taken.add(k.name);
    }
  }
  const placed = [];
  for (const id of order) {
    if (id === sceneId) { placed.push({ id, slot: plan.slots[0] }); continue; }
    const kept = keep?.get(id);
    if (kept && !kept.seat && free.has(kept.name)) { placed.push({ id, slot: free.get(kept.name) }); continue; }
    const pick = homeSlotPreference(nonce, id, free.keys()).find((n) => !taken.has(n));
    if (!pick) continue; // beyond capacity → card-only, as today
    taken.add(pick);
    placed.push({ id, slot: free.get(pick) });
  }
  const slotOf = new Map(placed.map((p) => [p.id, p.slot]));
  const occupied = placed.map((p) => p.slot);
  const obstacles = [anchors.chog, anchors.foot, anchors.brand].filter(Boolean);
  const wide = new Map();
  // The seat keeps the established composition: only seated poses there. Elsewhere a wide pose is
  // allowed only where its full footprint clears everything at the approved scale (no shrink).
  const fitAt = (id, motion) => {
    const footprint = HOME_AMBIENT_WIDE[motion];
    const slot = slotOf.get(id);
    if (!footprint || !slot || slot.seat) return null;
    return fitWideSlot({ slot, footprint, others: occupied, obstacles, safe: anchors.safe, gap: plan.gap });
  };
  const eligible = (id, motion) => {
    if (!HOME_AMBIENT_WIDE[motion]) return true;
    const fit = fitAt(id, motion);
    if (fit) wide.set(`${id}|${motion}`, fit);
    return Boolean(fit);
  };
  const assigned = assignHomeAmbient(placed.map((p) => p.id), nonce, { eligible });
  // Two different wide poses could still meet each other: keep the first (stable order), the other idles.
  const assignment = new Map();
  const wideTaken = [];
  for (const [id, a] of assigned) {
    const fit = wide.get(`${id}|${a.state}`) || null;
    if (HOME_AMBIENT_WIDE[a.state] && (!fit || wideTaken.some((r) => rectsTouch(r, fit.rect, plan.gap)))) {
      assignment.set(id, Object.freeze({ state: PIGGY_MOTION_STATE.IDLE, phaseS: a.phaseS % 3.2 }));
      continue;
    }
    if (fit) wideTaken.push(fit.rect);
    assignment.set(id, a);
  }
  return { order, placed, slotOf, assignment, wide, fitAt };
}

// [A-654 F1] The ambient projection (state + phase + density rules) is decided once per Home-life
// cycle over the FULL resident set, as if every Piggy were home. A Piggy that goes to work / away /
// returning is then only dropped from the projection, so no other Piggy's state or phase changes
// (card rule: a runtime change invalidates only that Piggy's own ambient projection). Slots are
// still placed for the Piggies actually present. A wide pose that no longer fits at a Piggy's
// present slot falls back to Idle for that Piggy only.
// [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03] `mobileVisibleCap` (default
// 2, matching Home) is threaded straight through to planHomeSlots() — Explore/action scenes pass
// 0 from their own call site (placeHomeAmbientResidents() below) so they show only the active
// Piggy, never the left-side companion cluster this card adds for Home. Mid/web bands ignore the
// parameter entirely (planHomeSlots() only reads it inside its own `band === "mobile"` branch).
function planHomeAmbient(anchors, residents, runtime, sceneId, nonce, mobileVisibleCap = 2) {
  const plan = planHomeSlots({ width: anchors.vw, seat: anchors.seat, chog: anchors.chog, foot: anchors.foot, paper: anchors.paper, brand: anchors.brand, safe: anchors.safe, mobileVisibleCap });
  const everyone = residents.map((r) => r.id);
  const present = everyone.filter((id) => !isRuntimeMotionState(runtime.get(id)));
  const full = placeHomeAmbientSet(plan, anchors, everyone, sceneId, nonce);
  // [A-656 P4] Keep the full-cycle slots for the present subset — nobody shifts when one Piggy
  // leaves; only a Piggy that was off-slot (beyond capacity) may claim the freed slot.
  const now = present.length === everyone.length ? full : placeHomeAmbientSet(plan, anchors, present, sceneId, nonce, full.slotOf);
  if (now === full) return { plan, placed: full.placed, assignment: full.assignment, wide: full.wide, offstage: full.order.filter((id) => !full.slotOf.has(id)) };
  const assignment = new Map();
  const wide = new Map();
  const wideTaken = [];
  for (const { id } of now.placed) {
    const a = full.assignment.get(id);
    if (!a) continue;
    if (HOME_AMBIENT_WIDE[a.state]) {
      const fit = now.fitAt(id, a.state);
      if (!fit || wideTaken.some((r) => rectsTouch(r, fit.rect, plan.gap))) {
        assignment.set(id, Object.freeze({ state: PIGGY_MOTION_STATE.IDLE, phaseS: a.phaseS % 3.2 }));
        continue;
      }
      wideTaken.push(fit.rect);
      wide.set(`${id}|${a.state}`, fit);
    }
    assignment.set(id, a);
  }
  return { plan, placed: now.placed, assignment, wide, offstage: now.order.filter((id) => !now.slotOf.has(id)) };
}

function unmountHomeAmbientLayer() {
  homeAmbient.seq += 1;
  if (homeAmbient.cleanup) {
    try {
      homeAmbient.cleanup();
    } catch {
      // best effort
    }
  }
  homeAmbient.cleanup = null;
  homeAmbient.layer?.remove();
  homeAmbient.layer = null;
  document.querySelector("#homeChar")?.removeAttribute("data-ambient-seat");
}

// Mounted from mountHome()'s settle() and re-planned on resize. Scene teardown removes it.
function mountHomeAmbientResidents() {
  unmountHomeAmbientLayer();
  homeAmbient.assignment = null;
  if (!HOME_LIFE_SCENES.includes(state.scene)) return;
  syncHomeLifeCycle();
  if (indexedResidents().length < 2) return;
  // Chog's ink is read from its drawn pixels, so wait until every part image is decoded — the slot
  // set is planned once, never nudged after it is on screen.
  const seq = homeAmbient.seq;
  const token = sceneToken;
  const parts = [...document.querySelectorAll("#chogHome .chogHome__stack img, #chogHome .chogHome__sleep img")];
  Promise.all(parts.map((img) => (img.complete && img.naturalWidth ? null : img.decode().catch(() => null))))
    .then(() => {
      if (seq === homeAmbient.seq && token === sceneToken) placeHomeAmbientResidents(seq, token, 0);
    });
}

function placeHomeAmbientResidents(mountSeq, mountToken, attempt) {
  const residents = indexedResidents();
  const anchors = homeAmbientAnchors();
  const stage = document.querySelector(`.stage[data-scene="${state.scene}"]`);
  const board = document.querySelector("#homeBoard");
  if (!anchors || !stage || !board) {
    // Right after a trip the Home cluster can still be settling (Chog/seat not laid out yet):
    // look again shortly instead of giving up; the slot set is still planned once.
    if (attempt < 20) {
      sceneTimeout(() => {
        if (mountSeq === homeAmbient.seq && mountToken === sceneToken) placeHomeAmbientResidents(mountSeq, mountToken, attempt + 1);
      }, 250);
    }
    return;
  }
  const runtime = homeResidentRuntimeStates(residents);
  const sceneId = currentScenePiggyId();
  // [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03] Only PLAIN Home (sendstay,
  // no First-Send card open) gets the small left-side companion cluster (up to 2). Every action
  // scene — Explore ("second", the other HOME_LIFE_SCENES member), AND First Send itself (still
  // `state.scene === "sendstay"`, just with `state.sendCardVisible` true — the "send?" card is an
  // overlay on the SAME scene, not a separate one, so it needs its own explicit check here) —
  // shows only the active Piggy, no companions. Away/Return/Receipt need no separate check: their
  // own scene names ("away"/"secondAway"/"return"/"secondReturn") are not in HOME_LIFE_SCENES at
  // all, so mountHomeAmbientResidents() never mounts the companion layer there in the first place
  // (main.js, `if (!HOME_LIFE_SCENES.includes(state.scene)) return;`) — structurally zero
  // companions, confirmed by reading that early-return, not assumed. Mid/web bands are unaffected
  // either way (planHomeSlots() only reads this inside its mobile branch).
  const mobileVisibleCap = (state.scene === "sendstay" && !state.sendCardVisible) ? 2 : 0;
  const planned = planHomeAmbient(anchors, residents, runtime, sceneId, homeLife.nonce, mobileVisibleCap);
  homeAmbient.assignment = planned.assignment;
  // The paper cards mirror the same projection (visual attribute only).
  const paper = document.querySelector('.homePaper[data-paper-mode="home"]');
  if (paper) applyHomeResidentMotionStates(paper);

  const seq = homeAmbient.seq;
  const token = sceneToken;
  const layer = document.createElement("div");
  layer.className = "homeLivingLayer";
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.band = planned.plan.band;
  layer.dataset.capacity = String(planned.plan.slots.length);
  layer.dataset.offstage = String(planned.offstage.length);
  stage.insertBefore(layer, board);
  homeAmbient.layer = layer;
  const stageBox = stage.getBoundingClientRect();
  const reduced = prefersReducedMotion();
  const nameById = new Map(residents.map((r) => [r.id, r.name || "Piggy"]));
  const S = anchors.seat;
  const seatOff = { x: anchors.seatImg.x - S.x, y: anchors.seatImg.y - S.y };
  const q = anchors.seatImg.h / AMB_SEATED.h;
  const nameScale = anchors.name.w / 120;
  const nameOff = { x: anchors.name.x - S.x, y: anchors.name.y - S.y };
  const entries = [];
  for (const { id, slot } of planned.placed) {
    const projected = resolvePiggyMotionState({ piggyId: id, runtime, ambient: planned.assignment });
    const phaseS = planned.assignment.get(id)?.phaseS || 0;
    const fit = planned.wide.get(`${id}|${projected.state}`) || null;
    const dx = fit ? fit.dx : 0;
    const box = slot.rect;
    // [A-681 OWNER VISUAL DECISION — MOBILE MULTI-PIGGY HOME, 2026-10-03] Home's small left-side
    // companions (`piggy-motion-state.js` M1/M2) now carry a SMALLER `slot.rect` than the main
    // seat's own box (0.425×/0.375×) so `planHomeSlots()`'s own collision/placement math treats
    // their TRUE smaller footprint as "close together" near the floor line. The rendered art
    // itself still mounts at the full natural seat size (`S.w`/`S.h` — every inner offset below,
    // `seatOff`/`q`/`AMB_SEATED`/the name tag, is calibrated against that full size and stays
    // completely unchanged) and is wrapped in one outer `scale(sizeFrac)` from its own top-left
    // corner, so the WHOLE already-correct subtree (art + name tag) shrinks together as a rigid
    // unit to exactly fill the smaller slot box — no risk of the art/name drifting apart from
    // each other. `sizeFrac` is read back from whatever `box.w` the slot actually got, not a
    // second hardcoded ratio, so the seat (box.w === S.w) is an exact no-op (sizeFrac=1).
    const sizeFrac = S.w > 0 ? box.w / S.w : 1;
    const el = document.createElement("div");
    el.className = "homeLiving";
    el.dataset.piggyId = id;
    el.dataset.slot = slot.name;
    el.dataset.motionState = projected.state;
    el.dataset.phase = phaseS.toFixed(3);
    if (fit) el.dataset.ambientAlign = fit.align;
    el.style.left = `${box.x - stageBox.left}px`;
    el.style.top = `${box.y - stageBox.top}px`;
    el.style.width = `${S.w}px`;
    el.style.height = `${S.h}px`;
    if (Math.abs(sizeFrac - 1) > 0.001) {
      el.style.transform = `scale(${sizeFrac})`;
      el.style.transformOrigin = "0 0";
    }
    el.style.visibility = "hidden";
    const stageEl = document.createElement("div");
    stageEl.className = "homeLiving__stage";
    stageEl.style.left = `${seatOff.x + dx - AMB_SEATED.x * q}px`;
    stageEl.style.top = `${seatOff.y - AMB_SEATED.y * q}px`;
    stageEl.style.transform = `scale(${q})`;
    el.append(stageEl);
    if (!slot.seat) {
      const tag = document.createElement("span");
      tag.className = "homeLiving__name";
      tag.textContent = nameById.get(id);
      tag.style.left = `${nameOff.x + dx}px`;
      // [A-656 P5] flop-sleep only: drop the label below the settled lying pose. Every other
      // state keeps the existing seated offset unchanged. The lying pose's feet/outline/blanket
      // crossed the label at the seated offset (measured 56–347px overlap, first-glyph clip
      // 15–77px, A-656 P45 raw/p5_measure.json) — this puts the label just below the
      // settled-sleep ink bottom (≤.287h), measured overlap 0 once combined with the widened
      // `flop-sleep` footprint above and `.homeAmbient__flop{overflow:visible}` (style.css).
      // [A-681] uses S.h (the full rendered-art height every inner offset here is calibrated
      // against), not box.h (the slot's own, possibly size-reduced, placement box) — the art
      // itself always mounts at full size and is scaled as one rigid unit (see sizeFrac above).
      const nameDropPx = projected.state === "flop-sleep" ? S.b - anchors.name.y + 0.29 * S.h + 2 : 0;
      tag.style.top = `${nameOff.y + nameDropPx}px`;
      tag.style.transform = `scale(${nameScale})`;
      el.append(tag);
    } else {
      el.dataset.seat = "1";
    }
    layer.append(el);
    entries.push({ id, el, stageEl, motion: projected.state, phaseS, seat: Boolean(slot.seat) });
  }

  let stopped = false;
  let stopFrames = null;
  homeAmbient.cleanup = () => {
    stopped = true;
    if (stopFrames) stopFrames();
  };
  onSceneTeardown(() => {
    if (seq === homeAmbient.seq) unmountHomeAmbientLayer();
  });
  const alive = () => !stopped && seq === homeAmbient.seq && token === sceneToken;
  loadHomeAmbientAssets([...new Set(entries.map((e) => e.motion))])
    .then((assets) => {
      if (!alive()) return;
      const arts = [];
      for (const entry of entries) {
        let art = null;
        try {
          art = buildAmbientArt(entry.motion, assets, entry.stageEl, `${homeLife.nonce}|${entry.id}`);
        } catch {
          art = null;
        }
        if (!art) {
          entry.el.remove();
          continue;
        }
        arts.push({ ...entry, art });
      }
      const elapsed = (entry) => Math.max(0, (Date.now() - homeLife.startedAt) / 1000 + entry.phaseS);
      const drawAll = () => {
        for (const a of arts) a.art.draw(elapsed(a), reduced);
      };
      drawAll();
      for (const a of arts) {
        a.el.style.removeProperty("visibility");
        if (a.seat) document.querySelector("#homeChar")?.setAttribute("data-ambient-seat", "1");
      }
      if (reduced) return;
      stopFrames = runSceneFrames(() => {
        if (!alive()) return false;
        drawAll();
        return true;
      });
    })
    .catch(() => {
      // Missing ambient parts: leave the extra residents undrawn and the seat exactly as it was.
      if (alive()) unmountHomeAmbientLayer();
    });
}

// ── confirmed Home motion parts (served unchanged) ──
const HOME_AMBIENT_FILES = Object.freeze({
  idle: "piggy_seat_idle.svg",
  drink0: "piggy_seat_drink.svg",
  drink1: "piggy_seat_drink-1.svg",
  drink2: "piggy_seat_drink-2.svg",
  listenBase: "piggy_seat_listen.svg",
  listenUp: "piggy_seat_listen-1.svg",
  phone: "piggy_seat_phone.svg",
  phoneGlasses: "piggy_seat_phone-1.svg",
  phoneTap: "piggy_seat_phone-2.svg",
  phoneTapTwo: "piggy_seat_sunshine_tap2_owner.svg",
  watching: "piggy_watching_fit.svg",
  flopSquash: "piggy_flop_zip5_squash.svg",
  flopLean: "piggy_flop_zip5_lean.svg",
  flopLand: "piggy_rolling.svg",
  rollRight: "rolling_right_owner.svg",
  lookRight: "lookdown_right_owner.svg",
  rollLeft: "rolling_left_owner.svg",
  lookLeft: "lookdown_left_owner.svg",
  blanket: "piggy_seat_lookdownR_blanket.svg",
});
// Keys are the PIGGY_MOTION_STATE values written out: this section sits inside the index slice that
// several tests evaluate on its own, so its top-level code must not read outer bindings.
const HOME_AMBIENT_NEEDS = Object.freeze({
  idle: ["idle"],
  drink: ["drink0", "drink1", "drink2"],
  listen: ["listenBase", "listenUp"],
  sunshine: ["phone", "phoneGlasses", "phoneTap", "phoneTapTwo"],
  watching: ["watching"],
  "flop-sleep": ["idle", "flopSquash", "flopLean", "flopLand", "rollRight", "lookRight", "rollLeft", "lookLeft", "blanket"],
});
const homeAmbientText = new Map();
function homeAmbientUrl(key) {
  return `${MOTION_DIR}/${HOME_AMBIENT_DIR}/${HOME_AMBIENT_FILES[key]}`;
}
function loadHomeAmbientAssets(motions) {
  const keys = [...new Set(motions.flatMap((m) => HOME_AMBIENT_NEEDS[m] || []))];
  return Promise.all(keys.map((key) => {
    if (!homeAmbientText.has(key)) {
      homeAmbientText.set(key, fetch(homeAmbientUrl(key)).then((r) => {
        if (!r.ok) throw new Error(`ambient part ${key} ${r.status}`);
        return r.text();
      }).catch((error) => {
        homeAmbientText.delete(key);
        throw error;
      }));
    }
    return homeAmbientText.get(key).then((text) => [key, text]);
  })).then((pairs) => {
    const text = Object.fromEntries(pairs);
    return { text, url: homeAmbientUrl };
  });
}

// ── ported renderer (preview.js of the 2026-09-26 freeze; timings/keyframes/coefficients unchanged) ──
// Every cue draws inside one canonical resident box — the preview's resident at its widest layout
// (1071px, aspect 1256:772, seated art padded 34/22/16) — and that box is scaled so the seated pose
// lands exactly on the approved seat size. Relative sizes between cues are therefore the preview's.
const AMB_BOX_W = 1071;
const AMB_BOX_H = (AMB_BOX_W * 772) / 1256;
const AMB_SEATED = (() => {
  const iw = AMB_BOX_W - 44;
  const ih = AMB_BOX_H - 50;
  const a = Math.min(iw / 1056, ih / 1102);
  return { a, x: 22 + (iw - 1056 * a) / 2, y: 34 + (ih - 1102 * a) / 2, w: 1056 * a, h: 1102 * a };
})();
const AMB_NS = "http://www.w3.org/2000/svg";
const AMB_BLINK_MS = 3200;
const AMB_BLINK_KEYS = [
  { offset: 0, transform: "scaleY(1)", easing: "ease-in-out" },
  { offset: 0.92, transform: "scaleY(1)", easing: "ease-in-out" },
  { offset: 0.95, transform: "scaleY(.08)", easing: "ease-in-out" },
  { offset: 0.98, transform: "scaleY(1)", easing: "ease-in-out" },
  { offset: 1, transform: "scaleY(1)" },
];
// Browser-local Owner adjustments of the preview are not readable here; these are its documented
// code defaults (face 0/0/0 · sleep face −70,0 · hand_L −18,18 · hand_R −50,0).
const AMB_FACE_ADJUST = Object.freeze({ left: { x: 0, y: 0, angle: 0 }, center: { x: 0, y: 0, angle: 0 }, right: { x: 0, y: 0, angle: 0 } });
const AMB_SLEEP_OFFSETS = Object.freeze({ face: { x: -70, y: 0 }, hand_L: { x: -18, y: 18 }, hand_R: { x: -50, y: 0 } });
let ambUid = 0;

function ambSmooth(value) {
  const c = Math.max(0, Math.min(1, value));
  return c * c * (3 - 2 * c);
}

// Each inline copy gets its own ids for anything referenced by url(#…)/href, so two residents never
// resolve each other's clip paths or masks.
function ambUniqueSvg(text) {
  const uid = `amb${(ambUid += 1)}`;
  const refs = new Set();
  for (const m of text.matchAll(/url\(#([^)]+)\)/g)) refs.add(m[1]);
  for (const m of text.matchAll(/href="#([^"]+)"/g)) refs.add(m[1]);
  let out = text;
  for (const id of refs) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`id="${esc}"`, "g"), `id="${id}-${uid}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, "g"), `url(#${id}-${uid})`)
      .replace(new RegExp(`href="#${esc}"`, "g"), `href="#${id}-${uid}"`);
  }
  return out;
}

function ambArt(className, padded) {
  const el = document.createElement("div");
  el.className = `homeAmbient__art ${className}${padded ? " homeAmbient__art--padded" : ""}`;
  return el;
}

function ambBlink(eyes) {
  return eyes.filter(Boolean).map((eye) => {
    eye.style.transformBox = "fill-box";
    eye.style.transformOrigin = "50% 50%";
    const animation = eye.animate(AMB_BLINK_KEYS, { duration: AMB_BLINK_MS, iterations: Infinity });
    animation.pause();
    return animation;
  });
}

function ambDrawBlink(animations, t, reduced) {
  const currentTime = reduced ? 0 : (t * 1000) % AMB_BLINK_MS;
  animations.forEach((animation) => {
    animation.currentTime = currentTime;
  });
}

function buildAmbientArt(motion, assets, mountEl, seed) {
  const S = PIGGY_MOTION_STATE;
  if (motion === S.IDLE) return ambIdle(assets, mountEl);
  if (motion === S.DRINK) return ambDrink(assets, mountEl);
  if (motion === S.LISTEN) return ambListen(assets, mountEl, seed);
  if (motion === S.SUNSHINE) return ambSunshine(assets, mountEl);
  if (motion === S.WATCHING) return ambWatching(assets, mountEl);
  if (motion === S.FLOP_SLEEP) return ambFlopSleep(assets, mountEl, seed);
  return null;
}

// Idle / blink — seated pose, 3.2s blink.
function ambIdle(assets, mountEl) {
  const art = ambArt("homeAmbient__idle", true);
  art.innerHTML = ambUniqueSvg(assets.text.idle);
  mountEl.append(art);
  const blink = ambBlink([art.querySelector("#eye_L"), art.querySelector("#eye_R")]);
  return { draw: (t, reduced) => ambDrawBlink(blink, t, reduced) };
}

// Drink — cup held, occasional sip, shut eyes (6s loop after a .45s intro).
const AMB_SAVOR_EYES = `<svg class="homeAmbient__savor" viewBox="0 0 1056 1102" aria-hidden="true"><ellipse cx="385.5" cy="507" rx="34" ry="38" fill="#000" /><ellipse cx="529" cy="507" rx="34" ry="38" fill="#000" /><path d="M365.32 470.797L353.066 474.569L344.796 480.811L339.182 491.881L337.005 503.581L339.042 511.741L345.371 520.71L355.448 528.637L364.905 530.396L370.37 529.684L378.018 526.784L383.245 522.569L390.422 512.654L392.909 499.283L389.386 484.784L383.759 476.821L379.072 473.355L365.32 470.797Z" fill="#fff" transform="translate(20.5 6.5) translate(365 500.5) rotate(-4) scale(1 .17) translate(-365 -500.5)" /><path d="M510.911 495.436L499.827 497.697L488.824 504.295L481.648 514.21L479.627 525.074L481.197 535.741L488.933 546.701L497.448 553.472L507.764 555.392L520.721 552.615L525.638 550.071L532.047 544.337L534.542 540.478L537.651 523.765L537.572 519.417L533.26 509.104L521.931 498.351L510.911 495.436Z" fill="#fff" transform="translate(20.5 -18.5) translate(508.5 525.5) rotate(4) scale(1 .17) translate(-508.5 -525.5)" /></svg>`;
function ambDrink(assets, mountEl) {
  const art = ambArt("homeAmbient__drink", false);
  const img = document.createElement("img");
  img.className = "homeAmbient__candidate";
  img.alt = "";
  art.append(img);
  art.insertAdjacentHTML("beforeend", AMB_SAVOR_EYES);
  mountEl.append(art);
  const savor = art.querySelector(".homeAmbient__savor");
  const frames = ["drink0", "drink1", "drink2", "drink1"].map((key) => assets.url(key));
  const starts = [0, 0.45, 2.6, 3.7];
  return {
    draw(e, reduced) {
      // Preview reduced motion holds the cue at half its length (3s).
      const t = reduced ? 3 : e <= 6 ? e : 0.45 + ((e - 0.45) % 5.55);
      const index = starts.reduce((current, start, i) => (t >= start ? i : current), 0);
      if (img.dataset.src !== frames[index]) {
        img.src = frames[index];
        img.dataset.src = frames[index];
      }
      savor.classList.toggle("is-visible", t >= 3.2 && t < 3.7);
      if (t >= 0.45) {
        const sway = Math.sin(((t - 0.45) / 3.2) * Math.PI * 2);
        const transform = `translateY(${(2 * sway).toFixed(2)}px) rotate(${sway.toFixed(2)}deg)`;
        img.style.transform = transform;
        savor.style.transform = transform;
      } else {
        img.style.transform = "";
        savor.style.transform = "";
      }
    },
  };
}

// Listen — headphones on; original listen/listen-1 headbang plus hands, left/right rhythm (6s plan).
const AMB_LISTEN_HEAD = ["ear_L", "ear_R", "face", "headphone_L", "headphone_R", "headphone_grip"];
const AMB_LISTEN_HAND = ["hand_L", "hand_R"];
function ambListenPlan(seed, loop) {
  // The preview draws a fresh random plan per load/loop; here it is seeded by Piggy id + Home life.
  const rng = seededRandom(hashSeed(`${seed}|listen|${loop}`));
  const beats = ["double", "sway", "nod", "rest", "sway"];
  for (let index = beats.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [beats[index], beats[swapIndex]] = [beats[swapIndex], beats[index]];
  }
  return ["nod", ...beats].map((type) => ({ type, vigor: 0.88 + rng() * 0.24 }));
}
function ambListenHead(plan, elapsed) {
  const beatIndex = Math.min(plan.length - 1, Math.floor(elapsed));
  const beat = plan[beatIndex];
  const phase = elapsed - beatIndex;
  const vigor = beat.vigor;
  if (beat.type === "rest") return { x: 0, y: 0, rotate: 0 };
  if (beat.type === "sway") {
    if (phase < 0.28) return { x: -26 * vigor, y: -3, rotate: -5 * vigor };
    if (phase < 0.56) return { x: 26 * vigor, y: -3, rotate: 5 * vigor };
    if (phase < 0.78) return { x: -13 * vigor, y: 0, rotate: -2.5 * vigor };
    return { x: 0, y: 0, rotate: 0 };
  }
  if (beat.type === "double") {
    if (phase < 0.16) return { x: 0, y: 8, rotate: 0 };
    if (phase < 0.34) return { x: 0, y: -43 * vigor, rotate: 0 };
    if (phase < 0.5) return { x: 0, y: 7, rotate: 0 };
    if (phase < 0.68) return { x: 0, y: -37 * vigor, rotate: 0 };
    return { x: 0, y: 0, rotate: 0 };
  }
  if (phase < 0.2) return { x: 0, y: 8, rotate: 0 };
  if (phase < 0.48) return { x: 0, y: -44 * vigor, rotate: 0 };
  if (phase < 0.7) return { x: 0, y: 6, rotate: 0 };
  return { x: 0, y: 0, rotate: 0 };
}
function ambListen(assets, mountEl, seed) {
  const art = ambArt("homeAmbient__listen", false);
  const img = document.createElement("img");
  img.className = "homeAmbient__candidate";
  img.alt = "";
  const inline = ambArt("homeAmbient__listenParts", true);
  inline.innerHTML = ambUniqueSvg(assets.text.listenBase);
  art.append(img, inline);
  mountEl.append(art);
  [...AMB_LISTEN_HEAD, ...AMB_LISTEN_HAND].forEach((id) => {
    const part = inline.querySelector(`#${id}`);
    if (part) part.dataset.baseTransform = part.getAttribute("transform") || "";
  });
  const base = assets.url("listenBase");
  const up = assets.url("listenUp");
  let planLoop = -1;
  let plan = null;
  return {
    draw(e, reduced) {
      const loop = reduced ? 0 : Math.floor(e / 6);
      if (loop !== planLoop) {
        plan = ambListenPlan(seed, loop);
        planLoop = loop;
      }
      const t = reduced ? 3 : e - loop * 6;
      const beat = plan[Math.min(plan.length - 1, Math.floor(t))];
      const headbang = !reduced && (beat.type === "nod" || beat.type === "double");
      img.hidden = !headbang;
      inline.hidden = headbang;
      if (headbang) {
        const phase = t - Math.floor(t);
        const isUp = beat.type === "double" ? (phase >= 0.16 && phase < 0.34) || (phase >= 0.5 && phase < 0.68) : phase >= 0.2 && phase < 0.48;
        const src = isUp ? up : base;
        if (img.dataset.src !== src) {
          img.src = src;
          img.dataset.src = src;
        }
        return;
      }
      const motionT = reduced ? 0 : t;
      const motion = ambListenHead(plan, motionT);
      const current = plan[Math.min(plan.length - 1, Math.floor(motionT))];
      const verticalHandFollow = current.type === "nod" || current.type === "double" ? 0.72 : 0.35;
      const headTransform = `translate(${motion.x.toFixed(2)} ${motion.y.toFixed(2)}) rotate(${motion.rotate.toFixed(2)} 528 360)`;
      const handTransform = `translate(${(motion.x * 0.45).toFixed(2)} ${(motion.y * verticalHandFollow).toFixed(2)}) rotate(${(motion.rotate * 0.45).toFixed(2)} 528 680)`;
      AMB_LISTEN_HEAD.forEach((id) => {
        const part = inline.querySelector(`#${id}`);
        if (part) part.setAttribute("transform", `${part.dataset.baseTransform} ${headTransform}`.trim());
      });
      AMB_LISTEN_HAND.forEach((id) => {
        const part = inline.querySelector(`#${id}`);
        if (part) part.setAttribute("transform", `${part.dataset.baseTransform} ${handTransform}`.trim());
      });
    },
  };
}

// Sunshine / tap-tap — glasses appear, first raised-hand tap held, second hand/glasses lift (4.4s).
const AMB_SUNSHINE_UPPER = ["body", "ear_L", "ear_R", "hand_L"];
function ambCloneLayer(sourceDocument, id) {
  const source = sourceDocument.getElementById(id);
  if (!source) throw new Error(`Missing SVG layer: ${id}`);
  const clone = source.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((child) => child.removeAttribute("id"));
  return clone;
}
function ambSunshineLayer(className, faceDocument, handDocument, glassesDocument = faceDocument, glassesIds = ["glasses_R", "glasses_L"]) {
  const layer = document.createElementNS(AMB_NS, "g");
  layer.classList.add(className);
  layer.style.display = "none";
  layer.append(
    ambCloneLayer(handDocument, "hand_R_fill"),
    ambCloneLayer(handDocument, "hand_R"),
    ambCloneLayer(faceDocument, "face"),
    ...glassesIds.map((id) => ambCloneLayer(glassesDocument, id)),
  );
  return layer;
}
function ambSunshineRhythm(phase) {
  if (phase < 1 || phase >= 4.4) return { y: 0, rotate: 0 };
  const smooth = (value) => value * value * (3 - 2 * value);
  if (phase >= 2.3 && phase < 2.58) {
    const rise = smooth(Math.min(1, (phase - 2.3) / 0.1));
    return { y: -8 * rise, rotate: -0.65 * rise };
  }
  if (phase >= 2.58 && phase < 2.9) {
    const tap = phase - 2.58;
    if (tap < 0.1) {
      const rise = smooth(tap / 0.1);
      return { y: -8 - 6 * rise, rotate: -0.65 + 1.5 * rise };
    }
    if (tap < 0.22) return { y: -14, rotate: 0.85 };
    const release = smooth((tap - 0.22) / 0.1);
    return { y: -14 * (1 - release), rotate: 0.85 * (1 - release) };
  }
  const pulse = (start, duration, down, upValue) => {
    const t = (phase - start) / duration;
    if (t < 0 || t >= 1) return 0;
    if (t < 0.22) return (t / 0.22) * down;
    if (t < 0.58) return down + ((t - 0.22) / 0.36) * (upValue - down);
    return upValue * (1 - (t - 0.58) / 0.42);
  };
  const idleBeat = Math.sin((phase - 1) * Math.PI * 2 * 1.25);
  return { y: idleBeat * 2.5 + pulse(1, 0.42, 5, -7), rotate: idleBeat * 0.55 };
}
function ambSunshine(assets, mountEl) {
  const art = ambArt("homeAmbient__sunshine", true);
  art.innerHTML = ambUniqueSvg(assets.text.phone);
  mountEl.append(art);
  const parse = (text) => new DOMParser().parseFromString(text, "image/svg+xml");
  const glasses = parse(assets.text.phoneGlasses);
  const tap = parse(assets.text.phoneTap);
  const tapTwo = parse(assets.text.phoneTapTwo);
  const svg = art.querySelector("svg");
  const normalLayer = ambSunshineLayer("sunshine-normal-layer", glasses, glasses);
  const tapOneLayer = ambSunshineLayer("sunshine-tap-one-layer", glasses, tap);
  const tapTwoLayer = ambSunshineLayer("sunshine-tap-two-layer", tapTwo, tapTwo, tapTwo, ["Vector 33", "Vector 34"]);
  svg.append(normalLayer, tapOneLayer, tapTwoLayer);
  const baseFace = art.querySelector("#face");
  const baseHandFill = art.querySelector("#hand_R_fill");
  const baseHand = art.querySelector("#hand_R");
  const upper = AMB_SUNSHINE_UPPER.map((id) => art.querySelector(`#${id}`));
  return {
    draw(e, reduced) {
      const phase = (reduced ? 1.5 : e) % 4.4;
      const sunshineVisible = phase >= 1 && phase < 4.4;
      const firstTap = phase >= 2.3 && phase < 2.58;
      const secondTap = phase >= 2.58 && phase < 2.9;
      const active = sunshineVisible || firstTap || secondTap;
      normalLayer.style.display = sunshineVisible && !firstTap && !secondTap ? "" : "none";
      tapOneLayer.style.display = firstTap ? "" : "none";
      tapTwoLayer.style.display = secondTap ? "" : "none";
      [baseFace, baseHandFill, baseHand].forEach((part) => {
        if (part) part.style.display = active ? "none" : "";
      });
      const rhythm = reduced ? { y: 0, rotate: 0 } : ambSunshineRhythm(phase);
      const rhythmTransform = rhythm.y === 0 && rhythm.rotate === 0 ? "" : `translate(0 ${rhythm.y.toFixed(2)}) rotate(${rhythm.rotate.toFixed(2)} 528 820)`;
      [...upper, baseFace, baseHandFill, baseHand, normalLayer, tapOneLayer, tapTwoLayer].forEach((part) => {
        if (part) part.setAttribute("transform", rhythmTransform);
      });
    },
  };
}

// Watching — silver device back, separate subtle colour-changing light, gaze/blink, breath .008 (48s).
function ambWatching(assets, mountEl) {
  const art = ambArt("homeAmbient__watching", true);
  art.innerHTML = ambUniqueSvg(assets.text.watching);
  mountEl.append(art);
  const uid = `amb${(ambUid += 1)}`;
  const svg = art.querySelector("svg");
  const defs = document.createElementNS(AMB_NS, "defs");
  const gradient = document.createElementNS(AMB_NS, "linearGradient");
  gradient.id = `watching-light-${uid}`;
  for (const [offset, opacity] of [["0%", "0.42"], ["35%", "0.30"], ["70%", "0.12"], ["100%", "0"]]) {
    const stop = document.createElementNS(AMB_NS, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-opacity", opacity);
    gradient.append(stop);
  }
  defs.append(gradient);
  svg.prepend(defs);
  const spillFilter = document.createElementNS(AMB_NS, "filter");
  spillFilter.id = `watching-spill-${uid}`;
  spillFilter.setAttribute("x", "-40%");
  spillFilter.setAttribute("y", "-40%");
  spillFilter.setAttribute("width", "180%");
  spillFilter.setAttribute("height", "180%");
  const blur = document.createElementNS(AMB_NS, "feGaussianBlur");
  blur.setAttribute("stdDeviation", "28");
  spillFilter.append(blur);
  defs.append(spillFilter);
  const device = svg.querySelector('[id="screen"]');
  const spill = svg.querySelector('[id="screen_fill"]').cloneNode(true);
  spill.removeAttribute("id");
  spill.classList.add("watching-screen-spill");
  spill.setAttribute("filter", `url(#${spillFilter.id})`);
  spill.setAttribute("opacity", "0");
  spill.setAttribute("stroke-width", "48");
  device.prepend(spill);
  const body = svg.querySelector('[id="body"]');
  const mask = document.createElementNS(AMB_NS, "mask");
  mask.id = `watching-interior-${uid}`;
  const interior = body.cloneNode(true);
  interior.removeAttribute("id");
  interior.setAttribute("fill", "white");
  interior.setAttribute("stroke", "black");
  mask.append(interior);
  defs.append(mask);
  const light = body.cloneNode(true);
  light.classList.add("watching-face-light");
  light.setAttribute("opacity", "0");
  light.removeAttribute("id");
  light.removeAttribute("stroke");
  light.setAttribute("fill", `url(#${gradient.id})`);
  light.setAttribute("mask", `url(#${mask.id})`);
  body.after(light);
  if (svg.querySelector('[id="hand_R_fill2"]') && svg.querySelector('[id="hand_R_outline"]')) {
    svg.querySelector('[id="hand_R_fill"]').style.display = "none";
  }
  const eyes = [...svg.querySelectorAll('[id="eye_L"], [id="eye_R"]')];
  const blink = ambBlink(eyes);
  const lying = svg.querySelector('[id="piggy_lying"]');
  lying.style.transformBox = "fill-box";
  lying.style.transformOrigin = "50% 85%";
  const stops = [...gradient.querySelectorAll("stop")];
  return {
    draw(e, reduced) {
      const t = reduced ? 0 : e % 48;
      ambDrawBlink(blink, t, reduced);
      const gazeTime = t % 12;
      const gaze = ambSmooth((gazeTime - 3.8) / 1.1) * (1 - ambSmooth((gazeTime - 6.5) / 1.2));
      eyes.forEach((eye) => {
        eye.style.translate = `${-10 * gaze}px 0px`;
      });
      const breath = (1 - Math.cos((t * Math.PI) / 2)) * 0.008;
      lying.style.transform = `scale(${1 + breath * 0.35}, ${1 + breath})`;
      const colors = [[192, 218, 239], [223, 206, 235], [232, 224, 195]];
      const segment = Math.floor(t / 8) % colors.length;
      const mix = ambSmooth(((t % 8) - 5) / 3);
      const color = colors[segment].map((v, i) => Math.round(v + (colors[(segment + 1) % colors.length][i] - v) * mix));
      const fill = `rgb(${color.join(",")})`;
      stops.forEach((stop) => stop.setAttribute("stop-color", fill));
      spill.setAttribute("fill", fill);
      spill.setAttribute("stroke", fill);
      const lightTime = t % 12;
      const luminance = reduced ? 0 : 0.6 * ambSmooth((lightTime - 1.8) / 2.2) * (1 - ambSmooth((lightTime - 7) / 3));
      light.setAttribute("opacity", String(luminance));
      spill.setAttribute("opacity", String(0.3 * luminance));
    },
  };
}

// Flop → right roll → drowsy → sleep — the connected sequence on one continuous body rig; sleep
// holds (no wake transition is confirmed) until the next Home-life cycle.
function ambFlopSleep(assets, mountEl, seed) {
  const art = ambArt("homeAmbient__flop", false);
  mountEl.append(art);
  const F = ambConfigureFlop(art, assets, seed);
  // Map the flop box so its first frame (the seated idle drawing) lands exactly on the seated pose:
  // same approved scale and foot anchor; every later frame keeps the preview's relative geometry.
  const W = AMB_BOX_W;
  const H = AMB_BOX_H;
  const fx = 0.08 * W;
  const fy = 0.08 * H;
  const fw = 0.84 * W;
  const fh = 0.84 * H;
  const k = Math.min(fw / 2000, fh / 1800);
  const ox = fx + (fw - 2000 * k) / 2;
  const oy = fy + (fh - 1800 * k) / 2;
  const { box, scale } = F.firstFrame;
  const a = AMB_SEATED.a;
  const m = a / (scale * k);
  const tx = AMB_SEATED.x + a * (box.x + box.width / 2) - m * (ox + 1000 * k);
  const ty = AMB_SEATED.y + a * (box.y + box.height) - m * (oy + 1300 * k);
  art.style.transform = `translate(${tx}px, ${ty}px) scale(${m})`;
  return {
    draw(e, reduced) {
      // Preview reduced motion holds the cue at half its length (38.55s → persistent sleep pose).
      const t = reduced ? 77.1 * 0.5 : e <= 77.1 ? e : 13.1 + ((e - 13.1) % 64);
      if (t < 1.3 && !reduced) return ambFlopDraw(F, t, "flop-experiment", reduced);
      if (t < 3 && !reduced) return ambConnectedRest(F, 0, null, t - 1.3, reduced);
      if (t < 4.5 && !reduced) return ambConnectedRest(F, ambSmooth((t - 3) / 1.5), null, null, reduced);
      return ambConnectedRest(F, 1, Math.max(0, t - 4.5), null, reduced);
    },
  };
}

function ambConfigureFlop(art, assets, seed) {
  const T = assets.text;
  const rng = seededRandom(hashSeed(`${seed}|sleep`));
  const F = { art, sleepHoldPlan: Array.from({ length: 4 }, () => 5 + rng() * 3), firstFrame: null, sleepPartTracks: null };
  const uid = `amb${(ambUid += 1)}`;
  const ownerRollSources = [T.rollRight, T.lookRight, T.rollLeft, T.lookLeft];
  ownerRollSources.forEach((source, poseIndex) => {
    const frame = document.createElement("div");
    frame.className = "owner-roll-frame";
    frame.style.cssText = "position:absolute;inset:8%;opacity:0;pointer-events:none";
    frame.innerHTML = ambUniqueSvg(source);
    art.append(frame);
    const svg = frame.querySelector("svg");
    if (poseIndex === 1 || poseIndex === 3) {
      const arm = svg.querySelector('[id="Group 5"]');
      arm.classList.add("owner-roll-front-arm");
      arm.dataset.pivot = poseIndex === 1 ? "212 650" : "839 660";
      arm.dataset.direction = poseIndex === 1 ? "-1" : "1";
      const leg = svg.querySelector('[id="leg_L"]');
      leg.classList.add("owner-roll-front-leg");
      leg.dataset.pivot = poseIndex === 1 ? "615 1110" : "402 1090";
      leg.dataset.direction = poseIndex === 1 ? "1" : "-1";
      if (poseIndex === 3) svg.querySelector('[id="Vector_6"]').classList.add("owner-roll-right-foot");
    }
    const body = [...svg.querySelectorAll("path")]
      .filter((path) => !path.closest("defs,mask,clipPath"))
      .map((path) => ({ path, box: path.getBBox() }))
      .sort((p, q) => q.box.width * q.box.height - p.box.width * p.box.height)[0];
    const box = body.box;
    body.path.classList.add("owner-roll-silhouette");
    const scale = 1000 / box.height;
    frame.dataset.bodyWidth = String(box.width * scale);
    frame.dataset.sourceScale = String(scale);
    frame.dataset.bodyCenter = JSON.stringify([box.x + box.width / 2, box.y + box.height / 2]);
    const eyes = [...svg.querySelectorAll('[id="eye_L"], [id="eye_R"], [id="Vector_8"], [id="Vector_9"]')]
      .map((eye) => ({ eye, box: eye.getBBox() }))
      .sort((p, q) => p.box.x - q.box.x);
    frame.dataset.eyePositions = JSON.stringify(eyes.map(({ eye, box: eyeBox }, index) => {
      eye.dataset.rollEye = String(index);
      return [(eyeBox.x + eyeBox.width / 2 - box.x - box.width / 2) * scale, (eyeBox.y + eyeBox.height / 2 - box.y - box.height / 2) * scale];
    }));
    const face = svg.querySelector('[id="face"], [id="Group 11"]');
    face.classList.add("owner-roll-face");
    const faceBox = face.getBBox();
    frame.dataset.faceCenter = JSON.stringify([
      (faceBox.x + faceBox.width / 2 - box.x - box.width / 2) * scale,
      (faceBox.y + faceBox.height / 2 - box.y - box.height / 2) * scale,
    ]);
    frame.dataset.faceOrigin = JSON.stringify([faceBox.x + faceBox.width / 2, faceBox.y + faceBox.height / 2]);
    const assembly = document.createElementNS(AMB_NS, "g");
    while (svg.firstChild) assembly.append(svg.firstChild);
    assembly.setAttribute("transform", `scale(${scale}) translate(${-box.x - box.width / 2} ${-box.y - box.height / 2})`);
    const roll = document.createElementNS(AMB_NS, "g");
    roll.classList.add("owner-roll-body");
    roll.append(assembly);
    svg.append(roll);
    svg.setAttribute("viewBox", "-900 -900 1800 1800");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.cssText = "width:100%;height:100%;display:block;transform:none";
  });
  const rollFrames = art.querySelectorAll(".owner-roll-frame");
  const blanketProbe = document.createElement("div");
  blanketProbe.innerHTML = ambUniqueSvg(T.blanket);
  art.append(blanketProbe);
  const blanketBox = blanketProbe.querySelector('[id="blanket"]').getBBox();
  const blanketScale = 1150 / blanketBox.width;
  const blanketPath = blanketProbe.querySelector('[id="blanket"]').cloneNode(true);
  blanketPath.removeAttribute("id");
  const closedSources = ["eye_L_closed", "eye_R_closed"].map((id) => {
    const eye = blanketProbe.querySelector(`[id="${id}"]`);
    return { node: eye.cloneNode(true), box: eye.getBBox() };
  });
  const openEyeBoxes = [...rollFrames[0].querySelectorAll('[id="eye_L"], [id="eye_R"]')].map((eye) => eye.getBBox());
  const faceTemplate = rollFrames[0].querySelector(".owner-roll-face").cloneNode(true);
  [...faceTemplate.querySelectorAll('[id="eye_L"], [id="eye_R"]')].forEach((eye, index) => {
    const eyeBox = openEyeBoxes[index];
    eye.classList.add("sleep-open-eye");
    eye.dataset.cy = String(eyeBox.y + eyeBox.height / 2);
  });
  const centers = (boxes) => boxes.map((b) => [b.x + b.width / 2, b.y + b.height / 2]).sort((p, q) => p[0] - q[0]);
  const sourceEyes = centers(closedSources.map((source) => source.box));
  const targetEyes = centers(openEyeBoxes);
  const pairAngle = (pair) => Math.atan2(pair[1][1] - pair[0][1], pair[1][0] - pair[0][0]);
  const pairDistance = (pair) => Math.hypot(pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]);
  const eyePair = document.createElementNS(AMB_NS, "g");
  eyePair.classList.add("sleep-closed-eye");
  eyePair.style.opacity = "0";
  eyePair.setAttribute("transform", `translate(${(targetEyes[0][0] + targetEyes[1][0]) / 2} ${(targetEyes[0][1] + targetEyes[1][1]) / 2}) rotate(${((pairAngle(targetEyes) - pairAngle(sourceEyes)) * 180) / Math.PI}) scale(${pairDistance(targetEyes) / pairDistance(sourceEyes)}) translate(${-(sourceEyes[0][0] + sourceEyes[1][0]) / 2} ${-(sourceEyes[0][1] + sourceEyes[1][1]) / 2})`);
  closedSources.forEach((source) => eyePair.append(source.node.cloneNode(true)));
  faceTemplate.append(eyePair);
  faceTemplate.querySelector('[id="mouth_smile"]').classList.add("sleep-mouth");
  faceTemplate.removeAttribute("class");
  [faceTemplate, ...faceTemplate.querySelectorAll("[id]")].forEach((node) => node.removeAttribute("id"));
  const [faceOriginX, faceOriginY] = JSON.parse(rollFrames[0].dataset.faceOrigin);
  faceTemplate.setAttribute("transform", `scale(${rollFrames[0].dataset.sourceScale}) translate(${-faceOriginX} ${-faceOriginY})`);
  rollFrames.forEach((frame) => {
    frame.querySelector(".owner-roll-face").style.visibility = "hidden";
    const faceMotion = document.createElementNS(AMB_NS, "g");
    faceMotion.classList.add("owner-roll-face-arc");
    faceMotion.append(faceTemplate.cloneNode(true));
    frame.querySelector(".owner-roll-body").append(faceMotion);
    const cover = document.createElementNS(AMB_NS, "g");
    cover.classList.add("sleep-blanket");
    const normalized = document.createElementNS(AMB_NS, "g");
    normalized.setAttribute("transform", `translate(0 40) scale(${-blanketScale} ${blanketScale}) translate(${-blanketBox.x - blanketBox.width / 2} ${-blanketBox.y})`);
    normalized.append(blanketPath.cloneNode(true));
    cover.append(normalized);
    cover.style.opacity = "0";
    frame.querySelector(".owner-roll-body").append(cover);
  });
  blanketProbe.className = "owner-sleep-source";
  blanketProbe.style.cssText = "position:absolute;inset:8%;opacity:0;pointer-events:none";
  const sleepSvg = blanketProbe.querySelector("svg");
  const sleepBodyBox = sleepSvg.querySelector('[id="body"]').getBBox();
  const sleepScale = 1000 / sleepBodyBox.height;
  const sleepAssembly = document.createElementNS(AMB_NS, "g");
  while (sleepSvg.firstChild) sleepAssembly.append(sleepSvg.firstChild);
  sleepAssembly.setAttribute("transform", `scale(${sleepScale}) translate(${-sleepBodyBox.x - sleepBodyBox.width / 2} ${-sleepBodyBox.y - sleepBodyBox.height / 2})`);
  sleepSvg.append(sleepAssembly);
  const sleepMotion = document.createElementNS(AMB_NS, "g");
  sleepMotion.classList.add("source-sleep-motion");
  sleepSvg.append(sleepMotion);
  sleepMotion.append(sleepAssembly);
  const sleepZ = document.createElementNS(AMB_NS, "text");
  sleepZ.classList.add("source-sleep-zz");
  sleepZ.setAttribute("x", "360");
  sleepZ.setAttribute("y", "-570");
  sleepZ.setAttribute("fill", "white");
  sleepZ.setAttribute("font-size", "68");
  sleepZ.textContent = "z";
  sleepSvg.append(sleepZ);
  const upperZ = sleepZ.cloneNode(true);
  upperZ.classList.add("source-sleep-zz-upper");
  upperZ.setAttribute("x", "435");
  upperZ.setAttribute("y", "-665");
  upperZ.setAttribute("font-size", "98");
  sleepSvg.append(upperZ);
  const sleepPlacement = document.createElementNS(AMB_NS, "g");
  sleepPlacement.classList.add("source-sleep-placement");
  sleepPlacement.append(sleepMotion, sleepZ, upperZ);
  sleepSvg.append(sleepPlacement);
  rollFrames.forEach((frame) => {
    [sleepZ, upperZ].forEach((source) => {
      const zz = source.cloneNode(true);
      zz.classList.add("connected-sleep-zz");
      zz.style.opacity = "0";
      frame.querySelector("svg").append(zz);
    });
  });
  sleepSvg.setAttribute("viewBox", "-1000 -900 2000 1800");
  sleepSvg.style.cssText = "width:100%;height:100%;display:block;transform:none";
  const sleepCover = document.createElementNS(AMB_NS, "g");
  sleepCover.classList.add("source-sleep-cover");
  const sourceBlanket = sleepSvg.querySelector('[id="blanket"]');
  sourceBlanket.before(sleepCover);
  sleepCover.append(sourceBlanket);
  ["hand_L", "hand_R"].forEach((id) => sleepCover.append(sleepSvg.querySelector(`[id="${id}"]`)));
  blanketProbe.dataset.bodyWidth = String(sleepBodyBox.width * sleepScale);
  const rightFrame = rollFrames[1];
  const sleepParts = document.createElementNS(AMB_NS, "g");
  sleepParts.classList.add("connected-sleep-parts");
  sleepParts.style.opacity = "0";
  rightFrame.querySelector(".owner-roll-body").append(sleepParts);
  const partScaleX = (sleepScale * Number(rightFrame.dataset.bodyWidth)) / Number(blanketProbe.dataset.bodyWidth);
  const sleepPartsLowerY = 100;
  const sourceCenter = [sleepBodyBox.x + sleepBodyBox.width / 2, sleepBodyBox.y + sleepBodyBox.height / 2];
  const normalizePart = (node) => {
    const group = document.createElementNS(AMB_NS, "g");
    group.setAttribute("transform", `translate(0 ${sleepPartsLowerY}) scale(${partScaleX} ${sleepScale}) translate(${-sourceCenter[0]} ${-sourceCenter[1]})`);
    group.append(node.cloneNode(true));
    return group;
  };
  const blanketOnly = document.createElementNS(AMB_NS, "g");
  blanketOnly.classList.add("connected-blanket-only");
  blanketOnly.append(normalizePart(sourceBlanket));
  sleepParts.append(blanketOnly);
  const targetHands = ["hand_L", "hand_R"].map((id) => {
    const node = sleepSvg.querySelector(`[id="${id}"]`);
    const b = node.getBBox();
    return { node, id, width: b.width * partScaleX, height: b.height * sleepScale,
      center: [(b.x + b.width / 2 - sourceCenter[0]) * partScaleX, (b.y + b.height / 2 - sourceCenter[1]) * sleepScale + sleepPartsLowerY] };
  }).sort((p, q) => p.center[0] - q.center[0]);
  const [rollCX, rollCY] = JSON.parse(rightFrame.dataset.bodyCenter);
  const rollScale = Number(rightFrame.dataset.sourceScale);
  F.sleepPartTracks = ["Group 5", "Vector_5"].map((id, index) => {
    const node = rightFrame.querySelector(`[id="${id}"]`);
    const b = node.getBBox();
    const original = document.createElementNS(AMB_NS, "g");
    original.classList.add("connected-original-arm");
    node.before(original);
    original.append(node);
    const homeAnchor = document.createElementNS(AMB_NS, "g");
    original.before(homeAnchor);
    const foreground = document.createElementNS(AMB_NS, "g");
    foreground.classList.add("connected-arm-foreground");
    const rollBody = rightFrame.querySelector(".owner-roll-body");
    const placement = rollBody.getCTM().inverse().multiply(original.parentNode.getCTM());
    foreground.setAttribute("transform", `matrix(${[placement.a, placement.b, placement.c, placement.d, placement.e, placement.f].join(" ")})`);
    rollBody.append(foreground);
    let openArm = null;
    let armRevealCover = null;
    if (index === 1) {
      openArm = document.createElementNS(AMB_NS, "g");
      openArm.classList.add("connected-right-open-arm");
      openArm.style.opacity = "0";
      openArm.append(normalizePart(targetHands[index].node));
      const mask = document.createElementNS(AMB_NS, "mask");
      mask.id = `sleep-arm-occlusion-${uid}`;
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      mask.setAttribute("x", "-3000");
      mask.setAttribute("y", "-3000");
      mask.setAttribute("width", "6000");
      mask.setAttribute("height", "6000");
      const outside = document.createElementNS(AMB_NS, "rect");
      for (const [key, value] of Object.entries({ x: -3000, y: -3000, width: 6000, height: 6000, fill: "white" })) outside.setAttribute(key, value);
      mask.append(outside);
      const silhouette = rightFrame.querySelector(".owner-roll-silhouette");
      const occluder = silhouette.cloneNode(true);
      occluder.removeAttribute("id");
      occluder.removeAttribute("class");
      occluder.removeAttribute("mask");
      occluder.setAttribute("fill", "black");
      occluder.setAttribute("stroke", "black");
      const matrix = rollBody.getCTM().inverse().multiply(silhouette.getCTM());
      occluder.setAttribute("transform", `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(" ")})`);
      mask.append(occluder);
      armRevealCover = blanketOnly.cloneNode(true);
      armRevealCover.removeAttribute("class");
      armRevealCover.querySelectorAll("[id]").forEach((part) => part.removeAttribute("id"));
      armRevealCover.querySelectorAll("path").forEach((part) => {
        part.setAttribute("fill", "white");
        part.setAttribute("stroke", "white");
      });
      armRevealCover.style.opacity = "0";
      mask.append(armRevealCover);
      const defs = document.createElementNS(AMB_NS, "defs");
      defs.append(mask);
      rightFrame.querySelector("svg").prepend(defs);
      const visibleArm = document.createElementNS(AMB_NS, "g");
      visibleArm.setAttribute("mask", `url(#${mask.id})`);
      visibleArm.append(openArm);
      rollBody.append(visibleArm);
    }
    return { original, foreground, homeAnchor, openArm, armRevealCover, sourceScale: rollScale, targetId: targetHands[index].id,
      from: [(b.x + b.width / 2 - rollCX) * rollScale, (b.y + b.height / 2 - rollCY) * rollScale],
      to: targetHands[index].center };
  });
  [0, 2].forEach((index) => {
    const rolling = rollFrames[index];
    const side = rollFrames[index + 1];
    rolling.dataset.widthFit = String(Math.max(0.94, Math.min(1, Number(side.dataset.bodyWidth) / Number(rolling.dataset.bodyWidth))));
  });
  [T.idle, T.flopSquash, T.flopLean, T.flopLand].forEach((source, index) => {
    const frame = document.createElement("div");
    frame.className = "flop-experiment-frame";
    frame.style.cssText = "position:absolute;inset:8%;opacity:0;pointer-events:none";
    frame.innerHTML = ambUniqueSvg(source);
    art.append(frame);
    const svg = frame.querySelector("svg");
    const paths = [...svg.querySelectorAll("path")];
    const body = svg.querySelector('[id="body"]') || paths.reduce((largest, path) => {
      const b = path.getBBox();
      const old = largest.getBBox();
      return b.width * b.height > old.width * old.height ? path : largest;
    });
    const box = body.getBBox();
    const scale = Math.sqrt(700000 / (box.width * box.height));
    if (index === 0) F.firstFrame = { box: { x: box.x, y: box.y, width: box.width, height: box.height }, scale };
    const assembly = document.createElementNS(AMB_NS, "g");
    while (svg.firstChild) assembly.append(svg.firstChild);
    assembly.setAttribute("transform", `translate(0 400) scale(${index === 3 ? -scale : scale} ${scale}) translate(${-box.x - box.width / 2} ${-box.y - box.height})`);
    const motion = document.createElementNS(AMB_NS, "g");
    motion.classList.add("flop-experiment-motion");
    motion.append(assembly);
    svg.append(motion);
    svg.setAttribute("viewBox", "-1000 -900 2000 1800");
    svg.style.cssText = "width:100%;height:100%;display:block";
  });
  return F;
}

function ambSleepTurn(F, rest) {
  const cycle = ((rest % 64) + 64) % 64;
  const index = Math.floor(cycle / 16);
  const time = cycle % 16;
  const start = F.sleepHoldPlan[index];
  const end = 12 + (F.sleepHoldPlan[(index + 1) % 4] - 5) * 0.35;
  const entering = Math.max(0, Math.min(1, (time - start) / 0.9));
  const leaving = Math.max(0, Math.min(1, (time - end) / 1.1));
  return {
    weight: ambSmooth(entering) * (1 - ambSmooth(leaving)),
    lift: Math.sin(entering * Math.PI) + Math.sin(leaving * Math.PI),
  };
}

function ambConnectedRest(F, rollTime, sleepElapsed, landingElapsed, reduced) {
  if (sleepElapsed !== null) return ambSleepHandoff(F, sleepElapsed, reduced);
  const art = F.art;
  ambFlopDraw(F, rollTime, "roll-test", reduced);
  const rest = 0;
  const breath = reduced ? 0 : (1 - Math.cos((rest * Math.PI) / 2)) * 0.013;
  const compression = landingElapsed === null || reduced ? 0 : Math.sin(Math.PI * Math.min(1, Math.max(0, landingElapsed) / 0.26)) * 0.035;
  const turn = { weight: 0, lift: 0 };
  const rise = 0;
  const eyelid = 1;
  art.querySelectorAll(".owner-roll-frame").forEach((frame) => {
    const body = frame.querySelector(".owner-roll-body");
    body.setAttribute("transform", `${body.getAttribute("transform")} translate(${-turn.weight * 5} ${500 - turn.lift * 14 - turn.weight * 3}) scale(${1 + compression * 0.6 + breath * 0.35} ${1 - compression + breath}) translate(0 -500)`);
    const face = frame.querySelector(".owner-roll-face-arc");
    face.style.translate = `${AMB_SLEEP_OFFSETS.face.x * turn.weight + breath * 35}px ${AMB_SLEEP_OFFSETS.face.y * turn.weight + breath * 90}px`;
    const cover = frame.querySelector(".sleep-blanket");
    cover.style.opacity = String(rise);
    cover.setAttribute("transform", `translate(0 ${(1 - rise) * 90})`);
    frame.querySelectorAll(".sleep-open-eye").forEach((eye) => {
      const cy = Number(eye.dataset.cy);
      eye.style.opacity = eyelid < 0.08 ? "0" : "1";
      eye.setAttribute("transform", `translate(0 ${cy}) scale(1 ${Math.max(0.08, eyelid)}) translate(0 ${-cy})`);
    });
    frame.querySelectorAll(".sleep-closed-eye").forEach((eye) => {
      eye.style.opacity = eyelid < 0.08 ? "1" : "0";
    });
    frame.querySelector(".sleep-mouth").style.opacity = "1";
    frame.querySelectorAll(".connected-sleep-zz").forEach((zz, index) => {
      const wave = (1 - Math.cos((rest * Math.PI) / 2 - index * 0.6)) / 2;
      zz.style.opacity = "0";
      zz.setAttribute("transform", `translate(0 ${reduced ? 0 : -wave * 18})`);
    });
  });
  return undefined;
}

function ambSleepHandoff(F, elapsed, reduced) {
  const art = F.art;
  const duration = 3.2;
  if (elapsed >= duration || reduced) {
    ambFlopDraw(F, 1, "roll-test", reduced);
    const frame = art.querySelectorAll(".owner-roll-frame")[1];
    const age = Math.max(0, elapsed - duration);
    const rest = Math.max(0, age - 2.4);
    const breath = reduced ? 0 : (1 - Math.cos((rest * Math.PI) / 2)) * 0.013;
    const turn = reduced ? { weight: 0, lift: 0 } : ambSleepTurn(F, rest);
    const body = frame.querySelector(".owner-roll-body");
    body.setAttribute("transform", `${body.getAttribute("transform")} translate(${-turn.weight * 5} ${500 - turn.lift * 14 - turn.weight * 3}) scale(${1 + breath * 0.35} ${1 + breath}) translate(0 -500)`);
    frame.querySelectorAll(".sleep-open-eye").forEach((eye) => {
      eye.style.opacity = "0";
    });
    frame.querySelectorAll(".sleep-closed-eye").forEach((eye) => {
      eye.style.opacity = "1";
    });
    frame.querySelector(".sleep-mouth").style.opacity = String(reduced ? 0 : 1 - ambSmooth((age - 0.25) / 0.65));
    frame.querySelector(".owner-roll-face-arc").style.translate = `${AMB_SLEEP_OFFSETS.face.x * turn.weight + breath * 35}px ${AMB_SLEEP_OFFSETS.face.y * turn.weight + breath * 90}px`;
    frame.querySelector(".connected-sleep-parts").style.opacity = "1";
    const blanket = frame.querySelector(".connected-blanket-only");
    const rise = reduced ? 1 : ambSmooth(age / 2.4);
    blanket.style.opacity = String(reduced ? 1 : ambSmooth(age / 0.7));
    blanket.setAttribute("transform", `translate(0 ${(1 - rise) * 180})`);
    F.sleepPartTracks.forEach((track) => {
      track.foreground.append(track.original);
      const progress = reduced ? 1 : ambSmooth((age - 0.15) / 1.5);
      const dx = track.to[0] - track.from[0];
      const dy = track.to[1] - track.from[1];
      const offset = AMB_SLEEP_OFFSETS[track.targetId];
      track.original.setAttribute("transform", `translate(${(dx * progress + offset.x * turn.weight) / track.sourceScale} ${(dy * progress + offset.y * turn.weight) / track.sourceScale})`);
      track.original.style.opacity = "1";
      if (track.openArm) {
        track.original.style.opacity = "0";
        track.openArm.style.opacity = "1";
        track.armRevealCover.setAttribute("transform", blanket.getAttribute("transform"));
        track.armRevealCover.style.opacity = blanket.style.opacity;
        track.openArm.setAttribute("transform", `translate(${-dx * (1 - progress) + offset.x * turn.weight} ${-dy * (1 - progress) + offset.y * turn.weight})`);
      }
    });
    frame.querySelectorAll(".connected-sleep-zz").forEach((zz, index) => {
      const wave = (1 - Math.cos((rest * Math.PI) / 2 - index * 0.6)) / 2;
      zz.style.opacity = String(age < 2.4 ? 0 : reduced ? 1 : 0.35 + wave * 0.65);
      zz.setAttribute("transform", `translate(0 ${reduced ? 0 : -wave * 18})`);
    });
    return undefined;
  }
  ambFlopDraw(F, 1, "roll-test", reduced);
  const frame = art.querySelectorAll(".owner-roll-frame")[1];
  const body = frame.querySelector(".owner-roll-body");
  const tilt = Math.sin((elapsed / duration) * Math.PI * 2) * 1.2 * Math.sin((elapsed / duration) * Math.PI);
  body.setAttribute("transform", `${body.getAttribute("transform")} rotate(${tilt})`);
  let eyelid = 1;
  for (const [start, length] of [[0.35, 0.22], [1.05, 0.5], [2.1, 0.85]]) {
    const phase = (elapsed - start) / length;
    if (phase > 0 && phase < 1) eyelid = Math.min(eyelid, 1 - 0.96 * Math.sin(phase * Math.PI));
  }
  eyelid *= 1 - ambSmooth((elapsed - 2.65) / 0.55);
  frame.querySelectorAll(".sleep-open-eye").forEach((eye) => {
    const cy = Number(eye.dataset.cy);
    eye.style.opacity = eyelid < 0.08 ? "0" : "1";
    eye.setAttribute("transform", `translate(0 ${cy}) scale(1 ${Math.max(0.08, eyelid)}) translate(0 ${-cy})`);
  });
  frame.querySelectorAll(".sleep-closed-eye").forEach((eye) => {
    eye.style.opacity = eyelid < 0.08 ? "1" : "0";
  });
  return undefined;
}

// The two branches of the preview's drawIdleFlop() the connected sequence uses: the confirmed Flop
// (quick drop, 1.30s impact) and the viewer-right roll rig. `reduced` holds the rig at its end pose,
// exactly like the preview does for the flop-sleep cue.
function ambFlopDraw(F, elapsed, cueId, reduced) {
  const art = F.art;
  F.sleepPartTracks?.forEach((track) => {
    if (track.openArm) track.openArm.style.opacity = "0";
    if (track.original.parentNode === track.foreground) track.homeAnchor.after(track.original);
  });
  art.querySelectorAll(".connected-sleep-parts").forEach((parts) => {
    parts.style.opacity = "0";
  });
  art.querySelectorAll(".connected-original-arm").forEach((arm) => {
    arm.style.opacity = "1";
    arm.removeAttribute("transform");
  });
  art.querySelector(".source-sleep-placement")?.removeAttribute("transform");
  art.querySelectorAll(".connected-sleep-zz").forEach((zz) => {
    zz.style.opacity = "0";
  });
  art.querySelectorAll(".owner-roll-face-arc").forEach((face) => {
    face.style.translate = "";
  });
  const experimentFrames = art.querySelectorAll(".flop-experiment-frame");
  experimentFrames.forEach((frame) => {
    frame.style.opacity = "0";
  });
  if (cueId === "flop-experiment") {
    art.querySelectorAll(".owner-roll-frame, .owner-sleep-source").forEach((frame) => {
      frame.style.opacity = "0";
    });
    const impactAt = 1.3;
    const index = reduced ? 3 : elapsed < 1 ? 0 : elapsed < 1.24 ? 1 : elapsed < impactAt ? 2 : 3;
    const impact = Math.max(0, elapsed - impactAt);
    const compression = index === 3 && !reduced ? Math.sin(Math.PI * Math.min(1, impact / 0.26)) * 0.035 : 0;
    experimentFrames[index].style.opacity = "1";
    experimentFrames[index].querySelector(".flop-experiment-motion").setAttribute("transform", `translate(0 400) scale(${1 + compression * 0.6} ${1 - compression}) translate(0 -400)`);
    return undefined;
  }
  const sourceSleep = art.querySelector(".owner-sleep-source");
  sourceSleep.style.opacity = "0";
  const ownerFrames = art.querySelectorAll(".owner-roll-frame");
  ownerFrames.forEach((frame) => {
    frame.style.opacity = "0";
  });
  const keys = [
    [0, 0, 0], [0.2, 0, 0], [0.85, 1, 1], [1.2, 1, 1], [1.75, 0, 0],
    [2, 2, 0], [2.2, 2, 0], [2.85, 3, -1], [3.2, 3, -1], [3.75, 2, 0], [4, 0, 0],
  ];
  // The connected sequence is the preview's "flop-sleep" cue: reduced motion holds the roll at t=1.
  const t = reduced ? 1 : elapsed % 4;
  const end = keys.findIndex((key) => key[0] > t);
  const a = keys[Math.max(0, end - 1)];
  const b = keys[end < 0 ? keys.length - 1 : end];
  const fraction = Math.min(1, Math.max(0, (t - a[0]) / Math.max(0.001, b[0] - a[0])));
  const eased = ambSmooth(fraction);
  const turn = a[2] + (b[2] - a[2]) * eased;
  const blend = fraction < 0.68 ? 0 : 1;
  ownerFrames[a[1]].style.opacity = String(a[1] === b[1] ? 1 : 1 - blend);
  if (a[1] !== b[1]) ownerFrames[b[1]].style.opacity = String(blend);
  const poseWidth = (index) => Number(ownerFrames[index].dataset.bodyWidth) * Number(ownerFrames[index].dataset.widthFit || 1);
  const widthProgress = eased;
  const continuousWidth = poseWidth(a[1]) + (poseWidth(b[1]) - poseWidth(a[1])) * widthProgress;
  const leftFace = JSON.parse(ownerFrames[3].dataset.faceCenter);
  const rightFace = JSON.parse(ownerFrames[1].dataset.faceCenter);
  const faceProgress = 0.5 + turn * 0.4;
  const faceX = leftFace[0] + (rightFace[0] - leftFace[0]) * faceProgress - 70 * Math.max(0, -turn);
  const faceY = 40 + 25 * Math.abs(turn) + leftFace[1] + (rightFace[1] - leftFace[1]) * faceProgress - 20 * 4 * faceProgress * (1 - faceProgress);
  const sourceFaceAngle = (index) => {
    const [left, right] = JSON.parse(ownerFrames[index].dataset.eyePositions);
    return (Math.atan2(right[1] - left[1], right[0] - left[0]) * 180) / Math.PI;
  };
  const faceAngle = (turn < 0 ? sourceFaceAngle(3) : sourceFaceAngle(1)) - sourceFaceAngle(0);
  const bodyAngle = 28 + Math.abs(turn) * 8;
  const endpoint = AMB_FACE_ADJUST[turn < 0 ? "left" : "right"];
  const adjustment = Object.fromEntries(["x", "y", "angle"].map((key) => [key, AMB_FACE_ADJUST.center[key] + (endpoint[key] - AMB_FACE_ADJUST.center[key]) * Math.abs(turn)]));
  ownerFrames.forEach((frame) => {
    const widthFit = continuousWidth / Number(frame.dataset.bodyWidth);
    const faceBodyScale = continuousWidth / Number(ownerFrames[0].dataset.bodyWidth);
    frame.querySelector(".owner-roll-face-arc").setAttribute("transform", `translate(${(faceX * faceBodyScale) / widthFit + adjustment.x} ${faceY + adjustment.y}) scale(${faceBodyScale / widthFit} 1) rotate(${faceAngle * Math.abs(turn) + adjustment.angle})`);
    const breathing = 0;
    frame.querySelector(".owner-roll-body").setAttribute("transform", `translate(${turn * 74} ${turn * 39}) rotate(${bodyAngle}) translate(0 500) scale(${widthFit * (1 + breathing * 0.5)} ${1 + breathing}) translate(0 -500)`);
    const coverProgress = 0;
    const blanket = frame.querySelector(".sleep-blanket");
    blanket.style.opacity = String(coverProgress);
    blanket.setAttribute("transform", `translate(0 ${(1 - coverProgress) * 430})`);
    const eyelid = 1;
    frame.querySelectorAll(".sleep-open-eye").forEach((eye) => {
      const cy = Number(eye.dataset.cy);
      eye.style.opacity = eyelid < 0.08 ? "0" : "1";
      eye.setAttribute("transform", `translate(0 ${cy}) scale(1 ${Math.max(0.08, eyelid)}) translate(0 ${-cy})`);
    });
    frame.querySelectorAll(".sleep-closed-eye").forEach((eye) => {
      eye.style.opacity = eyelid < 0.08 ? "1" : "0";
    });
    frame.querySelector(".sleep-mouth").style.opacity = "1";
    const arm = frame.querySelector(".owner-roll-front-arm");
    if (arm) {
      const localTime = t % 2;
      const follow = reduced ? 0 : ambSmooth((localTime - 0.32) / 0.45) * (1 - ambSmooth((localTime - 1.35) / 0.4));
      arm.setAttribute("transform", `rotate(${Number(arm.dataset.direction) * 9 * follow} ${arm.dataset.pivot})`);
      const leg = frame.querySelector(".owner-roll-front-leg");
      const legFollow = reduced ? 0 : ambSmooth((localTime - 0.4) / 0.43) * (1 - ambSmooth((localTime - 1.35) / 0.4));
      const [hipX, hipY] = leg.dataset.pivot.split(" ").map(Number);
      leg.setAttribute("transform", `rotate(${Number(leg.dataset.direction) * 14 * legFollow} ${leg.dataset.pivot}) translate(${hipX} ${hipY}) scale(0.85) translate(${-hipX} ${-hipY})`);
      const rightFoot = frame.querySelector(".owner-roll-right-foot");
      if (rightFoot) rightFoot.setAttribute("transform", `rotate(${8 * legFollow} 708 1090)`);
    }
  });
  return undefined;
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
  // [A-646 Gate Q4] Add money 는 MY MONEY 면이 떠 있는 동안만 산다 — 다른 면이면 흔적 없이 닫는다.
  if (mode !== "money") state.addMoney = null;
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
  // [A-662] this is the SAME "HISTORY stacked & open" condition `syncRecordsViewportState()`
  // already sets `.homePaperMount.inert` from — kept consistent with the new geometry-fit
  // decision (computeHistoryFitMode()) instead of the old flat `window.innerWidth <= 640`, so a
  // synthetic/programmatic click can't slip through in the 641-~710 range that used to read as
  // "web" under the old threshold but is now stacked mode.
  if (state.recordsCardVisible && computeHistoryFitMode() === "stacked") return;
  // [A-646] Add money — 열기 · 닫기 · ok(한 번). 셋 다 왼쪽 종이만 다시 그린다. 서명·WebAuthn·tx·충전 0.
  if (event.target.closest("#homeAddMoney")) {
    openAddMoney();
    refreshHomePaperMount();
    return;
  }
  if (event.target.closest("#homeAddMoneyBack")) {
    state.addMoney = null;
    refreshHomePaperMount();
    return;
  }
  if (event.target.closest("#homeAddMoneyOk")) {
    confirmAddMoney();
    refreshHomePaperMount();
    return;
  }
  if (event.target.closest(".homePaper__addMoney")) return; // 칸 탭은 입력만 — 다른 분기로 흘리지 않는다.
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

  // [A-644 2B] 고른 Piggy 의 조작 깊이 — **선호 저장소에만** 쓴다. 대상 Piggy 는 DOM 이 아니라
  // 그림을 그린 것과 같은 규칙(controlModePiggyId)으로 다시 정한다. 서명·권한·tx·충전·Job·
  // moneyIntent·selectedPiggy 를 건드리지 않고, render() 대신 왼쪽 종이만 다시 그린다.
  const controlModeButton = event.target.closest('[id^="homeControlMode--"]');
  if (controlModeButton) {
    const piggyId = controlModePiggyId();
    const mode = controlModeButton.id.slice("homeControlMode--".length);
    if (piggyId && isControlMode(mode)) saveControlMode(safeLocalStorage(), controlModeScope(piggyId), mode);
    refreshHomePaperMount();
    return;
  }
  // [A-484 Lane C] MY MONEY 의 Piggy 행 → **오른쪽 HISTORY 의 정체성만** 바꾼다.
  // 새 종이를 만들지 않는다. 다른 행을 고르면 정체성이 교체될 뿐이다.
  const moneyPiggyRow = event.target.closest('[id^="homeMoneyPiggyRow--"]');
  if (moneyPiggyRow) {
    state.historyPiggyId = moneyPiggyRow.id.slice("homeMoneyPiggyRow--".length) || null;
    // [A-512] 행을 고르면 그 Piggy 가 돈 동작의 선택이 된다 — 바뀌면 이전 권한부터 죽인다.
    applyPiggySelection(moneyPiggiesSnapshot().piggies.find((p) => p.id === state.historyPiggyId) || null);
    // [A-644] 고른 행(--on)과 (Second 뒤) 그 Piggy 의 조작 깊이가 바로 보이도록 왼쪽 종이만 다시
    // 그린다 — 그 전엔 openRecordsCard() 만 불러 종이가 옛 모양 그대로였다. 초점은 같은 행으로 돌려준다.
    const hadFocus = document.activeElement === moneyPiggyRow;
    refreshHomePaperMount();
    if (hadFocus) document.getElementById(moneyPiggyRow.id)?.focus({ preventScroll: true });
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

// [A-656 decision 2, coordinator merge 2026-09-30 → A-659 OWNER VISUAL REPAIR 2026-09-30 →
// A-659 OWNER CORRECTION "1440 WEB VERTICAL CANON" 2026-09-30/10-01, superseding rewrite #2]
// Web Home vertical anchor. History: A-656 scoped the correction to 641≤vw<1200 and left 1200+
// ("1440 reference") untouched. The A-659 visual-repair pass (superseded rewrite #1, see git
// blame on this block) replaced that with ONE fixed bottom-safe rule (`vh − max(64, 0.08·vh)`,
// foot ≈0.92·vh) applied to every width ≥641 including 1440 — the Owner's LATEST correction
// (INBOX "OWNER CORRECTION — 1440 WEB VERTICAL CANON + MOTION-COHERENCE" / "... 1440 WEB CANON
// 우선", both 2026-10-01) overturns that: **1440×900's current settled foot is canon and must
// not move.** Every other web width (641..∞, still no upper bound — 1200 is not a hole) must
// instead match 1440's own NORMALIZED foot ratio (foot Y / vh), not a fixed px gap and not the
// previous pass's fixed 0.92 fraction.
//
// `HOME_FOOT_NORMALIZED_RATIO` (≈0.8341, matches the Owner's measured 1440×900 canon
// 750.7/900) is DERIVED here from the same board constants every other Home placement uses
// (HOME_BOARD_W/H, HOME_FLOOR) via the reference viewport's own natural aspect-fit — the exact
// `refS`/`refFootFrac` shape A-656 originally used before the now-superseded rewrite replaced
// it — not hand-typed as a magic literal. Because it is derived from the SAME formula
// `computeHomeMidBandDropPx()` evaluates at runtime, plugging vw=1440/vh=900 back in below
// reproduces the canon exactly (`dy` resolves to 0), so 1440×900 gets no wrapper transform at
// all — byte/pixel-identical to the pre-repair baseline, not merely visually close.
const HOME_FOOT_REF_VW = 1440;
const HOME_FOOT_REF_VH = 900;
function computeHomeFootNormalizedRatio() {
  const refS = Math.min(HOME_FOOT_REF_VW / HOME_BOARD_W, HOME_FOOT_REF_VH / HOME_BOARD_H);
  const refTop = (HOME_FOOT_REF_VH - HOME_BOARD_H * refS) / 2;
  const refFootY = refTop + HOME_FLOOR * refS;
  return refFootY / HOME_FOOT_REF_VH;
}
const HOME_FOOT_NORMALIZED_RATIO = computeHomeFootNormalizedRatio();
// Mobile safe-area is a MINIMUM clearance only (Owner correction — 390/430 no longer use the
// fixed ~42px gap as the primary target): the proportional target wins unless it would leave
// less than this many px between the foot and the viewport bottom, which the normalized ratio's
// own ≈16.6% bottom-gap never does at any realistic viewport height. Same two tokens the narrow
// scale-floor branch already used (`--mobile-bottom-safe` + `HOME_CHAR_BOTTOM_ANCHOR_GAP_PX`) —
// one shared target function now, not a duplicated formula per call site.
function computeHomeFootTargetViewportY(vh) {
  const bottomSafeMinPx = resolveCssLengthVarPx("--mobile-bottom-safe", 20) + HOME_CHAR_BOTTOM_ANCHOR_GAP_PX;
  // [A-681 OWNER DIRECTION 2026-10-03 item 3] "the current ~128/137px Home bottom gap is too
  // large, derive an iPhone-safe bottom from actual geometry — do not invent a universal pixel
  // constant." Root cause: the min() below (frozen, still used at every width >640) always picks
  // the proportional-ratio branch, because HOME_FOOT_NORMALIZED_RATIO*vh is smaller than
  // vh-bottomSafeMinPx at any realistic viewport height — the tighter safe-min branch never wins,
  // on mobile or web. Mobile-only (<=640): flip to max() so the ALREADY-EXISTING safe-min target
  // (`--mobile-bottom-safe`, itself `env(safe-area-inset-bottom, 0px) + 20px` per style.css :root
  // — 0 in this Chromium harness, the real nonzero home-indicator inset on an actual iPhone Safari
  // per app/test/a665-real-iphone-safari.mjs) wins instead, closing the gap to ~42px here (20+22,
  // both pre-existing tokens) without inventing any new constant. HOME_FOOT_NORMALIZED_RATIO
  // itself is NOT re-derived (still frozen, still the fallback below for width>640) — only WHICH
  // of the two already-existing targets wins changes, and only under the same <=640 boundary this
  // card's other mobile-only changes use.
  if (window.innerWidth <= 640) return Math.max(HOME_FOOT_NORMALIZED_RATIO * vh, vh - bottomSafeMinPx);
  return Math.min(HOME_FOOT_NORMALIZED_RATIO * vh, vh - bottomSafeMinPx);
}

// [A-662 OWNER DECISION — NAME/HATCH → HOME ENDPOINT CONTINUITY, 2026-10-01, option ③] Hatch's
// and Name's phone (≤640px) anchor used to be a fixed near-bottom offset
// (`bottom: calc(var(--mobile-bottom-safe) + 5px)`, style.css — real ink measured ≈0.957·vh:
// 810/844 @390, 866/900 @430) completely unrelated to Home's own resident floor target
// (`computeHomeFootTargetViewportY()` → ≈0.834·vh: 703.8/844, 750.7/900) — two independent
// corrections (A-608 for this anchor, A-659 for Home's ratio) that never cross-checked each
// other, producing the ~107–116px visible-foot jump at the Name→Home cut (M1_CODE_MAP.md root
// cause, A-662 prewrite). Owner's 2026-10-01 decision (option ③) rejects "the walk is continuous
// so the jump doesn't matter" and requires fixing the ENDPOINT relationship itself, through the
// EXISTING shared safe-frame/floor contract — not a new one-off per-width offset. This reuses
// `computeHomeFootTargetViewportY()` ITSELF (the exact function/ratio Home's own resident floor
// targets) for Hatch/Name's phone anchor too — one shared target, two already-existing
// consumers — while leaving the onboarding close-up's own SIZE (107.6×139.9, `.chogInvite`
// crop) completely untouched, per Owner's explicit "preserve apparent onboarding scale, do not
// force identical character size" — only the anchor's distance from the viewport bottom moves.
// Hatch and Name stay byte-identical to each other (canon: "keep Hatch and Name identical") —
// same function call, same result, applied to both. Web (>640px) is untouched (frozen, A-608).
// [A-681 iteration 2 — coordinator AFTER1 report] Hatch/Name's Chog box was left at its
// pre-A-681 apparent size (107.6×139.9, `.chogInvite` crop unchanged) while Home's own Chog
// grew by homeCharMobileBoost() — exactly the Name→Home visible-size jump A-662 was written to
// close (shared foot anchor only fixes the Y jump; it never claimed to fix a SIZE mismatch,
// because until A-681 there wasn't one). Fix: scale the whole `.hatchChog`/`.nameScene__chog`
// box by the SAME boost, mobile-only, pivoted at its own bottom-center (`transform-origin:
// center bottom`) so it grows upward from the already-correct foot anchor, same "foot anchor,
// grow upward" principle as every other consumer in this card — `--paperScale`-style box, not a
// re-crop, so `.chogInvite`'s own internal crop offsets stay byte-identical. Only an INLINE
// override when boost>1; cleared (empty string) otherwise so the base CSS rule's own
// `transform: translate(-260%,-6%)` (web) or the narrow rule's `transform: none` (mobile,
// boost===1 case) keeps applying exactly as before A-681.
// NOT done here: the separate `#namePiggy` rig (`.nameScene__piggy`, full 1280×800 clip-masked
// container) already carries its OWN active `transform:translateX()` slide/hide choreography
// (A-415, `.is-standing`/`:has(#piggyNameInput:disabled)` toggles) — setting an inline
// `transform` here would silently replace that mechanism, and part of its styling
// (`.nameScene__piggy .pgwrap`) is in `name.css`, outside this card's allowlist. Flagged in
// VERIFY.md as a known scope boundary, not attempted blind without a browser to verify the
// slide/hide sequence still works.
function applyOnboardingPhoneFoot() {
  const narrow = window.innerWidth <= 640;
  const bottomPx = narrow ? `${Math.max(0, window.innerHeight - computeHomeFootTargetViewportY(window.innerHeight))}px` : "";
  const boost = homeCharMobileBoost();
  const scaleTransform = narrow && boost !== 1 ? `scale(${boost})` : "";
  const scaleOrigin = narrow && boost !== 1 ? "center bottom" : "";
  const hatch = document.querySelector(".hatchChog");
  if (hatch) { hatch.style.bottom = bottomPx; hatch.style.transform = scaleTransform; hatch.style.transformOrigin = scaleOrigin; }
  const name = document.querySelector(".nameScene__chog");
  if (name) { name.style.bottom = bottomPx; name.style.transform = scaleTransform; name.style.transformOrigin = scaleOrigin; }
}
const HOME_MID_BAND_MIN_VW = 641;
function computeHomeMidBandDropPx(fit, boardRect, s) {
  const vw = window.innerWidth;
  if (!(vw >= HOME_MID_BAND_MIN_VW)) return 0;
  const vh = window.innerHeight;
  const targetFootViewportY = computeHomeFootTargetViewportY(vh);
  const boardTop = fit && Number.isFinite(fit.top) ? fit.top : boardRect.top;
  const dy = targetFootViewportY - (boardTop + HOME_FLOOR * s);
  return dy > 0.5 ? dy : 0;
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
  // [A-656 decision 2 → A-659 OWNER VISUAL REPAIR] Web (vw≥641, no upper bound) translate-only
  // drop — see computeHomeMidBandDropPx() above. This branch is separate from, and evaluated before, the
  // mobile scale-floor branch's own no-op guard immediately below (that guard's literal source
  // shape is unchanged — home-character-scale-floor.mjs's locked contract still finds it). A
  // distinct `midBand: true` (never `applied: true`) on the returned plan is deliberate: the
  // walk-start / pairConverge gate (`computeHomeCharScaleFloorPlan(fit)?.applied`, used at
  // mountHome()'s pairConvergeActive/chogWalkStartBoardRect call sites) must NOT switch on for
  // mid-band — only the real narrow-scale floor does.
  if (s >= HOME_CHAR_SCALE_FLOOR) {
    const midBandDy = computeHomeMidBandDropPx(fit, boardRect, s);
    if (midBandDy > 0) {
      const midBandParts = [homeChar, chogHome].filter(Boolean);
      const midBandGroup = document.createElement("div");
      midBandGroup.className = "homeCharScaleFloor";
      midBandGroup.setAttribute("data-scale-floor", "1");
      midBandGroup.setAttribute("data-mid-band-drop", midBandDy.toFixed(2));
      board.insertBefore(midBandGroup, board.firstChild);
      midBandParts.forEach((el) => midBandGroup.appendChild(el));
      midBandGroup.style.transformOrigin = `${HOME_CENTER}px ${HOME_FLOOR}px`;
      midBandGroup.style.transform = `translate(0px, ${(midBandDy / s).toFixed(4)}px) scale(1)`;
      return { applied: false, s, midBand: true, midBandDy };
    }
  }
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
  // Fix: derive the Y nudge from an explicit **target** instead of a fixed offset from
  // whatever the natural position happens to be. [A-659 OWNER CORRECTION — 1440 WEB VERTICAL
  // CANON, 2026-10-01] the target itself used to be a fixed bottom-safe token (`--mobile-
  // bottom-safe` + `HOME_CHAR_BOTTOM_ANCHOR_GAP_PX`, ~42px gap) — the Owner's latest
  // correction overturns that for THIS narrow/mobile branch too: it must now match the SAME
  // 1440×900-derived normalized foot ratio the web mid-band branch uses
  // (`computeHomeFootTargetViewportY()`, defined above `computeHomeMidBandDropPx()`), with the
  // old bottom-safe tokens folded into that function as a MINIMUM clearance only, not the
  // primary target. `originLocalY` (=HOME_FLOOR) is still the transform-origin — the foot's
  // own LOCAL point never moves under `scale(k)` — so "foot anchor stable, grow upward" holds
  // exactly as before; only the *translate* component's Y is now computed rather than a magic
  // number. Same `fit`/`s` at walk-start and settle (A-605's own no-jump guarantee) ⇒ this Y
  // nudge is byte-identical across the whole walk→settle sequence, same as before.
  const boardTop = fit && Number.isFinite(fit.top) ? fit.top : boardRect.top;
  const naturalFootViewportY = boardTop + originLocalY * s;
  // [A-681 iteration 2] subtract the boosted ink-overhang so the REAL ink-bottom (not just the
  // anchor point) lands at the planned gap — see homeCharFloorInkOverhangCorrectionPx() above.
  const targetFootViewportY = computeHomeFootTargetViewportY(window.innerHeight) - homeCharFloorInkOverhangCorrectionPx();
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
  const nudgeViewportX = homeFloorNudgeViewportX(s);
  const nudgeViewportY = targetFootViewportY - naturalFootViewportY;
  const nudgeLocalX = nudgeViewportX / s;
  const nudgeLocalY = nudgeViewportY / s;
  // [A-681] Mobile-only size boost on top of the floor's own k — see HOME_CHAR_MOBILE_GROUP_BOOST
  // above. The foot anchor is unaffected: transform-origin stays the LOCAL foot point, and nudge*
  // above were derived from `s` (not `k`), so scaling by ANY k here still lands the origin exactly
  // at targetFootViewportY (algebraic proof: A-681 VERIFY.md) — this only changes how much the
  // group grows upward from that fixed foot.
  const kBoosted = k * homeCharMobileBoost();
  group.style.transformOrigin = `${originLocalX}px ${originLocalY}px`;
  group.style.transform = `translate(${nudgeLocalX}px, ${nudgeLocalY}px) scale(${kBoosted})`;

  return { applied: true, s, k: kBoosted, effectiveScale: s * kBoosted, collisionActive };
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
  // [A-656 decision 2/3/4] Mid-band twin of applyHomeCharacterScaleFloor()'s own mid-band branch
  // — read-only (this function never mutates the DOM), so Away/Return/First-Job consumers can
  // learn the SAME drop before mounting/re-fitting their own elements.
  if (s >= HOME_CHAR_SCALE_FLOOR) {
    const midBandDy = computeHomeMidBandDropPx(fit, boardRect, s);
    if (midBandDy > 0) return { applied: false, s, midBand: true, midBandDy };
  }
  if (s >= HOME_CHAR_SCALE_FLOOR) return { applied: false, s };
  const k = HOME_CHAR_SCALE_FLOOR / s;
  const originLocalX = HOME_CENTER;
  const originLocalY = HOME_FLOOR;
  const boardTop = fit && Number.isFinite(fit.top) ? fit.top : boardRect.top;
  const naturalFootViewportY = boardTop + originLocalY * s;
  // [A-681 iteration 2] same ink-overhang correction as applyHomeCharacterScaleFloor()'s twin above.
  const targetFootViewportY = computeHomeFootTargetViewportY(window.innerHeight) - homeCharFloorInkOverhangCorrectionPx();
  const nudgeViewportX = homeFloorNudgeViewportX(s);
  const nudgeViewportY = targetFootViewportY - naturalFootViewportY;
  const nudgeLocalX = nudgeViewportX / s;
  const nudgeLocalY = nudgeViewportY / s;
  // [A-681] same boost as applyHomeCharacterScaleFloor()'s own copy above — this twin's `k` must
  // report the SAME boosted value its callers (applyHomeFloorToChogOnly/applyHomeFloorToReturnCluster/
  // chogWalkStartBoardRect) actually render with, or A-610's walk-start inverse-math desyncs from
  // the real transform.
  const kBoosted = k * homeCharMobileBoost();
  return { applied: true, s, k: kBoosted, originLocalX, originLocalY, nudgeLocalX, nudgeLocalY };
}

// [A-656 decision 3 — CANON "Away does NOT move Chog"] Away/Return render `#chogHome` as a direct
// child of their OWN `#homeBoard` (same markup convention Home uses — see renderAway()/
// renderSecondAway() markup) but never render `#homeChar` (Piggy there is drawn on the depart/
// return canvas, not through `#homeChar`), so `applyHomeCharacterScaleFloor()`'s own
// `if (!homeChar) return null;` guard always bails there. Proven root cause of the mobile Away/
// Return Chog jump (A-656 P3: "renderAway() has no #homeChar, so the scale-floor group is never
// built"). This applies the SAME plan (`computeHomeCharScaleFloorPlan(fit)` — mobile floor OR
// mid-band, whichever is active; a strict no-op otherwise) to `#chogHome` alone, reusing the same
// idempotent global `.homeCharScaleFloor` wrap/unwrap idiom Home itself uses. Home, Away and
// Return never share the DOM at once (different state.scene), so the one global marker is safe to
// reuse here — same as `unwrapHomeCharacterScaleFloor()` already assumes.
function applyHomeFloorToChogOnly(fit) {
  const board = document.querySelector("#homeBoard");
  unwrapHomeCharacterScaleFloor();
  const chogHome = document.querySelector("#chogHome");
  if (!board || !chogHome) return null;
  const plan = computeHomeCharScaleFloorPlan(fit);
  if (!plan || (!plan.applied && !plan.midBand)) return plan;
  const s = plan.s;
  const k = plan.applied ? plan.k : 1;
  const nudgeLocalX = plan.applied ? plan.nudgeLocalX : 0;
  const nudgeLocalY = plan.applied ? plan.nudgeLocalY : plan.midBandDy / s;
  const group = document.createElement("div");
  group.className = "homeCharScaleFloor";
  group.setAttribute("data-scale-floor", plan.applied ? String(HOME_CHAR_SCALE_FLOOR) : "1");
  board.insertBefore(group, board.firstChild);
  group.appendChild(chogHome);
  group.style.transformOrigin = `${HOME_CENTER}px ${HOME_FLOOR}px`;
  group.style.transform = `translate(${nudgeLocalX}px, ${nudgeLocalY}px) scale(${k})`;
  return plan;
}

// [A-656 decision 4] Return's `#homeBoard` has TWO direct children beyond the usual
// `#homeChar`/`#chogHome` pair the floor otherwise wraps: `#returnChogHop` (Chog's OWN
// alarm-hop wrapper — return-view.js's `placeChog()` animates ITS transform; wrapping
// `#chogHome` directly instead would silently detach it from that hop) and `#returnName` (the
// filed-state name tag, return-view.js's own `onFiled()`). Both need the SAME floor/mid-band
// group Home settled uses, so the coming-home Chog, the filed Chog and the filed name all agree
// with Home on mobile and mid-band (A-656 P3 §4 R2/R3). Same idempotent global marker/unwrap
// idiom as `applyHomeFloorToChogOnly()` — Home/Away/Return never share the DOM at once.
function applyHomeFloorToReturnCluster(fit) {
  const board = document.querySelector("#homeBoard");
  unwrapHomeCharacterScaleFloor();
  if (!board) return null;
  const plan = computeHomeCharScaleFloorPlan(fit);
  if (!plan || (!plan.applied && !plan.midBand)) return plan;
  const parts = [board.querySelector("#returnChogHop"), board.querySelector("#returnName")].filter(Boolean);
  if (!parts.length) return plan;
  const s = plan.s;
  const k = plan.applied ? plan.k : 1;
  const nudgeLocalX = plan.applied ? plan.nudgeLocalX : 0;
  const nudgeLocalY = plan.applied ? plan.nudgeLocalY : plan.midBandDy / s;
  const group = document.createElement("div");
  group.className = "homeCharScaleFloor";
  group.setAttribute("data-scale-floor", plan.applied ? String(HOME_CHAR_SCALE_FLOOR) : "1");
  board.insertBefore(group, board.firstChild);
  parts.forEach((el) => group.appendChild(el));
  group.style.transformOrigin = `${HOME_CENTER}px ${HOME_FLOOR}px`;
  group.style.transform = `translate(${nudgeLocalX}px, ${nudgeLocalY}px) scale(${k})`;
  return plan;
}

// [A-656 decision 4] Viewport-space (not local/board-space) view of a floor/mid-band plan, for
// consumers that must resize/reposition their OWN element (a <canvas>, not a DOM subtree CSS
// can wrap) with the A-607 canon-K formula — the Return canvas (return-view.js `fit()`, fed
// through the `fitBoard()` injection below) and the First Job work canvas (main.js, "apply the
// same anchor... for mid-band"). `k=1`/`nudgeViewportX=0` for mid-band mirrors the fact that
// mid-band never rescales, only translates.
// [A-681 iteration 3 — HISTORICAL, the compensation part is superseded by the FINAL CLOSEOUT note
// below; the `k` boost sharing stays] coordinator requires Away/Return/Receipt to share the group boost for
// A-656 Return→Receipt→File→Home continuity, superseding iteration 2's full revert] `plan.k`
// carries the A-681 mobile group-size boost. Iteration 2 divided it back out here to stop the
// Receipt paper clipping off-screen (root cause: piggy-return.js's own fixed board-local receipt
// anchor, `ANCHOR_BOARD_CX/CY` — NOT editable from this file — sits far from the
// (HOME_CENTER,HOME_FLOOR) pivot this whole canvas scales around, so inflating `k` drags that
// anchor proportionally off-screen) — but that also stopped the paper/in-canvas Piggy from
// growing with the rest of the cluster, which the coordinator's iteration-3 report says breaks
// continuity instead. Fix: keep `k` boosted (so the canvas, including the paper, grows), and ADD
// a compensating nudge that cancels (most of) the drift of a chosen board-local point, so it
// keeps close to the SAME viewport position it had at the un-boosted k while everything scales
// around it. Derivation: a board-local point P keeps its viewport position EXACTLY under any k
// once the nudge includes `HOME_CHAR_SCALE_FLOOR * (PIVOT - P) * (boost-1)` — HOME_CHAR_SCALE_FLOOR
// because `s·k_raw` is always exactly that constant whenever the floor is active, independent of
// viewport (the same identity item 2's ink-overhang fix relies on). Zero at boost=1 (web/641-653
// sliver), so non-mobile widths are an exact no-op, unchanged from pre-A-681.
//
//   [A-681 FINAL CLOSEOUT — anchor/bell point-compensation REMOVED] Iterations 3-6 added an extra
//   nudge `HOME_CHAR_SCALE_FLOOR * (PIVOT - P) * (boost-1)` here to pin ONE board-local point P (the
//   old fixed receipt anchor, piggy-return.js ANCHOR_BOARD_CX/CY) to its un-boosted viewport spot.
//   That translated the WHOLE return canvas (portal ring, bell, returning Piggy, folder) by ~119/88px
//   (390, boost 1.5) while Chog's wrapper (`applyHomeFloorToReturnCluster`, a pure floor transform)
//   did not move — so the bell and the returning Piggy slid out of Chog's frame and the bell
//   collided with Chog's yellow "...is coming home" line (coordinator-measured). The Owner's
//   closeout (A): "Bell + returning Piggy + Receipt canvas must use ONE mobile transform/pivot".
//   Now the canvas rides EXACTLY the transform Chog's group rides (same HOME_CENTER/HOME_FLOOR
//   pivot, same k, same nudge) — every canvas element keeps its un-boosted position RELATIVE to Chog
//   (the relationship confirmed non-colliding before the boost), and the seat still lands on Home's
//   foot (A-656). The Receipt no longer depends on any board-local anchor on mobile: piggy-return.js
//   re-targets it from live viewport facts (`homeReturnReceiptRail()` below ->
//   `receiptRailTarget()`), so nothing here has to keep it on-screen. Web / 641-653 sliver:
//   `plan.applied` is false there or the extra term was already exactly 0 — unchanged.
function computeHomeFloorViewportNudge(plan, s) {
  if (!plan || !(s > 0)) return null;
  if (plan.applied) {
    return { k: plan.k, nudgeViewportX: plan.nudgeLocalX * s, nudgeViewportY: plan.nudgeLocalY * s };
  }
  if (plan.midBand) return { k: 1, nudgeViewportX: 0, nudgeViewportY: plan.midBandDy };
  return null;
}

// [A-681 FINAL CLOSEOUT A — mobile Receipt target = viewer-LEFT CONTENT rail] Live viewport facts
// handed to piggy-return.js (via return-view.js `getReceiptRail`), which converts them through the
// return canvas's own on-screen rect into the Receipt's throw/settled/read target
// (`receiptRailTarget()`, pure + unit-tested in a681-return-receipt-bell-anchor.mjs). Returns null
// at width >640 -> piggy-return.js keeps its legacy fixed anchor (1440 / 700 / 900 byte-identical).
// Nothing here is an invented universal px — every term is an existing token or constant:
//   inset    --mobile-inset (style.css :root; 20 @<=400, 24 above) — the rail's left edge, and the
//            symmetric right margin the read (zoomed) paper must respect
//   topBound --mobile-top-safe + --grid-3 (16) — same top token Chog/brand/cards use, plus a grid step
//   cardCy   vh/2 - 48 — .cardAnchor's vertical centre line (style.css top:50% + translateY(-50% - 48px);
//            fitCardAnchor()'s own offY = 48)
//   cardW    285 — .cardAnchor width (style.css; fitCardAnchor() w) — Receipt never exceeds the
//            First Send / Explore card's own width
//   gap      --grid-5 (32) — clearance under the read paper to Piggy's head box (holds return-view's
//            8px-offset hint line too)
// TUNE HERE (coordinator): RECEIPT_RAIL_GAP_TOKEN / RECEIPT_RAIL_TOP_EXTRA_TOKEN / the two card
// constants. The size itself is DERIVED in piggy-return.js (min of card width, rail width / zoom,
// free band height / zoom), not stored.
const RECEIPT_RAIL_CARD_W = 285;
const RECEIPT_RAIL_CARD_OFF_Y = 48;
const RECEIPT_RAIL_GAP_TOKEN = "--grid-5";
const RECEIPT_RAIL_TOP_EXTRA_TOKEN = "--grid-3";
let receiptRailMemo = null;
function homeReturnReceiptRail() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!(vw <= 640)) return null;
  if (receiptRailMemo && receiptRailMemo.vw === vw && receiptRailMemo.vh === vh) return receiptRailMemo.rail;
  const rail = {
    vw, vh,
    inset: resolveCssLengthVarPx("--mobile-inset", 20),
    topBound: resolveCssLengthVarPx("--mobile-top-safe", 14) + resolveCssLengthVarPx(RECEIPT_RAIL_TOP_EXTRA_TOKEN, 16),
    cardCy: vh / 2 - RECEIPT_RAIL_CARD_OFF_Y,
    cardW: RECEIPT_RAIL_CARD_W,
    gap: resolveCssLengthVarPx(RECEIPT_RAIL_GAP_TOKEN, 32),
  };
  receiptRailMemo = { vw, vh, rail };
  return rail;
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

// [A-656 OWNER CORRECTION — WEB-FIRST PROPORTIONAL INVARIANT, 2026-09-30] `mountAway()` /
// `mountSecondAway()`'s own `#departStage` canvas (the departing-Piggy board — piggy-depart.js's
// own renderer is board-local, `sx() = canvas.width/BOARD_W`, so an outer canvas resize/
// reposition alone is enough, no piggy-depart.js edit) used to size itself with the plain
// centered fit (`s = min(vw/HOME_BOARD_W, vh/HOME_BOARD_H)`, `.departStage`'s own CSS
// left:50%/top:50%/translate(-50%,-50%)) alone — never floor/mid-band corrected, unlike
// `#chogHome` (`applyHomeFloorToChogOnly()`, called right beside this at both mount and resize)
// or the First Job work canvas (`mountSendCardWorkPose()`'s own `fit()`, main.js:8069-8135,
// which this generalizes). Measured (A-656 PROP.md Q1, awayprobe): the departing Piggy's foot
// sat 113–319px off the Home foot at every width below 1200 (worst −3.91 normalized units at
// 430) — "Departure and Return must share the same Home baseline relationship" (Owner
// correction) was failing outright for Departure while Return (return-view.js `fit()`) already
// carried it. Same k/nudge/mid-band formulas as `mountSendCardWorkPose()`'s own branches, minus
// the `clock === "send"` gate — Departure/Second-Departure have no "off" state needing the
// floor, so this always applies it when active. Strict no-op at 1440 and at any width where
// neither the mobile floor nor the mid-band drop is active (`s >= HOME_CHAR_SCALE_FLOOR`, no mid-
// band): falls through to clearing the inline overrides so `.departStage`'s own CSS centering
// still applies, byte-identical to pre-correction sizing.
function applyHomeFloorToDepartCanvas(canvas) {
  if (!canvas) return;
  const board = document.querySelector("#homeBoard");
  const s = Math.min(window.innerWidth / HOME_BOARD_W, window.innerHeight / HOME_BOARD_H);
  if (board && s > 0 && s < HOME_CHAR_SCALE_FLOOR) {
    const k = HOME_CHAR_SCALE_FLOOR / s;
    const fitLeft = (window.innerWidth - HOME_BOARD_W * s) / 2;
    const fitTop = (window.innerHeight - HOME_BOARD_H * s) / 2;
    const naturalFootViewportY = fitTop + HOME_FLOOR * s;
    // [A-681 iteration 2] same ink-overhang correction as applyHomeCharacterScaleFloor().
    const targetFootViewportY = computeHomeFootTargetViewportY(window.innerHeight) - homeCharFloorInkOverhangCorrectionPx();
    const nudgeViewportX = homeFloorNudgeViewportX(s);
    const nudgeViewportY = targetFootViewportY - naturalFootViewportY;
    // [A-681] same mobile-only size boost as applyHomeCharacterScaleFloor() — foot-anchor-safe,
    // see that function's own comment.
    const kBoosted = k * homeCharMobileBoost();
    const effW = HOME_BOARD_W * s * kBoosted;
    const effH = HOME_BOARD_H * s * kBoosted;
    const left = fitLeft + s * HOME_CENTER * (1 - kBoosted) + nudgeViewportX;
    const top = fitTop + s * HOME_FLOOR * (1 - kBoosted) + nudgeViewportY;
    canvas.width = Math.round(effW * (window.devicePixelRatio || 1));
    canvas.height = Math.round(effH * (window.devicePixelRatio || 1));
    canvas.style.width = `${effW}px`;
    canvas.style.height = `${effH}px`;
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.transform = "none";
    return;
  }
  if (board && s >= HOME_CHAR_SCALE_FLOOR) {
    const fitLeftMid = (window.innerWidth - HOME_BOARD_W * s) / 2;
    const fitTopMid = (window.innerHeight - HOME_BOARD_H * s) / 2;
    const midBandDy = computeHomeMidBandDropPx({ top: fitTopMid }, null, s);
    if (midBandDy > 0) {
      canvas.width = Math.round(HOME_BOARD_W * s * (window.devicePixelRatio || 1));
      canvas.height = Math.round(HOME_BOARD_H * s * (window.devicePixelRatio || 1));
      canvas.style.width = `${HOME_BOARD_W * s}px`;
      canvas.style.height = `${HOME_BOARD_H * s}px`;
      canvas.style.left = `${fitLeftMid}px`;
      canvas.style.top = `${fitTopMid + midBandDy}px`;
      canvas.style.transform = "none";
      return;
    }
  }
  // Desktop / floor-not-active: unchanged simple centered fit (`.departStage`'s own CSS
  // left:50%/top:50%/translate(-50%,-50%) applies whenever these inline overrides are cleared —
  // same as every pre-correction width).
  canvas.style.left = "";
  canvas.style.top = "";
  canvas.style.transform = "";
  canvas.width = Math.round(HOME_BOARD_W * s * (window.devicePixelRatio || 1));
  canvas.height = Math.round(HOME_BOARD_H * s * (window.devicePixelRatio || 1));
  canvas.style.width = `${HOME_BOARD_W * s}px`;
  canvas.style.height = `${HOME_BOARD_H * s}px`;
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
  // [A-666 §2] Wrapped in debouncedHomeResizeListener() (defined by sceneListener() above) so
  // the iOS toolbar collapse/expand resize-event storm collapses into one settle-time
  // recompute instead of one per intermediate frame — everything inside this handler is
  // otherwise byte-identical to before this card.
  sceneListener(window, "resize", debouncedHomeResizeListener(() => {
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
    // [A-654] re-plan the living Home against the new live anchors (same Home-life seed).
    if (host.dataset.arrival !== "1") {
      clearTimeout(homeAmbientResizeTimer);
      homeAmbientResizeTimer = sceneTimeout(mountHomeAmbientResidents, 120);
    }
  }));

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
    // [A-654] 2+ indexed Piggies only: the living Home residents (no-op with one Piggy).
    mountHomeAmbientResidents();
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
  // [A-681 FINAL CLOSEOUT D-1 — Name->Home first-frame pop] `walk` lives INSIDE the mobile floor group
  // (applyHomeCharacterScaleFloor(fit) below wraps #homeChar in translate(nudge) scale(k), k = floor
  // k * A-681 boost), so the local transform below is composed ON TOP of that group: a start rect
  // converted with the bare board scale `s` renders k times too big and displaced (measured 390: peek
  // ~45px -> first frame ~100px at the left edge; HEAD had the same bug at k=1.675: 35 -> 60px). Map the
  // screen rect through the INVERSE of the group — the same closed form Chog's walk start already uses
  // (chogWalkStartBoardRect: left'/top'/width' with s' = s*k) — so local(first frame) o group == the
  // visible Name peek Piggy rect. Mobile (<=640) only; >640 keeps the bare fit exactly.
  const floorPlan = window.innerWidth <= 640 ? computeHomeCharScaleFloorPlan(fit) : null;
  const inv = floorPlan && floorPlan.applied ? chogWalkStartBoardRect(fit, floorPlan) : null;
  const sW = inv ? inv.width / HOME_BOARD_W : s;
  const leftW = inv ? inv.left : left;
  const topW = inv ? inv.top : top;
  const ENTER_X = (startRect.left + startRect.width * 0.5133 - leftW) / sW - HOME_CENTER;
  const entryScale = startRect.width / sW / HOME_WALK_W;
  const entryY = (startRect.bottom - topW) / sW - HOME_FLOOR;

  // 동결한 포즈를 Name it 에 있던 **그 화면 자리에** 그대로 얹는다. 판 안에 넣되
  // 좌표는 판 기준으로 환산해 두 번 이동하지 않게 한다. 120ms 동안 이것이 사라지고
  // 걷기가 나타난다 — 첫 프레임부터 무언가 보이고, 같은 Piggy 가 둘로 보이지 않는다.
  let snapshot = null;
  if (startPose) {
    snapshot = startPose;
    Object.assign(snapshot.style, {
      position: "absolute",
      // [A-681 FINAL CLOSEOUT D-1b] host (#homeChar) is INSIDE the floor group too, so the frozen pose
      // is composed with translate(nudge) scale(k) like the walker — same inverse mapping (sW/leftW/
      // topW; identical to s/left/top when no group applies, i.e. >640) puts it exactly on the peek rect.
      left: `${(startRect.left - leftW) / sW}px`,
      top: `${(startRect.top - topW) / sW}px`,
      width: `${startRect.width / sW}px`,
      height: `${startRect.height / sW}px`,
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
// (비공개 모션 디자인 원본 departure.js:79 `source=.15+.65*ease(elapsed/.55)`)과 달리 scene 진행값 `t`를 그
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
  // formulas, not reinvented. Originally scoped to `clock === "send"` only (First Job) —
  // Explore's `clock === "second"` reaction was left on its original simple centered fit as an
  // out-of-scope flow.
  // [A-681 INBOX "EXPLORE PAPER-EDGE PIGGY SOURCE CORRECTION" 2026-10-03] Source-checked: that
  // "second" exclusion is NOT a documented peek canon (no A-401/A-415 source establishes an
  // intended "Explore paper-edge Piggy" placement) — it is this same floor/anchor gap, just never
  // extended to the Explore work canvas. Mobile-only (this whole branch is only reachable at
  // s<HOME_CHAR_SCALE_FLOOR, i.e. <=640/653px in practice, same boundary every other mobile-only
  // change in this card uses): extend to `clock === "second"` too, reusing the exact same
  // HOME_CENTER/HOME_FLOOR path, so the Explore/Second work-pose Piggy joins the Chog/Piggy
  // lower-right group instead of floating at the paper edge. The work? animation itself
  // (piggy-depart.js) is untouched — only this canvas's outer size/position changes. The sibling
  // mid-band branch below (s>=HOME_CHAR_SCALE_FLOOR, width>=641) stays `clock === "send"` only —
  // this card is mobile-only, so web's Explore canvas is intentionally left exactly as before.
  const fit = () => {
    const s = Math.min(window.innerWidth / HOME_BOARD_W, window.innerHeight / HOME_BOARD_H);
    const board = document.querySelector("#homeBoard");
    if ((clock === "send" || clock === "second") && board && s > 0 && s < HOME_CHAR_SCALE_FLOOR) {
      const k = HOME_CHAR_SCALE_FLOOR / s;
      // [A-681] same mobile-only size boost as applyHomeCharacterScaleFloor() — foot-anchor-safe.
      const kBoosted = k * homeCharMobileBoost();
      const fitLeft = (window.innerWidth - HOME_BOARD_W * s) / 2;
      const fitTop = (window.innerHeight - HOME_BOARD_H * s) / 2;
      const naturalFootViewportY = fitTop + HOME_FLOOR * s;
      // [A-681 iteration 2] same ink-overhang correction as applyHomeCharacterScaleFloor().
      const targetFootViewportY = computeHomeFootTargetViewportY(window.innerHeight) - homeCharFloorInkOverhangCorrectionPx();
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
      const nudgeViewportX = homeFloorNudgeViewportX(s);
      const nudgeViewportY = targetFootViewportY - naturalFootViewportY;
      const effW = HOME_BOARD_W * s * kBoosted;
      const effH = HOME_BOARD_H * s * kBoosted;
      const left = fitLeft + s * HOME_CENTER * (1 - kBoosted) + nudgeViewportX;
      const top = fitTop + s * HOME_FLOOR * (1 - kBoosted) + nudgeViewportY;
      canvas.width = Math.round(effW * (window.devicePixelRatio || 1));
      canvas.height = Math.round(effH * (window.devicePixelRatio || 1));
      canvas.style.width = `${effW}px`;
      canvas.style.height = `${effH}px`;
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.style.transform = "none";
      return;
    }
    // [A-656 decision 4 → A-659 OWNER VISUAL REPAIR] "Also apply the same anchor to the First Job
    // work canvas" — so Home → work (this canvas) → Away → Return has no jump at any web width
    // (vw≥641, no upper bound since A-659). Translate-only (no scale change, mirrors decision 2's
    // own web-drop branch). [A-681] Deliberately still `clock === "send"` only — this card's
    // Explore/"second" fix is mobile-only (<=640/653); web keeps Explore's original simple fit.
    if (clock === "send" && board && s >= HOME_CHAR_SCALE_FLOOR) {
      const fitLeftMid = (window.innerWidth - HOME_BOARD_W * s) / 2;
      const fitTopMid = (window.innerHeight - HOME_BOARD_H * s) / 2;
      const midBandDy = computeHomeMidBandDropPx({ top: fitTopMid }, null, s);
      if (midBandDy > 0) {
        canvas.width = Math.round(HOME_BOARD_W * s * (window.devicePixelRatio || 1));
        canvas.height = Math.round(HOME_BOARD_H * s * (window.devicePixelRatio || 1));
        canvas.style.width = `${HOME_BOARD_W * s}px`;
        canvas.style.height = `${HOME_BOARD_H * s}px`;
        canvas.style.left = `${fitLeftMid}px`;
        canvas.style.top = `${fitTopMid + midBandDy}px`;
        canvas.style.transform = "none";
        return;
      }
    }
    // Desktop / floor-not-active (any width where neither branch above fired — includes
    // Explore's "second" clock at web widths, which keeps its pre-A-681 simple centered fit;
    // mobile "second" is handled by the first branch above as of A-681): unchanged simple
    // centered fit (`.departStage`'s own CSS left:50%/top:50%/translate(-50%,-50%) still applies
    // whenever these inline overrides are cleared — same as before this card for these paths).
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
    // [A-656 decision 3] Chog does not move because Piggy is Away — keep it at the same Home
    // anchor (mobile floor / mid-band) the settled Home cluster uses.
    applyHomeFloorToChogOnly(boardFit);
  }
  // 판 다시 맞추기는 아래 `fit()` 이 함께 한다. canvas 가 없는 경우만 여기서 건다.
  const canvas = document.querySelector("#departStage");
  if (!canvas) { sceneListener(window, "resize", () => { applyHomeFloorToChogOnly(fitHomeBoard()); }); return; }

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
    // [A-656 OWNER CORRECTION] Departure start must share the same Home floor/mid-band
    // baseline Return already carries — see applyHomeFloorToDepartCanvas() above.
    applyHomeFloorToDepartCanvas(canvas);
    // [A-656 decision 3] Chog does not move because Piggy is Away — same Home anchor on resize.
    applyHomeFloorToChogOnly(fitHomeBoard());
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
// 알람. 승인 원본(비공개 return 리뷰 노트 README.md:10 "0.7–1.8 |
// Alarm: Honeybun is coming back. / Chog만 짧게 반응", 같은 파일 §38 "실제 알림음은
// 확정 자산이 없어 넣지 않음")에서 Alarm 구간의 시각 요소는 이 문구 카드 하나와 Chog의
// 짧은 반응(hop)뿐이다 — 별도 벨/링 그래픽은 canon 에 없다(portal-ring 은 그 뒤
// "Returning" 구간에 Piggy 가 나오는 포털이고 다른 자산·다른 구간이다, piggy-return.js
// stateAt() phase 표). [주의] 위 문장 "별도 벨/링 그래픽은 canon 에 없다"는 A-413
// 당시(그 시점 canon) 기준이다 — Owner 가 그 뒤(2026-09-18 채팅)에 실제 알람 종 그래픽을
// 새로 지시했다(piggy-return.js BELL_* 참고, 그 파일이 그린다). 여기 문장은 그 지시
// 이전 기록이라 갱신하지 않고 그대로 두되(이 발화 span 의 히스토리 문맥은 바뀌지 않았다)
// 이 주석으로 바로잡는다 — [A-415-e 흔적 정리].
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
// 그대로 먹는다). 정확한 지연 값·근거는 mountReturn() 주석 참고. received/필드를 기다리지
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
    // [A-656 decision 4] Same Home anchor math (mobile floor / mid-band) as Home settled —
    // wraps #returnChogHop + #returnName, and hands the canvas consumer (return-view.js fit())
    // the viewport-space k/nudge it needs to resize/reposition itself the same way.
    fitBoard: () => {
      const fit = fitHomeBoard();
      const plan = applyHomeFloorToReturnCluster(fit);
      return { ...fit, floor: computeHomeFloorViewportNudge(plan, fit.s) };
    },
    // [A-681 FINAL CLOSEOUT A] mobile-only Receipt rail target (null at >640 -> legacy anchor).
    getReceiptRail: homeReturnReceiptRail,
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
      <!-- filebox 에는 다음 진입이 없었다 — Home 복귀와 Explore 진입을
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
// [A-662 coordinator browser regression fix] `.homePaper`'s own CSS box is 400×568 local px
// (style.css `.homePaper{width:400px;height:568px}` — the SAME ratio a621/a623 already pin as
// HOME_W=256.338/HOME_H=364). home-paper-multi.js's multi-Piggy resident list ONLY overrides
// `paper.style.height` when the list is unfolded/open (never `.width`) — so `paperRect.width`
// stays this fixed ratio's own invariant, while `paperRect.height` can grow well past it. Used
// below to recover the paper's "single-card" reference height from its (always-stable) live
// width, for the character-safe check only — see its own comment.
const HOME_PAPER_ASPECT_H_OVER_W = 568 / 400;
// [A-662 coordinator browser regression fix — HYSTERESIS BUG] `.homePaper`'s own live rect is
// NOT mode-independent: `syncRecordsViewportState()` applies the A-411 two-card shift
// (`.homePaperMount--twoCardShift`, translateX) only while HISTORY is open AND NOT stacked —
// so computeHistoryFitMode() was reading a `.homePaper` rect whose X position already depended
// on the PREVIOUS mode decision, feeding back into the NEXT one. Once stacked (no shift, HOME
// sits ~46px further right → less whitespace → stays stacked) or once side-by-side (shift
// applied, HOME ~46px further left → more whitespace → stays side-by-side), the decision became
// a self-reinforcing fixed point that never re-crossed, even on a real resize (coordinator
// real-browser repro: 700→800→700 same-page, mode frozen both directions). Fix: always evaluate
// the candidate against the shift-NORMALIZED (side-by-side-reference) paper position, regardless
// of which class is currently applied — this exact 46px viewport-space delta is not a new magic
// number: it is the same A-411 shift a623's own test already pins exactly
// ("web two-card shift = −46px exactly when open ... after a mobile→web crossing").
const RECORDS_TWO_CARD_SHIFT_VIEWPORT_PX = 46;

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
  // [A-684] 기본 HISTORY 머리글은 이름만 보인다 — 원시 주소는 올리지 않는다. 주소는 tx/증거 상세가
  // 이미 보여주는 자리에만 남는다(새 노출 0).
  const identityMarkup = `
        <p class="recordsCard__identity">
          <span class="recordsCard__identityName">${escapeHtml(name)}</span>
        </p>`;
  return `
      <div class="recordsCard__masthead">
        <span class="recordsCard__dot" role="button" tabindex="0" aria-label="back to Home"></span>
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
// [A-662 OWNER RESPONSIVE DECISION, 2026-10-01 → A-662 OWNER CORRECTION PREWRITE §2(c)]
// Read-only twin of fitHomeBoard()'s own {s,left,top} — that function also WRITES
// #homeBoard's transform as a side effect (mountHome()/the resize listener already keep it
// current at all real interaction times); calling it again here, once per HISTORY align-loop
// tick, would force a redundant style write/reflow every frame for a value that hasn't
// changed. This instead reads the board's already-applied live rect — same
// "read, never recompute-and-write" contract computeHomeCharScaleFloorPlan() itself already
// uses for its own `fit` input.
function readHomeBoardFitForHistory() {
  const board = document.querySelector("#homeBoard");
  if (!board) return null;
  const rect = board.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { s: rect.width / HOME_BOARD_W, left: rect.left, top: rect.top, rect };
}

// [A-662 §2(c) condition 2 — character-safe clearance, required, not whitespace-only] The
// resident cluster's board-local ink/seat corners, reusing chog-home.js's own EXPORTED
// CHOG_HOME_GEOMETRY (ink box + corner transform + homeScale — no new constants, no
// re-measurement) for Chog, and the same HOME_SEAT_ / HOME_FLOOR constants
// layoutHomeCharacter() itself places Piggy with, for Piggy. #chogHome's OWN
// getBoundingClientRect() was tried and rejected here — that element is the WHOLE 1256×772
// board-local box scaled down around the corner (chog-home.js place()), so its bounding rect
// is mostly transparent padding, not Chog's visible ink (measured: it falsely "collided" with
// HISTORY's candidate box at 900×900 even though the real render has an ~82px clear Y gap
// there — see A662 VERIFY.md). This computes the SAME
// `origin(HOME_CENTER,HOME_FLOOR) + k·(point−origin) + nudge` composition
// applyHomeCharacterScaleFloor()/computeHomeFloorViewportNudge() already perform for the
// floor/mid-band group's transform, applied to the ink/seat corner points instead of the DOM
// subtree — correct whether the narrow floor, the mid-band drop, or neither is currently active,
// without a 4th hand-rederivation of that k/nudge math and without any DOM write.
function homeCharacterSafeBoxViewport(plan, fit) {
  if (!fit || !(fit.s > 0)) return null;
  const s = fit.s;
  const k = plan && plan.applied ? plan.k : 1;
  const nudgeLocalX = plan && plan.applied ? plan.nudgeLocalX : 0;
  const nudgeLocalY = plan && plan.applied ? plan.nudgeLocalY : plan && plan.midBand ? plan.midBandDy / s : 0;
  const toBoard = (x, y) => ({
    x: HOME_CENTER + k * (x - HOME_CENTER) + nudgeLocalX,
    y: HOME_FLOOR + k * (y - HOME_FLOOR) + nudgeLocalY,
  });
  // [A-662 coordinator browser regression fix] HOME_SEAT_H/HOME_SEAT_FOOT describe the Piggy
  // seat ASSET's own full box (like #chogHome's raw box, rejected above) — they include unmeasured
  // transparent headroom above the drawn ink, not Piggy's real ink top. Using that full box here
  // pushed the safe box's top far above the real character ink (measured regression: falsely
  // "collided" with HISTORY at 1440/1200/900/800/768/720, forcing stacked/HOME-inert at widths
  // that must stay side-by-side/HOME-live — coordinator real-browser run, a626/a628/a623/a654).
  // Chog is the one character with real exported ink bounds (CHOG_HOME_GEOMETRY.inkLocal); both
  // residents share the same HOME_FLOOR-anchored floor line, so this reuses Chog's measured ink
  // HEIGHT as the conservative vertical extent for the whole cluster (X stays per-character —
  // Piggy sits to Chog's right, per canon) instead of guessing at the seat asset's padding.
  const g = CHOG_HOME_GEOMETRY;
  const chogInkTopLocal = g.cornerTransform.y + g.inkLocal.top * g.homeScale;
  const chogA = toBoard(g.cornerTransform.x + g.inkLocal.left * g.homeScale, chogInkTopLocal);
  const chogB = toBoard(g.cornerTransform.x + g.inkLocal.right * g.homeScale, HOME_FLOOR);
  const seatA = toBoard(HOME_SEAT_L, chogInkTopLocal);
  const seatB = toBoard(HOME_SEAT_L + HOME_SEAT_W, HOME_FLOOR);
  const xs = [chogA.x, chogB.x, seatA.x, seatB.x];
  const ys = [chogA.y, chogB.y, seatA.y, seatB.y];
  return {
    left: fit.left + Math.min(...xs) * s,
    right: fit.left + Math.max(...xs) * s,
    top: fit.top + Math.min(...ys) * s,
    bottom: fit.top + Math.max(...ys) * s,
  };
}

// [A-651 OWNER RESPONSIVE DECISION 2026-10-01 → A-662 OWNER CORRECTION PREWRITE §2(c)] ONE
// shared geometry-fit decision for HISTORY, replacing the 3 independently-duplicated
// `window.innerWidth <= 640` checks this function/closeRecordsCard()/syncRecordsViewportState()
// used to each re-test on their own. Reads the LIVE `.homePaper` rect fresh on every call —
// never cached, so a multi-Piggy resident-card fold/open (home-paper-multi.js
// mountResidentPaper(), which changes `.homePaper`'s own height) is picked up the same frame,
// exactly like the existing per-frame align loop already re-measures every tick. Side-by-side
// is valid only when BOTH:
//   (1) the candidate side-by-side HISTORY rect (HOME's own live rect, right edge +
//       RECORDS_CARD_GAP) leaves at least RECORDS_CARD_GAP(24) more of whitespace before the
//       viewport's own right edge — reusing RECORDS_CARD_GAP itself as the required safe-margin
//       value. Owner's own words ("우리가 정한 여백" — "the whitespace WE defined") point at this
//       24px inter-paper gap already used everywhere in this system, not a new or borrowed
//       token — `--mobile-inset` stays mobile-labeled and is never read by this path;
//   (2) that same candidate rect does not rectangle-intersect the resident character cluster's
//       safe box (homeCharacterSafeBoxViewport() above) — Owner's own trigger text names
//       "collide with the character-safe area" explicitly, so this is implemented, not deferred.
// Falls back to "stacked" — the already Owner-confirmed A-621 mobile grammar, safe by
// construction — whenever `.homePaper` isn't present/measurable yet, so a mid-mount call never
// claims side-by-side on missing evidence. No hardcoded width: on the current 24px-gap/256×364
// paper geometry this produces a crossover between 700 and 720 (19.5px vs 29.5px measured
// whitespace, A662 VERIFY.md) — a CONSEQUENCE of the measurement, never an asserted constant.
// [coordinator browser regression fix] The character-safe check (condition 2 below) uses the
// paper's single-card REFERENCE height (derived from its always-stable live width, see
// HOME_PAPER_ASPECT_H_OVER_W), not its live (possibly multi-Piggy-resident-list-grown) height —
// HOME/HISTORY's actual rendered size still follows the live height unchanged (unaffected
// anywhere else). Reasoning: HOME and HISTORY always share the identical top/height in EITHER
// mode, so a tall unfolded resident list reaches exactly as far down whether HISTORY sits beside
// HOME or stacked above it — switching modes cannot avoid that overlap, so it must not be what
// decides the mode (an unfolded multi-Piggy list must not flip 1440/1200/900/etc.'s own frozen
// wide-web side-by-side canon, "Preserve 1440 canon and wide-web side-by-side composition").
function computeHistoryFitMode() {
  const stage = document.querySelector('.stage[data-scene="sendstay"]');
  const paper = document.querySelector(".homePaper");
  if (!stage || !paper) return "stacked";
  const paperRect = paper.getBoundingClientRect();
  if (!paperRect.width || !paperRect.height) return "stacked";
  // [A-662 coordinator browser regression fix — hysteresis] normalize to the side-by-side
  // (shifted) reference position regardless of whether the shift is CURRENTLY applied — see
  // RECORDS_TWO_CARD_SHIFT_VIEWPORT_PX's own comment. Only X moves (translateX); top/height are
  // untouched by the shift.
  const mount = document.querySelector(".homePaperMount");
  const alreadyShifted = !!mount && mount.classList.contains("homePaperMount--twoCardShift");
  const shiftCorrection = alreadyShifted ? 0 : RECORDS_TWO_CARD_SHIFT_VIEWPORT_PX;
  const normalizedPaperRight = paperRect.right - shiftCorrection;
  const candidate = {
    left: normalizedPaperRight + RECORDS_CARD_GAP,
    right: normalizedPaperRight + RECORDS_CARD_GAP + paperRect.width,
    top: paperRect.top,
    bottom: paperRect.top + paperRect.height,
  };
  if (window.innerWidth - candidate.right < RECORDS_CARD_GAP) return "stacked";
  const fit = readHomeBoardFitForHistory();
  const plan = fit && computeHomeCharScaleFloorPlan(fit);
  const charBox = fit && homeCharacterSafeBoxViewport(plan, fit);
  if (charBox) {
    const characterCheckBottom = candidate.top + paperRect.width * HOME_PAPER_ASPECT_H_OVER_W;
    const overlapsX = candidate.left < charBox.right && candidate.right > charBox.left;
    const overlapsY = candidate.top < charBox.bottom && characterCheckBottom > charBox.top;
    if (overlapsX && overlapsY) return "stacked";
  }
  return "side-by-side";
}

function alignRecordsCardToHomePaper() {
  const anchor = document.querySelector("#recordsCardAnchor");
  if (!anchor) return;
  // [A-623] shift/inert follow the CURRENT breakpoint before the live `.homePaper` is measured.
  syncRecordsViewportState();
  // [A-662] geometry-fit decision (side-by-side vs stacked) replaces the old flat fixed-width
  // check — see computeHistoryFitMode() above.
  if (computeHistoryFitMode() === "stacked") {
    stackMobileRecordsOverHome();
    return;
  }
  // [A-662 coordinator browser regression fix] the stacked-mode styling below (z-order above
  // HOME, +12px slide direction) is keyed off this class now, not only the old ≤640px media
  // query — side-by-side must clear it explicitly (stackMobileRecordsOverHome() is the only
  // place that sets it, idempotent either way).
  anchor.classList.remove("recordsCardAnchor--stackedMode");
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
  // [A-662 coordinator browser regression fix, 2026-10-01] web "stacked" widths (641-~710, the
  // narrow-web extension A-651/A-662 added) were computing the right geometry but rendering
  // HOME drawn OVER HISTORY — the z-order/slide-direction CSS that makes this stack grammar
  // actually look stacked (`.recordsCardAnchor` z-index:2 above `.homeBoard`'s 1, the +12px
  // viewer-right slide) was still gated behind the OLD flat `@media (max-width: 640px)`, so it
  // never applied above 640px even though this function (and the geometry) now does. This class
  // (style.css `.recordsCardAnchor--stackedMode`) carries the SAME declarations at any width —
  // additive to, not a replacement of, the existing ≤640px rule (both apply there, redundantly,
  // harmlessly). alignRecordsCardToHomePaper()'s side-by-side branch clears it.
  anchor.classList.add("recordsCardAnchor--stackedMode");
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

// [A-699 M2-alpha R4] 앱 잠금이 없는 표면(웹 641+ · 인증 불가 origin)에서도 First Send 미확정 기록이 있으면 같은 읽기 전용
// 조회를 건다 — 예전엔 아래 잠금 블록(≤640)에서만 돌아서, 그 밖의 표면은 영원히 확인 없이 잠겨 있었다. 목적지는 같은 Away
// (checking…)이고 잠금(appLock)만 없다. 서명·전송·grant·인증 0 · 새 문구 0.
if (state.credential && state.scene === "sendstay" && LEGACY_TESTNET_PATH && !appLockSurface()) {
  const bootPendingOpen = readSendPending();
  if (bootPendingOpen) {
    state.scene = "away";
    state.homeQuietForExplore = false;
    state.awayRestore = "checking";
    reconcileSendPending(bootPendingOpen);
  }
}

// [A-633 A/C] 모바일/app 표면에서 저장된 credential 로 돌아온 사람(목적지 Name/Home)은 목적지를 보존한 채
// LOGIN_CHECKING 으로 연다 — 부팅 때 WebAuthn 호출 0(사용자가 Chog 를 눌러야 한다). 첫 Invite·새 기기·
// 웹(641+)·인증 불가 origin 은 지금 그대로다. First Send 미확정 기록이 있으면 목적지는 Away(checking…)이고,
// 그 hash 의 결과를 **공개 읽기로만** 잠금과 병렬로 조회한다(reconcileSendPending — 서명·전송 0).
if (state.credential && (state.scene === "name" || state.scene === "sendstay") && appLockSurface()) {
  const bootPending = state.scene === "sendstay" && LEGACY_TESTNET_PATH ? readSendPending() : null;
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

// [A-654] A page that opens away from Home (a trip, Name, auth) is outside the Home-life cycle, so
// the first Home it reaches starts a new one (visual only).
homeLifeLeft = !HOME_LIFE_SCENES.includes(state.scene);

render();

// [A-697] Invite fit rides the same debounce as Home (A-666 §2): a real width/orientation change
// recomputes synchronously (so the wide<->mobile `render()` switch in fitInvite is immediate), an
// iOS toolbar-sized height burst is coalesced into one trailing call.
window.addEventListener("resize", debouncedHomeResizeListener(fitInvite));
window.addEventListener("beforeunload", endActiveSession);
// [A-667 R6] bfcache 복원(pageshow persisted)·백그라운드 복귀 — WebAuthn 을 **새로 부르지 않는다**. 메모리에 남은 인증
// 시도만 정리한다(아래 expireStaleAuthState). visibilitychange 리스너는 기존 두 개(애니메이션 시계)와 별개다.
window.addEventListener("pageshow", (event) => { if (event.persisted) expireStaleAuthState({ restored: true }); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") expireStaleAuthState({ restored: false }); });
// [A-565] 한 번만 붙는 module-scope 캡처 리스너 — render() 안 리스너처럼 씬마다 다시 붙지 않는다.
// capture:true 는 앱 안 아무 화면에서 눌러도(하위 요소가 stopPropagation 해도) 잡히게 하려는
// 것뿐이고, passive:true 는 activity 훅이 스크롤/탭을 막을 이유가 없어서다(preventDefault 0).
window.addEventListener("pointerdown", handleTrustedAppActivity, { capture: true, passive: true });
window.addEventListener("keydown", handleTrustedAppActivity, { capture: true, passive: true });

// [A-666] Owner-identified top-left HISTORY dot (`.recordsCard__dot`, masthead) is now the
// obvious Home-return control — same closeRecordsCard() path #recordsCardClose already
// drives (render()'s own `#recordsCard` click delegation, above), no new navigation family.
// A module-scope, one-time `document` listener (same shape as handleTrustedAppActivity just
// above) rather than adding this inside render() itself: render() is byte-identical-pinned by
// other cards' own regression tests (a642/a653), and `#recordsCard` persists across HISTORY
// open/close without a re-render anyway (renderRecordsCardBody() only swaps its innerHTML —
// render()'s own comment on this card), so a document-level delegated listener reaches the
// dot exactly the same as one scoped to `#recordsCard` would, without touching render().
function handleRecordsDotActivate(event) {
  if (!event.target.closest(".recordsCard__dot")) return;
  if (event.type === "keydown") {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
  }
  closeRecordsCard();
}
document.addEventListener("click", handleRecordsDotActivate);
document.addEventListener("keydown", handleRecordsDotActivate);

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
