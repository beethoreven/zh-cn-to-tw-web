// 「阿舍老師的叮嚀」：內容來自後端 /api/ta-notice（不需要登入），維護者只要
// 編輯 zh-cn-to-tw-backend 的 ta-notice.txt、部署即可，前端與桌面版打包都
// 不用跟著動。1.x 的桌面版用 file:// 載入、讀不到本機檔案，才把內容搬到
// 後端；2.0 起其實讀得到了，但「改一個檔案不用重新打包 App」這個好處還在，
// 所以維持原樣。不受頁面鎖定影響，沒登入也看得到。

import { API_BASE } from "../core/config.js";
import { byId } from "../core/dom.js";

export async function initTaNotice() {
  const taNoticeText = byId("ta-notice-text");
  try {
    const res = await fetch(`${API_BASE}/api/ta-notice`);
    const data = await res.json();
    taNoticeText.textContent = data.text || "（目前沒有內容）";
  } catch (e) {
    taNoticeText.textContent = "（載入失敗）";
  }
}
