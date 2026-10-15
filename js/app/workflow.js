// 流程控制：鎖定狀態、「正在處理中」、這次要跑哪些 Stage（流程進度條的
// 資料來源），以及睡眠前的自動搶救。
//
// 刻意不 import 任何 Stage 模組：Stage 模組要 import 這裡（登記鎖定規則、
// 回報狀態），反過來的話會變成循環依賴。Stage 之間「做完接下一個」的串接
// 在 js/app/chain.js。

import { DESKTOP_MODE } from "../core/config.js";
import { postToShell, exposeToShell } from "../core/bridge.js";
import { byId } from "../core/dom.js";
import { emit } from "../core/events.js";
import { state } from "./state.js";

// ===== 鎖定狀態 =====
// 每個 Stage 用 registerLock 登記「依目前狀態決定自己哪些欄位要鎖」的函式；
// 任何狀態旗標變動後呼叫 refreshLockStates() 統一重新套用，不要在各個事件
// 處理常式裡零散地直接改 disabled，避免漏改、狀態兜不攏。

const lockAppliers = [];

export function registerLock(fn) {
  lockAppliers.push(fn);
}

export function refreshLockStates() {
  lockAppliers.forEach((fn) => fn(state));
}

// ===== 處理中／背景工作 =====
// 桌面殼在真的有工作進行中時，請系統別把 App 睡掉、也別把 WebView 背後的
// Web Content process 標成「不活躍」而優先砍掉回收記憶體——工作被打斷的
// 代價是已經付費的 LLM 呼叫全部作廢。只在「有沒有工作」真的變化時才通知殼。

const backgroundTasks = new Set();
let guardActive = false;

function updateActivityGuard() {
  const want = state.busy || backgroundTasks.size > 0;
  if (want === guardActive) return;
  guardActive = want;
  if (DESKTOP_MODE) {
    postToShell("activityGuard", { action: want ? "start" : "stop" });
  }
}

export function setBusy(value) {
  state.busy = value;
  updateActivityGuard();
  refreshLockStates();
}

// 不鎖畫面、但要防止系統睡眠的背景工作（Stage 2 的分析報告）
export function setBackgroundTask(name, running) {
  const changed = backgroundTasks.has(name) !== running;
  if (running) {
    backgroundTasks.add(name);
  } else {
    backgroundTasks.delete(name);
  }
  updateActivityGuard();
  // 背景工作也算「有工作在進行」，會影響劇本案能不能換（見 isWorkInProgress）
  if (changed) refreshLockStates();
}

// 還有沒有工作在進行：某個 Stage 正在跑（含直接上傳中）、背景還有分析報告
// 在跑，或這次流程還有排定要接續的 Stage（Stage 之間交接的空檔也算）。
// 劇本案的選擇用這個判斷要不要鎖住——跑到一半換劇本案，後面接續的 Stage
// 會用新的劇本案送出，用量就記錯案子了。
export function isWorkInProgress() {
  return state.busy || backgroundTasks.size > 0 || currentRun !== null;
}

// ===== 這次的流程（流程進度條） =====
// 每個 Stage 的狀態：idle（還沒開始任何工作）、planned（等等會執行）、
// running（正在執行）、skipped（這次不會執行）、done（已完成）、
// failed（失敗或中斷）。

const stageStatus = { 1: "idle", 2: "idle", 3: "idle" };
let currentRun = null; // { origin, stage1Model, stage1Docx }

export function getStageStatus(stage) {
  return stageStatus[stage];
}

// 目前正在執行的 Stage（沒有就是 0）。給各 Stage 的鎖定規則用：前面的
// Stage 在跑的時候，後面 Stage 的設定還可以改（等等自動接續時會用到），
// 只有「開始」類的按鈕要等到不忙了才能按。
export function getRunningStage() {
  for (let stage = 1; stage <= 3; stage++) {
    if (stageStatus[stage] === "running") return stage;
  }
  return 0;
}

export function getCurrentRun() {
  return currentRun;
}

// 這次流程是從 Stage 1 開始、而且會跑到（或正在跑）這個 Stage：它的 LLM
// 一律沿用 Stage 1 選的 model（Stage 2 的分析報告、Stage 3 校對都是），
// 自己的 model 選單這次用不到。
export function usesStage1Model(stage) {
  const status = stageStatus[stage];
  return !!currentRun && currentRun.origin === 1 && (status === "planned" || status === "running");
}

function setStatus(stage, status) {
  if (stageStatus[stage] === status) return;
  stageStatus[stage] = status;
  emit("workflow:status", { stage, status, run: currentRun });
  // 「哪個 Stage 正在跑」會影響其他 Stage 的鎖定（見 getRunningStage）
  refreshLockStates();
}

