const desktopParams = new URLSearchParams(window.location.search);

// 預設「同源」：這份前端現在是由本機的 zh-cn-to-tw-backend 自己供應的
// （見該 repo 的 WEB_STATIC_DIR 設定），網頁跟 API 在同一個 origin
// （http://127.0.0.1:<backend 動態 port>），所以 API 路徑用相對路徑就好，
// 不需要、也不應該寫死任何主機位址或 port——port 每次啟動都不一樣。
// 同源還有一個附帶好處：完全不會有 CORS 問題。
//
// 例外只有一個：如果這份前端是從 GitHub Pages（*.github.io）載入的舊
// 純網頁版，那裡沒有 API 可以打，只能繼續打 Render。桌面版 App 已經
// 不走這條路了（整份前端包在 .app 裡、由本機 backend 供應）。
//
// 網址帶 ?apiBase=<url> 可以覆寫以上判斷，測試時要指到別的後端用。
const API_BASE_OVERRIDE = desktopParams.get("apiBase");
const API_BASE =
  API_BASE_OVERRIDE ??
  (window.location.hostname.endsWith("github.io")
    ? "https://zh-cn-to-tw-backend.onrender.com"
    : "");

// ===== 桌面版 App 偵測 =====
// 桌面殼（zh-cn-to-tw-mac / zh-cn-to-tw-windows）載入這個網頁時會在網址帶
// ?desktop=1&ocrPort=<本機服務 port>&ocrToken=<殼啟動時產生的隨機值>，有這個
// 標記時 Stage 1 送出的 PDF 要先送去本機的 zh-cn-to-tw-ocr-service 做 OCR，
// 再把辨識完的文字轉送給 Render 後端做潤飾，而不是像瀏覽器版那樣把整份
// PDF 直接丟給 Render（Render 免費方案扛不住 PaddleOCR，見 desktop_app_plan
// 設計文件）。純瀏覽器開啟（網址沒有這些參數）行為完全不受影響。
const DESKTOP_MODE = desktopParams.get("desktop") === "1";
const DESKTOP_OCR_PORT = desktopParams.get("ocrPort");
const DESKTOP_OCR_TOKEN = desktopParams.get("ocrToken") || "";
const DESKTOP_OCR_BASE =
  DESKTOP_MODE && DESKTOP_OCR_PORT ? `http://127.0.0.1:${DESKTOP_OCR_PORT}` : null;

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

// ===== Google 登入 =====
//
// 跟 fireless-war-web 同樣用 Google Identity Services + 後端白名單驗證
// 身份，但這裡多做一層：Google 登入成功後拿到的 ID Token 只用來跟後端
// 換一次應用程式自己簽發的 session token（/auth/login，見後端
// auth_utils/sessions.py），存進 localStorage 的是這個 session token，
// 不是 Google ID Token 本身。這麼做是因為 Google ID Token 效期固定約
// 1 小時，直接拿它當長效憑證用，會讓長時間的工作階段（Stage 1/校對，
// 尤其遇到額度限制、重試+指數退避時）每小時就被打斷一次，逼使用者
// 重新登入，甚至讓已經算好、要花錢的 LLM 結果來不及存下來（實測發生
// 過）。session token 效期是滑動式的（只要還在用就不會過期，見後端
// 說明），不受 Google 那個固定 1 小時的限制。
//
// localStorage 天生同網域跨分頁共用、重新整理不會消失，只有明確登出
// （removeItem，且會呼叫 /auth/logout 讓後端也刪掉這筆 session）或
// 使用者自己清瀏覽器資料才會不見，這樣才符合「重新整理不會登出、另開
// 分頁也在登入狀態、只有登出才清除」的需求。fireless-war-web 沒存
// token，靠的是 Google 自己的靜默登入 (prompt) 嘗試恢復，但那個機制
// 常被瀏覽器的第三方 cookie 限制擋掉，不可靠。

const GOOGLE_CLIENT_ID = "415031055130-73moi9aantfm5hjojmt1r0isk2uo35mr.apps.googleusercontent.com";
const SESSION_TOKEN_STORAGE_KEY = "ztw_session_token";

const containerEl = document.querySelector(".container");
// 鎖定效果特意套用在 .main-column（不是整個 .container）：CSS 的
// opacity 會透過合成往下影響所有子元素，子元素自己設 opacity:1 沒辦法
// 蓋掉父層的效果，唯一乾淨的解法是「鎖定的對象本身不要包含不該被鎖的
// 東西」——.sidebar-column（阿舍老師的叮嚀）是 .main-column 的手足，
// 不是子孫，這樣鎖定就完全影響不到它，不用把它搬到 DOM 樹外面
const mainColumnEl = document.querySelector(".main-column");
const adminContainerEl = document.getElementById("admin-container");
const adminToggleBtnEl = document.getElementById("admin-toggle-btn");
const googleSigninBtnEl = document.getElementById("google-signin-button");
const accountSlotEl = document.getElementById("account-slot");
const accountLabelEl = document.getElementById("account-label");
const accountDropdownEl = document.getElementById("account-dropdown");
const btnSignOut = document.getElementById("btn-sign-out");
const toastEl = document.getElementById("toast");

let currentSessionToken = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
let currentAuthorized = false;
let currentIsAdmin = false;
let showingAdminView = false;
let toastTimer = null;

// currentSessionToken 是應用程式自己簽發的 session token（見上面
// 「Google 登入」區塊的說明），效期是滑動式的，正常使用下不會在工作
// 到一半過期——但 session 還是可能因為其他原因失效（例如管理員在後台
// 把這個帳號停用、或是真的放到滑動視窗過期），這時 401 不代表「沒登入
// 過」，代表的是「登入過，但這個 token 剛好在這個時間點失效」——如果
// 跟真的沒登入一樣直接判定失敗/清掉狀態，會讓已經花了 LLM 費用算出來
// 的結果（校對 findings、Stage 1 結果）沒辦法存下來，使用者只能重新
// 跑一次，等於白花錢。這裡讓 authedFetch 在撞到 401 時就地觸發一次
// 重新登入、等到拿到新 token 後用同一組參數自動重打一次，呼叫端完全
// 不用知道中間發生過這件事。如果是管理員主動停用帳號，重新登入本身
// 會在 /auth/login 卡在白名單檢查那關失敗，不會無限重試，行為正確。
let reauthInFlight = false;
let reauthResolvers = [];

