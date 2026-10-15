// 把檔案存到使用者電腦：後端產生的檔案（帶登入憑證下載），或前端自己
// 產生的文字（例如 Stage 2 的範本）。

import { DESKTOP_OS_TIER } from "./config.js";
import { authedFetch, errorFromResponse } from "./api.js";
import { hasShellChannel, postToShell } from "./bridge.js";

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

// blob 轉純 base64（不帶 data: 前綴），給 legacyDownload channel 用——
// FileReader.readAsDataURL 的結果是 "data:<mime>;base64,<data>" 這個
// 格式，只要逗號後面那一段。
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function saveBlob(blob, filename) {
  // 10.15 那包桌面殼的 WKWebView 部署目標壓到 10.15，沒有 WKDownload
  // （要 macOS 11.3+，見 zh-cn-to-tw-mac 的 WebView.swift 說明）——下面
  // 這條「blob: URL + <a download> 模擬點擊」的路在那包完全沒有東西
  // 接手，點了不會有任何反應。改成把整份檔案內容轉成 base64，直接
  // postMessage 給殼的 legacyDownload channel，殼收到後自己解碼寫進
  // 下載資料夾。11+ 桌面殼、Windows 殼跟純瀏覽器都走下面原本那條路。
  if (DESKTOP_OS_TIER === "10.15" && hasShellChannel("legacyDownload")) {
    const base64 = await blobToBase64(blob);
    postToShell("legacyDownload", { filename, base64 });
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function saveText(text, filename) {
  return saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

// 下載端點需要帶登入憑證，不能直接用 <a href> 導覽（那樣沒辦法附加
// Authorization header）——改成用 fetch 把檔案內容抓成 blob，檔名從後端
// 回傳的 Content-Disposition header 還原（後端 CORS 設定裡有把這個 header
// 明確曝露給前端 JS）。
export async function downloadViaAuthedFetch(url, fallbackFilename) {
  const res = await authedFetch(url);
  if (!res.ok) {
    throw await errorFromResponse(res, "下載失敗");
  }
  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("Content-Disposition"), fallbackFilename);
  await saveBlob(blob, filename);
}
