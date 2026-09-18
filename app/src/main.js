import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, parseEther } from "viem";
import { chogHomeMarkup, mountChogHome, CHOG_HOME_GEOMETRY } from "./chog-home.js";
import { chogInviteMarkup, mountChogInvite, CHOG_INVITE_GEOMETRY } from "./chog-invite.js";
import { createDepartPlayback } from "./piggy-depart.js";
import { nameCardMarkup, mountNameCard } from "./name-card.js";
import { returnSceneMarkup, mountReturnView } from "./return-view.js";
import { homePaperMarkup, homePaperRecordsEntryMarkup, homeStatusFromScene, homeTimeNow } from "./home-paper.js";
import { sendCardButtonMarkup, sendCardMarkup } from "./send-card.js";
import { receiptPaperMarkup, receiptPaperFields } from "./receipt-paper.js";
import { buildVisibleLaneChoices, runSecondJourney } from "./job-feed.js";
import {
  applyExploreSelection,
  createSecondJourneyState,
  loadSecondJourneyState,
  saveSecondJourneyState,
  validatePersistenceScope,
} from "./second-journey-state.js";
import {
  paperStatusCopy,
  secondJourneyCardMarkup,
  secondJourneyReceiptFields,
  secondJourneySendReason,
  validateSecondAmount,
} from "./second-journey-view.js";
import "./style.css";

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
// [A-377 §3] 보관은 전체 — 저장 cap 을 없앴다(옛 RECEIPT_KEEP=2). 화면 쪽 "최근 3장만"은
// 저장 개수가 아니라 서류철 미리보기가 보여주는 장수일 뿐이다 — RECORDS_FOLDER_PREVIEW.
// 그 뒤(4건째부터)도 Home 카드 오른쪽 기록 카드의 전체 목록에서는 그대로 열린다
// (§A-383 recordsCardListMarkup()).
const RECORDS_FOLDER_PREVIEW = 3;

// --- 탄생 한 바퀴의 세 가지 사실 (A-292 번호 8) -------------------------
// 셋은 서로 다른 사실이라 각각 따로 기록한다. 하나로 묶으면 「이름은 아직인데
// 연출은 끝난」 중간 상태를 표현할 수 없다. WebAuthn 의 user 필드(`araso-owner`/`Araso`)와
// PASSKEY_STORAGE_KEY 는 이 셋과 무관하다 — 캐릭터 이름 저장소로 쓰지 않는다(§7).
const PIGGY_RECEIVED_KEY = "araso.piggyReceived"; // Piggy 받음 (패스키가 생겼다)
const PIGGY_NAME_KEY = "araso.piggyName"; // 이름 저장 완료 (빈 문자열 = 미완료)
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
  // 「보냈다」가 아니라 「바퀴가 닫혔다」로 판정한다. txHash 하나로 잠그면
  // 실패한 바퀴도 filebox 에 갇힌다(2026-09-08 A-056 실측).
  if (hasClosedTrip) return "filebox";
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
  noPiggy: false,
  // 바퀴의 결말. "" = 아직 안 났다 · "done" · "failed". 사유는 tripReason 에 남긴다.
  tripOutcome: "",
  tripReason: "",
  // 「보냈다」(txHash)와 분리된 「이번 바퀴가 닫혔다」. 성공한 바퀴에서만 선다.
  // 옛 저장값에는 이 키가 없으므로 txHash 가 있으면 닫힌 것으로 본다(A-048 이관과 같은 다리).
  tripClosed:
    localStorage.getItem(TRIP_CLOSED_KEY) === "1" || !!localStorage.getItem("araso.txHash"),
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
  recordsDetailIndex: null,
  // [A-360] Second Journey — Explore/후보check/JIT/permission/amount/Send 진행 상태.
  // 메모리 값이다(§forbidden "fixture 결과는 메모리만"). 관심(interests)만 계정/체인
  // scope 가 유효할 때 second-journey-state.js 저장소로도 남는다(§5) — 그 외 필드
  // (선택 후보·amount·permission 체크)는 새로고침에 남지 않는다.
  secondJourney: createEmptySecondJourney(),
  // [A-389] birth 카드(구 renderBirth 자리 — 이제 renderAuthCard)의 표시 국면.
  // "checking"(진행 중, 버튼 없음) 이외에는 항상 "idle" — 문자열 파싱으로 국면을
  // 추측하지 않고 각 호출부가 명시적으로 세운다. authCancelled 는 직전 실패가
  // 진짜 WebAuthn 취소(cause.name === "NotAllowedError")였는지를 기록한다 —
  // 다음 시도가 그 값을 이어받지 않도록 매 호출부가 다시 세운다.
  authPhase: "idle",
  authCancelled: false,
};
state.scene = computeInitialScene(!!state.credential, state.tripClosed, !!state.address);
// 최초 진입이 곧장 Name it 이라는 것은 이름을 짓다 나갔다 왔다는 뜻이다.
state.nameResumed = state.scene === "name";

const publicClient = createPublicClient({
  chain: MONAD_TESTNET,
  transport: http(MONAD_TESTNET_RPC),
});

let activeSession = null;
let activeAccount = null;
let idleTimer = null;

