// Stage 3：校對（1.x 的 Stage 2）。把文字分批交給 LLM 挑出錯字／用詞問題，
// 使用者勾選要套用的建議、下載，或用套用後的文字再校對一輪。

import { API_BASE, PERSONAL_PROJECT_ERROR_MESSAGES } from "../core/config.js";
import { authedFetch, errorFromResponse, isReauthInFlight } from "../core/api.js";
import { byId, createLogRenderer, escapeHtml, setDisabled, validateBoundedInput } from "../core/dom.js";
import { downloadViaAuthedFetch } from "../core/download.js";
import { emit, on } from "../core/events.js";
import { showInterruptedDialog } from "../core/modal.js";
import { showToast } from "../core/toast.js";
import { checkVersionOrBlock } from "../core/version.js";
import { createModelPicker, fetchReviewOpts } from "../app/options.js";
import { setStageDetail } from "../app/stage-card.js";
import { state } from "../app/state.js";
import { refreshUsageAfterStage } from "../app/usage.js";
import {
  advanceRun,
  finishStage,
  getCurrentRun,
  getRunEpoch,
  getRunningStage,
  registerLock,
  setBusy,
  startRun,
  usesStage1Model,
} from "../app/workflow.js";

const uploadField = byId("direct-upload-field");
const uploadInput = byId("direct-upload-input");
const uploadBtn = byId("direct-upload-btn");
const sourceLine = byId("stage3-source-line");
const formGroup = byId("stage3-form-group");
const preprocessToggle = byId("review-preprocess-toggle");
const modelSelect = byId("review-model-select");
const modelFollowNote = byId("review-model-follow");
const batchSelect = byId("review-batch-select");
const batchHelp = byId("review-batch-help");
const retryInput = byId("review-retry-input");
const retryHelp = byId("review-retry-help");
const docxToggle = byId("review-docx-toggle");
const runBtn = byId("review-run-btn");
const progressBox = byId("review-progress");
const statusText = byId("review-status-text");
const logList = byId("review-log-list");
const findingsSection = byId("review-findings-section");
const findingsList = byId("findings-list");
const findingsScrollHint = byId("findings-scroll-hint");
const findingsCount = byId("findings-count");
const selectAllBtn = byId("select-all-btn");
const selectNoneBtn = byId("select-none-btn");
const applyBtn = byId("apply-btn");
const downloadBtn = byId("review-download-btn");
const rerunBtn = byId("rerun-btn");

const modelPicker = createModelPicker(modelSelect, byId("review-model-help"));
const logs = createLogRenderer(logList);

let source = null; // { jobId, label, from: "stage1" | "stage2" | "upload" }
let reviewId = null;
let canRerun = false;
let pollTimer = null;
// 跟 Stage 1 的 pollGeneration 同一個道理（known-issue-check 第 2 條）。這正是
// 實測抓到的案例：校對因為 backend 剛好在 deploy 被中斷，使用者按重試後，
// 勾選的建議項目在幾秒後莫名其妙被取消掉。
let pollGeneration = 0;

export async function loadStage3Options() {
  const opts = await fetchReviewOpts();
  modelPicker.render(opts, state.isPersonalProject);

  batchSelect.value = String(opts.batch_chars.default);
  batchHelp.textContent = opts.batch_chars.description;

  retryInput.min = opts.max_retry.min;
  retryInput.max = opts.max_retry.max;
  retryInput.value = opts.max_retry.default;
  retryHelp.textContent = opts.max_retry.description;
}

function setSource(jobId, label, from) {
  source = { jobId, label, from };
  sourceLine.textContent = `目前的來源：${label}`;
  sourceLine.hidden = false;
  applyLock(state);
}

function resetReviewUI() {
  progressBox.hidden = false;
  logs.reset();
  statusText.textContent = "上傳中";
  findingsSection.hidden = true;
  findingsList.innerHTML = "";
  downloadBtn.disabled = true;
  canRerun = false;
  rerunBtn.disabled = true;
}