function triggerReauth() {
  if (DESKTOP_MODE) {
    window.webkit.messageHandlers.desktopSignIn.postMessage({});
  } else {
    google.accounts.id.prompt();
  }
}

// 同一次過期只觸發一次重新登入，不管同時有幾個請求撞到 401——不然背景
// 輪詢加上使用者手動點的按鈕，可能一次跳出好幾個系統瀏覽器分頁
function requestReauthOnce() {
  if (reauthInFlight) return;
  reauthInFlight = true;
  showToast("登入已過期，請重新登入以繼續（目前的工作進度不會遺失）", "error");
  triggerReauth();
}

// 等下一次重新登入成功——刻意不設逾時：使用者可能過一段時間才回來完成
// 系統瀏覽器那邊的登入，讓呼叫端這樣等著，好過顯示「工作不見了」這種
// 誤導訊息逼使用者重新上傳/重新校對
function waitForReauth() {
  return new Promise((resolve) => {
    reauthResolvers.push(resolve);
  });
}
let appDataLoaded = false; // Stage 1/2 的選項、使用量等資料只需要在授權後載入一次
let adminDataLoaded = false; // 管理員介面的下拉選單資料只需要在第一次打開時載入一次

// 使用者登入後必須先選定「本案處理劇本」並按下確定，下方 Stage 1/2
// 區塊才會解鎖——確定的專案 ID 之後每次呼叫 model 都會帶上，記進
// usage_log.project，讓「本案使用 Claude token 狀況」能統計出正確數字
let projectConfirmed = false;
let currentProjectId = null;

// 「個人專案」：沒有負責人、所有人都能選的共用專案（owner 是 null）。
// 選到這個專案時，Claude model 選單要拿掉（後端也會擋，這裡只是
// 視覺提示，不用重打一次 API 才知道要不要擋）。projectOwnerById 在
// loadMyProjects() 載入下拉選單時一起建立，key/value 都是數字（跟
// currentProjectId 型別一致），owner 是 null 就代表是個人專案。
let projectOwnerById = new Map();
let isPersonalProject = false;

// Stage 1/2 的完整 model 清單（含 Claude），從 /api/options、
// /api/review-options 抓回來後快取起來——選到個人專案時要把 Claude
// 選項從畫面上拿掉，不想因為這樣就多打一次 API，快取起來自己重新
// 算繪選單即可
let stage1AllOpts = null;
let stage2AllOpts = null;

// Stage 1/2 model 選單共用的算繪邏輯：excludeClaude 為 true 時，Claude
// 系列 model 完全不會出現在選單裡（不是 disabled 灰字，是直接不存在），
// 確保「選單面就不給選」；盡量保留原本選到的值，選不到才退回預設值
function renderModelOptions(selectEl, opts, descriptionsMap, excludeClaude) {
  const previousValue = selectEl.value;
  selectEl.innerHTML = "";
  for (const [value, info] of Object.entries(opts.models)) {
    if (excludeClaude && value.startsWith("claude")) continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = info.label;
    selectEl.appendChild(option);
    descriptionsMap[value] = info.description;
  }
  const hasOption = (v) => [...selectEl.options].some((o) => o.value === v);
  if (hasOption(previousValue)) {
    selectEl.value = previousValue;
  } else if (hasOption(opts.default_model)) {
    selectEl.value = opts.default_model;
  } else {
    selectEl.value = selectEl.options[0]?.value || "";
  }
}

// 選定劇本案之後呼叫：依目前是不是「個人專案」重新算繪 Stage 1/2
// 的 model 選單。opts 還沒載入過（理論上不會發生，appDataLoaded 一定
// 會先跑 loadOptions/loadReviewOptions）就跳過，避免噴錯
function applyModelRestrictionsForProject() {
  if (stage1AllOpts) {
    renderModelOptions(modelSelect, stage1AllOpts, modelDescriptions, isPersonalProject);
    modelHelp.textContent = modelDescriptions[modelSelect.value] || "";
  }
  if (stage2AllOpts) {
    renderModelOptions(reviewModelSelect, stage2AllOpts, reviewModelDescriptions, isPersonalProject);
    reviewModelHelp.textContent = reviewModelDescriptions[reviewModelSelect.value] || "";
  }
}

// 後端在「個人專案」限制被違反時回傳的錯誤訊息，跟 showToast 搭配用：
// 這兩種情況要跳 toast，不是走一般的「上傳中→錯誤」內嵌狀態文字
const PERSONAL_PROJECT_ERROR_MESSAGES = new Set(["個人專案不能使用 Claude Model", "個人專案使用量達上限"]);

function showToast(message, type) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = "toast visible" + (type ? ` toast--${type}` : "");
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("visible");
  }, 3500);
}

function authHeaders() {
  return currentSessionToken ? { Authorization: `Bearer ${currentSessionToken}` } : {};
}

// 除了 /api/health（keep-alive 用，刻意不需要登入）以外，其餘所有打
// 後端的 fetch 都要透過這支，自動帶上登入憑證——後端每一支保護路由
// 都會驗證這個 token，前端這裡只是負責把它附上去。
//
// 撞到 401 時會就地觸發一次重新登入，等到新 token 後用同一組 options
// 自動重打一次（見上面 requestReauthOnce/waitForReauth 的說明）——
// options.body 如果是字串（JSON.stringify 的結果）或 FormData，重打
// 完全沒問題：字串本來就能重複使用，FormData 也不會因為傳給 fetch()
// 一次就被消耗掉，兩種在這個檔案裡目前用到的 body 型別都安全。
async function authedFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  const res = await fetch(url, { ...options, headers });
  if (res.status !== 401 || !currentSessionToken) return res;
  requestReauthOnce();
  await waitForReauth();
  const retryHeaders = { ...(options.headers || {}), ...authHeaders() };
  return fetch(url, { ...options, headers: retryHeaders });
}

