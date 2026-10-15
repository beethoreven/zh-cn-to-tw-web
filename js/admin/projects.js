// 管理員介面：專案管理。

import { API_BASE, DEFAULT_PROJECT_OWNER_ID } from "../core/config.js";
import { authedFetch, errorFromResponse } from "../core/api.js";
import { byId, populateSelect, setDisabled } from "../core/dom.js";
import { showToast } from "../core/toast.js";

const selectEl = byId("admin-project-select");
const loadBtn = byId("admin-project-load-btn");
const editBtn = byId("admin-project-edit-btn");
const newBtn = byId("admin-project-new-btn");
const fieldsEl = byId("admin-project-fields");
const idFieldEl = byId("admin-project-id-field");
const idEl = byId("admin-project-id");
const nameEl = byId("admin-project-name");
// 三個負責人欄位（拆單時一個專案會同時給不只一個人）。負責人1 必填，
// 負責人2/3 可以空著；三格重複填同一個人後端不會報錯。
const ownerEls = [1, 2, 3].map((n) => byId(`admin-project-owner-${n}`));
const statusEl = byId("admin-project-status");
const createActionsEl = byId("admin-project-create-actions");
const createSubmitBtn = byId("admin-project-create-submit-btn");
const createCancelBtn = byId("admin-project-create-cancel-btn");
const editableFields = [nameEl, statusEl].concat(ownerEls);

let currentProjectId = null;
let editing = false;
let wired = false; // 理由同 users.js

async function refreshProjectOptions() {
  const res = await authedFetch(`${API_BASE}/admin/projects`);
  const data = await res.json();
  populateSelect(selectEl, data.projects, "id", "name");
}

async function refreshOwnerOptions() {
  // 只列出 active 的使用者，deactive 的不能被指派為新的負責人
  const res = await authedFetch(`${API_BASE}/admin/users/active-names`);
  const data = await res.json();
  ownerEls.forEach((ownerEl, index) => {
    populateSelect(ownerEl, data.users, "id", "name");
    if (index > 0) {
      // 負責人2/3 可以不填：最前面補一個空白選項
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "（無）";
      ownerEl.insertBefore(emptyOption, ownerEl.firstChild);
    }
  });
}

// 送給後端的三個負責人欄位。空白選項送 null（不是 Number("") 的 0）
function ownersPayload() {
  const payload = {};
  ownerEls.forEach((ownerEl, index) => {
    payload[`owner_${index + 1}`] = ownerEl.value === "" ? null : Number(ownerEl.value);
  });
  return payload;
}

function resetToViewMode() {
  editing = false;
  fieldsEl.hidden = true;
  createActionsEl.hidden = true;
  idFieldEl.hidden = false;
  setDisabled(editableFields, true);
  editBtn.textContent = "編輯";
  editBtn.disabled = true;
  currentProjectId = null;
}

function wire() {
  loadBtn.addEventListener("click", async () => {
    const projectId = selectEl.value;
    if (!projectId) {
      showToast("請先選擇要讀取的專案", "error");
      return;
    }
    try {
      await refreshOwnerOptions();
      const res = await authedFetch(`${API_BASE}/admin/projects/${projectId}`);
      if (!res.ok) throw await errorFromResponse(res, "讀取失敗");
      const project = await res.json();
      currentProjectId = project.id;
      editing = false;
      idFieldEl.hidden = false;
      idEl.value = project.id;
      nameEl.value = project.name;
      // 負責人可能是目前已 deactive、active-only 下拉選單裡搜尋不到的人——
      // 這種情況原本會讓 <select> 選不中任何選項，.value 變成空字串，
      // 「不改負責人」按儲存時反而把負責人意外送成空值，悄悄把負責人
      // 改壞。這裡額外補一個選項，確保畫面正確顯示、「不改負責人」時
      // 儲存的還是原本的 id；要換人才必須換成 active 名單裡的人。
      ownerEls.forEach((ownerEl, index) => {
        const ownerId = project[`owner_${index + 1}`];
        const ownerName = project[`owner_${index + 1}_name`];
        if (ownerId === null || ownerId === undefined) {
          ownerEl.value = "";
          return;
        }
        ownerEl.value = ownerId;
        if (ownerEl.value !== String(ownerId)) {
          const deactiveOwnerOption = document.createElement("option");
          deactiveOwnerOption.value = ownerId;
          deactiveOwnerOption.textContent = `${ownerName || ownerId}（已停用）`;
          ownerEl.appendChild(deactiveOwnerOption);
          ownerEl.value = ownerId;
        }
      });
      statusEl.value = project.status;
      fieldsEl.hidden = false;
      createActionsEl.hidden = true;
      setDisabled(editableFields, true);
      editBtn.disabled = false;
      editBtn.textContent = "編輯";
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
      const res = await authedFetch(`${API_BASE}/admin/projects/${currentProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ name: nameEl.value.trim(), status: statusEl.value }, ownersPayload())),
      });
      if (!res.ok) throw await errorFromResponse(res, "儲存失敗");
      const data = await res.json();
      showToast(data.changed ? "已儲存" : "無任何修改", data.changed ? "success" : undefined);
      editing = false;
      setDisabled(editableFields, true);
      editBtn.textContent = "編輯";
      await refreshProjectOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  newBtn.addEventListener("click", async () => {
    await refreshOwnerOptions();
    currentProjectId = null;
    editing = false;
    idFieldEl.hidden = true;
    nameEl.value = "";
    // 負責人1 預設是專案擁有者自己（固定 id=1）；負責人2/3 預設空白（第一個
    // 選項就是「（無）」）。id=1 萬一不在 active 名單裡，<select> 會選不中、
    // .value 變成空字串——這時退回名單第一個人，不要讓必填的負責人1 空著。
    ownerEls.forEach((ownerEl, index) => {
      const firstValue = ownerEl.options.length ? ownerEl.options[0].value : "";
      if (index > 0) {
        ownerEl.value = firstValue;
        return;
      }
      ownerEl.value = String(DEFAULT_PROJECT_OWNER_ID);
      if (ownerEl.value !== String(DEFAULT_PROJECT_OWNER_ID)) ownerEl.value = firstValue;
    });
    statusEl.value = "pending";
    fieldsEl.hidden = false;
    createActionsEl.hidden = false;
    setDisabled(editableFields, false);
    editBtn.disabled = true;
  });

  createCancelBtn.addEventListener("click", resetToViewMode);

  createSubmitBtn.addEventListener("click", async () => {
    try {
      const res = await authedFetch(`${API_BASE}/admin/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ name: nameEl.value.trim(), status: statusEl.value }, ownersPayload())),
      });
      if (!res.ok) throw await errorFromResponse(res, "建立失敗");
      showToast("已建立", "success");
      resetToViewMode();
      await refreshProjectOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });
}

export function initProjectsPanel() {
  if (!wired) {
    wire();
    wired = true;
  }
  resetToViewMode();
  refreshProjectOptions();
}