// 換檔案時（前面的 Stage 重新跑、或直接上傳）要一併清掉：不然這些畫面跟
// 按鍵會一直指向舊檔案的 review_id，讓人誤以為是這次剛上傳的檔案的結果
function clearResult() {
  reviewId = null;
  clearInterval(pollTimer);
  // 還在路上的輪詢回應要作廢，不然它晚到時會把舊檔案的結果畫回來
  pollGeneration++;
  progressBox.hidden = true;
  logs.reset();
  findingsSection.hidden = true;
  findingsList.innerHTML = "";
  downloadBtn.disabled = true;
  canRerun = false;
  rerunBtn.disabled = true;
  setStageDetail(3, "");
}

function clearAll() {
  clearResult();
  source = null;
  sourceLine.hidden = true;
  sourceLine.textContent = "";
}

function renderFindings(findings) {
  findingsSection.hidden = false;
  findingsList.innerHTML = "";
  findingsCount.textContent = `共找到 ${findings.length} 筆建議（預設全不選，勾選代表套用）`;

  findings.forEach((finding) => {
    const li = document.createElement("li");
    li.className = "finding-item";
    li.innerHTML = `
      <label class="finding-checkbox-row">
        <input type="checkbox" class="finding-checkbox" data-id="${escapeHtml(String(finding.id))}" />
        <span class="finding-diff">
          <span class="finding-original">${escapeHtml(finding.original)}</span>
          →
          <span class="finding-suggested">${escapeHtml(finding.suggested)}</span>
        </span>
      </label>
      <p class="finding-context">上下文：${escapeHtml(finding.context)}</p>
      <p class="finding-reason">原因：${escapeHtml(finding.reason)}</p>
    `;
    findingsList.appendChild(li);
  });

  // 清單在隱藏期間被清空時，瀏覽器不會把卷軸位置歸零，重新顯示後會沿用
  // 上一輪的位置。要等清單已經顯示、內容也填好之後再歸零才有效。
  findingsList.scrollTop = 0;
  updateScrollHint();
}

function updateScrollHint() {
  const hasMoreBelow = findingsList.scrollHeight - findingsList.scrollTop - findingsList.clientHeight > 8;
  findingsScrollHint.hidden = !hasMoreBelow;
}

async function downloadResult() {
  if (!reviewId) return;
  const format = docxToggle.checked ? "docx" : "txt";
  await downloadViaAuthedFetch(`${API_BASE}/api/reviews/${reviewId}/download?format=${format}`, `download.${format}`);
  state.hasDownloaded = true;
}

function pollReview(id) {
  const myGeneration = ++pollGeneration;
  const tick = async () => {
    if (isReauthInFlight()) return;
    let res;
    let review;
    try {
      res = await authedFetch(`${API_BASE}/api/reviews/${id}`);
      review = await res.json();
    } catch (e) {
      return;
    }
    if (myGeneration !== pollGeneration) return;

    if (!res.ok) {
      clearInterval(pollTimer);
      statusText.textContent = `錯誤：${review.error || "找不到這個處理進度，可能是伺服器重啟過，請重新開始校對"}`;
      setBusy(false);
      finishStage(3, false);
      return;
    }

    statusText.textContent = review.status_label || review.status;
    logs.render(review.logs);

    if (review.status === "done") {
      clearInterval(pollTimer);
      renderFindings(review.findings);
      // 校對一旦完成就能下載，不管有沒有套用任何建議——不套用就是下載
      // 校對前的原始文字，不應該綁在「有沒有按過套用」上
      downloadBtn.disabled = false;
      setStageDetail(3, `${review.findings.length} 筆建議`);
      setBusy(false);
      refreshUsageAfterStage();
      finishStage(3, true);
    } else if (review.status === "failed") {
      clearInterval(pollTimer);
      setBusy(false);
      refreshUsageAfterStage();
      finishStage(3, false);
    } else if (review.status === "interrupted") {
      clearInterval(pollTimer);
      setBusy(false);
      refreshUsageAfterStage();
      finishStage(3, false);
      showInterruptedDialog({
        hasPartial: review.has_partial,
        onDownload: async () => {
          try {
            const r = await authedFetch(`${API_BASE}/api/reviews/${id}/finalize`, { method: "POST" });
            if (!r.ok) throw await errorFromResponse(r, "結束失敗");
            const refreshed = await (await authedFetch(`${API_BASE}/api/reviews/${id}`)).json();
            renderFindings(refreshed.findings);
            downloadBtn.disabled = false;
            statusText.textContent = "已結束（保留中斷前完成的部分）";
            setStageDetail(3, "保留中斷前的部分");
            // 這裡下載的是「還沒套用任何建議」的文字——中斷發生在校對途中，
            // 使用者根本還沒機會勾選；已經算出來的建議仍然列在畫面上，套用
            // 後可以再下載一次
            await downloadResult();
            showToast("已下載中斷前的進度，已完成的建議仍可勾選套用", "success");
          } catch (e) {
            showToast(e.message, "error");
          }
        },
      });
    }
  };
  pollTimer = setInterval(tick, 5000);
  tick();
}