// 沒登入或未授權時，把主要內容區塊都鎖住（含純顯示的區塊，例如使用量
// 統計）——這只是視覺提示，devtools 拔掉也沒用，真正擋掉未授權存取的
// 是後端每支 API 自己驗證 token。「阿舍老師的叮嚀」刻意不受這個影響，
// 不需要登入就看得到（見 mainColumnEl 的說明）。
function setPageLocked(locked) {
  mainColumnEl.classList.toggle("page-locked", locked);
}

// 主介面／管理員介面二選一顯示，同一個按鈕在兩邊切換文字跟功能
function showMainView() {
  showingAdminView = false;
  containerEl.hidden = false;
  adminContainerEl.hidden = true;
  adminToggleBtnEl.textContent = "管理員介面";
}

function showAdminView() {
  showingAdminView = true;
  containerEl.hidden = true;
  adminContainerEl.hidden = false;
  adminToggleBtnEl.textContent = "使用者介面";
  if (!adminDataLoaded) {
    adminDataLoaded = true;
    initAdminPanels();
  }
}

adminToggleBtnEl.addEventListener("click", () => {
  if (showingAdminView) {
    showMainView();
  } else {
    showAdminView();
  }
});

function showSignedOutUI() {
  currentSessionToken = null;
  currentAuthorized = false;
  currentIsAdmin = false;
  localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  googleSigninBtnEl.hidden = false;
  accountSlotEl.hidden = true;
  accountDropdownEl.hidden = true;
  adminToggleBtnEl.hidden = true;
  showMainView();
  setPageLocked(true);

  // 登出後劇本案的選擇也要重置：下次登入（可能是別的使用者）必須
  // 重新選一次，不能沿用上一個帳號選過的專案
  projectConfirmed = false;
  currentProjectId = null;
  isPersonalProject = false;
  projectOwnerById = new Map();
  projectSelectEl.innerHTML = "";
  projectUsageBlockEl.hidden = true;
  refreshLockStates();

  // 這兩個旗標控制「這些資料只在登入後載入一次」——同一個分頁換帳號
  // 重新登入時要重置，不然新帳號會沿用舊帳號當初載入的資料，且
  // loadMyProjects 等呼叫因為旗標是 true 而完全不會再執行一次
  appDataLoaded = false;
  adminDataLoaded = false;

  resetJobAndReviewState();
}

function showSignedInUI(email) {
  googleSigninBtnEl.hidden = true;
  accountSlotEl.hidden = false;
  accountLabelEl.textContent = email ? email.split("@")[0] : "帳號";
}

