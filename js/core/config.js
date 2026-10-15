// 網址參數與全域常數。整個前端只在這裡讀 window.location。
//
// 語法上限：這份前端的每一個檔案都不能用 ?? 與 ?.（空值合併與可選鏈）、
// ||= 之類的邏輯賦值、class 的 #private 欄位、頂層 await、String#replaceAll、
// Array#at——它們都需要比 Safari 13.0 新的版本，而 macOS 10.15 出廠是
// Safari 13.0，在那上面是**語法錯誤**：整個模組解析失敗、連帶 import 它的
// 模組全部不會執行，症狀是整頁看起來「載入了但什麼都沒有」。10.15 分流最低
// 支援到 10.15.0，所以這是整份前端的語法上限。ES module 本身 Safari 11 就
// 支援，沒有問題。

const params = new URLSearchParams(window.location.search);

// 用這個小工具取代 `params.get(k) ?? fallback`：URLSearchParams.get()
// 只會回傳 string 或 null（不會有 undefined），所以判斷 null 就等價於
// ?? 的行為，不能用 || ——那會把空字串也當成沒有值。
function paramOr(key, fallback) {
  const value = params.get(key);
  return value === null ? fallback : value;
}

// 預設「同源」（相對路徑），例外是 GitHub Pages 上的舊純網頁版，那裡沒有
// API 可以打，只能打 Render。桌面殼一律在網址帶 ?apiBase=<Render 網址>，
// 不會走到這兩個預設值。
const API_BASE_OVERRIDE = params.get("apiBase");
export const API_BASE =
  API_BASE_OVERRIDE !== null
    ? API_BASE_OVERRIDE
    : window.location.hostname.endsWith("github.io")
      ? "https://zh-cn-to-tw-backend.onrender.com"
      : "";

// ===== 桌面版 App =====
// 桌面殼（zh-cn-to-tw-mac / zh-cn-to-tw-windows）載入這個網頁時會在網址帶
// ?desktop=1&ocrToken=<殼啟動時產生的隨機值>&apiBase=...&appMajor=...&appMinor=...
// &osTier=...。有 desktop=1 時，Stage 1 的 PDF 先在本機做 OCR（見
// js/stages/ocr.js），再把文字送給 Render 後端潤飾。
export const DESKTOP_MODE = params.get("desktop") === "1";
export const DESKTOP_OCR_TOKEN = params.get("ocrToken") || "";
// 桌面殼自己的版本號，只有 major/minor 兩碼，跟後端 GET /api/version_check
// 的比較邏輯一致。
export const DESKTOP_APP_MAJOR = Number(paramOr("appMajor", "0"));
export const DESKTOP_APP_MINOR = Number(paramOr("appMinor", "0"));
// 這包桌面殼屬於哪一個版控分流："11+" 是 Mac 主線版，"10.15" 是部署目標
// 壓到 10.15 的分流（Stage 1 改用 Apple Vision framework 做 OCR，下載也要
// 走 legacyDownload，見 js/core/download.js），"windows" 是 Windows 版（刻意
// 用後端政策表裡不存在的值，見 known-issue-check 第 22 條）。跟後端
// GET /api/version_check 的 os_version 參數用同一套字串。
export const DESKTOP_OS_TIER = paramOr("osTier", "11+");

export const GOOGLE_CLIENT_ID = "415031055130-73moi9aantfm5hjojmt1r0isk2uo35mr.apps.googleusercontent.com";
export const SESSION_TOKEN_STORAGE_KEY = "ztw_session_token";

// 「個人專案」：所有人都能選的共用專案，固定 id=1（跟後端
// config.PERSONAL_PROJECT_ID 對齊）。刻意不用「owner 是不是 null」
// 判斷——實測發現 DB 裡這個專案的 owner 其實不是 null（是專案擁有者
// 自己的帳號），用 owner 判斷會整個失效；用固定 id 判斷不受 owner
// 欄位實際存什麼值影響。選到這個專案時，Claude model 選單要拿掉
// （後端也會擋，這裡只是視覺提示，不用重打一次 API 才知道要不要擋）。
export const PERSONAL_PROJECT_ID = 1;

// 後端在「個人專案」限制被違反時回傳的錯誤訊息：這兩種情況要跳 toast，
// 不是走一般的「上傳中→錯誤」內嵌狀態文字
export const PERSONAL_PROJECT_ERROR_MESSAGES = new Set(["個人專案不能使用 Claude Model", "個人專案使用量達上限"]);

// 新建專案時「負責人1」的預設值：專案擁有者自己的使用者 id
export const DEFAULT_PROJECT_OWNER_ID = 1;
