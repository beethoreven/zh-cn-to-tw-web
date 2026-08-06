const API_BASE = "https://zh-cn-to-tw-backend.onrender.com";

// Render 免費方案閒置約 15 分鐘會休眠。GitHub Actions 的排程 keep-alive
// 無法保證真的每 10 分鐘執行(GitHub 自己的 schedule 觸發時間常常延遲數小時),
// 所以只要這個分頁還開著,就自己每 5 分鐘打一次 /api/health,確保使用中途
// 不會被 Render 判定閒置——不需要登入,/api/health 本來就是為了這個用途設計的公開端點。
// 一開始就先打一次(不等第一個 5 分鐘),盡量提早把可能還在睡的後端叫醒。
function pingKeepAlive() {
  fetch(`${API_BASE}/api/health`).catch(() => {});
}
pingKeepAlive();
setInterval(pingKeepAlive, 5 * 60 * 1000);

const fileInput = document.getElementById("file-input");
const submitBtn = document.getElementById("submit-btn");
const statusBox = document.getElementById("status-box");
const statusText = document.getElementById("status-text");
const logList = document.getElementById("log-list");
const downloadBtn = document.getElementById("download-btn");
const docxToggle = document.getElementById("docx-toggle");
const autoReviewToggle = document.getElementById("auto-review-toggle");
const detectCoverToggle = document.getElementById("detect-cover-toggle");
const startReviewBtn = document.getElementById("start-review-btn");

let currentJobId = null;
let lastStage1Model = null; // Stage 1 這次用的 model，「直接進行校對」開啟時要沿用

// 「一次只能做一件事」的整體鎖定狀態：
// - stage1Started：Stage 1 曾經送出過（即使已完成），直接上傳就永久鎖住
// - isProcessing：Stage 1 或 Stage 2 目前正在跑，跑的時候整頁都鎖住
// - stage2Unlocked：Stage 2 的設定欄位是否已經解鎖過（按過「開始校對」
//   或直接上傳成功過）；每次重新送出 Stage 1 都會重置，逼使用者針對
//   新的來源重新確認一次
let stage1Started = false;
let isProcessing = false;
let stage2Unlocked = false;

const monthlyUsageList = document.getElementById("monthly-usage-list");

const directUploadField = document.getElementById("direct-upload-field");
const directUploadInput = document.getElementById("direct-upload-input");
const directUploadBtn = document.getElementById("direct-upload-btn");
const stage2LockedGroup = document.getElementById("stage2-locked-group");

const reviewBox = document.getElementById("review-box");
const reviewModelSelect = document.getElementById("review-model-select");
const reviewModelHelp = document.getElementById("review-model-help");
const reviewBatchSelect = document.getElementById("review-batch-select");
const reviewBatchHelp = document.getElementById("review-batch-help");
const reviewRetryInput = document.getElementById("review-retry-input");
const reviewRetryHelp = document.getElementById("review-retry-help");
const reviewRunBtn = document.getElementById("review-run-btn");
const reviewProgress = document.getElementById("review-progress");
const reviewStatusText = document.getElementById("review-status-text");
const reviewLogList = document.getElementById("review-log-list");
const reviewFindingsSection = document.getElementById("review-findings-section");
const findingsList = document.getElementById("findings-list");
const findingsScrollHint = document.getElementById("findings-scroll-hint");
const findingsCount = document.getElementById("findings-count");
const selectAllBtn = document.getElementById("select-all-btn");
const selectNoneBtn = document.getElementById("select-none-btn");
const applyBtn = document.getElementById("apply-btn");
const reviewDownloadBtn = document.getElementById("review-download-btn");
const reviewDocxToggle = document.getElementById("review-docx-toggle");
const rerunBtn = document.getElementById("rerun-btn");

let currentReviewId = null;
let reviewOptionsLoaded = false;
let reviewModelDescriptions = {};
let reviewPollTimer = null;
let renderedReviewLogCount = 0;