function readCredential() {
  try {
    return JSON.parse(localStorage.getItem(PASSKEY_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

// receipt 의 금액은 BigInt 라 JSON 이 그대로 담지 못한다. 넣을 때 문자열로 눕히고 읽을 때 되세운다.
// 한 건이라도 모양이 어긋나면 통째로 버린다 — 반쯤 읽힌 영수증으로 숫자를 그리지 않는다.
// [A-377 §3] 더 이상 slice 하지 않는다 — 전체를 읽는다(저장 cap 제거, RECEIPT_KEEP 폐기).
function readReceipts() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.map((row) => ({
      before: BigInt(row.before),
      after: BigInt(row.after),
      gas: BigInt(row.gas),
      sent: BigInt(row.sent),
      txHash: row.txHash || "",
      depositTxHash: row.depositTxHash || "",
      redeemTxHash: row.redeemTxHash || "",
      grantTxHash: row.grantTxHash || "",
      depositBlockNumber: row.depositBlockNumber ? BigInt(row.depositBlockNumber) : 0n,
      redeemBlockNumber: row.redeemBlockNumber ? BigInt(row.redeemBlockNumber) : 0n,
      depositGasUsed: row.depositGasUsed ? BigInt(row.depositGasUsed) : 0n,
      redeemGasUsed: row.redeemGasUsed ? BigInt(row.redeemGasUsed) : 0n,
      shmonReceived: row.shmonReceived ? BigInt(row.shmonReceived) : 0n,
      shmonAfterRedeem: row.shmonAfterRedeem ? BigInt(row.shmonAfterRedeem) : 0n,
      // 옛 영수증에는 status 가 없다. 없으면 빈 값으로 두고 성공이라 넘겨짚지 않는다.
      status: row.status || "",
      at: row.at || 0,
    }));
  } catch {
    return [];
  }
}

function serializeReceiptRow(row) {
  return {
    before: String(row.before),
    after: String(row.after),
    gas: String(row.gas),
    sent: String(row.sent),
    txHash: row.txHash,
    depositTxHash: row.depositTxHash || "",
    redeemTxHash: row.redeemTxHash || "",
    grantTxHash: row.grantTxHash || "",
    depositBlockNumber: String(row.depositBlockNumber || 0n),
    redeemBlockNumber: String(row.redeemBlockNumber || 0n),
    depositGasUsed: String(row.depositGasUsed || 0n),
    redeemGasUsed: String(row.redeemGasUsed || 0n),
    shmonReceived: String(row.shmonReceived || 0n),
    shmonAfterRedeem: String(row.shmonAfterRedeem || 0n),
    status: row.status || "",
    at: row.at,
  };
}

// 실제 tx 증거(redeemTxHash 우선, 없으면 txHash)로만 "같은 바퀴"를 판정한다 — 추측으로
// 서로 다른 바퀴를 합치지 않는다(§4 receiptIdentity 지시와 같은 원칙, 방향만 반대: 여기는
// 이미 저장된 것과 **완전히 같은** tx 가 다시 들어왔을 때만 중복을 막는다).
function receiptIdentityKey(receipt) {
  return (receipt && (receipt.redeemTxHash || receipt.txHash)) || "";
}

// [A-377 §3] 전체 보관(cap 제거) + 반복 호출/탭이 같은 바퀴를 새 항목으로 또 쌓지 않게.
// finishTrip 은 정상 경로에서 트랜잭션당 한 번만 부르지만, 방어적으로 여기서도 막는다 —
// 실제 tx 식별자가 직전 0번과 같을 때만 중복으로 본다(값 없는 receipt 는 항상 새로 쌓는다,
// 식별자가 없어 "같다"고 볼 근거가 없으므로).
function rememberReceipt(receipt) {
  const key = receiptIdentityKey(receipt);
  if (key && state.receipts[0] && receiptIdentityKey(state.receipts[0]) === key) {
    state.receiptIndex = 0;
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

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function endActiveSession() {
  activeSession?.end();
  activeSession = null;
  activeAccount = null;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function touchSession() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    endActiveSession();
    if (state.scene !== "away") {
      setScene("sendstay", "Piggy is resting.", "Open again when you need it.");
    }
  }, 10 * 60 * 1000);
}

function activateSigningSession(prfOutput) {
  endActiveSession();
  activeSession = createSecp256k1SigningSession({ privateKey: prfOutput });
  activeAccount = toViemAccount(activeSession);
  const address = getEvmAddress(activeSession.publicKey);
  localStorage.setItem("araso.address", address);
  state.address = address;
  touchSession();
  return { account: activeAccount, address };
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
  state.recordsCardVisible = false;
  state.recordsDetailIndex = null;
  stopRecordsAlignLoop();
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
  // 「이름 저장 완료」= 이 한 줄. Piggy 받음·최초 연출 처리와 별개로 기록한다(번호 8).
  localStorage.setItem(PIGGY_NAME_KEY, name);

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
    const chogArt = document.querySelector(".nameScene__chog");
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

function formatError(error) {
  if (isMeraError(error)) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

// credential 을 넘기면 그 패스키 하나로 제한된다. 넘기지 않으면
// "WebAuthn may choose any discoverable credential for the relying party."
// (@category-labs/mera passkey.d.ts) → 브라우저가 이 rpId 의 기존 패스키를 고르게 한다.
function requestPrf(credential) {
  return getPasskeyPrfOutput({
    rpId: getRpId(),
    ...(credential ? { credential } : {}),
    timeout: 120_000,
  });
}

async function recoverPiggy() {
  const pinned = state.credential;
  let result;
  try {
    result = await requestPrf(pinned);
  } catch (error) {
    // 저장된 credential 하나만 지정했다가 실패했다면 그 패스키가 이 기기에서 사라졌을 수 있다.
    // 지정을 빼고 딱 한 번 다시 묻는다. 둘 다 실패해야 throw —
    // 어느 경우에도 새 패스키를 만들지 않는다. localStorage 가 비어도 마찬가지다.
    const mayBeGone = isMeraError(error) && error.code === "PASSKEY_OPERATION_FAILED";
    if (!pinned || !mayBeGone) throw error;
    result = await requestPrf(null);
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
    setScene("birth", "Not this door.", `Open Piggy only at ${PRODUCTION_RP_ID}.`);
    return;
  }

  state.authPhase = "checking";
  state.authCancelled = false;
  setScene("birth", "The egg is checking this device.", "Face ID may appear once.");

  try {
    const result = await createPasskeyWithPrfOutput({
      rp: { id: getRpId(), name: "Araso" },
      user: { name: "araso-owner", displayName: "Araso" },
      timeout: 120_000,
    });

    const credential = {
      credentialId: result.credentialId,
      transports: result.transports,
    };
    const { address } = activateSigningSession(result.prfOutput);

    writeCredential(credential);
    localStorage.setItem("araso.prfSalt", toHex(result.prfSalt));
    localStorage.setItem(PIGGY_RECEIVED_KEY, "1");
    noteRecoverSuccess();
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
    state.authPhase = "idle";
    state.authCancelled = isCancelledAuthError(error);
    setScene("birth", "Piggy could not open here.", formatError(error));
  }
}

// [A-389] 이미 Piggy 를 받은 기기에서 다시 Face ID 를 눌러도 새 패스키를 만들지 않는다 —
// 옛 renderBirth() 는 이 조건일 때 Open 버튼 자체를 숨겨서 막았다(2026-09-02 주소 3개
// 사고). 그 버튼 껍질은 지웠지만 판정 로직은 그대로 여기로 옮긴다 — Try again 이 이
// 조건에 걸리면 새로 만들지 않고 기존 Check Piggy 복구로 대신한다.
function startPiggyOpen() {
  if (readCredential() || hasReceivedPiggy() || state.address) {
    checkPiggy();
  } else {
    openPiggy();
  }
}

async function checkPiggy() {
  if (!isAllowedPiggyRpId()) {
    state.authPhase = "idle";
    state.authCancelled = false;
    setScene("birth", "Not this door.", `Check Piggy only at ${PRODUCTION_RP_ID}.`);
    return;
  }

  // 생성 폴백 없음 — 이 버튼은 절대 새 패스키를 만들지 않는다.
  state.authPhase = "checking";
  state.authCancelled = false;
  setScene("birth", "Chog is checking if this is the same Piggy.", "Face ID may appear once.");

  try {
    await recoverPiggy();
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
  } catch (error) {
    noteRecoverFailure();
    state.authPhase = "idle";
    state.authCancelled = isCancelledAuthError(error);
    // [A-389-a] 복구 실패는 짧고 구분되는 원인만 보여준다 — cancelled 는 renderAuthCard 가
    // "Face ID was cancelled."로 따로 가로챈다(authCancelled). 그 외(NotFound 등)는 원본
    // 기술 에러 문자열(formatError) 대신 이 짧은 문구를 쓴다. 두 버튼 다시 보이는 것은
    // authPhase="idle" 복귀만으로 충분(§actions checking 게이트, 새로 disabled 걸지 않음).
    setScene("birth", "Chog could not find Piggy here.", "Couldn't find your Piggy.");
  }
}

function stayHome() {
  // [A-354] stay home 을 눌러도 같은 Send 카드가 그대로 남던 버그 교정: sendstay 로 다시
  // 들어갈 때 카드 표시 표를 명시적으로 내려서 Home 대기(초그·HomeNotepad)로 분리한다.
  state.sendCardVisible = false;
  setScene("sendstay", "Piggy stayed home today.", "Chog is quiet.");
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
  return { before, beforeShares, depositTx };
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

async function settleSend({ before, address, grantTxHash = "", depositTxHash, depositReceipt, redeemTxHash, shmonReceived }) {
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
    },
  };
}

// 결말 하나가 화면과 저장을 같이 정한다. 성공했을 때만 바퀴가 닫힌다.
function finishTrip(trip) {
  state.tripOutcome = trip.outcome;
  state.tripReason = trip.reason;
  if (trip.receipt) rememberReceipt(trip.receipt);
  if (trip.outcome !== "done") {
    // 돌아왔다고 말하지 않는다 — awayLine 을 성공 쪽으로 넘기지 않는다.
    setScene("sendstay", "couldn't finish this one.");
    return;
  }
  state.tripClosed = true;
  localStorage.setItem(TRIP_CLOSED_KEY, "1");
  state.awayLine = "It's back.";
  // [A-320] 실제 영수증이 있는 성공에서만 귀환 연출로 들어간다.
  // 영수증이 없으면 기존 「확인 중」 경로를 그대로 둔다 — 없는 값을 만들지 않는다.
  // transient 플래그라 새로고침·재방문에서는 다시 재생되지 않는다.
  if (trip.receipt) {
    state.returnArrival = true;
    setScene("return", "Piggy is home.", "One tag.");
    return;
  }
  setScene("away", "Piggy is home.", "Confirmation is still catching up.");
  setTimeout(() => setScene("filebox"), 1200);
}

async function sendPiggy() {
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
      setScene("birth", "Chog could not wake Piggy.", formatError(error));
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
    setScene("sendstay", "relayer unreachable", error instanceof Error ? error.message : String(error));
    return;
  }
  // 이미 가스가 있으면 grant tx 자체가 없다. 그대로 simulate 로 넘어간다.
  state.grantTxHash = grant.txHash;

  const account = activeAccount;
  let plan;
  try {
    plan = await simulateSend(account);
  } catch (error) {
    // fail-closed — broadcast 전에 멈춘다. 추측 진행 금지.
    setScene("sendstay", "Piggy can't go out yet.", formatError(error));
    return;
  }

  state.awayLine = "I'll check it.";
  // 여기까지 왔다는 것은 grant·simulate 가 통과했다는 뜻이다. 그 사실 위에서만
  // 출발 연출이 돈다 — 모션이 먼저 돌아 "이미 떠났다"를 만들지 않는다.
  // 순서(rpId → recover → grant → simulate → away → 서명/broadcast)는 바뀌지 않았다.
  state.departureArrival = true;
  setScene("away", "Piggy went out.", "Can go out once, up to $5.");

  try {
    touchSession();
    const walletClient = createWalletClient({
      account,
      chain: MONAD_TESTNET,
      transport: http(MONAD_TESTNET_RPC),
    });
    const bytes = new TextEncoder().encode(`araso:mera:send-piggy-to-work:v1:${account.address}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const signature = await activeSession.signDigest(digest);
    const mark = `${toHex(signature.compact)}:${signature.recovery}`;
    const depositTxHash = await walletClient.sendTransaction({
      account,
      chain: MONAD_TESTNET,
      ...plan.depositTx,
    });
    const depositReceipt = await waitForSuccess(depositTxHash);
    if (!depositReceipt) throw new Error("deposit unconfirmed or reverted");
    const afterDepositShares = await readShmonBalance(account.address);
    const shmonReceived = afterDepositShares - plan.beforeShares;
    const redeemTx = makeRedeemTx(shmonReceived, account.address, account.address);
    await publicClient.estimateGas({
      account: account.address,
      ...redeemTx,
    });
    const redeemTxHash = await walletClient.sendTransaction({
      account,
      chain: MONAD_TESTNET,
      ...redeemTx,
    });
    localStorage.setItem("araso.mark", mark);
    localStorage.setItem("araso.txHash", redeemTxHash);
    state.mark = mark;
    state.txHash = redeemTxHash;

    settleSend({
      before: plan.before,
      address: account.address,
      grantTxHash: state.grantTxHash,
      depositTxHash,
      depositReceipt,
      redeemTxHash,
      shmonReceived,
    })
      .then(finishTrip)
      // settleSend 는 결말을 반환한다 — 여기로 오는 건 그 밖의 예외뿐이라 미확인으로 접는다.
      .catch(() => finishTrip({ outcome: "failed", reason: "unconfirmed", receipt: null }));
  } catch (error) {
    setScene("sendstay", "Piggy could not get ready.", formatError(error));
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
    jitAnswer: null,
    permission: false,
    amount: "",
    domainState: null, // second-journey-state.js 의 interests/preference 저장 모양
    persisted: false, // 마지막 저장이 실제 localStorage 로 갔는가(scope 유효)
    devPreview: false, // [A-360 §7] DEV 전용 — production 진입 0(아래 window.__arasoScene)
    flow: null, // 마지막 runSecondJourney() 결과
    mockReceipt: null, // makeMockReceipt() 출력 — 메모리만, 실제 receipts 에 안 감
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
    // note/noteQueue: 목록 없이 문구만 보여주고 Home 으로 닫는 종결 화면(seed B 소진,
    // 본편 반복 none). render() 가 이 큐를 sceneTimeout 으로 한 걸음씩 넘긴다.
    note: null,
    noteQueue: [],
  };
}

// Explore 에서 한 번에 내놓는 최대 후보 수 — job-feed.js EXPLORE_ERRANDS(8개 정본)는
// 그대로 두고, 이 view/delivery 경계에서만 최대 5개로 자른다(§success_criteria
// "표시 개수와 실제 선택가능 ids 일치, all=현재 제시목록"). job-feed.js 는 고치지 않는다.
const MAX_EXPLORE_VISIBLE = 5;
// seed B 소진("okay./maybe later.") 및 본편 반복 none 종결 노트가 화면에 머무는 시간 —
// 기존 filebox 자동전환(A-292, 1200ms)과 같은 값을 재사용한다(새 타이밍 발명 0).
const EXPLORE_NOTE_MS = 1200;

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

function ensureSecondJourneyDomainState() {
  const sj = state.secondJourney;
  if (sj.domainState) return sj.domainState;
  const scope = secondJourneyScope();
  const validScope = validatePersistenceScope(scope);
  sj.domainState = validScope.error ? createSecondJourneyState(scope) : loadSecondJourneyState(localStorage, scope).state;
  sj.persisted = !validScope.error;
  return sj.domainState;
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
  sj.flow = runSecondJourney({
    selectionKind,
    selectedErrandIds: ids,
    scope: secondJourneyScope(),
    jitAnswer: sj.jitAnswer || undefined,
    preferredDestinationId: chosenId || undefined,
    destinationOverrides: devPreview && chosenId ? buildDevPreviewOverrides(chosenId) : {},
    permission: sj.permission === true,
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
  });
}

function buildSecondJourneyViewModel() {
  const sj = state.secondJourney;
  const flow = sj.flow;
  const chosen = (flow?.destinations || []).find((d) => d.id === sj.chosenDestinationId) || null;
  const amountCheck = validateSecondAmount(sj.amount);
  const devPreview = import.meta.env.DEV && sj.devPreview === true;
  const preflight = flow?.preflight || null;
  const canSend = devPreview && preflight?.status === "JOB_READY" && preflight?.executionPermission === true;
  return {
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
  };
}

// Chog 탭 → Explore. 첫 Journey 카드가 떠 있는 동안은 chog-home.js 의 cardClaimed
// 가드가 이 콜백 자체를 부르지 않는다(§A-360 §3 주석).
function openSecondJourneyExplore() {
  if (!state.receipts.some((r) => r && r.txHash) && !(import.meta.env.DEV && state.secondJourney.devPreview)) return;
  const sj = state.secondJourney;
  const domainState = ensureSecondJourneyDomainState();
  sj.selectedIds = (domainState.interests || []).map((item) => item.errandId);
  sj.chosenDestinationId = null;
  sj.jitAnswer = null;
  sj.permission = false;
  sj.amount = "";
  sj.interestsNote = null;
  sj.note = null;
  sj.noteQueue = [];
  // [A-405-a] 관심이 이미 있으면(=이미 뭔가 골라둔 재방문) 곧장 candidates 로 — 기존
  // 회귀 동작 그대로. 관심이 비어 있을 때만 seedStage 를 다시 유추한다(최초 seed A/B
  // 이어가기 또는 반복 방문 단일 세트).
  sj.step = sj.selectedIds.length ? "candidates" : "interests";
  sj.seedStage = sj.selectedIds.length ? "done" : inferSeedStage(domainState);
  recomputeSecondJourneyFlow();
  setScene("explore", "", "");
}

// [A-405] "표시 id == 선택가능 id" 를 여기서도 다시 지킨다 — DOM 에서 온 ids 를 그대로
// 믿지 않고, 지금 실제로 그려졌어야 할 bounded 세트(computeExploreDisplayErrands)에
// 없는 id 는 버린다. 빠르게 두 번 저장을 눌러도(예: 재렌더 전에 큐잉된 옛 클릭) 화면에
// 없던 항목이 섞여 들어가지 않는다.
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
  const preferenceUpdate = { preference: domainState.preference, delta: {}, signal: kind, fixedPersonalityLabel: null };
  const stateUpdate = applyExploreSelection(domainState, selection, preferenceUpdate, {
    eventId: `explore-save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    now: new Date().toISOString(),
  });
  sj.domainState = stateUpdate.state;
  persistSecondJourneyDomainState();
  sj.selectedIds = selection.errandIds;
  // one/multi(= 지금 보여준 세트 전체를 골랐으면 그게 곧 "all") 선택은 A 든 B 든 seed
  // 시퀀스를 벗어나 기존 bounded preference + checking 흐름으로 합류한다(§A-405-a 3).
  sj.seedStage = "done";
  sj.interestsNote = null;
  sj.step = "candidates";
  sj.chosenDestinationId = null;
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
  const preferenceUpdate = { preference: domainState.preference, delta: {}, signal: "none", fixedPersonalityLabel: null };
  const stateUpdate = applyExploreSelection(domainState, selection, preferenceUpdate, {
    eventId: `explore-none-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    now: new Date().toISOString(),
  });
  sj.domainState = stateUpdate.state;
  persistSecondJourneyDomainState();
  sj.selectedIds = [];
  sj.chosenDestinationId = null;

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

function handleCandidateCheck(destinationId) {
  const sj = state.secondJourney;
  sj.chosenDestinationId = destinationId;
  sj.jitAnswer = null;
  sj.step = "readiness";
  recomputeSecondJourneyFlow();
  render();
}

function handleJitAnswer(value) {
  state.secondJourney.jitAnswer = value;
  recomputeSecondJourneyFlow();
  render();
}

// [A-377 §6] 한 걸음만 되돌린다, 선택은 보존한다 — readiness 단계 안에는 실제로 두
// 페이지가 있다(질문 화면 / READY+Permission+amount 화면). 질문에 이미 답한 뒤라면
// 그 답만 지우고 질문 화면으로 돌아간다(후보 선택은 그대로). 아직 질문 전(또는 질문이
// 필요 없는 후보)이면 후보 목록으로 돌아간다(관심 선택은 그대로 — Home 닫기가 아니다).
function handleReadinessBack() {
  const sj = state.secondJourney;
  const hasJitQuestion = (sj.flow?.jitQuestions?.length || 0) > 0;
  if (hasJitQuestion && sj.jitAnswer) {
    sj.jitAnswer = null;
    recomputeSecondJourneyFlow();
    render();
    return;
  }
  sj.step = "candidates";
  sj.chosenDestinationId = null;
  sj.jitAnswer = null;
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
  const canSend = devPreview && preflight?.status === "JOB_READY" && preflight?.executionPermission === true;
  btn.disabled = !canSend;
  const reasonEl = document.querySelector("#secondSendReason");
  if (reasonEl) reasonEl.textContent = secondJourneySendReason(preflight, devPreview);
  const preflightEl = document.querySelector("#secondJourneyPreflightLine");
  if (preflightEl) preflightEl.textContent = preflight ? paperStatusCopy(preflight.status) : "";
  const amountErrorEl = document.querySelector("#secondAmountError");
  if (amountErrorEl) amountErrorEl.textContent = validateSecondAmount(sj.amount).error || "";
}

// 실제 경로에서는 devPreview 가 항상 false 라 canSend 가 절대 true 가 될 수 없다
// (recomputeSecondJourneyFlow 의 ruleAgreed/evidence 도 devPreview 로만 채워진다) —
// 이 함수 자신도 다시 한 번 같은 조건을 확인한다(fail closed 이중 방어, §금지 "새로운
// 금융 adapter/서명/permission 부여는 이번 범위 아님").
function handleSecondSend() {
  const sj = state.secondJourney;
  const devPreview = import.meta.env.DEV && sj.devPreview === true;
  const preflight = sj.flow?.preflight;
  const canSend = devPreview && preflight?.status === "JOB_READY" && preflight?.executionPermission === true;
  if (!canSend) return;
  sj.mockReceipt = sj.flow.mockReceipt;
  sj.awayLine = "Piggy is checking a second errand. (preview)";
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
  document.querySelectorAll(".secondJourney__checkBtn").forEach((btn) => {
    btn.addEventListener("click", () => handleCandidateCheck(btn.dataset.destinationId));
  });
  document.querySelectorAll(".secondJourney__jitBtn").forEach((btn) => {
    btn.addEventListener("click", () => handleJitAnswer(btn.dataset.jitAnswer));
  });
  const permissionInput = document.querySelector("#secondPermission");
  permissionInput?.addEventListener("change", () => {
    sj.permission = permissionInput.checked;
    recomputeSecondJourneyFlow();
    updateSecondJourneyReadinessUI();
  });
  const amountInput = document.querySelector("#secondAmount");
  amountInput?.addEventListener("input", () => {
    sj.amount = amountInput.value;
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
      <article class="note note--quiet">
        <p class="line">${state.secondJourney.awayLine || "Piggy is checking a second errand."}</p>
      </article>
      <p class="secondJourney__mockTag">UI preview — no transaction</p>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
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
    advanced = true;
    setScene("secondReturn", "", "");
  };
  const canvas = document.querySelector("#departStage");
  if (!canvas) {
    sceneListener(window, "resize", () => {
      fitHomeBoard();
    });
    advanceToReturn();
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
      if (st.phase === "asset-missing" || st.phase === "asset-error") {
        advanceToReturn();
        return;
      }
      if (st.phase === "complete" || st.phase === "reduced-final") advanceToReturn();
    },
  });
  onSceneTeardown(() => playback.stop());
  sceneListener(window, "resize", () => playback.redraw());
  playback.start();
}

function renderSecondReturn() {
  return returnSceneMarkup({
    line: "Piggy is home. (preview)",
    receiptRowsMarkup: receiptPaperMarkup(secondJourneyReceiptFields(state.secondJourney.mockReceipt, displayPiggyName())),
    name: displayPiggyName(),
    homeChogMarkup: chogHomeMarkup({ padMarkup: homePadMarkup("return") }),
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
  const finishSecondJourney = () => {
    if (!valid()) return;
    const prior = state.secondJourney;
    state.secondJourney = createEmptySecondJourney();
    // Keep the in-memory interest/domain snapshot; clear only the transient run.
    state.secondJourney.domainState = prior.domainState;
    state.secondJourney.persisted = prior.persisted;
    state.secondJourney.devPreview = prior.devPreview;
    state.secondJourney.selectedIds = [...prior.selectedIds];
    setScene("sendstay", "Piggy is home.", "Second errand filed. (preview)");
  };
  mountReturnView({
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
    openFileLabel: "Home",
    onOpenFilebox: finishSecondJourney,
    onError: finishSecondJourney,
    onIdleEnter: () => {
      sceneTimeout(finishSecondJourney, 0);
    },
  });
}

function goHomeFromFilebox() {
  setScene("sendstay", "Piggy is home.", "");
}

// [A-383 §1] Home 피기 칸의 "records" entry — 별도 화면 전환이 아니라 Home 카드 오른쪽에
// 기록 카드를 편다. 읽기 전용: 아무것도 저장하지 않는다(§3 "반복탭이 영수증을 새로
// 저장하지 않게"). setScene()/render() 를 부르지 않는다 — 부르면 render() 의
// teardownScene() 이 mountChogHome() 을 처음부터 다시 마운트해 이미 손끝-고정(pinned)으로
// 열려 있는 Home 카드가 닫혀 버린다(chog-home.js mountChogHome, `let pinned = false`
// 초기값). 그래서 여기서는 이미 그려져 있던(hidden) 기록 카드 DOM만 그대로 채워 보여준다.
// [A-387] Codex 실화면검토 FAIL: 옛 fitRecordsCard() 는 "공통 Send 앵커(285×364)가 곧
// 실제 Home 종이"라고 가정했지만 실측은 달랐다(x695,y350,w136,h185 vs 계산 x802,y129,
// w256,h364). alignRecordsCardToHomePaper() 가 그 자리에서 실제 `.homePaper` rect 를
// 재서 맞추고, startRecordsAlignLoop() 가 열려 있는 동안 계속 따라간다(도킹 애니메이션·
// 리사이즈 전부 포함 — chog-home.js 는 매 프레임 pad.style.transform 을 직접 쓴다, 그
// 파일은 allowlist 밖이라 고치지 않고 읽기만 했다).
function openRecordsCard() {
  const anchor = document.querySelector("#recordsCardAnchor");
  if (!anchor) return;
  state.recordsCardVisible = true;
  state.recordsDetailIndex = null;
  renderRecordsCardBody();
  alignRecordsCardToHomePaper();
  // [A-387-a] Owner 지시: 카드가 Home 옆으로 스르륵 열리는 짧은 open transition만(새
  // 모션 디자인 확대 금지) — 숨김을 풀기 **전에** .recordsCardAnchor--opening(초기
  // opacity 0/이동)을 먼저 걸어 둬야 첫 페인트가 이미 그 상태로 나가고, 다음 프레임에
  // 떼면 CSS transition 이 자연스럽게 걸린다(순서를 반대로 하면 한 프레임 풀-오퍼시티로
  // 반짝인 뒤 되감기는 것처럼 보인다). reduced-motion 은 즉시 표시(클래스를 아예 걸지
  // 않는다 — CSS 쪽에도 안전망으로 media query 를 뒀다).
  const reduced = prefersReducedMotion();
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
  if (anchor) {
    anchor.hidden = true;
    anchor.classList.remove("recordsCardAnchor--opening");
  }
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
  localStorage.removeItem(RECEIPTS_KEY);
  // 탄생 한 바퀴의 세 가지 사실도 함께 지운다 — 안 지우면 리셋 뒤에도 Open 이 숨고
  // 해치가 다시 돌지 않는다.
  localStorage.removeItem(PIGGY_RECEIVED_KEY);
  localStorage.removeItem(PIGGY_NAME_KEY);
  localStorage.removeItem(BIRTH_PLAYED_KEY);
  endActiveSession();
  state.credential = null;
  state.address = "";
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
function receiptRows(receipt) {
  if (!receipt) return [];
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
function receiptCheck(receipt) {
  if (!receipt) return "";
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
function renderAuthCard() {
  const blocked = !isAllowedPiggyRpId();
  const checking = !blocked && state.authPhase === "checking";
  const heading = checking ? state.message || "Checking…" : "Couldn't open Piggy";
  const body = checking
    ? state.detail || "Face ID may appear once."
    : state.authCancelled
      ? "Face ID was cancelled."
      : state.detail || "Try again, or use Check Piggy to recover.";
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
  return `
    <section class="stage" data-scene="birth">
      ${buttonInkFilter()}
      <div class="authCard">
        <div class="authCard__chog" aria-hidden="true">${chogInviteMarkup()}</div>
        <div class="authCard__paper">
          <p class="authCard__eyebrow">Araso</p>
          <h1 class="authCard__title">${heading}</h1>
          <p class="authCard__body">${body}</p>
          ${actions}
        </div>
      </div>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
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
const HOME_DROWSY_MS = 180000;

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
      <div class="hatchStage" id="hatchStage" aria-hidden="true"></div>
      <div class="hatchChog" id="hatchChog" aria-hidden="true">${chogInviteMarkup()}</div>
      <button class="tiny skip" id="skipHatchButton" type="button">건너뛰기</button>
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
  return `
    <section class="stage stage--name" data-scene="name">
      ${buttonInkFilter()}
      <div class="nameScene${state.nameResumed ? " is-hidden" : ""}" id="nameScene">
        <div class="nameScene__piggy" id="namePiggy" aria-hidden="true"></div>
        <img class="nameScene__chog" src="${MOTION_DIR}/assets/chog_idle_fill.png" alt="" aria-hidden="true" />
        <div class="nameScene__pad">
          ${nameCardMarkup({ phase: state.nameResumed ? "name" : "arrival", name: readPiggyName() })}
        </div>
      </div>
      ${isDevDebugOptIn() ? `<button class="tiny" id="resetButton">reset local test</button>` : ""}
    </section>
  `;
}

// 아트보드는 고정 크기다(1280×800). 화면이 그보다 작으면 그림을 다시 짜지 않고 판을
// 통째로 축소해 가운데에 넣는다 — fitInvite 와 같은 방법(§O).
function fitNameScene() {
  const board = document.querySelector("#nameScene");
  if (!board) return;
  const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 800);
  board.style.transform = `translate(${(window.innerWidth - 1280 * scale) / 2}px, ${(window.innerHeight - 800 * scale) / 2}px) scale(${scale})`;
}

function mountName() {
  const token = sceneToken;
  fitNameScene();
  sceneListener(window, "resize", fitNameScene);
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

// 후버 노트패드에 넣을 실제 데이터 — Piggy 는 한 기기에 하나뿐이라 지금 어디 있는지는
// scene 하나로 정해진다(home-paper.js homeStatusFromScene). 샘플 이름/시간을 쓰지 않는다.
function homePadMarkup(scene) {
  // [A-377 §2] 기록 보기 entry 는 Home 대시보드(scene "sendstay")에서만 실제로 채운다.
  // 다른 씬에서는 이 pad 자체가 opacity 0 이 되므로(chog-home.js cardClaimed) 빈 문자열을
  // 주고, Home 이 아닌 곳에서 자동으로 기록이 열리는 경로를 만들지 않는다(§5).
  const recordsEntryMarkup = scene === "sendstay" ? homePaperRecordsEntryMarkup(state.receipts.length) : "";
  const markup = homePaperMarkup({
    name: displayPiggyName(),
    time: homeTimeNow(),
    recordsEntryMarkup,
    ...homeStatusFromScene(scene),
  });
  const hasRealReceipt = state.receipts.some((receipt) => receipt && (receipt.txHash || receipt.redeemTxHash));
  const canOpenSecondJourney = scene === "sendstay" && (hasRealReceipt || (import.meta.env.DEV && state.secondJourney.devPreview === true));
  if (!canOpenSecondJourney) return markup;
  const button = sendCardButtonMarkup({ id: "nextErrandButton", label: "next errand", className: "homeNextErrand" });
  return markup.replace('<div class="homePaper__mark"', `${button}<div class="homePaper__mark"`);
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
      ${chogHomeMarkup({ padMarkup: homePadMarkup(state.scene) })}
    </div>
  `;
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
  if (state.recordsCardVisible) alignRecordsCardToHomePaper();
  sceneListener(window, "resize", () => {
    fitHomeBoard();
    layoutHomeCharacter();
    fitCardAnchor();
    if (state.recordsCardVisible) alignRecordsCardToHomePaper();
  });

  // Home Chog — Piggy 와 같은 판·같은 발선. 같은 Save 전환에서 함께 출발한다.
  const chogRoot = document.querySelector("#chogHome");
  if (chogRoot && fit) {
    const chogStart = state.homeArrival ? state.chogStartRect : null;
    state.chogStartRect = null;
    homeChog = mountChogHome(chogRoot, {
      startRect: chogStart,
      // Name it 에 있던 그 그림 — 걷기 첫 120ms 를 그것에서 이어받는다.
      startSrc: chogStart ? `${MOTION_DIR}/assets/chog_idle_fill.png` : null,
      board: fit.rect,
      reduced: prefersReducedMotion(),
      // [A-359 §3] 공통 카드 자리(.cardAnchor)는 한 번에 카드 하나만 — Send 카드가 이미
      // 떠 있으면(state.sendCardVisible) Home 노트패드가 손끝-고정(pinned)으로 같은 자리에
      // 도킹하지 못하게 한다(chog-home.js sharedCardPadTarget). DEV 경로만이 아니라 이
      // 값 자체가 실제 sendCardVisible 상태라 실제 Send 진입에도 그대로 적용된다.
      cardClaimed,
      onFrame: (step) => runSceneFrames(step),
      onCleanup: (fn) => onSceneTeardown(fn),
      listen: (target, type, handler, options) => sceneListener(target, type, handler, options),
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
    if (!keepPose) {
      if (walk) walk.style.removeProperty("transform");
      if (seat) seat.style.removeProperty("transform");
    }
    startHomeDrowsyTimer();
    // [A-356 §2] A354 회귀 교정 — state.sendCardVisible 이 설 자리가 없어 첫 Journey 카드가
    // 영영 안 열리던 것. 이 정착이 Save 직후 첫 도착일 때만, 잠깐(위 상수) 뒤 카드를 연다.
    // 재방문·Stay 재진입은 isFirstArrival 이 false 라 여기 오지 않는다. 씬을 떠나면(다음
    // render() 의 teardownScene()) sceneTimeout 이 예약을 스스로 지운다 — 반복 강제 표시 0.
    if (isFirstArrival && !state.sendCardVisible) {
      sceneTimeout(() => {
        // [A-359 §3] Send 카드가 공통 자리를 넘겨받기 직전, 아직 pinned 로 열려 있을 수
        // 있는 Home 노트패드를 먼저 닫는다 — render() 의 전체 다시그리기가 곧 이 인스턴스를
        // 치우지만, 그 사이 한 프레임이라도 두 카드가 같은 자리에서 겹치지 않게 한다.
        homeChog?.closeCard?.();
        state.sendCardVisible = true;
        render();
      }, HOME_FIRST_JOURNEY_CARD_MS);
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
      if (walk) {
        walk.src = `${MOTION_DIR}/walk/f${String(Math.floor(k / HOME_FPS) % HOME_WALK_FRAMES).padStart(2, "0")}.svg`;
        walk.style.transform = `translate(${lerp(ENTER_X, 0, u)}px, ${lerp(entryY, 0, u)}px) scale(${lerp(entryScale, 1, u)})`;
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
            address: state.address,
            terms: ["$5 limit", "Ask me every time", "One-time"],
            blocked,
          })}
        </div>
      </div>`
    : "";
  return `
    <section class="stage" data-scene="sendstay">
      ${buttonInkFilter()}
      ${corner("sendstay")}
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

function renderAway() {
  return `
    <section class="stage" data-scene="away">
      <canvas class="departStage" id="departStage" aria-hidden="true"></canvas>
      <div class="homeBoard" id="homeBoard">
        ${chogHomeMarkup({ padMarkup: homePadMarkup("away") })}
      </div>
      ${corner("away")}
      <article class="note note--quiet">
        <p class="line">${state.awayLine}</p>
      </article>
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

// 장면 — 귀환. 화면 바인딩은 `return-view.js` 가 갖는다 —
// 앱과 로컬 검토 하네스가 **같은 것**을 쓰기 위해서다(A-322 교정 7).
// 여기서 넘기는 것은 화면 입력뿐이다. finance 는 이 파일에 남는다.
function renderReturn() {
  return returnSceneMarkup({
    line: state.awayLine,
    receiptRowsMarkup: returnReceiptRows(),
    name: displayPiggyName(),
    homeChogMarkup: chogHomeMarkup({ padMarkup: homePadMarkup("return") }),
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

  let errored = false;
  mountReturnView({
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

function recordsCardListMarkup() {
  const name = displayPiggyName();
  const receipts = state.receipts;
  const preview = receipts.slice(0, RECORDS_FOLDER_PREVIEW);
  const rotations = [-2.2, 1.8, -1.0];
  const tops = [8, 24, 40];
  if (!receipts.length) {
    // §4 "무기록은 같은 종이에 짧은 빈 상태만, 합성 Unknown receipt 생성 금지".
    return `
      <div class="recordsCard__panel recordsCard__panel--empty">
        <p class="recordsCard__empty">No records yet. They'll show up here after a real trip.</p>
      </div>
      <button class="recordsCard__close" id="recordsCardClose" type="button">close</button>
    `;
  }
  const slipsMarkup = preview
    .map((receipt, i) => {
      const fields = receiptPaperFields({ receipt, name });
      return `
        <div class="recordsFolder__slip" style="top: ${tops[i] ?? 8}px; transform: translateX(-50%) rotate(${rotations[i] ?? 0}deg); z-index: ${2 + i};">
          <div class="recordsFolder__slipRow">
            <span>${escapeHtml(fields.name)}</span>
            <span>${escapeHtml(fields.date)}</span>
          </div>
          <div class="recordsFolder__slipStatus">&gt; ${escapeHtml(fields.statusLabel)}</div>
        </div>
      `;
    })
    .join("");
  // 전부 저장, 전부 열 수 있다(§4) — "최근 3장" 은 위 folder 미리보기(RECORDS_FOLDER_PREVIEW)
  // 만의 표시 규칙이다.
  const rowsMarkup = receipts
    .map((receipt, index) => {
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
    <div class="recordsCard__panel recordsCard__panel--folder">
      <div class="recordsFolder" aria-hidden="true">
        <img class="recordsFolder__back" src="/motion/piggy-return/folder-back.png" alt="" />
        ${slipsMarkup}
        <img class="recordsFolder__front" src="/motion/piggy-return/folder-front.png" alt="" />
      </div>
      <p class="recordsCard__caption">kept ${receipts.length} &middot; showing latest ${preview.length}</p>
    </div>
    <div class="recordsCard__panel recordsCard__panel--list">
      <div class="recordsCard__list">${rowsMarkup}</div>
    </div>
    <button class="recordsCard__close" id="recordsCardClose" type="button">close</button>
  `;
}

// 선택한 영수증 상세 — 같은 카드 영역에서 목록을 대체한다(§4). filebox 와 같은
// receiptPaperMarkup/receiptRows/receiptCheck(실제 tx/block 상세)를 그대로 쓴다(재디자인 0).
function recordsCardDetailMarkup(index) {
  const receipt = state.receipts[index] ?? null;
  if (!receipt) return recordsCardListMarkup();
  const name = displayPiggyName();
  const paperMarkup = receiptPaperMarkup(receiptPaperFields({ receipt, name }));
  const rows = receiptRows(receipt);
  const rowsMarkup = rows
    .map(
      (row) =>
        `<p class="receipt-row"><span class="label">${row.label}</span><span class="value">${row.value}</span></p>`,
    )
    .join("");
  return `
    <div class="recordsCard__panel recordsCard__panel--detail">
      <div class="recordsCard__detailPaper">${paperMarkup}</div>
      <div class="recordsCard__detailRows">${rowsMarkup}${receiptCheck(receipt)}</div>
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

// [A-383 §3] Home 카드 앵커(.cardAnchor, 285×364, 중앙 -32/-48)의 오른쪽에 gap 만큼
// 떨어져 자리잡는다 — 앵커 자체는 옮기지 않는다(Home 카드 위치·크기 불변, §3). 세로는
// Home 카드와 같은 top(중앙 -230). 실제 렌더 markup 은 renderSendStay() 에서 항상 함께
// 그려지고(hidden), openRecordsCard() 가 hidden 만 뗀다 — 씬 전환 0.
function recordsCardMarkup() {
  return `
    <div class="recordsCardAnchor" id="recordsCardAnchor" ${state.recordsCardVisible ? "" : "hidden"}>
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
function alignRecordsCardToHomePaper() {
  const anchor = document.querySelector("#recordsCardAnchor");
  const stage = document.querySelector('.stage[data-scene="sendstay"]');
  const paper = document.querySelector(".homePaper");
  if (!anchor || !stage || !paper) return;
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

function render() {
  teardownScene();
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
  document.querySelector("#stayButton")?.addEventListener("click", stayHome);
  document.querySelector("#fileboxHomeButton")?.addEventListener("click", goHomeFromFilebox);
  document.querySelector("#nextErrandButton")?.addEventListener("click", openSecondJourneyExplore);
  // [A-383 §1] Home 카드 오른쪽 기록 카드 — 별도 화면 전환 없이 같은 sendstay DOM 안에서
  // 열림/목록/상세/닫힘을 전부 위임 클릭 하나로 배선한다(카드 내용은 render() 를 다시
  // 부르지 않고 renderRecordsCardBody() 가 innerHTML 만 바꾸므로, 매번 다시 부를 필요가
  // 없다 — 이 델리게이션은 이번 sendstay 마운트 동안 계속 유효하다).
  document.querySelector("#homeRecordsButton")?.addEventListener("click", openRecordsCard);
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
  if (state.scene === "sendstay") mountHome();
  if (state.scene === "away") mountAway();
  if (state.scene === "return") mountReturn();
  // [A-360] explore 는 mountHome() 을 카드 자리 고정(cardClaimed:true)으로 재사용한다
  // (걷기 없는 정착 경로 그대로) — 그 뒤에 Second Journey 카드 버튼을 배선한다.
  if (state.scene === "explore") {
    mountHome({ cardClaimed: true });
    wireExploreCard();
    // [A-405-a] 종결 note("okay./maybe later." 류)만 씬에 묶인 타이머로 한 걸음
    // 넘긴다 — 다음 render()(카드 이탈·다른 클릭)가 오면 teardownScene() 이 이 예약을
    // 지워 뒤늦은 덮어쓰기를 막는다(기존 sceneTimeout 패턴, 새 타이머 체계 0).
    if (state.secondJourney.step === "note") {
      sceneTimeout(advanceExploreNote, EXPLORE_NOTE_MS);
    }
  }
  if (state.scene === "secondAway") mountSecondAway();
  if (state.scene === "secondReturn") mountSecondReturn();
}

// 돌아온 사용자는 Received 에 갇히지 않는다 — 이미 credential 이나 주소가 있으면 Birth 로 연다.
// (Received 는 "아직 아무것도 열지 않은" 첫 진입 전용)
if (state.scene === "received" && (readCredential() || state.address)) {
  state.scene = "birth";
}

render();

window.addEventListener("resize", fitInvite);
window.addEventListener("beforeunload", endActiveSession);

// @DEV_ONLY — 로컬 검토용 씬 점프. localhost 는 rpId 가 허용 목록 밖이라 실제 패스키를
// 탈 수 없고(isAllowedPiggyRpId), 그래서 해치·Name it·첫 Home 을 실제 앱에서 눈으로
// 확인할 방법이 달리 없다. 인증·저장·게이트는 건드리지 않는다 — 화면만 띄운다.
// 프로덕션 번들에는 실리지 않는다(import.meta.env.DEV).
if (import.meta.env.DEV) {
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
        unsupported: { cancelled: false, detail: `Open Piggy only at ${PRODUCTION_RP_ID}. (DEV preview — no real auth call)` },
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
    if (scene === "return") state.returnArrival = arrival;
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
