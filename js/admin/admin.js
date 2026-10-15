// 管理員介面：跟主介面二選一顯示，同一個按鈕在兩邊切換。第一次打開時才
// 載入各分頁的資料。

import { API_BASE } from "../core/config.js";
import { authedFetch } from "../core/api.js";
import { byId } from "../core/dom.js";
import { on } from "../core/events.js";
import { fetchReviewOpts } from "../app/options.js";
import { renderClaudeUsageRows } from "../app/usage.js";
import { initPermissionsPanel } from "./permissions.js";
import { initProjectsPanel } from "./projects.js";
import { initUsersPanel } from "./users.js";

const mainViewEl = byId("main-view");
const adminContainerEl = byId("admin-container");
const adminToggleBtnEl = byId("admin-toggle-btn");
const adminUsageTotalsListEl = byId("admin-usage-totals-list");

let showingAdminView = false;
let adminDataLoaded = false;

async function loadAdminUsageTotals() {
  const res = await authedFetch(`${API_BASE}/admin/usage/totals`);
  const data = await res.json();
  const reviewOpts = await fetchReviewOpts();
  renderClaudeUsageRows(adminUsageTotalsListEl, data, reviewOpts.models);
}

function showMainView() {
  showingAdminView = false;
  mainViewEl.hidden = false;
  adminContainerEl.hidden = true;
  adminToggleBtnEl.textContent = "管理員介面";
}

function showAdminView() {
  showingAdminView = true;
  mainViewEl.hidden = true;
  adminContainerEl.hidden = false;
  adminToggleBtnEl.textContent = "使用者介面";
  if (!adminDataLoaded) {
    adminDataLoaded = true;
    loadAdminUsageTotals().catch((e) => console.warn("[admin] 總使用量載入失敗：", e.message));
    initUsersPanel();
    initPermissionsPanel();
    initProjectsPanel();
  }
}

export function initAdmin() {
  adminToggleBtnEl.addEventListener("click", () => {
    if (showingAdminView) {
      showMainView();
    } else {
      showAdminView();
    }
  });

  const tabBtns = document.querySelectorAll(".admin-tab-btn");
  const panels = {
    users: byId("admin-panel-users"),
    permissions: byId("admin-panel-permissions"),
    projects: byId("admin-panel-projects"),
  };
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
      Object.keys(panels).forEach((key) => {
        panels[key].hidden = key !== btn.dataset.tab;
      });
    });
  });

  on("auth:authorized", (payload) => {
    adminToggleBtnEl.hidden = !payload.isAdmin;
  });
  on("auth:signed-out", () => {
    adminToggleBtnEl.hidden = true;
    adminDataLoaded = false;
    showMainView();
  });
}
