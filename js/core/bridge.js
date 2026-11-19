// 跟桌面殼溝通的唯一出入口。
//
// 網頁 → 殼：window.webkit.messageHandlers.<channel>.postMessage(...)。這是
// WKWebView 的 API；Windows 殼（WebView2）沒有這個物件，殼自己在頁面載入前
// 注入一段 shim 補上，網頁不用分平台。目前的 channel：consoleLog、
// desktopSignIn、ocrService、activityGuard、legacyDownload、visionOcr
// （最後兩個只有 Mac 10.15 分流有；其他殼沒有註冊，用 hasShellChannel
// 判斷得出來）。
//
// 殼 → 網頁：殼用 evaluateJavaScript / ExecuteScriptAsync 直接執行一段 JS，
// 所以被呼叫的東西必須是 window 上的全域名稱。ES module 裡宣告的函式預設
// 不是全域的，一定要經過下面的 exposeToShell 掛上去，否則殼呼叫時只會得到
// ReferenceError，而且畫面上什麼都不會發生。目前殼會呼叫的：
// - handleCredentialResponse({credential, nonce})：系統瀏覽器登入完成（兩個殼
//   都有；nonce 是殼這次登入產生的原值，要跟 credential 一起送給後端）
// - window.__desktopSignInFailed(reason)：系統瀏覽器登入失敗（兩個殼都有）
// - showToast(message, type)：下載完成／失敗提示（Mac 殼；Windows 殼只在
//   拒絕存檔時呼叫）
// - window.__attemptAutoSaveBeforeSleep()：系統即將睡眠前搶救未下載的結果（Mac 殼）
// - window.__visionOcrProgress(payload)：10.15 分流的本機 OCR 進度（Mac 10.15；
//   名字裡的 vision 是當初用 Apple Vision framework 留下的，現在殼內嵌的是 Tesseract）
// 另外殼會直接寫入 window.__OCR_PORT__（本機 OCR 服務目前的 port）。
// 新增或改名任何一個，兩個殼的程式都要跟著改。

function handler(channel) {
  const webkit = window.webkit;
  if (!webkit || !webkit.messageHandlers) return null;
  return webkit.messageHandlers[channel] || null;
}

export function hasShellChannel(channel) {
  return handler(channel) !== null;
}

export function postToShell(channel, body) {
  const h = handler(channel);
  if (!h) {
    console.warn(`[bridge] 找不到桌面殼的 ${channel} channel，略過`);
    return;
  }
  h.postMessage(body);
}

export function exposeToShell(name, fn) {
  window[name] = fn;
}
