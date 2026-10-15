// Google 登入、授權檢查、登出，以及沒登入時的頁面鎖定。
//
// 登入後拿到的 Google ID Token 只用來跟後端換一次應用程式自己的 session
// token（/auth/login），之後一律用 session token（見 js/core/api.js 的說明）。
// 桌面版不在內嵌 WebView 裡跑 Google 的登入彈出視窗（Google 會限制/降級
// 內嵌瀏覽器裡的登入流程，實測撞過 window.open 被擋、帳戶選擇視窗越開越多），
// 改成請桌面殼用系統瀏覽器完成登入，殼再呼叫 handleCredentialResponse()
// 把結果交回來，後續驗證/儲存/更新畫面跟瀏覽器版共用同一套邏輯。
//
// 這個模組只管登入本身；登入狀態改變時用事件通知其他模組：
// - auth:authorized   授權通過（payload: {email, isAdmin}）
// - auth:signed-out   回到未登入狀態（各模組把自己的狀態清掉）

import { API_BASE, DESKTOP_MODE, GOOGLE_CLIENT_ID } from "../core/config.js";
import {
  authHeaders,
  getSessionToken,
  setSessionToken,
  settleReauthWaiters,
} from "../core/api.js";
import { exposeToShell, postToShell } from "../core/bridge.js";
import { byId } from "../core/dom.js";
import { emit } from "../core/events.js";
import { hideConnectionNotice, showConnectionNotice, showToast } from "../core/toast.js";
import { state } from "../app/state.js";
import { refreshLockStates } from "../app/workflow.js";

// 鎖定效果特意套用在 .main-column（不是整個 .container）：CSS 的 opacity
// 會透過合成往下影響所有子元素，子元素自己設 opacity:1 沒辦法蓋掉父層的
// 效果——.sidebar-column（阿舍老師的叮嚀）是 .main-column 的手足，不是
// 子孫，這樣鎖定就完全影響不到它。這只是視覺提示，真正擋掉未授權存取的
// 是後端每支 API 自己驗證 token。
const mainColumnEl = document.querySelector(".main-column");
const googleSigninBtnEl = byId("google-signin-button");
const accountSlotEl = byId("account-slot");
const accountLabelEl = byId("account-label");
const accountDropdownEl = byId("account-dropdown");
const btnSignOut = byId("btn-sign-out");

export function setPageLocked(locked) {
  mainColumnEl.classList.toggle("page-locked", locked);
}

function showSignedOutUI() {
  setSessionToken(null);
  state.authorized = false;
  state.isAdmin = false;
  googleSigninBtnEl.hidden = false;
  accountSlotEl.hidden = true;
  accountDropdownEl.hidden = true;
  setPageLocked(true);
  // 回到未登入狀態時一併清掉連線提示——不清的話，先前的「正在連線…」
  // 或「此帳號尚未獲得授權」會留在畫面上，跟現在的登入按鈕互相矛盾。
  hideConnectionNotice();
  // 其他模組各自清掉自己的狀態（劇本案選擇、選項快取、各 Stage 的工作…）：
  // 同一個畫面換一個帳號登入後，不能還看得到上一個使用者的結果，下載鍵
  // 背後也不能還指著上一個使用者的 job。
  emit("auth:signed-out");
  refreshLockStates();
}

function showSignedInUI(email) {
  googleSigninBtnEl.hidden = true;
  accountSlotEl.hidden = false;
  accountLabelEl.textContent = email ? email.split("@")[0] : "帳號";
}