async function checkAuthStatus() {
  if (!currentSessionToken) {
    setPageLocked(true);
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/status`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    console.log("[auth] /auth/status →", res.status, data);
    if (res.status === 200) {
      currentAuthorized = !!data.authorized;
      currentIsAdmin = !!data.is_admin;
      adminToggleBtnEl.hidden = !currentIsAdmin;
      showSignedInUI(data.email);
      if (!currentAuthorized) {
        setPageLocked(true);
        showToast("此帳號尚未獲得授權", "error");
      } else {
        setPageLocked(false);
        if (!appDataLoaded) {
          appDataLoaded = true;
          loadOptions();
          loadReviewOptions();
          loadUsage();
          loadMyProjects();
        }
      }
    } else {
      // token 過期或無效，視同沒登入，回到登入前的狀態
      showSignedOutUI();
      showToast("登入已過期，請重新登入", "error");
    }
  } catch (err) {
    // 網路層級的失敗（例如 CORS 被擋、連不上後端）——之前這裡完全沒有
    // 任何提示，使用者只會看到頁面莫名其妙鎖住，不知道發生了什麼事。
    // 一定要讓使用者知道檢查失敗了，不能靜默鎖住。
    console.error("[auth] checkAuthStatus 發生例外：", err);
    currentAuthorized = false;
    setPageLocked(true);
    showToast("無法確認登入狀態，請檢查網路連線後重新整理", "error");
  }
}

// Google 這裡回傳的 response.credential 是 Google ID Token，效期固定
// 約 1 小時——不能直接拿它當長效憑證用（見上面 reauthInFlight 附近的
// 說明），這裡换一次應用程式自己的 session token（/auth/login，見後端
// auth_utils/sessions.py），之後才是真正撐住整個工作階段的憑證。
// 不管這次重新登入成功還是失敗，都要把 reauthInFlight 重置、把在等
// waitForReauth() 的呼叫端放行——失敗時如果漏做這件事（例如帳號已經被
// 管理員停用，/auth/login 回 403；或換 session 這次呼叫本身網路失敗），
// reauthInFlight 會永遠卡在 true：所有背景輪詢會因為
// `if (reauthInFlight) return` 永遠跳過，之後任何 401 也再也不會觸發
// 新的一次重新登入（requestReauthOnce 一樣會被這個旗標擋掉），使用者
// 只能整頁重新整理才能恢復——這是比「單純登入失敗」更糟的卡死狀態，
// 一定要在成功/失敗兩條路徑都做這件事。
function settleReauthWaiters() {
  reauthInFlight = false;
  const resolvers = reauthResolvers;
  reauthResolvers = [];
  resolvers.forEach((resolve) => resolve());
}

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

    currentSessionToken = data.session_token;
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, currentSessionToken);
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
    // 桌面版 App：不用 Google Identity Services 在內嵌 WebView 裡跑登入
    // 彈出視窗——Google 會限制/降級內嵌瀏覽器裡的登入流程（實測撞過
    // window.open 被擋、CSP 錯誤、帳戶選擇視窗越開越多），改成點按鈕
    // 時請桌面殼用系統瀏覽器開一個真正的分頁完成登入，殼會在登入成功後
    // 自己呼叫 handleCredentialResponse()，後續驗證/儲存/更新 UI 完全
    // 沿用跟瀏覽器版一樣的邏輯，不用另外寫一份。
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "desktop-signin-btn";
    btn.textContent = "使用 Google 帳戶登入";
    btn.addEventListener("click", () => {
      window.webkit.messageHandlers.desktopSignIn.postMessage({});
    });
    googleSigninBtnEl.replaceChildren(btn);
  } else {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: true,
    });
    google.accounts.id.renderButton(googleSigninBtnEl, {
      theme: "outline",
      size: "medium",
      shape: "pill",
      text: "signin",
    });
  }

  if (currentSessionToken) {
    // localStorage 裡已經有存起來的 token，直接拿去問後端還有沒有效，
    // 不用等 Google 的靜默登入——這就是跟 fireless-war-web 不同、
    // 「重新整理/開新分頁不會登出」的關鍵
    checkAuthStatus();
  } else {
    setPageLocked(true);
    if (!DESKTOP_MODE) {
      // 瀏覽器裡如果還留著 Google 自己的登入狀態，嘗試靜默登入；
      // 不保證成功（可能被第三方 cookie 限制擋掉），失敗就維持鎖住，
      // 使用者自己按登入按鈕即可。桌面版沒有這個機制（系統瀏覽器登入
      // 走一次性流程，不是常駐在頁面裡的 GSI），使用者自己按登入按鈕
      // 即可，checkAuthStatus 401 時本來就會鎖回去。
      google.accounts.id.prompt();
    }
  }
}

initGoogleSignIn();

accountSlotEl.addEventListener("click", () => {
  accountDropdownEl.hidden = !accountDropdownEl.hidden;
});

document.addEventListener("click", (e) => {
  if (!accountSlotEl.contains(e.target)) {
    accountDropdownEl.hidden = true;
  }
});

btnSignOut.addEventListener("click", (e) => {
  // 這個按鈕包在 account-slot 裡面，點擊事件會往上冒泡觸發
  // account-slot 自己的「切換下拉選單開關」監聽器，把 showSignedOutUI()
  // 剛關好的下拉選單狀態又扳回開啟——擋掉冒泡，避免這個互相打架
  e.stopPropagation();
  // 桌面版沒有呼叫 google.accounts.id.initialize()（改用系統瀏覽器
  // 登入，見 initGoogleSignIn），這個物件雖然因為 <script> 標籤還是
  // 存在，但在沒初始化過的狀態下呼叫它的方法，行為沒有保證，不要冒險。
  if (!DESKTOP_MODE) {
    google.accounts.id.disableAutoSelect();
  }
  // 讓後端也把這個 session 刪掉，不是只有前端自己忘記它——不然同一個
  // token 理論上還能繼續打 API 直到滑動視窗自然過期，登出應該要是
  // 真的登出。這裡刻意不 await：失敗（例如網路問題）也不該擋住使用者
  // 登出，前端該清的狀態一樣清，最壞情況只是後端那筆 session 記錄要
  // 等滑動視窗自然過期，不影響使用者這邊「已經登出」的體感。
  fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeaders() }).catch(() => {});
  showSignedOutUI();
});

function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  // 後端檔名如果含中文（例如「朱懿安先行本.txt」），Flask send_file 對
  // 非 ASCII 檔名會同時送兩個參數：純 ASCII 的 filename="..."（中文字
  // 元整個被拿掉，剩下的常常只有副檔名）跟正確完整編碼過的
  // filename*=UTF-8''...——一定要優先抓後者，不然下載出來的檔名會變得
  // 面目全非（例如只剩「.txt」）。純 ASCII 檔名的情況下 Flask 只會送
  // 前者，所以還是要留著這個 fallback。
  const extendedMatch = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extendedMatch) {
    return decodeURIComponent(extendedMatch[1]);
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  return plainMatch ? plainMatch[1] : fallback;
}

// 下載端點需要帶登入憑證，不能像以前那樣直接用 <a href> 導覽（那樣
// 沒辦法附加 Authorization header）——改成用 fetch 把檔案內容抓成
// blob，再組一個暫時的下載連結，檔名從後端回傳的 Content-Disposition
// header 還原（後端 CORS 設定裡有把這個 header 明確曝露給前端 JS）。
async function downloadViaAuthedFetch(url, fallbackFilename) {
  const res = await authedFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "下載失敗");
  }
  const blob = await res.blob();
  const filename = filenameFromContentDisposition(
    res.headers.get("Content-Disposition"),
    fallbackFilename
  );
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

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

const projectSelectEl = document.getElementById("project-select");
const projectConfirmBtnEl = document.getElementById("project-confirm-btn");
const projectUsageBlockEl = document.getElementById("project-usage-block");
const projectUsageListEl = document.getElementById("project-usage-list");

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

// 純靜態內容，跟網頁本身放在一起、不用登入也看得到，所以不透過後端
// API（不用 authedFetch、不用等登入），直接抓同源的純文字檔案
async function loadTeacherNotice() {
  const teacherNoticeText = document.getElementById("teacher-notice-text");
  try {
    const res = await fetch("teacher-notice.txt");
    const text = await res.text();
    teacherNoticeText.textContent = text || "（目前沒有內容）";
  } catch (e) {
    teacherNoticeText.textContent = "（載入失敗）";
  }
}

async function loadOptions() {
  const res = await authedFetch(`${API_BASE}/api/options`);
  const opts = await res.json();
  stage1AllOpts = opts;

  renderModelOptions(modelSelect, opts, modelDescriptions, isPersonalProject);
  modelHelp.textContent = modelDescriptions[modelSelect.value] || "";
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
  const res = await authedFetch(`${API_BASE}/api/usage`);
  const usage = await res.json();

  const opts = await (await authedFetch(`${API_BASE}/api/options`)).json();

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

// Claude 用量統計三個地方共用的算繪邏輯（本案使用狀況／管理員總使用量）：
// 資料形狀都是 {models: {model: {input_tokens, output_tokens, twd_cost}}}
function renderClaudeUsageRows(listEl, data, modelInfoMap) {
  listEl.innerHTML = "";
  for (const [model, info] of Object.entries(data.models)) {
    const label = modelInfoMap[model]?.label || model;
    const totalTokens = info.input_tokens + info.output_tokens;
    const row = document.createElement("div");
    row.className = "usage-row";
    row.textContent = `${label}：${totalTokens.toLocaleString()} tokens / 約 NT$${info.twd_cost.toFixed(2)}`;
    listEl.appendChild(row);
  }
}

async function loadMyProjects() {
  const res = await authedFetch(`${API_BASE}/api/my-projects`);
  const data = await res.json();

  projectSelectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "請選擇劇本案";
  projectSelectEl.appendChild(placeholder);
  projectOwnerById = new Map();
  for (const project of data.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelectEl.appendChild(option);
    projectOwnerById.set(project.id, project.owner);
  }
}

async function loadProjectUsage() {
  if (!currentProjectId) return;
  const res = await authedFetch(`${API_BASE}/api/usage/project/${currentProjectId}`);
  const data = await res.json();

  const reviewOpts = await (await authedFetch(`${API_BASE}/api/review-options`)).json();

  renderClaudeUsageRows(projectUsageListEl, data, reviewOpts.models);
}

projectConfirmBtnEl.addEventListener("click", () => {
  if (!projectSelectEl.value) {
    showToast("尚未選擇專案", "error");
    return;
  }
  currentProjectId = Number(projectSelectEl.value);
  isPersonalProject = projectOwnerById.get(currentProjectId) === null;
  applyModelRestrictionsForProject();
  projectConfirmed = true;
  refreshLockStates();
  projectUsageBlockEl.hidden = false;
  loadProjectUsage();
});

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
  formData.append("project", currentProjectId);

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

  // 上一個檔案如果已經跑完 Stage 2、留有校對結果／下載鍵／重新校對鍵
  // 還能按，這裡要一併清掉——不然這些畫面跟按鍵會一直指向舊檔案的
  // review_id，讓人誤以為是這次剛上傳的檔案的結果
  currentReviewId = null;
  clearInterval(reviewPollTimer);
  renderedReviewLogCount = 0;
  reviewProgress.hidden = true;
  reviewLogList.innerHTML = "";
  reviewFindingsSection.hidden = true;
  findingsList.innerHTML = "";
  reviewDownloadBtn.disabled = true;
  rerunBtn.disabled = true;

  try {
    let jobId;
    if (DESKTOP_OCR_BASE) {
      statusText.textContent = "本機 OCR 辨識中";
      const ocrFormData = new FormData();
      ocrFormData.append("file", file);
      ocrFormData.append("dpi", dpiInput.value);
      ocrFormData.append("detect_cover", detectCoverToggle.checked ? "true" : "false");

      const startRes = await fetch(`${DESKTOP_OCR_BASE}/ocr/pdf/start`, {
        method: "POST",
        headers: { "X-OCR-Token": DESKTOP_OCR_TOKEN },
        body: ocrFormData,
      });
      if (!startRes.ok) {
        const err = await startRes.json();
        throw new Error(err.error || "本機 OCR 辨識失敗");
      }
      const { job_id: ocrJobId } = await startRes.json();
      const { pages } = await pollLocalOcrJob(ocrJobId);

      statusText.textContent = "上傳中";
      const res = await authedFetch(`${API_BASE}/api/jobs/from-ocr-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages,
          model: modelSelect.value,
          batch_pages: batchSelect.value,
          max_retry: retryInput.value,
          file_name: file.name,
          project: currentProjectId,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "上傳失敗");
      }
      ({ job_id: jobId } = await res.json());
    } else {
      const res = await authedFetch(`${API_BASE}/api/jobs`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "上傳失敗");
      }
      ({ job_id: jobId } = await res.json());
    }
    pollJob(jobId);
  } catch (e) {
    if (PERSONAL_PROJECT_ERROR_MESSAGES.has(e.message)) {
      showToast(e.message, "error");
      statusBox.hidden = true;
      stage1Started = false;
    } else {
      statusText.textContent = `錯誤：${e.message}`;
    }
    isProcessing = false;
    refreshLockStates();
  }
});