const stage1FormGroup = document.getElementById("stage1-form-group");
const modelSelect = document.getElementById("model-select");
const modelHelp = document.getElementById("model-help");
const batchSelect = document.getElementById("batch-select");
const batchHelp = document.getElementById("batch-help");
const retryInput = document.getElementById("retry-input");
const retryHelp = document.getElementById("retry-help");
const dpiInput = document.getElementById("dpi-input");
const dpiHelp = document.getElementById("dpi-help");
const usageList = document.getElementById("usage-list");

let pollTimer = null;
let renderedLogCount = 0;
let modelDescriptions = {};

function validateBoundedInput(input, fieldLabel) {
  const value = Number(input.value);
  const min = Number(input.min);
  const max = Number(input.max);
  if (input.value === "" || Number.isNaN(value)) {
    return `${fieldLabel} 必須是數字`;
  }
  if (value < min || value > max) {
    return `${fieldLabel} 必須介於 ${min}-${max} 之間`;
  }
  return null;
}

async function loadTeacherNotice() {
  const teacherNoticeText = document.getElementById("teacher-notice-text");
  try {
    const res = await fetch(`${API_BASE}/api/teacher-notice`);
    const data = await res.json();
    teacherNoticeText.textContent = data.text || "（目前沒有內容）";
  } catch (e) {
    teacherNoticeText.textContent = "（載入失敗）";
  }
}

async function loadOptions() {
  const res = await fetch(`${API_BASE}/api/options`);
  const opts = await res.json();

  modelSelect.innerHTML = "";
  for (const [value, info] of Object.entries(opts.models)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = info.label;
    modelSelect.appendChild(option);
    modelDescriptions[value] = info.description;
  }
  modelSelect.value = opts.default_model;
  modelHelp.textContent = modelDescriptions[opts.default_model] || "";
  modelSelect.addEventListener("change", () => {
    modelHelp.textContent = modelDescriptions[modelSelect.value] || "";
  });

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

async function loadUsage() {
  const res = await fetch(`${API_BASE}/api/usage`);
  const usage = await res.json();

  const opts = await (await fetch(`${API_BASE}/api/options`)).json();

  usageList.innerHTML = "";
  for (const [model, info] of Object.entries(usage)) {
    const label = opts.models[model]?.label || model;
    const row = document.createElement("div");
    row.className = "usage-row";
    if (info.used >= info.limit) {
      row.classList.add("usage-row-warning");
      row.textContent = `${label}：${info.used} / ${info.limit}（本工具統計已達上限，Google 那邊實際是否還能用請以真實呼叫結果為準）`;
    } else {
      row.textContent = `${label}：${info.used} / ${info.limit}`;
    }
    usageList.appendChild(row);
  }
}

async function loadMonthlyUsage() {
  const res = await fetch(`${API_BASE}/api/usage/monthly`);
  const data = await res.json();

  const reviewOpts = await (await fetch(`${API_BASE}/api/review-options`)).json();

  monthlyUsageList.innerHTML = "";
  for (const [model, info] of Object.entries(data.models)) {
    const label = reviewOpts.models[model]?.label || model;
    const totalTokens = info.input_tokens + info.output_tokens;
    const row = document.createElement("div");
    row.className = "usage-row";
    row.textContent = `${label}：${totalTokens.toLocaleString()} tokens / 約 NT$${info.twd_cost.toFixed(2)}`;
    monthlyUsageList.appendChild(row);
  }
}

submitBtn.addEventListener("click", async () => {
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

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", modelSelect.value);
  formData.append("batch_pages", batchSelect.value);
  formData.append("max_retry", retryInput.value);
  formData.append("dpi", dpiInput.value);
  formData.append("detect_cover", detectCoverToggle.checked ? "true" : "false");

  lastStage1Model = modelSelect.value;
  stage1Started = true;
  isProcessing = true;
  stage2Unlocked = false;
  refreshLockStates();
  statusBox.hidden = false;
  logList.innerHTML = "";
  renderedLogCount = 0;
  downloadBtn.disabled = true;
  startReviewBtn.disabled = true;
  currentJobId = null;
  statusText.textContent = "上傳中";

  try {
    const res = await fetch(`${API_BASE}/api/jobs`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "上傳失敗");
    }
    const { job_id: jobId } = await res.json();
    pollJob(jobId);
  } catch (e) {
    statusText.textContent = `錯誤：${e.message}`;
    isProcessing = false;
    refreshLockStates();
  }
});

