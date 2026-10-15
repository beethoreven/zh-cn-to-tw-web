// Stage 2：通用修改。目前只有一項功能「套用範本修改」：
// - 套用：後端用程式（不呼叫 AI）把半形標點轉全形、套用替換範本（半形空格一律不動），
//   結果存成一個新的 job，下載與接續 Stage 3 都直接沿用。
// - 分析報告（選配）：套用完另外請 AI 看過字詞類的修改，只提醒、不改字，
//   在背景跑，不擋接續 Stage 3。
// - 個人範本：使用者下載目前範本、自己增減、再選回來。只存在這個畫面的
//   記憶體裡（關掉 App 或重新整理就沒了），套用時跟著請求送出，後端用完
//   就丟，不會改到預設範本。

import { API_BASE, PERSONAL_PROJECT_ERROR_MESSAGES } from "../core/config.js";
import { authedFetch, errorFromResponse, isReauthInFlight } from "../core/api.js";
import { byId, createLogRenderer, escapeHtml, setDisabled } from "../core/dom.js";
import { downloadViaAuthedFetch, saveText } from "../core/download.js";
import { emit, on } from "../core/events.js";
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
  setBackgroundTask,
  setBusy,
  startRun,
  usesStage1Model,
} from "../app/workflow.js";
import { formatIssue, parseTemplate } from "./pattern-template.js";

const uploadField = byId("stage2-upload-field");
const uploadInput = byId("stage2-upload-input");
const uploadBtn = byId("stage2-upload-btn");
const sourceLine = byId("stage2-source-line");
const formGroup = byId("stage2-form-group");
const analysisToggle = byId("pattern-analysis-toggle");
const modelField = byId("pattern-model-field");
const modelSelect = byId("pattern-model-select");
const modelFollowNote = byId("pattern-model-follow");
const customToggle = byId("pattern-custom-toggle");
const templateDownloadBtn = byId("pattern-template-download-btn");
const templateInput = byId("pattern-template-input");
const templateInputLabel = document.querySelector('label[for="pattern-template-input"]');
const templateResetBtn = byId("pattern-template-reset-btn");
const templateStatus = byId("pattern-template-status");
const templateIssues = byId("pattern-template-issues");
const chainToggle = byId("pattern-chain-toggle");
const docxToggle = byId("pattern-docx-toggle");
const runBtn = byId("pattern-run-btn");
const resultBox = byId("pattern-result");
const statusText = byId("pattern-status-text");
const summaryEl = byId("pattern-summary");
const warningsEl = byId("pattern-warnings");
const downloadBtn = byId("pattern-download-btn");
const reportBtn = byId("pattern-report-btn");
const toStage3Btn = byId("pattern-to-stage3-btn");
const analysisBox = byId("pattern-analysis");
const analysisStatus = byId("pattern-analysis-status");
const analysisLog = byId("pattern-analysis-log");
const analysisCount = byId("pattern-analysis-count");
const analysisList = byId("pattern-analysis-list");
const analysisRerunBtn = byId("pattern-analysis-rerun-btn");

const modelPicker = createModelPicker(modelSelect, byId("pattern-model-help"));
const analysisLogs = createLogRenderer(analysisLog);

let source = null; // { jobId, label, from: "stage1" | "upload" }
let resultJobId = null;
let defaultTemplate = null; // { text, ruleCount }
let defaultTemplatePromise = null;
let customTemplate = null; // { name, text, ruleCount }
let analysisTimer = null;
let analysisGeneration = 0;

export function wantsDocx() {
  return docxToggle.checked;
}

export async function loadStage2Options() {
  const opts = await fetchReviewOpts();
  modelPicker.render(opts, state.isPersonalProject);
}

function fetchDefaultTemplate() {
  if (!defaultTemplatePromise) {
    defaultTemplatePromise = authedFetch(`${API_BASE}/api/pattern-template`)
      .then(async (res) => {
        if (!res.ok) throw await errorFromResponse(res, "讀取預設範本失敗");
        const data = await res.json();
        defaultTemplate = { text: data.text, ruleCount: data.rule_count };
        renderTemplateStatus();
        return defaultTemplate;
      })
      .catch((err) => {
        defaultTemplatePromise = null;
        throw err;
      });
  }
  return defaultTemplatePromise;
}