// 本機 ocr-service 的 /ocr/pdf/start 只負責啟動、立刻回 job_id，實際的
// 逐頁 OCR 在它自己的背景執行緒跑，這裡輪詢 /ocr/pdf/status/<job_id> 拿
// 進度——跟下面 pollJob() 對 Render 後端 job 的輪詢是同一種模式，只是這支
// 是本機服務、沒有 authedFetch 需要的登入 token，改帶 X-OCR-Token。
function pollLocalOcrJob(jobId) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      let res, job;
      try {
        res = await fetch(`${DESKTOP_OCR_BASE}/ocr/pdf/status/${jobId}`, {
          headers: { "X-OCR-Token": DESKTOP_OCR_TOKEN },
        });
        job = await res.json();
      } catch (e) {
        // 網路暫時性錯誤，下一輪再試，不要整個停掉（跟 pollJob 一致的處理方式）
        return;
      }

      if (!res.ok || job.status === "failed") {
        clearInterval(timer);
        reject(new Error(job.error || "本機 OCR 辨識失敗"));
        return;
      }

      if (job.status === "done") {
        clearInterval(timer);
        resolve(job);
        return;
      }

      statusText.textContent = job.total_pages
        ? `本機 OCR 辨識中（第 ${job.current_page}/${job.total_pages} 頁）`
        : "本機 OCR 辨識中";
    }, 1500);
  });
}

