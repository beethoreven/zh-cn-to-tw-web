// 畫面提示：短暫的 toast，以及常駐的連線狀態提示。

import { byId } from "./dom.js";

const toastEl = byId("toast");
const connectionNoticeEl = byId("connection-notice");
let toastTimer = null;

// 桌面殼（Mac）也會直接呼叫這支顯示下載結果，見 js/core/bridge.js
export function showToast(message, type) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = "toast visible" + (type ? ` toast--${type}` : "");
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("visible");
  }, 3500);
}

// 連線狀態提示（#connection-notice）。跟 toast 分開的理由：toast 3.5 秒
// 就自動消失，而 Render 免費方案閒置後的冷啟動實測可能超過一分鐘——訊息
// 會在使用者還在等的時候就不見了。這個是常駐的，明確清掉才會消失。
export function showConnectionNotice(message, isError) {
  connectionNoticeEl.textContent = message;
  connectionNoticeEl.classList.toggle("is-error", !!isError);
  connectionNoticeEl.hidden = false;
}

export function hideConnectionNotice() {
  connectionNoticeEl.hidden = true;
  connectionNoticeEl.classList.remove("is-error");
}
