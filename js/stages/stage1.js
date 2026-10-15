// Stage 1：簡轉繁。PDF 在本機 OCR（js/stages/ocr.js），文字送到後端做
// OpenCC 簡轉繁與（選配的）LLM 前置處理／潤飾，前端輪詢進度。

import { API_BASE, DESKTOP_MODE, DESKTOP_OS_TIER, PERSONAL_PROJECT_ERROR_MESSAGES } from "../core/config.js";
import { authedFetch, errorFromResponse, isReauthInFlight } from "../core/api.js";
import { byId, createLogRenderer, setDisabled, validateBoundedInput } from "../core/dom.js";
import { downloadViaAuthedFetch } from "../core/download.js";
import { emit, on } from "../core/events.js";
import { showInterruptedDialog } from "../core/modal.js";
import { showToast } from "../core/toast.js";
import { checkVersionOrBlock } from "../core/version.js";
import { createModelPicker, fetchStage1Opts } from "../app/options.js";
import { setStageDetail } from "../app/stage-card.js";
import { state } from "../app/state.js";
import { refreshUsageAfterStage } from "../app/usage.js";
import {
  finishStage,
  getRunEpoch,
  getRunningStage,
  refreshLockStates,
  registerLock,
  setBusy,
  startRun,
} from "../app/workflow.js";
import { runLocalOcr } from "./ocr.js";

const formGroup = byId("stage1-form-group");
const fileInput = byId("file-input");
const submitBtn = byId("submit-btn");
const statusBox = byId("status-box");
const statusText = byId("status-text");
const logList = byId("log-list");
const downloadBtn = byId("download-btn");
const toStage2Btn = byId("to-stage2-btn");
const toStage3Btn = byId("to-stage3-btn");
const docxToggle = byId("docx-toggle");
const chainSelect = byId("stage1-chain-select");
const detectCoverToggle = byId("detect-cover-toggle");
const splitLeftRightToggle = byId("split-left-right-toggle");
const preprocessToggle = byId("preprocess-toggle");
const llmRefineToggle = byId("llm-refine-toggle");
const modelSelect = byId("model-select");
const modelField = byId("model-field");
const batchSelect = byId("batch-select");
const batchHelp = byId("batch-help");
const batchField = byId("batch-field");
const retryInput = byId("retry-input");
const retryHelp = byId("retry-help");
const retryField = byId("retry-field");
const dpiInput = byId("dpi-input");
const dpiHelp = byId("dpi-help");
const ocrThresholdSelect = byId("ocr-threshold-select");
const patternChainToggle = byId("pattern-chain-toggle");
const patternAnalysisToggle = byId("pattern-analysis-toggle");

const modelPicker = createModelPicker(modelSelect, byId("model-help"));

// 這兩支 log 來源（後端 job.logs、本機 OCR 服務的 logs）各自計數：本機 OCR
// 那邊如果摻進同一個計數，會讓後端接手後自己的 log 少畫幾筆。
const backendLogs = createLogRenderer(logList);
const localOcrLogs = createLogRenderer(logList);

let resultJobId = null;
let pollTimer = null;
// pollJob() 每次被呼叫都代表新的一輪輪詢，這個計數器就是那一輪的代號。
// tick() 是 async，await 那段完全可能拖到「這一輪」早就被換掉之後才
// resolve——這種姍姍來遲的舊 callback 不能再去動任何畫面狀態，不然會把
// 新一輪已經正確的畫面蓋掉（known-issue-check 第 2 條）。
let pollGeneration = 0;

export function getResultJobId() {
  return resultJobId;
}

export function getSelectedModel() {
  return modelSelect.value;
}

export function wantsDocx() {
  return docxToggle.checked;
}

export async function loadStage1Options() {
  const opts = await fetchStage1Opts();
  modelPicker.render(opts, state.isPersonalProject);

  batchSelect.value = String(opts.batch_pages.default);
  batchHelp.textContent = opts.batch_pages.description;

  retryInput.min = opts.max_retry.min;
  retryInput.max = opts.max_retry.max;
  retryInput.value = opts.max_retry.default;
  retryHelp.textContent = opts.max_retry.description;

  dpiInput.min = opts.dpi.min;
  dpiInput.max = opts.dpi.max;
  dpiInput.value = opts.dpi.default;
  dpiHelp.textContent = opts.dpi.description;
}

