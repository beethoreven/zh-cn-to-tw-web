// 下載檔名的整理：只留路徑的最後一段、只接受這個 App 會產生的副檔名。
//
// 檔名最源頭是伺服器回應的 Content-Disposition，不是前端自己決定的；它接著
// 會被拿去存成使用者電腦上的檔案（瀏覽器的下載，或 10.15 那包交給殼寫檔）。
// 所以存檔前先過這裡：帶著路徑的名字只留最後一段，副檔名不是 .txt／.docx
// 的一律改用呼叫端自己給的預設檔名——這個 App 的下載只有這兩種，其他副檔名
// 不該出現。
//
// 這個檔案刻意不 import 任何東西、也不碰 window／document，可以單獨執行。
// 語法上限同 config.js 的說明（Safari 13.0）。

const ALLOWED_EXTENSIONS = ["txt", "docx"];

// 兩種斜線都當成路徑分隔：檔名會從後端（Linux）一路傳到殼（macOS、Windows）
function lastSegment(name) {
  const parts = String(name).split(/[\\/]/);
  return parts[parts.length - 1];
}

// 沒有點、或點在最前面（".txt" 這種只有副檔名的名字）都算沒有副檔名
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function safeDownloadFilename(name, fallback) {
  if (name === null || name === undefined) return fallback;
  // 控制字元（含換行）直接拿掉，前後空白去掉
  const cleaned = lastSegment(name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  if (ALLOWED_EXTENSIONS.indexOf(extensionOf(cleaned)) < 0) return fallback;
  return cleaned;
}
