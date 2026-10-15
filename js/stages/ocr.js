// 本機 OCR：PDF 一律在使用者電腦上辨識，後端只收辨識完的文字。
// - Mac 11+、Windows：桌面殼內嵌的 zh-cn-to-tw-ocr-service（HTTP，用到才開）
// - Mac 10.15：Apple 原生 Vision framework（訊息通道，見 runVisionOcrJob）

import { DESKTOP_MODE, DESKTOP_OCR_TOKEN } from "../core/config.js";
import { postToShell, exposeToShell } from "../core/bridge.js";

// 本機 OCR service 是「用到才開、用完就關」的：它只在 Stage 1 的 OCR 那一步
// 派得上用場，而且 OCR 模型的記憶體佔用跑完不會完全還回去，關掉重開才收得
// 回來。所以它平常根本沒在跑，port 也不是固定值——網址上刻意不帶 port，改由
// 桌面殼在服務起來/關掉時直接把最新的值寫進 window.__OCR_PORT__。刻意不走
// 「改網址再重新載入」那條路，那樣會把使用者做到一半的工作狀態清掉。
function desktopOcrBase() {
  if (!DESKTOP_MODE) return null;
  const port = window.__OCR_PORT__;
  return port ? `http://127.0.0.1:${port}` : null;
}