// 批次頁數 / API 失敗重試次數，只有這次真的會呼叫 LLM 才有意義：「進行
// 前置處理」與「進行LLM潤飾」兩個都關，Stage 1 就全程只做 OpenCC 簡轉繁。
//
// Model 欄位再多一層：即使上面兩個都關掉，只要這次接下去的 Stage 會用到
// LLM——Stage 2 的分析報告（有開的話）、Stage 3 校對——它們都會沿用這裡選的
// model（見 js/app/chain.js），所以 Model 要「不呼叫 LLM」而且「後面也沒有
// Stage 會用到」才真的沒有作用。
//
// 這個鎖定跟整組的鎖定（跑中/未選案）是疊加關係，不是互斥——整組已經鎖住
// 時，這裡不需要、也不會把它解開。
function updateLlmDependentLock() {
  const noLlmCall = !llmRefineToggle.checked && !preprocessToggle.checked;
  const laterStageUsesModel =
    chainSelect.value === "stage3" ||
    (chainSelect.value === "stage2" && (patternAnalysisToggle.checked || patternChainToggle.checked));
  const baseLocked = formGroup.classList.contains("locked");

  const modelLocked = noLlmCall && !laterStageUsesModel;
  modelField.classList.toggle("locked", modelLocked);
  modelSelect.disabled = baseLocked || modelLocked;

  [batchField, retryField].forEach((el) => el.classList.toggle("locked", noLlmCall));
  [batchSelect, retryInput].forEach((el) => {
    el.disabled = baseLocked || noLlmCall;
  });
}

// 「一次只做一件事」：有任何 Stage 在跑時整組鎖住。唯一的例外是「完成後
// 接續」——Stage 1 自己在跑的時候還可以改（使用者跑到一半才決定要不要
// 接下去，這個設定只影響之後的事）。
function applyLock(s) {
  const locked = s.busy || !s.projectConfirmed;
  formGroup.classList.toggle("locked", locked);
  setDisabled(
    [
      fileInput,
      dpiInput,
      ocrThresholdSelect,
      detectCoverToggle,
      splitLeftRightToggle,
      preprocessToggle,
      llmRefineToggle,
      docxToggle,
      submitBtn,
    ],
    locked
  );
  chainSelect.disabled = !s.projectConfirmed || (s.busy && getRunningStage() !== 1);
  updateLlmDependentLock();
  const hasResult = !!resultJobId;
  toStage2Btn.disabled = locked || !hasResult;
  toStage3Btn.disabled = locked || !hasResult;
}

function clearResult() {
  clearInterval(pollTimer);
  pollGeneration++;
  resultJobId = null;
  statusBox.hidden = true;
  backendLogs.reset();
  localOcrLogs.reset();
  downloadBtn.disabled = true;
  toStage2Btn.disabled = true;
  toStage3Btn.disabled = true;
  setStageDetail(1, "");
}

function pollJob(jobId) {
  const myGeneration = ++pollGeneration;
  const tick = async () => {
    // 已經有一次重新登入在等使用者完成，這一輪先跳過，不要一直打注定又是
    // 401 的請求（見 js/core/api.js）
    if (isReauthInFlight()) return;
    let res;
    let job;
    try {
      res = await authedFetch(`${API_BASE}/api/jobs/${jobId}`);
      job = await res.json();
    } catch (e) {
      return; // 網路暫時性錯誤，下一輪再試，不要整個停掉
    }
    if (myGeneration !== pollGeneration) return;

    if (!res.ok) {
      // job 查不到了，不能繼續假裝在跑，要停下來明確告訴使用者
      clearInterval(pollTimer);
      statusText.textContent = `錯誤：${job.error || "找不到這個處理進度，可能是伺服器重啟過，請重新上傳"}`;
      setBusy(false);
      finishStage(1, false);
      return;
    }

    statusText.textContent = job.status_label || job.status;
    backendLogs.render(job.logs);

    if (job.status === "done") {
      clearInterval(pollTimer);
      resultJobId = job.has_result ? jobId : null;
      downloadBtn.disabled = !job.has_result;
      setStageDetail(1, job.has_result ? "可以下載" : "");
      setBusy(false);
      refreshUsageAfterStage();
      finishStage(1, !!job.has_result);
      if (job.has_result) emit("stage1:done", { jobId });
    } else if (job.status === "failed") {
      clearInterval(pollTimer);
      setBusy(false);
      // 失敗前很可能已經燒掉一些 token，這也算 Stage 結束，要更新用量
      refreshUsageAfterStage();
      finishStage(1, false);
    } else if (job.status === "interrupted") {
      clearInterval(pollTimer);
      setBusy(false);
      refreshUsageAfterStage();
      finishStage(1, false);
      showInterruptedDialog({
        hasPartial: job.has_partial,
        // 下載中斷前的進度：後端要先 finalize（把 partial_text 收成正式結果）
        // 才有東西可以下載，接著直接觸發下載，不用使用者再按一次
        onDownload: async () => {
          try {
            const r = await authedFetch(`${API_BASE}/api/jobs/${jobId}/finalize`, { method: "POST" });
            if (!r.ok) throw await errorFromResponse(r, "結束失敗");
            resultJobId = jobId;
            downloadBtn.disabled = false;
            refreshLockStates();
            statusText.textContent = "已結束（保留中斷前完成的部分）";
            setStageDetail(1, "保留中斷前的部分");
            await downloadResult();
            showToast("已下載中斷前完成的部分", "success");
          } catch (e) {
            showToast(e.message, "error");
          }
        },
      });
    }
  };
  // 先排好 interval 再手動觸發第一次（理由同 js/stages/ocr.js 的 pollLocalOcrJob）
  pollTimer = setInterval(tick, 5000);
  tick();
}

