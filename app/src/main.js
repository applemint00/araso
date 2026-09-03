import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import "./style.css";

const PASSKEY_STORAGE_KEY = "araso.testMera.passkey";
// rpId 이력: arasoapp.vercel.app (9/2 낮, 폐기) → arasoo.vercel.app (9/2 밤 재생성, 현재).
// 이후 변경 금지 — 바뀌면 기존에 등록된 패스키가 전부 못 찾는 상태가 된다.
const PRODUCTION_RP_ID = "arasoo.vercel.app";
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
const RECEIPTS_KEY = "araso.testMera.receipts";
// 보관은 최근 2건까지 — 이번 바퀴와 그 앞의 바퀴 하나. 그 이상은 아직 화면에 열 자리가 없다.
const RECEIPT_KEEP = 2;

const app = document.querySelector("#app");

// scene 은 credential/txHash 로부터 최초 1회 파생하고, 그 뒤로는 사용자 행동에 따라
// 명시적으로 전환한다(완전 파생이 아님 — away/filebox 전환은 진행 중인 네트워크 상태를 담아야 해서
// 이벤트 사실만으로는 부족하다).
function computeInitialScene(hasCredential, hasTxHash, hasAddress) {
  // 아무것도 없는 첫 방문 = Invite(Received). 그 전까지는 이 화면이 한 번도 뜨지 않았다 —
  // credential 이 없으면 곧장 Birth 로 보냈기 때문이다(2026-09-03 A-018 에서 발견).
  if (!hasCredential && !hasAddress) return "received";
  if (!hasCredential) return "birth";
  if (hasTxHash) return "filebox";
  return "sendstay";
}

const state = {
  scene: "received", // 5장 중 1장 — 첫 진입
  message: "",
  detail: "",
  address: localStorage.getItem("araso.testMera.address") || "",
  mark: localStorage.getItem("araso.testMera.mark") || "",
  txHash: localStorage.getItem("araso.testMera.txHash") || "",
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
  // 패스키를 못 찾은 뒤에만 켜지는 안내 한 줄. 비공개 탭인지 자체는 알 수 없다(아래 주석).
  privateTabHint: false,
};
state.scene = computeInitialScene(!!state.credential, !!state.txHash, !!state.address);

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
function readReceipts() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.slice(0, RECEIPT_KEEP).map((row) => ({
      before: BigInt(row.before),
      after: BigInt(row.after),
      gas: BigInt(row.gas),
      sent: BigInt(row.sent),
      txHash: row.txHash || "",
      at: row.at || 0,
    }));
  } catch {
    return [];
  }
}

function rememberReceipt(receipt) {
  const kept = [receipt, ...state.receipts].slice(0, RECEIPT_KEEP);
  state.receipts = kept;
  state.receiptIndex = 0;
  localStorage.setItem(
    RECEIPTS_KEY,
    JSON.stringify(
      kept.map((row) => ({
        before: String(row.before),
        after: String(row.after),
        gas: String(row.gas),
        sent: String(row.sent),
        txHash: row.txHash,
        at: row.at,
      })),
    ),
  );
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
  localStorage.setItem("araso.testMera.address", address);
  state.address = address;
  touchSession();
  return { account: activeAccount, address };
}

function setScene(scene, message = "", detail = "") {
  state.scene = scene;
  state.message = message;
  state.detail = detail;
  render();
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
  state.privateTabHint = false;
}

// 연속 2회 실패 = 이 기기엔 되찾을 Piggy 가 없다고 본다. Birth 화면의 안내문을
// "already have a Piggy?" 대신 새로 만들라는 쪽으로 넌지시 돌린다. 자동 생성은 여전히 없다.
function noteRecoverFailure() {
  state.recoverFailures += 1;
  if (state.recoverFailures >= 2) state.noPiggy = true;
  // 비공개 탭인지 페이지가 직접 아는 방법은 없다 — Safari 는 비공개에서도 localStorage 를
  // 정상으로 답한다. 그래서 판정하지 않고, 패스키를 못 찾았을 때 후보 원인 하나를 안내만 한다
  // (Owner 실측 2026-09-03: 비공개 탭에서 카드 미표시 + Send 불가 2회 재현, 원인 UNKNOWN).
  state.privateTabHint = true;
}