async function checkAuthStatus() {
  if (!getSessionToken()) {
    setPageLocked(true);
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/status`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    console.log("[auth] /auth/status →", res.status, data);
    if (res.status === 200) {
      state.authorized = !!data.authorized;
      state.isAdmin = !!data.is_admin;
      showSignedInUI(data.email);
      if (!state.authorized) {
        setPageLocked(true);
        showConnectionNotice("此帳號尚未獲得授權，請聯絡管理員。", true);
        showToast("此帳號尚未獲得授權", "error");
      } else {
        setPageLocked(false);
        hideConnectionNotice();
        emit("auth:authorized", { email: data.email, isAdmin: state.isAdmin });
      }
    } else {
      // token 過期或無效，視同沒登入，回到登入前的狀態
      showSignedOutUI();
      showToast("登入已過期，請重新登入", "error");
    }
  } catch (err) {
    // 網路層級的失敗（例如 CORS 被擋、連不上後端）：一定要讓使用者知道
    // 檢查失敗了，不能靜默鎖住、讓頁面莫名其妙變灰。
    console.error("[auth] checkAuthStatus 發生例外：", err);
    state.authorized = false;
    setPageLocked(true);
    showConnectionNotice(
      "無法連線到伺服器。\n" +
        "如果久未使用，伺服器可能正在冷啟動（約需 1 分鐘），請稍候再重新整理；" +
        "若持續失敗請檢查網路連線。",
      true
    );
    showToast("無法確認登入狀態，請檢查網路連線後重新整理", "error");
  }
}

// Google 回傳的 response.credential 是 Google ID Token（效期約 1 小時），
// 這裡換一次應用程式自己的 session token。不管成功還是失敗，都要呼叫
// settleReauthWaiters() 放行正在等重新登入的呼叫端，見 js/core/api.js。
// 桌面殼登入完成後會直接呼叫這支（見 js/core/bridge.js）。
async function handleCredentialResponse(response) {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: response.credential }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showSignedOutUI();
      settleReauthWaiters();
      showToast(data.error || "登入失敗，請再試一次", "error");
      return;
    }
    setSessionToken(data.session_token);
    settleReauthWaiters();
    checkAuthStatus();
  } catch (err) {
    console.error("[auth] 登入換發 session 失敗：", err);
    settleReauthWaiters();
    showToast("無法完成登入，請檢查網路連線後再試一次", "error");
  }
}

function initGoogleSignIn() {
  if (DESKTOP_MODE) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "desktop-signin-btn";
    btn.textContent = "使用 Google 帳戶登入";
    btn.addEventListener("click", () => {
      postToShell("desktopSignIn", {});
    });
    // 不用 replaceChildren()：它要 Safari 14，10.15 出廠的 Safari 13.0 沒有，
    // 呼叫下去是 TypeError，登入按鈕就整個出不來
    googleSigninBtnEl.innerHTML = "";
    googleSigninBtnEl.appendChild(btn);
  } else {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: true,
    });
    window.google.accounts.id.renderButton(googleSigninBtnEl, {
      theme: "outline",
      size: "medium",
      shape: "pill",
      text: "signin",
    });
  }

  setPageLocked(true);
  if (getSessionToken()) {
    // localStorage 裡已經有存起來的 token，直接拿去問後端還有沒有效——這就是
    // 「重新整理/重開 App 不會登出」的關鍵。先鎖住再問：Render 冷啟動實測
    // 可能超過一分鐘，沒鎖的話使用者會看到一個可以操作、但所有下拉選單都
    // 是空的表單。checkAuthStatus 三條路徑都會正確設定最終狀態。
    showConnectionNotice("正在連線到伺服器…\n如果久未使用，可能需要約 1 分鐘的冷啟動，請稍候。");
    checkAuthStatus();
  } else if (!DESKTOP_MODE) {
    // 瀏覽器裡如果還留著 Google 自己的登入狀態，嘗試靜默登入；不保證成功，
    // 失敗就維持鎖住，使用者自己按登入按鈕即可。
    window.google.accounts.id.prompt();
  }
}

export function initLogin() {
  exposeToShell("handleCredentialResponse", handleCredentialResponse);

  accountSlotEl.addEventListener("click", () => {
    accountDropdownEl.hidden = !accountDropdownEl.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!accountSlotEl.contains(e.target)) accountDropdownEl.hidden = true;
  });

  btnSignOut.addEventListener("click", (e) => {
    // 這個按鈕包在 account-slot 裡面，點擊事件會往上冒泡觸發 account-slot
    // 自己的「切換下拉選單開關」監聽器，把剛關好的下拉選單又扳回開啟
    e.stopPropagation();
    // 桌面版沒有初始化 Google Identity Services，物件雖然因為 <script>
    // 標籤還是存在，但在沒初始化過的狀態下呼叫它的方法，行為沒有保證。
    if (!DESKTOP_MODE) {
      window.google.accounts.id.disableAutoSelect();
    }
    // 讓後端也把這個 session 刪掉，登出應該要是真的登出。刻意不 await：
    // 失敗（例如網路問題）也不該擋住使用者登出。
    fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeaders() }).catch(() => {});
    showSignedOutUI();
  });

  initGoogleSignIn();
}