async function downloadResult() {
  if (!resultJobId) return;
  const format = docxToggle.checked ? "docx" : "txt";
  await downloadViaAuthedFetch(`${API_BASE}/api/jobs/${resultJobId}/download?format=${format}`, `download.${format}`);
  state.hasDownloaded = true;
}

async function submit() {
  // 半路上登出的話，這次的流程整個作廢（見 workflow.js 的 getRunEpoch）
  const epoch = getRunEpoch();
  const stale = () => epoch !== getRunEpoch();
  if (!(await checkVersionOrBlock()) || stale()) return;

  const file = fileInput.files[0];
  if (!file) {
    alert("請先選擇 PDF 檔案");
    return;
  }
  const retryError = validateBoundedInput(retryInput, "API 失敗重試次數");
  if (retryError) {
    alert(retryError);
    return;
  }
  const dpiError = validateBoundedInput(dpiInput, "PDF 轉圖片解析度（DPI）");
  if (dpiError) {
    alert(dpiError);
    return;
  }
  // OCR 一律在使用者本機做，backend 已經沒有接收 PDF 的路徑。
  if (!DESKTOP_MODE) {
    showToast("Stage 1 需要使用桌面版 App（OCR 在本機執行）", "error");
    return;
  }

  // 新的一份檔案：後面 Stage 的結果都是上一份的，一起清掉
  emit("pipeline:clear", { stages: [2, 3] });
  clearResult();
  state.hasDownloaded = false;
  setBusy(true);
  startRun(1, { stage1Model: modelSelect.value }, false);
  statusBox.hidden = false;
  statusText.textContent = "上傳中";

  try {
    const pages = await runLocalOcr(
      file,
      {
        dpi: Number(dpiInput.value),
        detectCover: detectCoverToggle.checked,
        splitLeftRight: splitLeftRightToggle.checked,
        boxThresh: ocrThresholdSelect.value,
        useVision: DESKTOP_OS_TIER === "10.15",
      },
      {
        onStatus: (text) => {
          if (!stale()) statusText.textContent = text;
        },
        onLogs: (logs) => {
          if (!stale()) localOcrLogs.render(logs);
        },
      }
    );
    // OCR 可能跑了好幾分鐘，期間登出（甚至換了帳號登入）的話，結果不能
    // 用現在的登入送出去
    if (stale()) return;

    statusText.textContent = "上傳中";
    const res = await authedFetch(`${API_BASE}/api/jobs/from-ocr-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pages,
        model: modelSelect.value,
        batch_pages: batchSelect.value,
        max_retry: retryInput.value,
        enable_preprocess: preprocessToggle.checked,
        enable_llm_refine: llmRefineToggle.checked,
        file_name: file.name,
        project: state.currentProjectId,
      }),
    });
    if (!res.ok) throw await errorFromResponse(res, "上傳失敗");
    const data = await res.json();
    if (stale()) return;
    pollJob(data.job_id);
  } catch (e) {
    if (stale()) return;
    if (PERSONAL_PROJECT_ERROR_MESSAGES.has(e.message)) {
      showToast(e.message, "error");
      statusBox.hidden = true;
    } else {
      statusText.textContent = `錯誤：${e.message}`;
    }
    setBusy(false);
    finishStage(1, false);
  }
}

export function initStage1() {
  registerLock(applyLock);
  [preprocessToggle, llmRefineToggle, chainSelect, patternChainToggle, patternAnalysisToggle].forEach((el) =>
    el.addEventListener("change", updateLlmDependentLock)
  );

  submitBtn.addEventListener("click", submit);
  downloadBtn.addEventListener("click", async () => {
    try {
      await downloadResult();
    } catch (e) {
      showToast(e.message, "error");
    }
  });
  toStage2Btn.addEventListener("click", () => {
    if (resultJobId) emit("stage1:next", { stage: 2, jobId: resultJobId });
  });
  toStage3Btn.addEventListener("click", () => {
    if (resultJobId) emit("stage1:next", { stage: 3, jobId: resultJobId });
  });

  on("project:changed", (s) => modelPicker.rerender(s.isPersonalProject));
  on("pipeline:clear", (payload) => {
    if (payload.stages.indexOf(1) >= 0) clearResult();
  });
  on("auth:signed-out", clearResult);
}