// mode："start"（使用者按開始）、"chain"（前一個 Stage 自動串接）、"rerun"
// （用套用後的文字再校對一輪）
async function runReview(mode) {
  const isRerun = mode === "rerun";
  if (isRerun ? !reviewId : !source) return;
  // 半路上登出的話，這次的流程整個作廢（見 workflow.js 的 getRunEpoch）
  const epoch = getRunEpoch();
  const stale = () => epoch !== getRunEpoch();
  if (!(await checkVersionOrBlock())) {
    if (mode === "chain" && !stale()) finishStage(3, false);
    return;
  }
  if (stale()) return;
  const retryError = validateBoundedInput(retryInput, "API 失敗重試次數");
  if (retryError) {
    alert(retryError);
    if (mode === "chain") finishStage(3, false);
    return;
  }

  const formData = new FormData();
  formData.append("model", modelSelect.value);
  formData.append("batch_chars", batchSelect.value);
  formData.append("max_retry", retryInput.value);
  formData.append("project", state.currentProjectId);
  // 重新校對刻意不帶 enable_preprocess：要校對的是「已經前置處理過、又套用
  // 完勾選建議」的文字，同一份東西不需要再整理一次（後端也會強制關閉）
  if (!isRerun) {
    formData.append("enable_preprocess", preprocessToggle.checked ? "true" : "false");
    // 2.0 的半形轉全形歸 Stage 2 管，前置處理只整理引號；沒帶這個參數的
    // 1.x 前端，後端維持原本會轉全形的行為
    formData.append("skip_fullwidth_punct", "true");
  }
  const url = isRerun
    ? `${API_BASE}/api/reviews/${reviewId}/rerun`
    : `${API_BASE}/api/jobs/${source.jobId}/review`;

  state.hasDownloaded = false;
  setBusy(true);
  if (mode === "chain") {
    advanceRun(3);
  } else {
    startRun(3, {}, isRerun || (source && source.from !== "upload"));
  }
  resetReviewUI();

  try {
    const res = await authedFetch(url, { method: "POST", body: formData });
    if (!res.ok) throw await errorFromResponse(res, isRerun ? "重新校對失敗" : "開始校對失敗");
    const data = await res.json();
    if (stale()) return;
    reviewId = data.review_id;
    pollReview(reviewId);
  } catch (e) {
    if (stale()) return;
    if (PERSONAL_PROJECT_ERROR_MESSAGES.has(e.message)) {
      showToast(e.message, "error");
      progressBox.hidden = true;
    } else {
      statusText.textContent = `錯誤：${e.message}`;
    }
    setBusy(false);
    finishStage(3, false);
  }
}

// 設定欄位：前面的 Stage 在跑的時候還可以改（等等自動接續時會用到），
// Stage 3 自己在跑就鎖住。「開始」類的按鈕一律要等到不忙了才能按。
function applyLock(s) {
  const running = getRunningStage();
  const settingsLocked = !s.projectConfirmed || (s.busy && running !== 1 && running !== 2);
  formGroup.classList.toggle("locked", settingsLocked);
  setDisabled([preprocessToggle, modelSelect, batchSelect, retryInput, docxToggle], settingsLocked);
  // 這次流程從 Stage 1 一路接過來：校對沿用 Stage 1 的 model（1.x「直接進行
  // 校對」的既有規則），選單直接顯示那個 model 並鎖住，跟 Stage 2 一致
  const followsStage1 = usesStage1Model(3);
  if (followsStage1) modelPicker.trySelect(getCurrentRun().stage1Model);
  modelSelect.disabled = settingsLocked || followsStage1;
  modelFollowNote.hidden = !followsStage1;

  const actionLocked = s.busy || !s.projectConfirmed;
  runBtn.disabled = actionLocked || !source;
  uploadField.classList.toggle("locked", actionLocked);
  uploadInput.disabled = actionLocked;
  uploadBtn.disabled = actionLocked;
  rerunBtn.disabled = actionLocked || !canRerun;
  applyBtn.disabled = actionLocked;
}

