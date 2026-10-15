// 呼叫後端：登入憑證（session token）、自動附上憑證的 authedFetch，以及
// 憑證中途失效時「就地重新登入、再自動重打一次」的機制。
//
// 憑證是應用程式自己簽發的 session token（/auth/login 用 Google ID Token
// 換來的，見後端 auth_utils/sessions.py），不是 Google ID Token 本身——
// Google 的只活約 1 小時，直接拿來用會讓長時間的工作每小時被打斷一次，
// 甚至讓已經付費算出來的 LLM 結果存不下來（實測發生過）。session token
// 是滑動效期，只要還在用就不會過期。存在 localStorage：重新整理、重開
// App 都還在，只有明確登出才清掉。

import { DESKTOP_MODE, SESSION_TOKEN_STORAGE_KEY } from "./config.js";
import { postToShell } from "./bridge.js";
import { showToast } from "./toast.js";

let sessionToken = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);

export function getSessionToken() {
  return sessionToken;
}

export function setSessionToken(token) {
  sessionToken = token;
  if (token) {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  }
}

export function authHeaders() {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
}

// ===== 憑證中途失效時的重新登入 =====
//
// session 還是可能因為其他原因失效（管理員停用帳號、真的閒置太久），這時
// 401 代表的是「登入過，但這個 token 剛好在這個時間點失效」——如果跟真的
// 沒登入一樣直接判定失敗、清掉狀態，已經花了 LLM 費用算出來的結果會存不
// 下來。所以 authedFetch 撞到 401 時就地觸發一次重新登入，等拿到新 token
// 後用同一組參數自動重打一次，呼叫端完全不用知道中間發生過這件事。
// 管理員停用的帳號，重新登入本身會在 /auth/login 的白名單檢查失敗，不會
// 無限重試。

let reauthInFlight = false;
let reauthResolvers = [];

export function isReauthInFlight() {
  return reauthInFlight;
}

function triggerReauth() {
  if (DESKTOP_MODE) {
    postToShell("desktopSignIn", {});
  } else {
    window.google.accounts.id.prompt();
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

// 不管重新登入成功還是失敗，都要呼叫這支把等待中的呼叫端放行——失敗時
// 漏做的話 reauthInFlight 會永遠卡在 true：所有背景輪詢會永遠跳過，之後
// 任何 401 也不會再觸發新的一次重新登入，使用者只能整頁重新整理才能恢復。
export function settleReauthWaiters() {
  reauthInFlight = false;
  const resolvers = reauthResolvers;
  reauthResolvers = [];
  resolvers.forEach((resolve) => resolve());
}

// 除了不需要登入的端點（/api/health、/api/ta-notice、/auth/*）以外，所有
// 打後端的 fetch 都要透過這支。options.body 是字串或 FormData 時重打都安全
// （字串可重複使用，FormData 也不會因為傳給 fetch() 一次就被消耗掉）。
export async function authedFetch(url, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {}, authHeaders());
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  if (res.status !== 401 || !sessionToken) return res;
  requestReauthOnce();
  await waitForReauth();
  const retryHeaders = Object.assign({}, opts.headers || {}, authHeaders());
  return fetch(url, Object.assign({}, opts, { headers: retryHeaders }));
}

// 把非 2xx 的回應轉成例外，訊息優先用後端的 error 欄位
export async function errorFromResponse(res, fallback) {
  const data = await res.json().catch(() => ({}));
  const err = new Error(data.error || fallback);
  err.details = data.details;
  return err;
}