function pollJob(jobId) {
  pollTimer = setInterval(async () => {
    let res, job;
    try {
      res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
      job = await res.json();
    } catch (e) {
      // 網路暫時性錯誤，下一輪再試，不要整個停掉
      return;
    }

    if (!res.ok) {
      // job 查不到了（例如伺服器重啟過，記憶體內的 job 狀態沒了），
      // 不能繼續假裝在跑，要停下來明確告訴使用者，不能讓畫面卡在
      // 最後一筆進度不動又不說原因
      clearInterval(pollTimer);
      statusText.textContent = `錯誤：${job.error || "找不到這個處理進度，可能是伺服器重啟過，請重新上傳"}`;
      isProcessing = false;
      refreshLockStates();
      return;
    }

    statusText.textContent = job.status_label || job.status;
    renderNewLogs(job.logs);
    loadUsage();

    if (job.status === "done") {
      clearInterval(pollTimer);
      isProcessing = false;
      refreshLockStates();
      currentJobId = jobId;
      downloadBtn.disabled = !job.has_result;
      startReviewBtn.disabled = !job.has_result;

      if (autoReviewToggle.checked && job.has_result) {
        startAutoReview();
      }
    } else if (job.status === "failed") {
      clearInterval(pollTimer);
      isProcessing = false;
      refreshLockStates();
    }
  }, 1500);
}

downloadBtn.addEventListener("click", () => {
  if (!currentJobId) return;
  const format = docxToggle.checked ? "docx" : "txt";
  const url = `${API_BASE}/api/jobs/${currentJobId}/download?format=${format}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

function renderNewLogs(logs) {
  for (let i = renderedLogCount; i < logs.length; i++) {
    const entry = logs[i];
    const li = document.createElement("li");
    li.textContent = entry.message;
    if (entry.level && entry.level !== "info") {
      li.classList.add(entry.level);
    }
    logList.appendChild(li);
  }
  renderedLogCount = logs.length;
  logList.scrollTop = logList.scrollHeight;
}

// --- Stage 2：校對 ---

async function loadReviewOptions() {
  const res = await fetch(`${API_BASE}/api/review-options`);
  const opts = await res.json();

  reviewModelSelect.innerHTML = "";
  for (const [value, info] of Object.entries(opts.models)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = info.label;
    reviewModelSelect.appendChild(option);
    reviewModelDescriptions[value] = info.description;
  }
  reviewModelSelect.value = opts.default_model;
  reviewModelHelp.textContent = reviewModelDescriptions[opts.default_model] || "";
  reviewModelSelect.addEventListener("change", () => {
    reviewModelHelp.textContent = reviewModelDescriptions[reviewModelSelect.value] || "";
  });

  reviewBatchSelect.value = String(opts.batch_chars.default);
  reviewBatchHelp.textContent = opts.batch_chars.description;

  reviewRetryInput.min = opts.max_retry.min;
  reviewRetryInput.max = opts.max_retry.max;
  reviewRetryInput.value = opts.max_retry.default;
  reviewRetryHelp.textContent = opts.max_retry.description;

  reviewOptionsLoaded = true;
}

function setStage1FormLocked(locked) {
  stage1FormGroup.classList.toggle("locked", locked);
  [
    fileInput,
    modelSelect,
    batchSelect,
    retryInput,
    dpiInput,
    detectCoverToggle,
    docxToggle,
    submitBtn,
  ].forEach(
    (el) => (el.disabled = locked)
  );
}

function setStage2Locked(locked) {
  stage2LockedGroup.classList.toggle("locked", locked);
  [reviewModelSelect, reviewBatchSelect, reviewRetryInput, reviewDocxToggle, reviewRunBtn].forEach(
    (el) => (el.disabled = locked)
  );
}

function setDirectUploadLocked(locked) {
  directUploadField.classList.toggle("locked", locked);
  directUploadInput.disabled = locked;
  directUploadBtn.disabled = locked;
}

// 統一的鎖定狀態更新：任何一個狀態旗標變動後都呼叫這個函式重新整理畫面，
// 不要在各個事件處理常式裡零散地直接改 disabled，避免漏改、狀態兜不攏
function refreshLockStates() {
  setStage1FormLocked(isProcessing);
  setDirectUploadLocked(stage1Started || isProcessing);
  setStage2Locked(isProcessing || !stage2Unlocked);
  if (isProcessing) {
    rerunBtn.disabled = true;
  }
}

startReviewBtn.addEventListener("click", async () => {
  if (!reviewOptionsLoaded) {
    await loadReviewOptions();
  }
  stage2Unlocked = true;
  refreshLockStates();
  reviewBox.scrollIntoView({ behavior: "smooth" });
});

// 「直接進行校對」開啟時，Stage 1 一完成就自動觸發，沿用 Stage 1 用的 model
async function startAutoReview() {
  if (!reviewOptionsLoaded) {
    await loadReviewOptions();
  }
  const hasModelOption = Array.from(reviewModelSelect.options).some(
    (opt) => opt.value === lastStage1Model
  );
  if (lastStage1Model && hasModelOption) {
    reviewModelSelect.value = lastStage1Model;
    reviewModelHelp.textContent = reviewModelDescriptions[lastStage1Model] || "";
  }
  stage2Unlocked = true;
  refreshLockStates();
  reviewBox.scrollIntoView({ behavior: "smooth" });
  await runReview();
}

directUploadBtn.addEventListener("click", async () => {
  const file = directUploadInput.files[0];
  if (!file) {
    alert("請先選擇 .docx 或 .txt 檔案");
    return;
  }
  const nameLower = file.name.toLowerCase();
  if (!nameLower.endsWith(".docx") && !nameLower.endsWith(".txt")) {
    alert("只接受 .docx 或 .txt 檔案");
    return;
  }

  directUploadBtn.disabled = true;
  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch(`${API_BASE}/api/jobs/direct-upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "上傳失敗");
    }
    const { job_id: jobId } = await res.json();
    currentJobId = jobId;

    if (!reviewOptionsLoaded) {
      await loadReviewOptions();
    }
    stage2Unlocked = true;
    refreshLockStates();
    reviewBox.scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    alert(e.message);
    directUploadBtn.disabled = false;
  }
});