// 請桌面殼把本機 OCR 服務拉起來，並等到它真的可以服務了才回傳 base URL。
// 一定要等：殼啟動 process、process 綁好 port、port 再被推回這個頁面，
// 整串是非同步的。這裡等的是 /health 真的回應，不是只等 port 出現——
// port 是 process 一綁好就印出來的，那時候 Flask 不見得已經開始接受連線。
async function ensureDesktopOcrReady(timeoutMs) {
  const limit = timeoutMs || 30000;
  postToShell("ocrService", { action: "start" });

  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    const base = desktopOcrBase();
    if (base) {
      try {
        const res = await fetch(`${base}/health`, { headers: { "X-OCR-Token": DESKTOP_OCR_TOKEN } });
        if (res.ok) return base;
      } catch (e) {
        // 還沒開始接受連線，下一輪再試
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("本機 OCR 服務啟動逾時，請再按一次「上傳並開始繁化」重試");
}

// OCR 結束（結果已經拿到手）就把服務關掉釋放記憶體；失敗也要關。
function releaseDesktopOcr() {
  if (!DESKTOP_MODE) return;
  postToShell("ocrService", { action: "stop" });
}

// 本機 ocr-service 的 /ocr/pdf/start 只負責啟動、立刻回 job_id，實際的逐頁
// OCR 在它自己的背景執行緒跑，這裡輪詢 /ocr/pdf/status/<job_id> 拿進度。
// 本機服務沒有登入 token，改帶 X-OCR-Token。
function pollLocalOcrJob(jobId, hooks) {
  return new Promise((resolve, reject) => {
    // 先立刻查一次，再每 5 秒一次
    const tick = async () => {
      let res;
      let job;
      try {
        // 每一輪都重新解析 base——服務中途重啟換 port 的話，下一輪就會
        // 自動打到新的那個上去。
        res = await fetch(`${desktopOcrBase()}/ocr/pdf/status/${jobId}`, {
          headers: { "X-OCR-Token": DESKTOP_OCR_TOKEN },
        });
        job = await res.json();
      } catch (e) {
        return; // 網路暫時性錯誤，下一輪再試
      }

      hooks.onLogs(job.logs);

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

      // 依實際階段顯示。模型載入單獨要花一段時間（實測不同機器從 5 秒到
      // 25 秒都有，而且服務是用到才開的，每次都會重來一次），如果這段時間
      // 一路顯示「辨識中（第 0/N 頁）」，使用者會以為當掉了。
      if (job.phase === "preparing") {
        hooks.onStatus("本機 OCR 準備中（讀取 PDF）");
      } else if (job.phase === "loading_model") {
        hooks.onStatus("載入辨識模型中（每次辨識前一次，時間依電腦效能而定）");
      } else {
        hooks.onStatus(
          job.total_pages ? `本機 OCR 辨識中（第 ${job.current_page}/${job.total_pages} 頁）` : "本機 OCR 辨識中"
        );
      }
    };
    // 先排好 interval 再手動觸發第一次：tick() 裡 done/failed 會
    // clearInterval(timer)，順序反過來的話第一拍如果剛好就該收尾，timer
    // 還沒賦值，清不掉真正的 interval。
    const timer = setInterval(tick, 5000);
    tick();
  });
}

// 10.15 分流的本機 OCR：zh-cn-to-tw-ocr-service 在真正的 macOS 10.15 上跑
// 不動（見 zh-cn-to-tw-mac 的 VisionOCRManager.swift），改用 visionOcr 訊息
// 通道——把 PDF 讀成 base64 postMessage 過去，殼用 Vision framework 處理，
// 再呼叫 window.__visionOcrProgress(payload) 把進度/結果推回來。resolve 的
// 形狀（{ pages }）刻意跟 pollLocalOcrJob 一致。
function runVisionOcrJob(file, options, hooks) {
  return new Promise((resolve, reject) => {
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 用完就拆掉，避免上一份工作的殘留 callback 在下一份工作開始後才姍姍
    // 來遲（用 jobId 比對雖然也能擋掉，但拆乾淨更保險）
    exposeToShell("__visionOcrProgress", (payload) => {
      if (payload.jobId !== jobId) return;
      hooks.onLogs(payload.logs);

      if (payload.status === "failed") {
        delete window.__visionOcrProgress;
        reject(new Error(payload.error || "本機 OCR 辨識失敗"));
        return;
      }
      if (payload.status === "done") {
        delete window.__visionOcrProgress;
        resolve({ pages: payload.pages });
        return;
      }
      hooks.onStatus(
        payload.totalPages
          ? `本機 OCR 辨識中（第 ${payload.currentPage != null ? payload.currentPage : 0}/${payload.totalPages} 頁）`
          : "本機 OCR 準備中（讀取 PDF）"
      );
    });

    const reader = new FileReader();
    reader.onerror = () => {
      delete window.__visionOcrProgress;
      reject(new Error("讀取 PDF 檔案失敗"));
    };
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      postToShell("visionOcr", {
        jobId,
        pdfBase64: base64,
        dpi: options.dpi,
        detectCover: options.detectCover,
        splitLeftRight: options.splitLeftRight,
      });
    };
    reader.readAsDataURL(file);
  });
}

// 對外的單一入口：依平台選擇 OCR 方式，回傳每一頁的文字。
// options: {dpi, detectCover, splitLeftRight, boxThresh, useVision}
// hooks: {onStatus(text), onLogs(logs)}
export async function runLocalOcr(file, options, hooks) {
  if (options.useVision) {
    // Vision framework 在同一個 process 裡跑，沒有 subprocess 可以啟動/關閉
    hooks.onStatus("本機 OCR 準備中（讀取 PDF）");
    return (await runVisionOcrJob(file, options, hooks)).pages;
  }

  hooks.onStatus("啟動本機 OCR 服務");
  // 服務平常是關著的，這裡請殼把它拉起來並等到真的可以用。不管後面成功
  // 還是失敗，finally 都會把它關掉，記憶體不會一直佔著。
  try {
    const ocrBase = await ensureDesktopOcrReady();
    hooks.onStatus("本機 OCR 辨識中");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("dpi", options.dpi);
    formData.append("detect_cover", options.detectCover ? "true" : "false");
    formData.append("split_left_right", options.splitLeftRight ? "true" : "false");
    formData.append("box_thresh", options.boxThresh);

    const startRes = await fetch(`${ocrBase}/ocr/pdf/start`, {
      method: "POST",
      headers: { "X-OCR-Token": DESKTOP_OCR_TOKEN },
      body: formData,
    });
    if (!startRes.ok) {
      const err = await startRes.json();
      throw new Error(err.error || "本機 OCR 辨識失敗");
    }
    const started = await startRes.json();
    return (await pollLocalOcrJob(started.job_id, hooks)).pages;
  } finally {
    // OCR 這一步已經結束，結果也已經在手上了，服務沒有存在的必要。後面
    // 把文字送去 Render 潤飾那段完全不需要它。
    releaseDesktopOcr();
  }
}