async function directUpload() {
  const file = uploadInput.files[0];
  if (!file) {
    alert("請先選擇 .docx 或 .txt 檔案");
    return;
  }
  const nameLower = file.name.toLowerCase();
  if (!nameLower.endsWith(".docx") && !nameLower.endsWith(".txt")) {
    alert("只接受 .docx 或 .txt 檔案");
    return;
  }
  // 上傳期間當成「處理中」：其他 Stage 的「開始」都先鎖住。不然在上傳的
  // 這一兩秒內按了別的 Stage 開始，上傳完成時的 pipeline:clear 會把那個
  // 剛開始的工作清掉，畫面卡在「執行中」（known-issue-check 第 2 條）
  setBusy(true);
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await authedFetch(`${API_BASE}/api/jobs/direct-upload`, { method: "POST", body: formData });
    if (!res.ok) throw await errorFromResponse(res, "上傳失敗");
    const data = await res.json();
    // 上傳成功才清：失敗的話畫面上的舊結果仍然對得上，不該清掉
    emit("pipeline:clear", { stages: [1, 2] });
    clearAll();
    setSource(data.job_id, `上傳的檔案「${file.name}」`, "upload");
    showToast("已上傳，可以開始校對", "success");
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
}

// ===== 對外介面（給 js/app/chain.js） =====

// 使用者按前一個 Stage 的「下一步」：只設定來源，等使用者自己按開始
export function acceptSource(jobId, label, from) {
  clearAll();
  setSource(jobId, label, from);
}

// 前一個 Stage 完成後自動串接：沿用指定的 model 與輸出格式，直接開始
export function startFromUpstream(jobId, label, from, options) {
  clearAll();
  setSource(jobId, label, from);
  if (options.model) modelPicker.trySelect(options.model);
  docxToggle.checked = !!options.docx;
  runReview("chain");
}

export function initStage3() {
  registerLock(applyLock);

  uploadBtn.addEventListener("click", directUpload);
  runBtn.addEventListener("click", () => runReview("start"));
  rerunBtn.addEventListener("click", () => runReview("rerun"));

  findingsList.addEventListener("scroll", updateScrollHint);
  window.addEventListener("resize", updateScrollHint);
  selectAllBtn.addEventListener("click", () => {
    findingsList.querySelectorAll(".finding-checkbox").forEach((cb) => {
      cb.checked = true;
    });
  });
  selectNoneBtn.addEventListener("click", () => {
    findingsList.querySelectorAll(".finding-checkbox").forEach((cb) => {
      cb.checked = false;
    });
  });

  applyBtn.addEventListener("click", async () => {
    if (!reviewId) return;
    const selectedIds = Array.prototype.filter
      .call(findingsList.querySelectorAll(".finding-checkbox"), (cb) => cb.checked)
      .map((cb) => Number(cb.dataset.id));
    const myReviewId = reviewId;
    applyBtn.disabled = true;
    try {
      const res = await authedFetch(`${API_BASE}/api/reviews/${reviewId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_ids: selectedIds }),
      });
      if (!res.ok) throw await errorFromResponse(res, "套用失敗");
      if (myReviewId !== reviewId) return; // 期間換了檔案或登出，結果已經不是畫面上這份
      downloadBtn.disabled = false;
      canRerun = true;
      alert(`已套用 ${selectedIds.length} 筆修改，可以下載或重新校對了`);
    } catch (e) {
      alert(e.message);
    } finally {
      applyLock(state);
    }
  });

  downloadBtn.addEventListener("click", async () => {
    try {
      await downloadResult();
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  on("project:changed", (s) => modelPicker.rerender(s.isPersonalProject));
  on("pipeline:clear", (payload) => {
    if (payload.stages.indexOf(3) >= 0) clearAll();
  });
  on("auth:signed-out", clearAll);
}