function resetReviewUI() {
  reviewProgress.hidden = false;
  reviewLogList.innerHTML = "";
  renderedReviewLogCount = 0;
  reviewStatusText.textContent = "上傳中";
  reviewFindingsSection.hidden = true;
  findingsList.innerHTML = "";
  reviewDownloadBtn.disabled = true;
  rerunBtn.disabled = true;
}

reviewRunBtn.addEventListener("click", runReview);

async function runReview() {
  if (!currentJobId) return;

  const retryError = validateBoundedInput(reviewRetryInput, "API 失敗重試次數");
  if (retryError) {
    alert(retryError);
    return;
  }

  const formData = new FormData();
  formData.append("model", reviewModelSelect.value);
  formData.append("batch_chars", reviewBatchSelect.value);
  formData.append("max_retry", reviewRetryInput.value);

  isProcessing = true;
  refreshLockStates();
  resetReviewUI();

  try {
    const res = await fetch(`${API_BASE}/api/jobs/${currentJobId}/review`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "開始校對失敗");
    }
    const { review_id: reviewId } = await res.json();
    currentReviewId = reviewId;
    pollReview(reviewId);
  } catch (e) {
    reviewStatusText.textContent = `錯誤：${e.message}`;
    isProcessing = false;
    refreshLockStates();
  }
}

