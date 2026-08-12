# 中文

## 劇本殺繁化助手 — 前端

劇本殺劇本簡繁轉換工具的前端。搭配後端 API：[`zh-cn-to-tw-backend`](https://github.com/beethoreven/zh-cn-to-tw-backend)。這份文件分成兩部分：

- **[專案報告](#專案報告)**：這個前端怎麼同時服務三種截然不同的執行環境、關鍵決策是什麼。
- **[架設 SOP](#架設-sop)**：本機怎麼跑起來測試。

---

## 專案報告

### 這是什麼

Vanilla JavaScript（無框架、無建置流程），單一份 `index.html`/`script.js`/`style.css`，但**同一份程式碼要同時正確運作在三種環境**：

1. **瀏覽器（GitHub Pages）**：一般網址開啟，PDF 直接上傳給 Render 後端，OCR 也在 Render 上跑。
2. **桌面版 App，本機 OCR**：被 `zh-cn-to-tw-mac` 用 `file://` 內嵌載入，PDF 先送本機的 `zh-cn-to-tw-ocr-service` 做 OCR，OCR 完的文字才送 Render 後端做簡轉繁/潤飾。
3. 兩者共用同一套登入、Stage 1/2 UI、校對介面——這是刻意的，不想維護兩份前端。

判斷現在是哪個環境靠網址的查詢參數：桌面殼載入頁面時會帶
`?desktop=1&ocrToken=<隨機值>&apiBase=<Render網址>`，`script.js` 一開始
就讀這些參數決定要不要走本機 OCR 這條路。純瀏覽器開啟（沒有這些參數）
行為完全不受影響。

### 為什麼桌面版的本機 OCR 服務是「用到才開、用完就關」

這是一段來回修正的過程，值得記錄：

**最早的設計**：桌面殼啟動時就把 `zh-cn-to-tw-ocr-service` 拉起來，整個 App 執行期間一直開著。問題是 PaddleOCR 模型載入後常駐佔用實測 **393MB** 記憶體，而它只在 Stage 1 的 OCR 那一步用得到，其他時候（潤飾、Stage 2 校對、下載、登入）完全沒事做，白白佔著。

**中間的補丁**：加了「閒置 30 分鐘自我關閉」，但同時又有「健康檢查每 30 秒發現服務沒在跑就重新拉起」——這兩個機制互相打架，關掉沒多久又被拉起來，記憶體從沒真的被回收過，而且每次重啟都換一個新 port。

**最終方案**：`script.js` 在真的要送 PDF 之前，才透過 `window.webkit.messageHandlers.ocrService.postMessage({action: "start"})` 請桌面殼把服務拉起來，並且**輪詢 `/health` 直到真的可以服務了才送 PDF**（這一步不能省——port 是 process 剛綁定就印出來的，那個當下 Flask 通常還沒真正開始接受連線，只等 port 出現會撞上連線失敗）。OCR 階段結束（不管成功失敗）都在 `finally` 裡請桌面殼把服務關掉。移除了原本的健康檢查自動重啟機制。

服務的 port 不是固定值，而且會隨著開關而改變，**故意不寫進網址查詢參數裡**（那樣一變動就要重新載入整個頁面，會清掉使用者做到一半的表單狀態）——改成桌面殼用 `evaluateJavaScript` 直接把最新 port 寫進 `window.__OCR_PORT__`，`script.js` 每次要打本機 OCR API 前才即時讀這個值。

### 為什麼用量數字不走輪詢

Stage 1/Stage 2 執行中會輪詢後端查進度，原本 `loadUsage()`（今日 Gemini
額度、Claude token 費用）也掛在同一個輪詢迴圈裡，每輪一起打。這個數字
其實完全不需要即時——使用者不會盯著它看它跳動，需要即時的只有三類：
「隨時可能中斷需要恢復的工作狀態」「執行進度」「使用者操作的直接回饋」。
用量統計都不屬於這三類。

改成只在「登入時」跟「每個 stage 結束時（含失敗/中斷）」才更新，
Stage 1 執行中每輪的請求數因此從 4 個降到 1 個。這個判斷準則後來寫成
了一個通用的稽核方法（`real-time-scenario` skill）：任何「持續輪詢/
持續同步」的設計，都該先問「如果這個晚幾秒才更新，誰會發現、會壞掉
什麼」，答不出來就不該是即時的。

### Session 儲存

登入後拿到的 session token（見 `zh-cn-to-tw-backend` 的說明，不是原始
Google ID Token）存進 `localStorage`。這在桌面版特別重要——桌面殼改用
固定的 `file://` 路徑載入頁面之後，origin 是穩定的，`localStorage` 才能
真正跨次啟動保留登入狀態（見 `zh-cn-to-tw-mac` README 的完整說明）。

### 「阿舍老師的叮嚀」：三次失敗才找到的解法

主頁左側那塊純文字提示，內容原本直接放在這個 repo、前端用 `fetch()`
讀同目錄檔案——瀏覽器版沒問題，桌面版 `file://` 底下完全行不通。依序
試過三種修法都失敗（`XMLHttpRequest`、隱藏 `<iframe>` + `contentDocument`），
原因都一樣：`file://` 底下 JS 執行期沒有任何辦法讀到「同目錄另一個
檔案」的內容，不管透過哪個瀏覽器 API 包裝都一樣，是平台層級的限制。
最後把內容整個移到 `zh-cn-to-tw-backend`，透過一個不需要登入的 API
端點供應，瀏覽器版跟桌面版從此走同一條路徑。完整過程見
`zh-cn-to-tw-backend` README 的對應段落。

### 一次會錯意的教訓

有一段時間這個提示框被做成 `position: sticky`（捲動時黏在畫面上，
內容捲出視野它還留著），做這個功能花了不少輪反覆確認（含 WebKit
momentum scroll 是否會讓 sticky 追不上捲動這種細節排查）。後來才發現
使用者要的其實是相反的效果——跟「今日使用量」一樣，位置固定在文件
內容裡、正常隨頁面捲走。雙方對「固定」這個詞的理解從頭到尾是相反的：
一方指「釘在螢幕上不動」，一方指「釘在文件裡的位置、被捲出視野」。
最後全部拿掉 sticky，恢復成普通的 flex 項目。這個教訓被記錄進
`known-issue-check` skill：驗證使用者互動類的 bug，一定要用「使用者
真正描述的最終畫面」反覆對照，不能只驗證「有沒有做出某個技術效果」。

### 檔案結構

```
index.html    唯一的頁面骨架
script.js     全部邏輯（登入、Stage 1/2、輪詢、管理員介面、桌面版判斷）
style.css     樣式
favicon.png
```

無建置流程，這三個檔案直接被 GitHub Pages 服務，也直接被
`zh-cn-to-tw-mac` 的打包腳本複製進 `.app` bundle。

---

# 架設 SOP / Setup Guide

## 本機測試（瀏覽器模式）

`file://` 直接打開會被後端 CORS 擋掉（後端只放行
`https://beethoreven.github.io` 跟任意 port 的 `localhost`/`127.0.0.1`），
務必用靜態伺服器方式開：

```bash
cd zh-cn-to-tw-web
python3 -m http.server 8000
```

打開 `http://localhost:8000`，預設會打正式的 Render 網址；要測本機
backend，網址列加 `?apiBase=http://localhost:5001`。

## 本機測試（模擬桌面版）

加齊桌面版判斷需要的查詢參數：

```
http://localhost:8000/?desktop=1&ocrToken=test&apiBase=http://localhost:5001
```

這樣會嘗試走本機 OCR 那條路，但因為沒有真正的桌面殼幫你把
`window.__OCR_PORT__` 寫進去、也沒有 `ocrService` 這個 message handler，
本機 OCR 相關功能實際上叫不動——這個模式主要是拿來看 UI 判斷邏輯對不
對，真正端到端測試桌面路徑要透過 `zh-cn-to-tw-mac` 重新打包整個 App。

## 部署（GitHub Pages）

Push 到 `main`，GitHub Pages 設定成從 repo 根目錄部署即可，沒有建置
步驟。

---

# English

## Script Murder Mystery Traditionalization Assistant — Frontend

The frontend for a Simplified-to-Traditional Chinese script conversion tool. Pairs with the backend API: [`zh-cn-to-tw-backend`](https://github.com/beethoreven/zh-cn-to-tw-backend). This document is split into two parts:

- **[Project Report](#project-report)**: how this single frontend correctly serves three very different runtime environments, and the key decisions behind it.
- **[Setup Guide](#setup-guide)**: how to run it locally.

## Project Report

### What This Is

Vanilla JavaScript (no framework, no build step) — a single `index.html`/`script.js`/`style.css` — but **the same code has to work correctly in three different environments**:

1. **Browser (GitHub Pages)**: opened at a normal URL; the PDF is uploaded directly to the Render backend, and OCR also runs on Render.
2. **Desktop app, local OCR**: embedded via `file://` by `zh-cn-to-tw-mac`; the PDF is first sent to the local `zh-cn-to-tw-ocr-service` for OCR, and only the resulting text goes to the Render backend for conversion/polish.
3. Both share the exact same login, Stage 1/2 UI, and proofreading interface — deliberately, to avoid maintaining two frontends.

Which environment it's in is determined from URL query parameters: the desktop shell loads the page with
`?desktop=1&ocrToken=<random>&apiBase=<Render URL>`, and `script.js` reads these at startup to decide whether to take the local-OCR path. A plain browser open (no such parameters) behaves exactly as before.

### Why the Desktop OCR Service Is "Start on Use, Stop When Done"

This went through a back-and-forth worth recording:

**Original design**: the desktop shell started `zh-cn-to-tw-ocr-service` at app launch and kept it running for the entire session. Problem: once PaddleOCR's models load, they sit at a measured **393MB** resident, but the service is only actually useful during Stage 1's OCR step — the rest of the time (polish, Stage 2 proofreading, download, login) it does nothing at all.

**Interim patch**: added a "self-shutdown after 30 minutes idle," but also had "a health check every 30 seconds that respawns the service if it's not running" — the two mechanisms fought each other, so the service kept getting respawned shortly after shutting down, memory was never actually reclaimed, and every respawn came with a new port.

**Final approach**: right before actually sending a PDF, `script.js` asks the desktop shell to start the service via `window.webkit.messageHandlers.ocrService.postMessage({action: "start"})`, and **polls `/health` until the service is actually ready before sending the PDF** (this step can't be skipped — the port is printed the moment the process binds it, at which point Flask typically hasn't started accepting connections yet; waiting only for the port to appear would hit connection failures). Once the OCR step ends (success or failure), a `finally` block asks the shell to stop the service. The original auto-respawning health check was removed.

The service's port isn't fixed and changes every time it starts/stops, so it's **deliberately not written into the URL query string** (which would require a full page reload on every change, wiping out whatever the user had half-filled in). Instead, the shell pushes the current port straight into `window.__OCR_PORT__` via `evaluateJavaScript`, and `script.js` reads that value fresh right before each local-OCR API call.

### Why Usage Numbers Aren't Polled

Stage 1/Stage 2 poll the backend for progress while running. `loadUsage()` (today's Gemini quota, Claude token cost) originally lived inside that same polling loop, firing on every tick. That number genuinely never needs to be real-time — nobody watches it tick up live. Only three kinds of thing actually need to be real-time: state that can be interrupted and needs recovery, execution progress, and direct feedback for something the user just did. Usage stats fit none of those.

It now updates only "on login" and "at the end of each stage (including failure/interruption)," dropping Stage 1's per-tick request count from 4 to 1. This judgment call was later generalized into a reusable audit method (the `real-time-scenario` skill): for any "keeps polling/keeps syncing" design, ask first "if this were a few seconds stale, who would notice, and what would break" — if there's no answer, it shouldn't be real-time.

### Session Storage

The session token obtained after login (see `zh-cn-to-tw-backend`'s notes — not the raw Google ID Token) is stored in `localStorage`. This matters especially on desktop — once the shell switched to loading pages from a fixed `file://` path, the origin became stable, which is what actually lets `localStorage` survive across app restarts (see `zh-cn-to-tw-mac`'s README for the full story).

### The "Teacher's Notes" Sidebar: Three Failed Attempts Before the Fix

The plain-text tip panel on the left originally lived in this repo, read via `fetch()` on a same-directory file — fine in the browser, completely broken under the desktop's `file://`. Three fixes were tried in sequence and all failed (`XMLHttpRequest`, a hidden `<iframe>` + `contentDocument`), for the same underlying reason each time: under `file://`, JS has no way at runtime to read another file in the same directory, regardless of which browser API wraps the attempt — a platform-level limitation, not an API choice. The content was eventually moved entirely into `zh-cn-to-tw-backend`, served through a no-login-required API endpoint, so browser and desktop share one path from then on. Full story in `zh-cn-to-tw-backend`'s README.

### A Miscommunication Worth Recording

For a stretch, this notice panel was built with `position: sticky` (stays pinned on screen while scrolling, visible even after the surrounding content scrolls away) — a fair amount of back-and-forth went into verifying this correctly (down to whether WebKit's momentum scrolling could make sticky lag behind, a genuinely subtle rendering detail). It later turned out the user wanted the *opposite* behavior — pinned to its position in the document, like "今日使用量," scrolling away normally with the page. Both sides had been using the word "固定" (fixed) to mean opposite things the entire time: one meaning "pinned to the screen," the other "anchored to its spot in the document, and therefore scrolled out of view." Sticky was removed entirely; the panel is now a plain flex item again. This is now recorded in the `known-issue-check` skill: verifying an interaction bug has to be checked against the user's own literal description of the end state, repeatedly, not just against whether some named technical effect was correctly implemented.

### File Layout

```
index.html    the one page skeleton
script.js     all logic (login, Stage 1/2, polling, admin UI, desktop-mode detection)
style.css     styles
favicon.png
```

No build step — these three files are served directly by GitHub Pages, and are also copied directly into the `.app` bundle by `zh-cn-to-tw-mac`'s packaging script.

---

# Setup Guide

## Local Testing (Browser Mode)

Opening via `file://` gets blocked by the backend's CORS (it only
allows `https://beethoreven.github.io` and any-port
`localhost`/`127.0.0.1`), so always use a static server:

```bash
cd zh-cn-to-tw-web
python3 -m http.server 8000
```

Open `http://localhost:8000` — this hits the production Render URL by
default; to test against a local backend, add
`?apiBase=http://localhost:5001` to the URL.

## Local Testing (Simulating Desktop Mode)

Add the query parameters desktop-mode detection needs:

```
http://localhost:8000/?desktop=1&ocrToken=test&apiBase=http://localhost:5001
```

This will attempt the local-OCR path, but since there's no real
desktop shell pushing `window.__OCR_PORT__` or providing an
`ocrService` message handler, local OCR won't actually work — this
mode is mainly useful for checking the UI's branching logic. True
end-to-end testing of the desktop path requires rebuilding the whole
app via `zh-cn-to-tw-mac`.

## Deployment (GitHub Pages)

Push to `main`; configure GitHub Pages to deploy from the repo root — no build step needed.