// 依目前畫面上的接續設定，算出從 origin 開始這次會跑哪些 Stage
function planFrom(origin) {
  const chain1 = byId("stage1-chain-select").value;
  const chain2 = byId("pattern-chain-toggle").checked;
  const plan = [origin];
  if (origin === 1) {
    if (chain1 === "stage2") {
      plan.push(2);
      if (chain2) plan.push(3);
    } else if (chain1 === "stage3") {
      plan.push(3);
    }
  } else if (origin === 2 && chain2) {
    plan.push(3);
  }
  return plan;
}

// 開始一次新的流程。keepEarlier：來源是前一個 Stage 剛做完的結果（使用者
// 按「下一步」）時為 true，前面那些 Stage 保留原本的「已完成」；直接上傳
// 檔案開始時為 false，前面的 Stage 這次都不算數。
export function startRun(origin, extra, keepEarlier) {
  currentRun = Object.assign({ origin }, extra || {});
  const plan = planFrom(origin);
  for (let stage = 1; stage <= 3; stage++) {
    if (stage < origin) {
      if (!(keepEarlier && stageStatus[stage] === "done")) setStatus(stage, "skipped");
    } else if (stage === origin) {
      setStatus(stage, "running");
    } else {
      setStatus(stage, plan.indexOf(stage) >= 0 ? "planned" : "skipped");
    }
  }
  // setStatus 只有在狀態真的變了才會重新套用鎖定；流程換了一輪，鎖定規則
  // 看的 currentRun 也換了，這裡一定要再套一次
  refreshLockStates();
}

// 串接到下一個 Stage 時呼叫（由 chain.js）
export function advanceRun(stage) {
  setStatus(stage, "running");
}

export function finishStage(stage, ok) {
  setStatus(stage, ok ? "done" : "failed");
  if (!ok) {
    // 失敗或中斷：後面原本排好的 Stage 這次都不會跑了
    for (let later = stage + 1; later <= 3; later++) {
      if (stageStatus[later] === "planned") setStatus(later, "skipped");
    }
  }
  if (!ok || !hasPlannedAfter(stage)) currentRun = null;
  // currentRun 是在上面 setStatus 之後才清掉的，劇本案的鎖定（看
  // isWorkInProgress）要等這裡再套一次才會解開
  refreshLockStates();
}

function hasPlannedAfter(stage) {
  for (let later = stage + 1; later <= 3; later++) {
    if (stageStatus[later] === "planned") return true;
  }
  return false;
}

// 流程跑到一半時使用者改了接續設定：還沒開始的 Stage 跟著更新
function refreshPlan() {
  if (!currentRun) return;
  const plan = planFrom(currentRun.origin);
  for (let stage = currentRun.origin + 1; stage <= 3; stage++) {
    const status = stageStatus[stage];
    if (status === "planned" || status === "skipped") {
      setStatus(stage, plan.indexOf(stage) >= 0 ? "planned" : "skipped");
    }
  }
}

// 登出時遞增。還在半路上的非同步流程（最長的是 Stage 1 的本機 OCR，可能
// 跑好幾分鐘）回來時比對一下，epoch 變了就整個放棄：上一個登入狀態的結果
// 不能寫進現在的畫面、不能用現在（可能是另一個帳號）的登入送出去，也不能
// 把現在的「處理中」解除掉（known-issue-check 第 2 條）
let runEpoch = 0;

export function getRunEpoch() {
  return runEpoch;
}

// 登出、或換了另一個劇本案時呼叫：所有狀態歸零，半路上的流程一併作廢
export function resetRun() {
  runEpoch++;
  currentRun = null;
  for (let stage = 1; stage <= 3; stage++) setStatus(stage, "idle");
  refreshLockStates();
}

// ===== 睡眠前自動搶救 =====
// 桌面殼（Mac）在系統即將睡眠前呼叫這個函式，嘗試把使用者還沒下載的結果
// 先存到本機。best-effort：睡眠通知沒辦法真的延後睡眠，來不來得及跑完沒有
// 保證（完整說明見 zh-cn-to-tw-mac README）。最後面的 Stage 結果最完整，
// 優先搶救那一份。
function attemptAutoSaveBeforeSleep() {
  if (state.hasDownloaded) return;
  const candidates = ["review-download-btn", "pattern-download-btn", "download-btn"];
  for (const id of candidates) {
    const btn = byId(id);
    if (!btn.disabled) {
      btn.click();
      return;
    }
  }
}

export function initWorkflow() {
  byId("stage1-chain-select").addEventListener("change", refreshPlan);
  byId("pattern-chain-toggle").addEventListener("change", refreshPlan);
  exposeToShell("__attemptAutoSaveBeforeSleep", attemptAutoSaveBeforeSleep);
}