async function openPiggy() {
  if (!isProductionRpId()) {
    setScene("birth", "Not this door.", `Open Piggy only at ${PRODUCTION_RP_ID}.`);
    return;
  }

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
    localStorage.setItem("araso.testMera.prfSalt", toHex(result.prfSalt));
    noteRecoverSuccess();

    setScene("sendstay", "Piggy is home.", `There's a little money inside. $${5}.`);
  } catch (error) {
    setScene("birth", "Piggy could not open here.", formatError(error));
  }
}

async function checkPiggy() {
  if (!isProductionRpId()) {
    setScene("birth", "Not this door.", `Check Piggy only at ${PRODUCTION_RP_ID}.`);
    return;
  }

  // 생성 폴백 없음 — 이 버튼은 절대 새 패스키를 만들지 않는다.
  setScene("birth", "Chog is checking if this is the same Piggy.", "Face ID may appear once.");

  try {
    await recoverPiggy();
    noteRecoverSuccess();
    setScene("sendstay", "Piggy is home.", "Same place, same Piggy.");
  } catch (error) {
    noteRecoverFailure();
    setScene("birth", "Chog could not find Piggy here.", formatError(error));
  }
}

function stayHome() {
  setScene("sendstay", "Piggy stayed home today.", "Chog is quiet.");
}

async function requestGrant(address) {
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

// broadcast 전에 잔액/가스를 확인한다. 부족하면 여기서 throw — 추측 진행 금지.
async function simulateSend(account) {
  const relayerAddress = import.meta.env.VITE_RELAYER_ADDRESS;
  if (!relayerAddress) {
    throw new Error("VITE_RELAYER_ADDRESS is not set");
  }
  const before = await publicClient.getBalance({ address: account.address });
  const gasEstimate = await publicClient.estimateGas({
    account: account.address,
    to: relayerAddress,
    value: SEND_AMOUNT,
  });
  const gasPrice = await publicClient.getGasPrice();
  const required = SEND_AMOUNT + gasEstimate * gasPrice;
  if (before < required) {
    throw new Error(`not enough to send: have ${formatEther(before)}, need ${formatEther(required)}`);
  }
  return { relayerAddress, before };
}

// receipt 확정 후 before/after/cost 를 하나의 receipt 객체로 만든다. 화면은 이 객체 위에서만 그린다.
async function settleSend({ before, address, txHash }) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const after = await publicClient.getBalance({ address });
  const gas = receipt.gasUsed * receipt.effectiveGasPrice;
  return { before, after, gas, sent: SEND_AMOUNT, txHash, at: Date.now() };
}

async function sendPiggy() {
  if (!isProductionRpId()) {
    setScene("sendstay", "Not this door.", `Send Piggy only at ${PRODUCTION_RP_ID}.`);
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
    const txHash = await walletClient.sendTransaction({
      account,
      chain: MONAD_TESTNET,
      to: plan.relayerAddress,
      value: SEND_AMOUNT,
    });
    localStorage.setItem("araso.testMera.mark", mark);
    localStorage.setItem("araso.testMera.txHash", txHash);
    state.mark = mark;
    state.txHash = txHash;

    settleSend({ before: plan.before, address: account.address, txHash })
      .then((receipt) => {
        rememberReceipt(receipt);
        state.awayLine = "It's back.";
        setScene("away", "Piggy is home.", "One tag.");
        setTimeout(() => setScene("filebox"), 1200);
      })
      .catch(() => {
        state.awayLine = "It's back.";
        setScene("away", "Piggy is home.", "Confirmation is still catching up.");
        setTimeout(() => setScene("filebox"), 1200);
      });
  } catch (error) {
    setScene("sendstay", "Piggy could not get ready.", formatError(error));
  }
}

