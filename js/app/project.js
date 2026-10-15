// 「本案處理劇本」選擇。
//
// - 有工作在進行時（見 workflow.js 的 isWorkInProgress）整組鎖住：跑到一半
//   換劇本案，後面接續的 Stage 會用新的劇本案送出，用量就記錯案子了。
// - 真的換了另一個劇本案，上一個案子的進度全部清掉、畫面回到剛開啟的樣子；
//   選同一個再按一次「確定」不清，避免誤按把還沒下載的結果清掉。

import { API_BASE, PERSONAL_PROJECT_ID } from "../core/config.js";
import { authedFetch } from "../core/api.js";
import { byId } from "../core/dom.js";
import { emit, on } from "../core/events.js";
import { showToast } from "../core/toast.js";
import { setCollapsed } from "./stage-card.js";
import { loadProjectUsage } from "./usage.js";
import { state } from "./state.js";
import { isWorkInProgress, refreshLockStates, registerLock, resetRun } from "./workflow.js";

const projectSelectEl = byId("project-select");
const projectConfirmBtnEl = byId("project-confirm-btn");
const projectUsageBlockEl = byId("project-usage-block");

export async function loadMyProjects() {
  const res = await authedFetch(`${API_BASE}/api/my-projects`);
  const data = await res.json();

  projectSelectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "請選擇劇本案";
  projectSelectEl.appendChild(placeholder);
  data.projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelectEl.appendChild(option);
  });
}

function clearPreviousProjectWork() {
  emit("pipeline:clear", { stages: [1, 2, 3] });
  resetRun();
  [1, 2, 3].forEach((stage) => setCollapsed(stage, true));
}

export function initProjectPicker() {
  registerLock(() => {
    const locked = isWorkInProgress();
    projectSelectEl.disabled = locked;
    projectConfirmBtnEl.disabled = locked;
    projectSelectEl.title = locked ? "工作進行中，跑完才能換劇本案" : "";
  });

  projectConfirmBtnEl.addEventListener("click", () => {
    if (!projectSelectEl.value) {
      showToast("尚未選擇專案", "error");
      return;
    }
    if (isWorkInProgress()) return;
    const newProjectId = Number(projectSelectEl.value);
    if (state.projectConfirmed && state.currentProjectId !== newProjectId) clearPreviousProjectWork();
    state.currentProjectId = newProjectId;
    state.isPersonalProject = state.currentProjectId === PERSONAL_PROJECT_ID;
    state.projectConfirmed = true;
    // 各 Stage 依「是不是個人專案」重新算繪自己的 model 選單（個人專案不能用 Claude）
    emit("project:changed", state);
    refreshLockStates();
    // 個人專案是所有人共用的選項，Claude 用量是大家一起計，顯示「本案使用
    // Claude token 狀況」對個人來說沒有意義（而且個人專案本來就不能用
    // Claude，這排數字永遠是空的）——整排不顯示，也不用白打一次 API。
    projectUsageBlockEl.hidden = state.isPersonalProject;
    loadProjectUsage().catch((e) => console.warn("[usage] 本案用量載入失敗：", e.message));
  });

  // 登出後劇本案的選擇也要重置：下次登入（可能是別的使用者）必須重新選一次
  on("auth:signed-out", () => {
    state.projectConfirmed = false;
    state.currentProjectId = null;
    state.isPersonalProject = false;
    projectSelectEl.innerHTML = "";
    projectUsageBlockEl.hidden = true;
  });
}
