// 「安裝說明」的內容來源是這個分支根目錄的 download_notice.txt
// （跟這個頁面同目錄、同樣由 GitHub Pages 服務）：維護者編輯那份
// 純文字檔、commit、push 即可更新這裡顯示的內容，不用碰這個頁面。
// 換行靠 .notice-text 的 white-space: pre-line 原樣呈現；用
// textContent 塞進去，檔案內容不會被當成 HTML 解析。
//
// 刻意讀同目錄的靜態檔、不打後端：這個頁面本來就是靜態站，繞去
// 後端只會讓安裝說明在後端休眠時卡在「載入中」、後端掛掉時整段
// 消失——而這段正是給還沒裝 App 的人看的。
//
// cache: "no-cache" 是每次都跟伺服器重新驗證（沒變就回 304），避免
// 改完文字之後瀏覽器還拿舊的快取顯示。
(function () {
  var el = document.getElementById("download-notice");
  fetch("download_notice.txt", { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(function (text) { el.textContent = text.trim() || "（目前沒有內容）"; })
    .catch(function () { el.textContent = "（載入失敗）"; });
})();