function resetLocalTest() {
  localStorage.removeItem(PASSKEY_STORAGE_KEY);
  localStorage.removeItem("araso.testMera.address");
  localStorage.removeItem("araso.testMera.prfSalt");
  localStorage.removeItem("araso.testMera.mark");
  localStorage.removeItem("araso.testMera.txHash");
  localStorage.removeItem(RECEIPTS_KEY);
  endActiveSession();
  state.credential = null;
  state.address = "";
  state.mark = "";
  state.txHash = "";
  state.grantTxHash = "";
  state.receipts = [];
  state.receiptIndex = 0;
  noteRecoverSuccess(); // 실패 카운터도 초기화 — 리셋 후엔 복구를 다시 처음부터 시도한다
  setScene("birth", "You received a Piggy.", "Local test memory cleared.");
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
const EGG_BIG_SRC = "/egg/egg_idle.png";
// Piggy 본체 파일 없음 (gift-piggy PIGGY_DESIGN_ASSET_SPEC.md §6 완료 인벤토리에 Piggy 자산 부재,
// §8 미정에도 "Egg 정확한 형태 생성물 있으나 lock 아님"만 있음) → 새로 그리지 않고
// Egg 6종 중 부화 후 프레임(egg_crack)으로 대체. UNKNOWN: 스펙대로 된 Piggy 파일.
const PIGGY_STANDIN_SRC = "/egg/egg_crack.png";
const CHOG_IDLE_SRC = "/chog/chog_idle@2x.png";
// Away 전용 걸음 루프 — WALK_META.json 의 이동량은 무시, 제자리 순환만. 10프레임 중 4장만 사용.
const CHOG_WALK_FRAMES = [
  "/chog/chog_walk_v3_F01@2x.png",
  "/chog/chog_walk_v3_F04@2x.png",
  "/chog/chog_walk_v3_F07@2x.png",
  "/chog/chog_walk_v3_F10@2x.png",
];

function chogWalkCycle() {
  return `
    <div class="chog-walk" aria-hidden="true">
      ${CHOG_WALK_FRAMES.map(
        (src, i) => `<img class="chog-walk__frame chog-walk__frame--${i + 1}" src="${src}" alt="" />`,
      ).join("")}
    </div>
  `;
}

// scene 별 구석 캐릭터. 모든 화면 = Chog idle 작게(away 만 walk 순환으로 대체).
// 탄생 이후(sendstay/filebox) = Piggy 대역(Egg 부화 후 프레임)도 곁에 둔다.
function corner(scene) {
  const showPiggyStandin = scene === "sendstay" || scene === "filebox";
  return `
    <div class="corner" aria-hidden="true">
      ${scene === "away" ? chogWalkCycle() : `<img class="chog-idle" src="${CHOG_IDLE_SRC}" alt="" />`}
      ${showPiggyStandin ? `<img class="piggy-corner" src="${PIGGY_STANDIN_SRC}" alt="" />` : ""}
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

// Chog 는 part-filled 8종 중 Invite 가 쓰는 5종이다(2026-08-31 승격, `PROVENANCE.md`
// "8/8 fill PASS → behavior preview PASS → InviteWide 실배치 PASS"). 값·간격은
// `02_REVIEW/behavior_invite_v1/InviteWide_behavior_preview.html` 의 behavior 스크립트 그대로다.
const CHOG_STATES = ["idle", "blink", "twitch", "wave", "click"];
const CHOG_LOOPS = [
  ["blink", 3000, 7000, 140],
  ["twitch", 8000, 15000, 110],
  ["wave", 20000, 40000, 450],
];
const CHOG_CLICK_MS = 220;
const CHOG_CLICK_COOLDOWN = 1500;

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
  const wide = board.dataset.kind === "wide";
  const w = wide ? 1280 : 420;
  // 아래로 재는 기준은 판 전체(800/840)가 아니라 **노트지 밑변**(와이드 17+691, 모바일 22+796)이다.
  // 판 밑에는 디자인이 남겨둔 검은 여백이 있고, 그것까지 넣으려고 판을 줄이면 창이 넓을 때
  // 좌우로 검은색이 크게 남는다(Owner 실측 2026-09-03: "검은색이 그렇게 많이 보이지 않았어").
  // 그래서 폭을 채우되 노트지가 잘리지 않는 선까지만 키우고, 남는 아래 여백은 잘린다.
  const paperBottom = wide ? 708 : 818;
  const scale = Math.min(window.innerWidth / w, window.innerHeight / paperBottom);
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

// 봉투 열기 = 이 화면의 유일한 입력. 뜯기는 순서가 끝나면 Birth 로 넘어간다.
function openInvite() {
  const board = document.querySelector(".invite");
  if (!board || (board.dataset.phase || "closed") !== "closed") return;
  clearInviteTimers();
  setInvitePhase("checking");
  INVITE_TIMELINE.forEach(([at, phase]) => {
    inviteTimers.push(setTimeout(() => setInvitePhase(phase), at));
  });
  inviteTimers.push(
    setTimeout(() => setScene("birth", "You received a Piggy.", "Open it with your face. Once."), 5900),
  );
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
          <img class="invite__line1" src="/invite/line1@2x.png" alt="something small" />
          <img class="invite__line2" src="/invite/line2@2x.png" alt="just for you" />
        </div>
      </div>
    </div>
  `;
}

// Chog 자리 — 상태 5장을 겹쳐 두고 하나만 보이게 한다(캔버스 preview 와 같은 방식).
function inviteChog(dir) {
  const frames = CHOG_STATES.map(
    (k) => `<img class="invite__chogState" data-chog="${k}" src="${dir}/${k}@2x.png" alt="" />`,
  ).join("");
  return `<div class="invite__chogIdle" id="inviteChog" aria-hidden="true">${frames}</div>`;
}

let chogTimers = [];
let chogBusy = 0;

function clearChogTimers() {
  chogTimers.forEach(clearTimeout);
  chogTimers = [];
  chogBusy = 0;
}

function showChog(state) {
  const box = document.querySelector("#inviteChog");
  if (!box) return;
  box.querySelectorAll(".invite__chogState").forEach((img) => {
    img.style.display = img.dataset.chog === state ? "block" : "none";
  });
}

// 우선순위: 클릭(2) 이 랜덤 micro(1) 를 끊는다. 어떤 상태든 끝나면 idle 로 돌아온다.
function playChog(state, priority, ms, squash) {
  if (chogBusy && priority <= chogBusy) return;
  chogBusy = priority;
  showChog(state);
  const box = document.querySelector("#inviteChog");
  if (squash && box) {
    box.style.transform = `scaleY(${squash})`;
    chogTimers.push(setTimeout(() => (box.style.transform = ""), 120));
  }
  chogTimers.push(
    setTimeout(() => {
      showChog("idle");
      chogBusy = 0;
    }, ms),
  );
}

function startChog() {
  clearChogTimers();
  showChog("idle");
  const rnd = (a, b) => a + Math.random() * (b - a);
  CHOG_LOOPS.forEach(([state, min, max, ms]) => {
    const again = () => {
      chogTimers.push(
        setTimeout(() => {
          playChog(state, 1, ms);
          again();
        }, rnd(min, max)),
      );
    };
    again();
  });
  let clickUntil = 0;
  document.querySelector("#inviteChog")?.addEventListener("click", () => {
    if (Date.now() < clickUntil) return;
    clickUntil = Date.now() + CHOG_CLICK_COOLDOWN;
    playChog("click", 2, CHOG_CLICK_MS, 0.99);
  });
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
        ${inviteHoles(16)}
        <div class="invite__hero" aria-hidden="true">${inviteHero("/invite")}</div>
        <img class="invite__burst" src="/invite/burst@2x.png" alt="" aria-hidden="true" />
        ${inviteFace()}
        <div class="invite__chog" aria-hidden="true">
          <img class="invite__trail" src="/invite/trail@2x.png" alt="" />
        </div>
        ${inviteChog("/invite/chog")}
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
        ${inviteChog("/invite/wide/chog")}
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

function renderBirth() {
  const blocked = !isProductionRpId();
  const title = blocked ? "Not this door." : state.message || "You received a Piggy.";
  const detail = blocked ? `Open Piggy only at ${PRODUCTION_RP_ID}.` : state.detail;
  return `
    <section class="stage" data-scene="birth">
      <img class="egg-big" src="${EGG_BIG_SRC}" alt="" aria-hidden="true" />
      ${corner("birth")}
      <article class="note">
        <p class="eyebrow">Araso</p>
        <h1>${title}</h1>
        ${detail ? `<p class="detail">${detail}</p>` : ""}
        ${state.privateTabHint ? `<p class="notice">${PRIVATE_TAB_HINT}</p>` : ""}
        ${state.address ? `<p class="address">${state.address}</p>` : ""}
        <div class="actions">
          ${
            // credential 이 있으면 Open 을 아예 숨긴다. 두 번째 Open 은 새 계정이다
            // (2026-09-02 주소 3개로 갈린 사고의 직접 원인). 버튼은 항상 2개 이하.
            readCredential()
              ? ""
              : `<button class="primary" id="openButton" ${blocked ? "disabled" : ""}>Open</button>`
          }
          <button class="secondary" id="checkButton" ${blocked ? "disabled" : ""}>Check Piggy</button>
        </div>
      </article>
      <button class="tiny" id="resetButton">reset local test</button>
    </section>
  `;
}

function renderSendStay() {
  const blocked = !isProductionRpId();
  return `
    <section class="stage" data-scene="sendstay">
      ${corner("sendstay")}
      <article class="note">
        <p class="eyebrow">Araso</p>
        <h1>${blocked ? "Not this door." : "Piggy is home."}</h1>
        <ul class="terms">
          <li>Can go out once</li>
          <li>up to $5</li>
          <li>call home anytime</li>
        </ul>
        ${state.detail ? `<p class="detail">${state.detail}</p>` : ""}
        ${state.privateTabHint ? `<p class="notice">${PRIVATE_TAB_HINT}</p>` : ""}
        ${state.address ? `<p class="address">${state.address}</p>` : ""}
        <div class="actions">
          <button class="primary" id="sendButton" ${blocked ? "disabled" : ""}>Send</button>
          <button class="secondary" id="stayButton">Stay</button>
        </div>
      </article>
      <button class="tiny check" id="checkButton" ${blocked ? "disabled" : ""}>check same Piggy</button>
      <button class="tiny" id="resetButton">reset local test</button>
    </section>
  `;
}

function renderAway() {
  return `
    <section class="stage" data-scene="away">
      ${corner("away")}
      <article class="note note--quiet">
        <p class="line">${state.awayLine}</p>
      </article>
      <button class="tiny" id="resetButton">reset local test</button>
    </section>
  `;
}

function renderFileBox() {
  // 최신이 0번. 두 건이 있으면 직전 바퀴로 넘겨볼 수 있다 — 2회차에서 앞 영수증이 사라지면
  // 무엇이 달라졌는지 대조할 것이 없다.
  const receipt = state.receipts[state.receiptIndex] || null;
  const hasPrevious = state.receipts.length > 1;
  const rows = receiptRows(receipt);
  const rowsMarkup = rows.length
    ? rows
        .map(
          (row) =>
            `<p class="receipt-row"><span class="label">${row.label}</span><span class="value">${row.value}</span></p>`,
        )
        .join("")
    : `<p class="receipt-row"><span class="label">Trip</span><span class="value">${shortHash(state.txHash)}</span></p>`;
  return `
    <section class="stage" data-scene="filebox">
      ${corner("filebox")}
      <article class="filebox">
        <div class="folder folder--1"></div>
        <div class="folder folder--2"></div>
        <div class="folder folder--3"></div>
        <div class="tape" aria-hidden="true"></div>
        <div class="tag" aria-hidden="true"></div>
        <div class="receipt">${rowsMarkup}${receiptCheck(receipt)}</div>
      </article>
      ${
        hasPrevious
          ? `<button class="tiny trips" id="tripsButton">${state.receiptIndex === 0 ? "last trip" : "this trip"}</button>`
          : ""
      }
      <button class="tiny" id="resetButton">reset local test</button>
    </section>
  `;
}

function render() {
  const markup =
    state.scene === "received"
      ? renderReceived()
      : state.scene === "sendstay"
      ? renderSendStay()
      : state.scene === "away"
        ? renderAway()
        : state.scene === "filebox"
          ? renderFileBox()
          : renderBirth();
  // 장면이 바뀌면 Invite 의 예약된 단계 전환은 전부 버린다 — 화면이 없는데 타이머만 남으면
  // 엉뚱한 시점에 Birth 로 넘어간다.
  if (state.scene !== "received") {
    clearInviteTimers();
    clearChogTimers();
  }
  app.innerHTML = markup;

  document.querySelector("#inviteFaceButton")?.addEventListener("click", openInvite);
  if (state.scene === "received") {
    fitInvite();
    startChog();
  }
  document.querySelector("#openButton")?.addEventListener("click", openPiggy);
  document.querySelector("#checkButton")?.addEventListener("click", checkPiggy);
  document.querySelector("#sendButton")?.addEventListener("click", sendPiggy);
  document.querySelector("#stayButton")?.addEventListener("click", stayHome);
  document.querySelector("#tripsButton")?.addEventListener("click", () => {
    state.receiptIndex = state.receiptIndex === 0 ? 1 : 0;
    render();
  });
  document.querySelector("#resetButton")?.addEventListener("click", resetLocalTest);
}

// 돌아온 사용자는 Received 에 갇히지 않는다 — 이미 credential 이나 주소가 있으면 Birth 로 연다.
// (Received 는 "아직 아무것도 열지 않은" 첫 진입 전용)
if (readCredential() || state.address) {
  state.scene = "birth";
}

render();

window.addEventListener("resize", fitInvite);
window.addEventListener("beforeunload", endActiveSession);