function pollReview(reviewId) {
  reviewPollTimer = setInterval(async () => {
    let res, review;
    try {
      res = await fetch(`${API_BASE}/api/reviews/${reviewId}`);
      review = await res.json();
    } catch (e) {
      return;
    }

    if (!res.ok) {
      clearInterval(reviewPollTimer);
      reviewStatusText.textContent = `錯誤：${review.error || "找不到這個處理進度，可能是伺服器重啟過，請重新開始校對"}`;
      isProcessing = false;
      refreshLockStates();
      return;
    }

    reviewStatusText.textContent = review.status_label || review.status;
    renderNewReviewLogs(review.logs);
    loadUsage();
    loadMonthlyUsage();

    if (review.status === "done") {
      clearInterval(reviewPollTimer);
      isProcessing = false;
      refreshLockStates();
      renderFindings(review.findings);
      // 校對一旦完成就能下載，不管有沒有套用任何建議——不套用就是
      // 下載校對前的原始文字，不應該綁在「有沒有按過套用」上
      reviewDownloadBtn.disabled = false;
    } else if (review.status === "failed") {
      clearInterval(reviewPollTimer);
      isProcessing = false;
      refreshLockStates();
    }
  }, 1500);
}

function renderNewReviewLogs(logs) {
  for (let i = renderedReviewLogCount; i < logs.length; i++) {
    const entry = logs[i];
    const li = document.createElement("li");
    li.textContent = entry.message;
    if (entry.level && entry.level !== "info") {
      li.classList.add(entry.level);
    }
    reviewLogList.appendChild(li);
  }
  renderedReviewLogCount = logs.length;
  reviewLogList.scrollTop = reviewLogList.scrollHeight;
}

function renderFindings(findings) {
  reviewFindingsSection.hidden = false;
  findingsList.innerHTML = "";
  findingsCount.textContent = `共找到 ${findings.length} 筆建議（預設全選，取消勾選代表不套用）`;

  for (const finding of findings) {
    const li = document.createElement("li");
    li.className = "finding-item";
    li.innerHTML = `
      <label class="finding-checkbox-row">
        <input type="checkbox" class="finding-checkbox" data-id="${finding.id}" checked />
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
  }

  updateScrollHint();
}

function updateScrollHint() {
  const hasMoreBelow =
    findingsList.scrollHeight - findingsList.scrollTop - findingsList.clientHeight > 8;
  findingsScrollHint.hidden = !hasMoreBelow;
}

findingsList.addEventListener("scroll", updateScrollHint);
window.addEventListener("resize", updateScrollHint);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

selectAllBtn.addEventListener("click", () => {
  findingsList.querySelectorAll(".finding-checkbox").forEach((cb) => (cb.checked = true));
});

selectNoneBtn.addEventListener("click", () => {
  findingsList.querySelectorAll(".finding-checkbox").forEach((cb) => (cb.checked = false));
});

applyBtn.addEventListener("click", async () => {
  if (!currentReviewId) return;

  const selectedIds = Array.from(findingsList.querySelectorAll(".finding-checkbox"))
    .filter((cb) => cb.checked)
    .map((cb) => Number(cb.dataset.id));

  applyBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/reviews/${currentReviewId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_ids: selectedIds }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "套用失敗");
    }
    reviewDownloadBtn.disabled = false;
    rerunBtn.disabled = false;
    alert(`已套用 ${selectedIds.length} 筆修改，可以下載或重新校對了`);
  } catch (e) {
    alert(e.message);
  } finally {
    applyBtn.disabled = false;
  }
});

reviewDownloadBtn.addEventListener("click", () => {
  if (!currentReviewId) return;
  const format = reviewDocxToggle.checked ? "docx" : "txt";
  const url = `${API_BASE}/api/reviews/${currentReviewId}/download?format=${format}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

rerunBtn.addEventListener("click", async () => {
  if (!currentReviewId) return;

  const formData = new FormData();
  formData.append("model", reviewModelSelect.value);
  formData.append("batch_chars", reviewBatchSelect.value);
  formData.append("max_retry", reviewRetryInput.value);

  isProcessing = true;
  refreshLockStates();
  resetReviewUI();

  try {
    const res = await fetch(`${API_BASE}/api/reviews/${currentReviewId}/rerun`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "重新校對失敗");
    }
    const { review_id: reviewId } = await res.json();
    currentReviewId = reviewId;
    pollReview(reviewId);
  } catch (e) {
    reviewStatusText.textContent = `錯誤：${e.message}`;
    isProcessing = false;
    refreshLockStates();
  }
});

refreshLockStates();
loadTeacherNotice();
loadOptions();
loadReviewOptions();
loadUsage();
loadMonthlyUsage();