// ===== 個人範本 =====

function usingCustomTemplate() {
  return customToggle.checked && !!customTemplate;
}

function renderTemplateStatus() {
  if (customToggle.checked && customTemplate) {
    templateStatus.textContent = `目前使用：個人範本「${customTemplate.name}」（${customTemplate.ruleCount} 條規則）`;
  } else if (customToggle.checked) {
    templateStatus.textContent = "還沒選擇個人範本，開始套用前請先選一個檔案（或關掉「使用個人範本」改用預設範本）";
  } else {
    templateStatus.textContent = defaultTemplate ? `目前使用：預設範本（${defaultTemplate.ruleCount} 條規則）` : "";
  }
  templateResetBtn.hidden = !customTemplate;
}

function renderIssues(listEl, issues) {
  listEl.innerHTML = "";
  issues.forEach((issue) => {
    const li = document.createElement("li");
    li.textContent = formatIssue(issue);
    listEl.appendChild(li);
  });
  listEl.hidden = issues.length === 0;
}

function showTemplateErrors(errors) {
  templateIssues.classList.remove("issue-list--warning");
  renderIssues(templateIssues, errors);
}

function showTemplateWarnings(warnings) {
  templateIssues.classList.add("issue-list--warning");
  renderIssues(templateIssues, warnings);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

async function onTemplateFileChosen() {
  const file = templateInput.files[0];
  // 清掉選擇：同一個檔案改完再選一次也會觸發 change
  templateInput.value = "";
  if (!file) return;
  let text;
  try {
    text = await readFileAsText(file);
  } catch (e) {
    showToast("讀取範本檔案失敗", "error");
    return;
  }
  const parsed = parseTemplate(text);
  if (parsed.errors.length) {
    showTemplateErrors(parsed.errors);
    showToast(`範本有 ${parsed.errors.length} 個格式問題，沒有採用`, "error");
    renderTemplateStatus();
    return;
  }
  customTemplate = { name: file.name, text, ruleCount: parsed.rules.length };
  showTemplateWarnings(parsed.warnings);
  renderTemplateStatus();
  showToast(`已採用個人範本（${parsed.rules.length} 條規則）`, "success");
}

async function downloadCurrentTemplate() {
  try {
    if (usingCustomTemplate()) {
      await saveText(customTemplate.text, customTemplate.name);
    } else {
      const tpl = await fetchDefaultTemplate();
      await saveText(tpl.text, "繁化助手範本.txt");
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ===== 來源與結果 =====

function setSource(jobId, label, from) {
  source = { jobId, label, from };
  sourceLine.textContent = `目前的來源：${label}`;
  sourceLine.hidden = false;
  refreshRunAvailability();
}

function refreshRunAvailability() {
  applyLock(state);
}

function clearResult() {
  stopAnalysis();
  resultJobId = null;
  resultBox.hidden = true;
  statusText.textContent = "-";
  summaryEl.textContent = "";
  warningsEl.hidden = true;
  downloadBtn.disabled = true;
  reportBtn.disabled = true;
  toStage3Btn.disabled = true;
  analysisBox.hidden = true;
  analysisList.innerHTML = "";
  analysisCount.textContent = "";
  analysisLogs.reset();
  setStageDetail(2, "");
}

function clearAll() {
  clearResult();
  source = null;
  sourceLine.hidden = true;
  sourceLine.textContent = "";
}

function renderSummary(summary) {
  const parts = [
    `範本規則修改 ${summary.rule_hits} 處（${summary.rules_hit}/${summary.rules_total} 條規則有命中）`,
    `半形標點轉全形 ${summary.punct_converted} 個`,
  ];
  summaryEl.textContent = `${summary.template_label}：${parts.join("；")}。全文 ${summary.paragraphs} 段，改到 ${summary.changed_paragraphs} 段。逐筆前後文請下載報告。`;
}

// fromChain：由 Stage 1 完成後自動串接過來（流程已經排好，不用重新開始一次）
async function runPattern(fromChain) {
  if (!source) return;
  // 半路上登出的話，這次的流程整個作廢（見 workflow.js 的 getRunEpoch）
  const epoch = getRunEpoch();
  const stale = () => epoch !== getRunEpoch();
  if (customToggle.checked && !customTemplate) {
    const message = "已開啟「使用個人範本」，但還沒選擇範本檔案";
    showToast(message, "error");
    if (fromChain) {
      // 自動串接過來時使用者可能沒在看這張卡片，原因要留在卡片上
      resultBox.hidden = false;
      statusText.textContent = `錯誤：${message}`;
      finishStage(2, false);
    }
    return;
  }
  if (!(await checkVersionOrBlock())) {
    if (fromChain && !stale()) finishStage(2, false);
    return;
  }
  if (stale()) return;

  // 後面 Stage 3 的結果是舊文字的，一起清掉
  emit("pipeline:clear", { stages: [3] });
  clearResult();
  state.hasDownloaded = false;
  setBusy(true);
  if (fromChain) {
    advanceRun(2);
  } else {
    startRun(2, {}, source.from === "stage1");
  }
  resultBox.hidden = false;
  statusText.textContent = "套用中";

  const body = {};
  if (usingCustomTemplate()) body.template = customTemplate.text;

  try {
    const res = await authedFetch(`${API_BASE}/api/jobs/${source.jobId}/pattern`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await errorFromResponse(res, "套用失敗");
      if (err.details) {
        // 後端的範本檢查沒過（前端理論上已經擋掉了，萬一兩邊規則不一致才會走到這）
        // 把開關打開，下載／選檔的按鈕才會解鎖，使用者可以直接改了再選一次
        customToggle.checked = true;
        showTemplateErrors(err.details);
      }
      throw err;
    }
    const data = await res.json();
    if (stale()) return;
    resultJobId = data.job_id;
    statusText.textContent = "已完成";
    renderSummary(data.summary);
    renderIssues(warningsEl, data.warnings || []);
    downloadBtn.disabled = false;
    reportBtn.disabled = false;
    setStageDetail(2, `規則修改 ${data.summary.rule_hits} 處`);
    setBusy(false);
    finishStage(2, true);
    if (analysisToggle.checked) startAnalysis();
    emit("stage2:done", { jobId: resultJobId });
  } catch (e) {
    if (stale()) return;
    statusText.textContent = `錯誤：${e.message}`;
    setBusy(false);
    finishStage(2, false);
  }
}

// ===== 分析報告 =====

function stopAnalysis() {
  clearInterval(analysisTimer);
  analysisGeneration++;
  setBackgroundTask("pattern-analysis", false);
}

function renderAnalysisItems(items) {
  analysisList.innerHTML = "";
  analysisCount.textContent = items.length
    ? `共 ${items.length} 筆需要注意（只是提醒，文字沒有被改動）`
    : "沒有發現需要特別注意的修改";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "analysis-item";
    li.innerHTML = `
      <div class="analysis-item__head">第 ${escapeHtml(String(item.para_no))} 段｜${escapeHtml(item.source)} → ${escapeHtml(item.target)}</div>
      <p class="analysis-item__excerpt">${escapeHtml(item.excerpt)}</p>
      <p class="analysis-item__issue">${escapeHtml(item.issue)}</p>
      ${item.suggestion ? `<p class="analysis-item__suggestion">建議：${escapeHtml(item.suggestion)}</p>` : ""}
    `;
    analysisList.appendChild(li);
  });
}

async function startAnalysis() {
  if (!resultJobId) return;
  stopAnalysis();
  const jobId = resultJobId;
  analysisBox.hidden = false;
  analysisRerunBtn.hidden = true;
  analysisStatus.textContent = "送出中";
  analysisList.innerHTML = "";
  analysisCount.textContent = "";
  analysisLogs.reset();

  try {
    const res = await authedFetch(`${API_BASE}/api/jobs/${jobId}/pattern-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelSelect.value, project: state.currentProjectId }),
    });
    if (!res.ok) throw await errorFromResponse(res, "無法開始分析");
    const data = await res.json();
    if (jobId !== resultJobId) return; // 送出期間使用者已經開始了別的工作
    pollAnalysis(data.analysis_id);
  } catch (e) {
    if (jobId !== resultJobId) return; // 舊工作的錯誤，不要寫到新工作的畫面上
    if (PERSONAL_PROJECT_ERROR_MESSAGES.has(e.message)) showToast(e.message, "error");
    analysisStatus.textContent = `錯誤：${e.message}`;
    analysisRerunBtn.hidden = false;
  }
}

function pollAnalysis(analysisId) {
  const myGeneration = ++analysisGeneration;
  setBackgroundTask("pattern-analysis", true);
  const tick = async () => {
    if (isReauthInFlight()) return;
    let res;
    let data;
    try {
      res = await authedFetch(`${API_BASE}/api/pattern-analyses/${analysisId}`);
      data = await res.json();
    } catch (e) {
      return;
    }
    // 同一個 generation 守門：姍姍來遲的舊回應不能蓋掉新的畫面
    // （known-issue-check 第 2 條）
    if (myGeneration !== analysisGeneration) return;

    if (!res.ok) {
      clearInterval(analysisTimer);
      setBackgroundTask("pattern-analysis", false);
      analysisStatus.textContent = `錯誤：${data.error || "找不到這份分析報告"}`;
      analysisRerunBtn.hidden = false;
      return;
    }
    analysisStatus.textContent = data.status_label || data.status;
    analysisLogs.render(data.logs);

    if (data.status === "done") {
      clearInterval(analysisTimer);
      setBackgroundTask("pattern-analysis", false);
      renderAnalysisItems(data.items);
      analysisRerunBtn.hidden = false;
      refreshUsageAfterStage();
    } else if (data.status === "failed" || data.status === "interrupted") {
      clearInterval(analysisTimer);
      setBackgroundTask("pattern-analysis", false);
      if (data.items && data.items.length) renderAnalysisItems(data.items);
      analysisStatus.textContent =
        data.status === "interrupted" ? "伺服器重啟，分析被中斷了，可以按「重新分析」再跑一次" : `失敗：${data.error || ""}`;
      analysisRerunBtn.hidden = false;
      refreshUsageAfterStage();
    }
  };
  analysisTimer = setInterval(tick, 4000);
  tick();
}

// ===== 鎖定 =====

// 設定欄位：Stage 1 在跑的時候還可以改（等等自動接續到 Stage 2 時會用到），
// 其他情況有任何 Stage 在跑就鎖住。「開始」類的按鈕一律要等到不忙了才能按。
function applyLock(s) {
  const settingsLocked = !s.projectConfirmed || (s.busy && getRunningStage() !== 1);
  formGroup.classList.toggle("locked", settingsLocked);
  setDisabled([analysisToggle, modelSelect, customToggle, chainToggle, docxToggle], settingsLocked);
  // 個人範本的下載／選檔按鈕一直都看得到，「使用個人範本」關著時鎖住，
  // 打開才能用
  const customLocked = settingsLocked || !customToggle.checked;
  setDisabled([templateDownloadBtn, templateInput, templateResetBtn], customLocked);
  templateInputLabel.classList.toggle("is-disabled", customLocked);
  // 分析報告關掉時不需要選 model，整個欄位收起來
  modelField.hidden = !analysisToggle.checked;
  // 這次流程從 Stage 1 一路接過來：分析報告沿用 Stage 1 的 model，選單直接
  // 顯示那個 model 並鎖住，不讓人以為改這裡有用
  const followsStage1 = usesStage1Model(2);
  if (followsStage1) modelPicker.trySelect(getCurrentRun().stage1Model);
  modelSelect.disabled = settingsLocked || followsStage1;
  modelFollowNote.hidden = !followsStage1;

  const actionLocked = s.busy || !s.projectConfirmed;
  runBtn.disabled = actionLocked || !source;
  uploadField.classList.toggle("locked", actionLocked);
  uploadInput.disabled = actionLocked;
  uploadBtn.disabled = actionLocked;
  toStage3Btn.disabled = actionLocked || !resultJobId;
}

// ===== 直接上傳 =====

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
    emit("pipeline:clear", { stages: [1, 3] });
    clearAll();
    setSource(data.job_id, `上傳的檔案「${file.name}」`, "upload");
    showToast("已上傳，可以開始套用修正", "success");
  } catch (e) {
    alert(e.message);
  } finally {
    setBusy(false);
  }
}

// ===== 對外介面（給 js/app/chain.js） =====

// 使用者按 Stage 1 的「下一步：Stage 2」：只設定來源，等使用者自己按開始
export function acceptSource(jobId, label) {
  emit("pipeline:clear", { stages: [3] });
  clearAll();
  setSource(jobId, label, "stage1");
}

// Stage 1 完成後自動串接：設定來源並直接開始套用
export function startFromUpstream(jobId, label, options) {
  clearAll();
  setSource(jobId, label, "stage1");
  // 分析報告沿用 Stage 1 的 model（鎖定規則平常就會同步，這裡再明確設一次）
  if (options && options.model) modelPicker.trySelect(options.model);
  runPattern(true);
}

export function initStage2() {
  registerLock(applyLock);
  renderTemplateStatus();

  analysisToggle.addEventListener("change", () => applyLock(state));
  customToggle.addEventListener("change", () => {
    applyLock(state);
    if (customToggle.checked && !defaultTemplate) {
      fetchDefaultTemplate().catch((e) => showToast(e.message, "error"));
    }
    renderTemplateStatus();
  });
  templateDownloadBtn.addEventListener("click", downloadCurrentTemplate);
  templateInput.addEventListener("change", onTemplateFileChosen);
  templateResetBtn.addEventListener("click", () => {
    customTemplate = null;
    templateIssues.hidden = true;
    renderTemplateStatus();
  });

  uploadBtn.addEventListener("click", directUpload);
  runBtn.addEventListener("click", () => runPattern(false));
  downloadBtn.addEventListener("click", async () => {
    if (!resultJobId) return;
    const format = docxToggle.checked ? "docx" : "txt";
    try {
      await downloadViaAuthedFetch(`${API_BASE}/api/jobs/${resultJobId}/download?format=${format}`, `download.${format}`);
      state.hasDownloaded = true;
    } catch (e) {
      showToast(e.message, "error");
    }
  });
  reportBtn.addEventListener("click", async () => {
    if (!resultJobId) return;
    try {
      await downloadViaAuthedFetch(`${API_BASE}/api/jobs/${resultJobId}/pattern-report`, "修改報告.txt");
    } catch (e) {
      showToast(e.message, "error");
    }
  });
  toStage3Btn.addEventListener("click", () => {
    if (resultJobId) emit("stage2:next", { jobId: resultJobId });
  });
  analysisRerunBtn.addEventListener("click", startAnalysis);

  on("project:changed", (s) => modelPicker.rerender(s.isPersonalProject));
  on("auth:authorized", () => {
    fetchDefaultTemplate().catch((e) => console.warn("[stage2] 預設範本載入失敗：", e.message));
  });
  on("pipeline:clear", (payload) => {
    if (payload.stages.indexOf(2) >= 0) clearAll();
  });
  // 個人範本只活到 App 關掉為止；換帳號登入也不該沿用上一個人的範本
  on("auth:signed-out", () => {
    clearAll();
    customTemplate = null;
    customToggle.checked = false;
    defaultTemplate = null;
    defaultTemplatePromise = null;
    templateIssues.hidden = true;
    renderTemplateStatus();
  });
}
