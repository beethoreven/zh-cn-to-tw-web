// 今日使用量、本案 Claude 用量。

import { API_BASE } from "../core/config.js";
import { authedFetch } from "../core/api.js";
import { byId } from "../core/dom.js";
import { showToast } from "../core/toast.js";
import { fetchReviewOpts, fetchStage1Opts } from "./options.js";
import { state } from "./state.js";

const usageList = byId("usage-list");
const projectUsageListEl = byId("project-usage-list");

// 用量顯示只是輔助資訊，抓不到不該影響任何主要流程。這裡自己把錯誤吞掉
// （只留 console.warn），是因為呼叫端多半是「順手更新一下」的寫法，沒有人
// await、也沒有人 catch——後端一有狀況就會變成 unhandled rejection，把真正
// 有用的錯誤訊息淹掉（實測撞過）。
//
// 刻意不在輪詢裡呼叫：一次會扇出兩個請求，放在每一輪輪詢等於一個人操作就
// 能讓每輪產生好幾條資料庫連線，而使用者不會盯著這個數字看它跳動。只在
// 「登入時」跟「每個 Stage 結束時（含失敗/中斷，那時 token 也已經花掉了）」
// 更新。
export async function loadUsage() {
  try {
    const res = await authedFetch(`${API_BASE}/api/usage`);
    const usage = await res.json();
    const opts = await fetchStage1Opts();

    usageList.innerHTML = "";
    Object.keys(usage).forEach((model) => {
      const info = usage[model];
      const label = (opts.models[model] || {}).label || model;
      const row = document.createElement("div");
      row.className = "usage-row";
      if (info.used >= info.limit) {
        row.classList.add("usage-row-warning");
        row.textContent = `${label}：${info.used} / ${info.limit}（本工具統計已達上限，Google 那邊實際是否還能用請以真實呼叫結果為準）`;
      } else {
        row.textContent = `${label}：${info.used} / ${info.limit}`;
      }
      usageList.appendChild(row);
    });
  } catch (e) {
    console.warn("[usage] 取得用量失敗，略過這次更新：", e.message);
  }
}

// Claude 用量統計共用的算繪邏輯（本案使用狀況／管理員總使用量）：
// 資料形狀都是 {models: {model: {input_tokens, output_tokens, twd_cost}}}
export function renderClaudeUsageRows(listEl, data, modelInfoMap) {
  listEl.innerHTML = "";
  Object.keys(data.models).forEach((model) => {
    const info = data.models[model];
    const label = (modelInfoMap[model] || {}).label || model;
    const totalTokens = info.input_tokens + info.output_tokens;
    const row = document.createElement("div");
    row.className = "usage-row";
    row.textContent = `${label}：${totalTokens.toLocaleString()} tokens / 約 NT$${info.twd_cost.toFixed(2)}`;
    listEl.appendChild(row);
  });
}

export async function loadProjectUsage() {
  if (!state.currentProjectId || state.isPersonalProject) return;
  const res = await authedFetch(`${API_BASE}/api/usage/project/${state.currentProjectId}`);
  const data = await res.json();
  // 沒檢查 res.ok 之前，後端任何錯誤都會讓 data 變成 {error: "..."}，下面
  // 對 undefined 的 data.models 直接炸例外，用量面板整個壞掉、也看不出
  // 真正原因。改成明確顯示錯誤訊息。
  if (!res.ok) {
    projectUsageListEl.innerHTML = "";
    showToast(data.error || "查詢本案用量失敗", "error");
    return;
  }
  const reviewOpts = await fetchReviewOpts();
  renderClaudeUsageRows(projectUsageListEl, data, reviewOpts.models);
}

// 每個 Stage 結束時呼叫（成功、失敗、中斷都算）
export function refreshUsageAfterStage() {
  loadUsage();
  loadProjectUsage().catch((e) => console.warn("[usage] 本案用量更新失敗：", e.message));
}
