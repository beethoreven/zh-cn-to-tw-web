// 強制更新檢查與後端保活。

import {
  API_BASE,
  DESKTOP_APP_MAJOR,
  DESKTOP_APP_MINOR,
  DESKTOP_OS_TIER,
} from "./config.js";

// 強制更新時請使用者去下載新版的地方。刻意寫死在這裡、跟 App 一起打包，不用
// 後端回傳的 update_url：網址由伺服器決定的話，後端被入侵或資料被竄改時，
// 這個由 App 自己跳出來、使用者最容易相信的提示，就能把人導去假的下載頁、
// 下載被換過的安裝檔。後端仍然回傳 update_url，給還沒更新的舊版用。
const DOWNLOAD_PAGE_URL = "https://beethoreven.github.io/zh-cn-to-tw-web/";

// 在真的要開始任何一個 Stage 之前檢查有沒有被要求強制更新。回傳 true 代表可以繼續，
// false 代表被擋下來，呼叫端要直接 return。查詢本身失敗（網路問題、
// backend 還在冷啟動）視為不擋：查不到版本狀態不該變成擋住使用者工作的
// 理由，這個檢查只在明確查到「版本太舊」時才生效。
//
// 查哪一列門檻：Mac 送 os=macos、os_version=分流（11+／10.15）；Windows 沒有
// 分流，送 os=windows、os_version=default。後端只認門檻表裡有的組合，送錯
// 的一律被要求更新，所以這裡送的值要跟表裡的資料列一致。
function versionCheckKey() {
  if (DESKTOP_OS_TIER === "windows") return { os: "windows", osVersion: "default" };
  return { os: "macos", osVersion: DESKTOP_OS_TIER };
}

export async function checkVersionOrBlock() {
  const key = versionCheckKey();
  let data;
  try {
    const res = await fetch(
      `${API_BASE}/api/version_check?os=${key.os}&os_version=${encodeURIComponent(key.osVersion)}` +
        `&major=${DESKTOP_APP_MAJOR}&minor=${DESKTOP_APP_MINOR}`
    );
    data = await res.json();
  } catch (e) {
    return true;
  }
  if (!data.force_update) return true;
  alert(
    `目前 App 版本過舊（最低需求版本 ${data.min_version}），請先更新才能繼續使用。\n\n請至以下網址下載最新版本：\n${DOWNLOAD_PAGE_URL}`
  );
  return false;
}

// Render 免費方案閒置約 15 分鐘會休眠。只要這個畫面還開著，就自己每 5 分鐘
// 打一次 /api/health（公開端點，不需要登入），確保使用中途不會被判定閒置。
// 一開始就先打一次，盡量提早把可能還在睡的後端叫醒。
export function startKeepAlive() {
  const ping = () => {
    fetch(`${API_BASE}/api/health`).catch(() => {});
  };
  ping();
  setInterval(ping, 5 * 60 * 1000);
}
