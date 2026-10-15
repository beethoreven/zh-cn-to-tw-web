// 管理員介面：使用者管理。

import { API_BASE } from "../core/config.js";
import { authedFetch, errorFromResponse } from "../core/api.js";
import { byId, populateSelect, setDisabled } from "../core/dom.js";
import { showToast } from "../core/toast.js";

const selectEl = byId("admin-user-select");
const loadBtn = byId("admin-user-load-btn");
const editBtn = byId("admin-user-edit-btn");
const newBtn = byId("admin-user-new-btn");
const fieldsEl = byId("admin-user-fields");
const idFieldEl = byId("admin-user-id-field");
const idEl = byId("admin-user-id");
const emailEl = byId("admin-user-email");
const nameEl = byId("admin-user-name");
const roleEl = byId("admin-user-role");
const statusEl = byId("admin-user-status");
const createActionsEl = byId("admin-user-create-actions");
const createSubmitBtn = byId("admin-user-create-submit-btn");
const createCancelBtn = byId("admin-user-create-cancel-btn");
const projectsBlockEl = byId("admin-user-projects-block");
const projectsListEl = byId("admin-user-projects-list");
const editableFields = [emailEl, nameEl, roleEl, statusEl];

let currentUserId = null;
let editing = false;
// 事件只綁一次：管理員登出再登入（沒有重新整理）時 initUsersPanel 會再被
// 呼叫一次，1.x 會重複綁定，按一次「建立」就送出兩次。
let wired = false;

// 讀取某個使用者之後，順便列出他名下負責的專案（不含 closed，closed 的
// 專案對「這個人手上還有哪些案子」這件事已經沒有意義）
async function loadUserProjects(userId) {
  projectsListEl.textContent = "載入中…";
  projectsBlockEl.hidden = false;
  try {
    const res = await authedFetch(`${API_BASE}/admin/users/${userId}/projects`);
    if (!res.ok) throw await errorFromResponse(res, "讀取專案清單失敗");
    const data = await res.json();
    projectsListEl.innerHTML = "";
    if (data.projects.length === 0) {
      const row = document.createElement("div");
      row.className = "usage-row";
      row.textContent = "目前沒有負責中的專案";
      projectsListEl.appendChild(row);
    } else {
      data.projects.forEach((project) => {
        const row = document.createElement("div");
        row.className = "usage-row";
        row.textContent = `${project.name}：${project.status}`;
        projectsListEl.appendChild(row);
      });
    }
  } catch (e) {
    projectsListEl.textContent = "（載入失敗）";
  }
}

async function refreshMemberOptions() {
  const res = await authedFetch(`${API_BASE}/admin/users`);
  const data = await res.json();
  // 名字沒填的話退回顯示信箱，避免下拉選單出現空白選項
  const users = data.users.map((u) => Object.assign({}, u, { label: u.name || u.email }));
  populateSelect(selectEl, users, "id", "label");
}

async function refreshRoleOptions() {
  const res = await authedFetch(`${API_BASE}/admin/permissions?include_admin=true`);
  const data = await res.json();
  populateSelect(roleEl, data.permissions, "id", "role");
}

function resetToViewMode() {
  editing = false;
  fieldsEl.hidden = true;
  createActionsEl.hidden = true;
  idFieldEl.hidden = false;
  setDisabled(editableFields, true);
  idEl.disabled = true;
  editBtn.textContent = "編輯";
  editBtn.disabled = true;
  currentUserId = null;
  projectsBlockEl.hidden = true;
}

function wire() {
  loadBtn.addEventListener("click", async () => {
    const userId = selectEl.value;
    if (!userId) {
      showToast("請先選擇要讀取的成員", "error");
      return;
    }
    try {
      const res = await authedFetch(`${API_BASE}/admin/users/${userId}`);
      if (!res.ok) throw await errorFromResponse(res, "讀取失敗");
      const user = await res.json();
      currentUserId = user.id;
      editing = false;
      idFieldEl.hidden = false;
      idEl.value = user.id;
      emailEl.value = user.email;
      nameEl.value = user.name || "";
      roleEl.value = user.role;
      statusEl.value = user.status;
      fieldsEl.hidden = false;
      createActionsEl.hidden = true;
      setDisabled(editableFields, true);
      editBtn.disabled = false;
      editBtn.textContent = "編輯";
      loadUserProjects(user.id);
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  editBtn.addEventListener("click", async () => {
    if (!editing) {
      editing = true;
      setDisabled(editableFields, false);
      editBtn.textContent = "儲存";
      return;
    }
    try {
      const res = await authedFetch(`${API_BASE}/admin/users/${currentUserId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailEl.value.trim(),
          name: nameEl.value.trim(),
          role: Number(roleEl.value),
          status: statusEl.value,
        }),
      });
      if (!res.ok) throw await errorFromResponse(res, "儲存失敗");
      const data = await res.json();
      showToast(data.changed ? "已儲存" : "無任何修改", data.changed ? "success" : undefined);
      editing = false;
      setDisabled(editableFields, true);
      editBtn.textContent = "編輯";
      await refreshMemberOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  newBtn.addEventListener("click", () => {
    currentUserId = null;
    editing = false;
    idFieldEl.hidden = true;
    emailEl.value = "";
    nameEl.value = "";
    // 新建使用者預設角色：明確排除 admin，不要依賴選項在陣列裡的順序（萬一
    // API 回傳順序改變，「挑最後一個」這種寫法可能會不小心把新使用者預設
    // 成管理員）
    const defaultRoleOption = Array.prototype.find.call(roleEl.options, (o) => o.textContent !== "admin");
    roleEl.value = defaultRoleOption ? defaultRoleOption.value : roleEl.options.length ? roleEl.options[0].value : "";
    statusEl.value = "active";
    fieldsEl.hidden = false;
    createActionsEl.hidden = false;
    setDisabled(editableFields, false);
    editBtn.disabled = true;
    projectsBlockEl.hidden = true;
  });

  createCancelBtn.addEventListener("click", resetToViewMode);

  createSubmitBtn.addEventListener("click", async () => {
    try {
      const res = await authedFetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailEl.value.trim(),
          name: nameEl.value.trim(),
          role: Number(roleEl.value),
          status: statusEl.value,
        }),
      });
      if (!res.ok) throw await errorFromResponse(res, "建立失敗");
      showToast("已建立", "success");
      resetToViewMode();
      await refreshMemberOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });
}

export function initUsersPanel() {
  if (!wired) {
    wire();
    wired = true;
  }
  resetToViewMode();
  refreshRoleOptions();
  refreshMemberOptions();
}