function pollJob(jobId) {
  pollTimer = setInterval(async () => {
    // 已經有一次重新登入在等使用者完成，這一輪先跳過，不要每 1.5 秒
    // 就再打一次注定又是 401 的請求（見 requestReauthOnce 的說明）
    if (reauthInFlight) return;
    let res, job;
    try {
      res = await authedFetch(`${API_BASE}/api/jobs/${jobId}`);
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

downloadBtn.addEventListener("click", async () => {
  if (!currentJobId) return;
  const format = docxToggle.checked ? "docx" : "txt";
  const url = `${API_BASE}/api/jobs/${currentJobId}/download?format=${format}`;
  try {
    await downloadViaAuthedFetch(url, `download.${format}`);
  } catch (e) {
    showToast(e.message, "error");
  }
});

// 只有使用者本來就停留在（或接近）最底部時，新 log 進來才跟著捲到底；
// 如果使用者已經往上捲去看之前的內容，新 log 進來不該把他們強制拉回
// 最底部，不然完全沒辦法邊跑邊往上看舊的 log
function isNearBottom(el, threshold = 24) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function renderNewLogs(logs) {
  const shouldStickToBottom = isNearBottom(logList);
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
  if (shouldStickToBottom) {
    logList.scrollTop = logList.scrollHeight;
  }
}

// --- Stage 2：校對 ---

async function loadReviewOptions() {
  const res = await authedFetch(`${API_BASE}/api/review-options`);
  const opts = await res.json();
  stage2AllOpts = opts;

  renderModelOptions(reviewModelSelect, opts, reviewModelDescriptions, isPersonalProject);
  reviewModelHelp.textContent = reviewModelDescriptions[reviewModelSelect.value] || "";
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
//
// !projectConfirmed 額外 AND 進 Stage 1/2 的鎖定條件：登入後上方的
// 「本案處理劇本」選單本身不受這個限制（一登入就能選、按確定），但
// 下方的 Stage 1/2 區塊要等選定劇本案並按下確定後才解鎖。
function refreshLockStates() {
  setStage1FormLocked(isProcessing || !projectConfirmed);
  setDirectUploadLocked(stage1Started || isProcessing || !projectConfirmed);
  setStage2Locked(isProcessing || !stage2Unlocked || !projectConfirmed);
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
    const res = await authedFetch(`${API_BASE}/api/jobs/direct-upload`, {
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

// 登出時要把 Stage 1/2 的整個工作狀態歸零，不然同一個分頁換一個帳號
// 登入後，還會看到上一個使用者的 job/review 結果、下載鍵/重新校對鍵
// 也還是可以按（背後其實是打上一個使用者留下來的 job_id/review_id）。
// 還在跑的輪詢也要清掉，不然它會在新的登入狀態下繼續覆寫畫面。
function resetJobAndReviewState() {
  clearInterval(pollTimer);
  clearInterval(reviewPollTimer);
  currentJobId = null;
  currentReviewId = null;
  stage1Started = false;
  isProcessing = false;
  stage2Unlocked = false;
  renderedLogCount = 0;
  renderedReviewLogCount = 0;
  statusBox.hidden = true;
  logList.innerHTML = "";
  downloadBtn.disabled = true;
  startReviewBtn.disabled = true;
  reviewProgress.hidden = true;
  reviewLogList.innerHTML = "";
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
  formData.append("project", currentProjectId);

  isProcessing = true;
  refreshLockStates();
  resetReviewUI();

  try {
    const res = await authedFetch(`${API_BASE}/api/jobs/${currentJobId}/review`, {
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
    if (PERSONAL_PROJECT_ERROR_MESSAGES.has(e.message)) {
      showToast(e.message, "error");
      reviewProgress.hidden = true;
    } else {
      reviewStatusText.textContent = `錯誤：${e.message}`;
    }
    isProcessing = false;
    refreshLockStates();
  }
}

function pollReview(reviewId) {
  reviewPollTimer = setInterval(async () => {
    if (reauthInFlight) return;
    let res, review;
    try {
      res = await authedFetch(`${API_BASE}/api/reviews/${reviewId}`);
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
    loadProjectUsage();

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
  const shouldStickToBottom = isNearBottom(reviewLogList);
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
  if (shouldStickToBottom) {
    reviewLogList.scrollTop = reviewLogList.scrollHeight;
  }
}

function renderFindings(findings) {
  reviewFindingsSection.hidden = false;
  findingsList.innerHTML = "";
  findingsCount.textContent = `共找到 ${findings.length} 筆建議（預設全不選，勾選代表套用）`;

  for (const finding of findings) {
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
    const res = await authedFetch(`${API_BASE}/api/reviews/${currentReviewId}/apply`, {
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

reviewDownloadBtn.addEventListener("click", async () => {
  if (!currentReviewId) return;
  const format = reviewDocxToggle.checked ? "docx" : "txt";
  const url = `${API_BASE}/api/reviews/${currentReviewId}/download?format=${format}`;
  try {
    await downloadViaAuthedFetch(url, `download.${format}`);
  } catch (e) {
    showToast(e.message, "error");
  }
});

rerunBtn.addEventListener("click", async () => {
  if (!currentReviewId) return;

  const formData = new FormData();
  formData.append("model", reviewModelSelect.value);
  formData.append("batch_chars", reviewBatchSelect.value);
  formData.append("max_retry", reviewRetryInput.value);
  formData.append("project", currentProjectId);

  isProcessing = true;
  refreshLockStates();
  resetReviewUI();

  try {
    const res = await authedFetch(`${API_BASE}/api/reviews/${currentReviewId}/rerun`, {
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
    if (PERSONAL_PROJECT_ERROR_MESSAGES.has(e.message)) {
      showToast(e.message, "error");
      reviewProgress.hidden = true;
    } else {
      reviewStatusText.textContent = `錯誤：${e.message}`;
    }
    isProcessing = false;
    refreshLockStates();
  }
});

refreshLockStates();
// 注意：loadOptions/loadReviewOptions/loadUsage/loadMyProjects 不在這裡
// 無條件呼叫——這些都是受保護的 API，沒登入會直接 401。改成在
// checkAuthStatus() 確認授權成功後才觸發（見上方「Google 登入」區塊），
// 避免頁面一載入就打一堆註定失敗的請求。
//
// loadTeacherNotice 是例外：內容是純靜態檔案、不需要登入，所以無論有
// 沒有登入都直接載入，且不受下面的 page-locked 視覺鎖定影響
// （CSS 裡對 .sidebar-column 有特別排除）。
loadTeacherNotice();

// ===== 管理員介面 =====

const adminTabBtns = document.querySelectorAll(".admin-tab-btn");
const adminPanels = {
  users: document.getElementById("admin-panel-users"),
  permissions: document.getElementById("admin-panel-permissions"),
  projects: document.getElementById("admin-panel-projects"),
};
const adminUsageTotalsListEl = document.getElementById("admin-usage-totals-list");

async function loadAdminUsageTotals() {
  const res = await authedFetch(`${API_BASE}/admin/usage/totals`);
  const data = await res.json();

  const reviewOpts = await (await authedFetch(`${API_BASE}/api/review-options`)).json();

  renderClaudeUsageRows(adminUsageTotalsListEl, data, reviewOpts.models);
}

adminTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    adminTabBtns.forEach((b) => b.classList.toggle("active", b === btn));
    for (const [key, panel] of Object.entries(adminPanels)) {
      panel.hidden = key !== btn.dataset.tab;
    }
  });
});

function populateSelect(selectEl, items, valueKey, labelKey) {
  selectEl.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    selectEl.appendChild(opt);
  }
}

function setFieldsDisabled(fieldEls, disabled) {
  fieldEls.forEach((el) => (el.disabled = disabled));
}

function initAdminPanels() {
  loadAdminUsageTotals();
  initUsersPanel();
  initPermissionsPanel();
  initProjectsPanel();
}

// --- 使用者管理 ---

function initUsersPanel() {
  const selectEl = document.getElementById("admin-user-select");
  const loadBtn = document.getElementById("admin-user-load-btn");
  const editBtn = document.getElementById("admin-user-edit-btn");
  const newBtn = document.getElementById("admin-user-new-btn");
  const fieldsEl = document.getElementById("admin-user-fields");
  const idFieldEl = document.getElementById("admin-user-id-field");
  const idEl = document.getElementById("admin-user-id");
  const emailEl = document.getElementById("admin-user-email");
  const nameEl = document.getElementById("admin-user-name");
  const roleEl = document.getElementById("admin-user-role");
  const statusEl = document.getElementById("admin-user-status");
  const createActionsEl = document.getElementById("admin-user-create-actions");
  const createSubmitBtn = document.getElementById("admin-user-create-submit-btn");
  const createCancelBtn = document.getElementById("admin-user-create-cancel-btn");
  const projectsBlockEl = document.getElementById("admin-user-projects-block");
  const projectsListEl = document.getElementById("admin-user-projects-list");
  const editableFields = [emailEl, nameEl, roleEl, statusEl];

  let currentUserId = null;
  let editing = false;

  // 讀取某個使用者之後，順便列出他名下負責的專案（不含 closed，
  // closed 的專案對「這個人手上還有哪些案子」這件事已經沒有意義）
  async function loadUserProjects(userId) {
    projectsListEl.textContent = "載入中…";
    projectsBlockEl.hidden = false;
    try {
      const res = await authedFetch(`${API_BASE}/admin/users/${userId}/projects`);
      if (!res.ok) throw new Error((await res.json()).error || "讀取專案清單失敗");
      const data = await res.json();
      projectsListEl.innerHTML = "";
      if (data.projects.length === 0) {
        const row = document.createElement("div");
        row.className = "usage-row";
        row.textContent = "目前沒有負責中的專案";
        projectsListEl.appendChild(row);
      } else {
        for (const project of data.projects) {
          const row = document.createElement("div");
          row.className = "usage-row";
          row.textContent = `${project.name}：${project.status}`;
          projectsListEl.appendChild(row);
        }
      }
    } catch (e) {
      projectsListEl.textContent = "（載入失敗）";
    }
  }

  async function refreshMemberOptions() {
    const res = await authedFetch(`${API_BASE}/admin/users`);
    const data = await res.json();
    // 名字沒填的話退回顯示信箱，避免下拉選單出現空白選項
    const users = data.users.map((u) => ({ ...u, label: u.name || u.email }));
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
    setFieldsDisabled(editableFields, true);
    idEl.disabled = true;
    editBtn.textContent = "編輯";
    editBtn.disabled = true;
    currentUserId = null;
    projectsBlockEl.hidden = true;
  }

  loadBtn.addEventListener("click", async () => {
    const userId = selectEl.value;
    if (!userId) {
      showToast("請先選擇要讀取的成員", "error");
      return;
    }
    try {
      const res = await authedFetch(`${API_BASE}/admin/users/${userId}`);
      if (!res.ok) throw new Error((await res.json()).error || "讀取失敗");
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
      setFieldsDisabled(editableFields, true);
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
      setFieldsDisabled(editableFields, false);
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
      if (!res.ok) throw new Error((await res.json()).error || "儲存失敗");
      const data = await res.json();
      showToast(data.changed ? "已儲存" : "無任何修改", data.changed ? "success" : undefined);
      editing = false;
      setFieldsDisabled(editableFields, true);
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
    // 新建使用者預設角色：明確排除 admin，不要依賴選項在陣列裡的
    // 順序（萬一 API 回傳順序改變，或未來多了別的非管理員角色，
    // 「挑最後一個」這種寫法可能會不小心把新使用者預設成管理員）
    const defaultRoleOption = [...roleEl.options].find((o) => o.textContent !== "admin");
    roleEl.value = defaultRoleOption ? defaultRoleOption.value : roleEl.options[0]?.value || "";
    statusEl.value = "active";
    fieldsEl.hidden = false;
    createActionsEl.hidden = false;
    setFieldsDisabled(editableFields, false);
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
      if (!res.ok) throw new Error((await res.json()).error || "建立失敗");
      showToast("已建立", "success");
      resetToViewMode();
      await refreshMemberOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  resetToViewMode();
  refreshRoleOptions();
  refreshMemberOptions();
}

// --- 權限管理 ---

function initPermissionsPanel() {
  const selectEl = document.getElementById("admin-permission-select");
  const loadBtn = document.getElementById("admin-permission-load-btn");
  const editBtn = document.getElementById("admin-permission-edit-btn");
  const fieldsEl = document.getElementById("admin-permission-fields");
  const idEl = document.getElementById("admin-permission-id");
  const roleEl = document.getElementById("admin-permission-role");
  const haikuEl = document.getElementById("admin-permission-haiku");
  const editableFields = [roleEl, haikuEl];

  let currentPermissionId = null;
  let editing = false;

  async function refreshPermissionOptions() {
    // 這裡兩個下拉都要更新：選擇要讀取哪個權限(排除管理員)，
    // 以及編輯時「權限」欄位本身可以改成哪些角色名稱(同樣排除管理員)
    const res = await authedFetch(`${API_BASE}/admin/permissions`);
    const data = await res.json();
    populateSelect(selectEl, data.permissions, "id", "role");
    populateSelect(roleEl, data.permissions, "role", "role");
  }

  function resetToViewMode() {
    editing = false;
    fieldsEl.hidden = true;
    setFieldsDisabled(editableFields, true);
    editBtn.textContent = "編輯";
    editBtn.disabled = true;
    currentPermissionId = null;
  }

  loadBtn.addEventListener("click", async () => {
    const permissionId = selectEl.value;
    if (!permissionId) {
      showToast("請先選擇要讀取的權限", "error");
      return;
    }
    try {
      const res = await authedFetch(`${API_BASE}/admin/permissions/${permissionId}`);
      if (!res.ok) throw new Error((await res.json()).error || "讀取失敗");
      const permission = await res.json();
      currentPermissionId = permission.id;
      editing = false;
      idEl.value = permission.id;
      roleEl.value = permission.role;
      haikuEl.value = permission.allowed_haiku;
      fieldsEl.hidden = false;
      setFieldsDisabled(editableFields, true);
      editBtn.disabled = false;
      editBtn.textContent = "編輯";
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  editBtn.addEventListener("click", async () => {
    if (!editing) {
      editing = true;
      setFieldsDisabled(editableFields, false);
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
      if (!res.ok) throw new Error((await res.json()).error || "儲存失敗");
      const data = await res.json();
      showToast(data.changed ? "已儲存" : "無任何修改", data.changed ? "success" : undefined);
      editing = false;
      setFieldsDisabled(editableFields, true);
      editBtn.textContent = "編輯";
      await refreshPermissionOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  resetToViewMode();
  refreshPermissionOptions();
}

// --- 專案管理 ---

function initProjectsPanel() {
  const selectEl = document.getElementById("admin-project-select");
  const loadBtn = document.getElementById("admin-project-load-btn");
  const editBtn = document.getElementById("admin-project-edit-btn");
  const newBtn = document.getElementById("admin-project-new-btn");
  const fieldsEl = document.getElementById("admin-project-fields");
  const idFieldEl = document.getElementById("admin-project-id-field");
  const idEl = document.getElementById("admin-project-id");
  const nameEl = document.getElementById("admin-project-name");
  const ownerEl = document.getElementById("admin-project-owner");
  const statusEl = document.getElementById("admin-project-status");
  const createActionsEl = document.getElementById("admin-project-create-actions");
  const createSubmitBtn = document.getElementById("admin-project-create-submit-btn");
  const createCancelBtn = document.getElementById("admin-project-create-cancel-btn");
  const editableFields = [nameEl, ownerEl, statusEl];

  let currentProjectId = null;
  let editing = false;

  async function refreshProjectOptions() {
    const res = await authedFetch(`${API_BASE}/admin/projects`);
    const data = await res.json();
    populateSelect(selectEl, data.projects, "id", "name");
  }

  async function refreshOwnerOptions() {
    // 只列出 active 的使用者，deactive 的不能被指派為新的負責人
    const res = await authedFetch(`${API_BASE}/admin/users/active-names`);
    const data = await res.json();
    populateSelect(ownerEl, data.users, "id", "name");
  }

  function resetToViewMode() {
    editing = false;
    fieldsEl.hidden = true;
    createActionsEl.hidden = true;
    idFieldEl.hidden = false;
    setFieldsDisabled(editableFields, true);
    editBtn.textContent = "編輯";
    editBtn.disabled = true;
    currentProjectId = null;
  }

  loadBtn.addEventListener("click", async () => {
    const projectId = selectEl.value;
    if (!projectId) {
      showToast("請先選擇要讀取的專案", "error");
      return;
    }
    try {
      await refreshOwnerOptions();
      const res = await authedFetch(`${API_BASE}/admin/projects/${projectId}`);
      if (!res.ok) throw new Error((await res.json()).error || "讀取失敗");
      const project = await res.json();
      currentProjectId = project.id;
      editing = false;
      idFieldEl.hidden = false;
      idEl.value = project.id;
      nameEl.value = project.name;
      // 負責人可能是目前已 deactive、active-only 下拉選單裡搜尋不到的人——
      // 這種情況原本會讓 <select> 選不中任何選項，.value 變成空字串，
      // 「不改負責人」按儲存時反而把 owner 意外送成空字串(轉數字後是 0)，
      // 悄悄把負責人改壞。這裡額外補一個選項，確保畫面正確顯示、
      // 「不改負責人」時儲存的還是原本的 owner id；要換人才必須換成
      // active 名單裡的人。
      ownerEl.value = project.owner;
      if (ownerEl.value !== String(project.owner)) {
        const deactiveOwnerOption = document.createElement("option");
        deactiveOwnerOption.value = project.owner;
        deactiveOwnerOption.textContent = `${project.owner_name || project.owner}（已停用）`;
        ownerEl.appendChild(deactiveOwnerOption);
        ownerEl.value = project.owner;
      }
      statusEl.value = project.status;
      fieldsEl.hidden = false;
      createActionsEl.hidden = true;
      setFieldsDisabled(editableFields, true);
      editBtn.disabled = false;
      editBtn.textContent = "編輯";
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  editBtn.addEventListener("click", async () => {
    if (!editing) {
      editing = true;
      setFieldsDisabled(editableFields, false);
      editBtn.textContent = "儲存";
      return;
    }

    try {
      const res = await authedFetch(`${API_BASE}/admin/projects/${currentProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameEl.value.trim(),
          owner: Number(ownerEl.value),
          status: statusEl.value,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "儲存失敗");
      const data = await res.json();
      showToast(data.changed ? "已儲存" : "無任何修改", data.changed ? "success" : undefined);
      editing = false;
      setFieldsDisabled(editableFields, true);
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
    ownerEl.value = ownerEl.options[0]?.value || "";
    statusEl.value = "pending";
    fieldsEl.hidden = false;
    createActionsEl.hidden = false;
    setFieldsDisabled(editableFields, false);
    editBtn.disabled = true;
  });

  createCancelBtn.addEventListener("click", resetToViewMode);

  createSubmitBtn.addEventListener("click", async () => {
    try {
      const res = await authedFetch(`${API_BASE}/admin/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameEl.value.trim(),
          owner: Number(ownerEl.value),
          status: statusEl.value,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "建立失敗");
      showToast("已建立", "success");
      resetToViewMode();
      await refreshProjectOptions();
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  resetToViewMode();
  refreshProjectOptions();
}
