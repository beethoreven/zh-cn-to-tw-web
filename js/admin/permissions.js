// 管理員介面：權限管理。

import { API_BASE } from "../core/config.js";
import { authedFetch, errorFromResponse } from "../core/api.js";
import { byId, populateSelect, setDisabled } from "../core/dom.js";
import { showToast } from "../core/toast.js";

const selectEl = byId("admin-permission-select");
const loadBtn = byId("admin-permission-load-btn");
const editBtn = byId("admin-permission-edit-btn");
const fieldsEl = byId("admin-permission-fields");
const idEl = byId("admin-permission-id");
const roleEl = byId("admin-permission-role");
const haikuEl = byId("admin-permission-haiku");
const editableFields = [roleEl, haikuEl];

let currentPermissionId = null;
let editing = false;
let wired = false; // 理由同 users.js

async function refreshPermissionOptions() {
  // 兩個下拉都要更新：選擇要讀取哪個權限（排除管理員），以及編輯時「權限」
  // 欄位本身可以改成哪些角色名稱（同樣排除管理員）
  const res = await authedFetch(`${API_BASE}/admin/permissions`);
  const data = await res.json();
  populateSelect(selectEl, data.permissions, "id", "role");
  populateSelect(roleEl, data.permissions, "role", "role");
}

function resetToViewMode() {
  editing = false;
  fieldsEl.hidden = true;
  setDisabled(editableFields, true);
  editBtn.textContent = "編輯";
  editBtn.disabled = true;
  currentPermissionId = null;
}

function wire() {
  loadBtn.addEventListener("click", async () => {
    const permissionId = selectEl.value;
    if (!permissionId) {
      showToast("請先選擇要讀取的權限", "error");
      return;
    }
    try {
      const res = await authedFetch(`${API_BASE}/admin/permissions/${permissionId}`);
      if (!res.ok) throw await errorFromResponse(res, "讀取失敗");
      const permission = await res.json();
      currentPermissionId = permission.id;
      editing = false;
      idEl.value = permission.id;
      roleEl.value = permission.role;
      haikuEl.value = permission.allowed_haiku;
      fieldsEl.hidden = false;
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
      const res = await authedFetch(`${API_BASE}/admin/permissions/${currentPermissionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: roleEl.value,
          allowed_haiku: Number(haikuEl.value),
        }),
      });
      if (!res.ok) throw await errorFromResponse(res, "儲存失敗");
      const data = await res.json();
      showToast(data.changed ? "已儲存" : "無任何修改", data.changed ? "success" : undefined);
      editing = false;
      setDisabled(editableFields, true);
      editBtn.textContent = "編輯";
      await refreshPermissionOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });
}

export function initPermissionsPanel() {
  if (!wired) {
    wire();
    wired = true;
  }
  resetToViewMode();
  refreshPermissionOptions();
}
