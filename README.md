# 中文

## 劇本殺繁化助手 — 前端

劇本殺劇本簡繁轉換工具的前端，目前唯一目標是被 `zh-cn-to-tw-mac` 桌面版 App 內嵌使用。搭配後端 API：[`zh-cn-to-tw-backend`](https://github.com/beethoreven/zh-cn-to-tw-backend)。這份文件分成兩部分：

- **[專案報告](#專案報告)**：為什麼這個 repo 的內容不會出現在 GitHub Pages 上、桌面版本機 OCR 的關鍵決策是什麼。
- **[架設 SOP](#架設-sop)**：本機怎麼跑起來測試。

---

## 專案報告

### 這是什麼

Vanilla JavaScript（無框架、無建置流程），單一份 `index.html`/`script.js`/`style.css`/`favicon.png`，被 `zh-cn-to-tw-mac` 用 `file://` 內嵌載入，是桌面版 App 畫面唯一的來源。

判斷現在是不是桌面殼載入的，靠網址的查詢參數：桌面殼載入頁面時會帶 `?desktop=1&ocrToken=<隨機值>&apiBase=<Render網址>`，`script.js` 一開始就讀這些參數決定要不要走本機 OCR 這條路——PDF 先送本機的 `zh-cn-to-tw-ocr-service` 做 OCR，OCR 完的文字才送 Render 後端（`zh-cn-to-tw-backend`）做簡轉繁/潤飾。
沒有這些參數時會回退成直接把 PDF 送給 Render 後端自己做 OCR 的舊路徑，這條路徑現在只有本機開發時（用靜態伺服器手動開起來，見下方 SOP）才碰得到——見下一節說明為什麼這整份內容不再出現在任何公開網址上。

### 為什麼這個 repo 的內容不會出現在 GitHub Pages 上

這個 repo 以前只有一個分支（`main`），同時扮演兩個角色：GitHub Pages 從這個分支的根目錄部署出去的公開網址（`https://beethoreven.github.io/zh-cn-to-tw-web/`），跟被 `zh-cn-to-tw-mac` 內嵌打包進桌面版 App 的網頁來源，是同一份檔案。

桌面版才是這個工具現在唯一的使用方式——單純瀏覽器打開網址、PDF 直接上傳給 Render 做 OCR 的那條路，繼承了 Render 免費方案扛不住 PaddleOCR 的資源風險（見 `zh-cn-to-tw-backend` README「為什麼 OCR 搬到使用者本機」），不該再是任何人能透過網址碰到的東西。

**曾經考慮過、後來放棄的方案**：把 GitHub Pages 服務的根目錄換成佔位頁，真正的網頁內容搬進同一個分支底下的 `app/` 子資料夾。這個方案的問題是 GitHub Pages 只要對某個分支開著，那個分支底下所有檔案都還是能被直接打開（`.../app/`）——只是沒有從根目錄連結出去，並沒有真正解決「這個網址打得到」的問題，只是藏起來，跟這個專案自己在別處記錄過的「延後問題、沒有根治」是同一種模式。

最後採用的方案：`main` 分支的內容維持原本結構（`zh-cn-to-tw-mac` 打包時照樣從這裡複製檔案），但另外開一個完全獨立的 `update-page` 分支，內容只有一個「網站建構中」的極簡佔位頁，跟 `main` 沒有共同的檔案。
GitHub repo 的 Pages 設定從「服務 `main` 分支的根目錄」改成「服務 `update-page` 分支的根目錄」。這樣一來，`main` 分支上的真實內容從結構上就完全不在 Pages 的服務範圍內——不是「沒連結」，是「根本不存在於被服務的那份檔案裡」，`https://beethoreven.github.io/zh-cn-to-tw-web/` 這個網址完全不變，未來規劃是把 `update-page` 分支的內容換成「下載/更新桌面版 App」的頁面，但這一步還沒做，目前只有佔位文字。

`zh-cn-to-tw-mac` 打包時是直接從這個 repo 本機 clone 的工作目錄複製 `main` 分支的檔案，完全不透過 HTTP、跟 GitHub Pages 服務哪個分支無關，所以這個切分不影響桌面版打包。

### 為什麼桌面版的本機 OCR 服務是「用到才開、用完就關」

這是一段來回修正的過程，值得記錄：

**最早的設計**：桌面殼啟動時就把 `zh-cn-to-tw-ocr-service` 拉起來，整個 App 執行期間一直開著。
問題是 PaddleOCR 模型載入後常駐佔用實測 **393MB** 記憶體，而它只在 Stage 1 的 OCR 那一步用得到，其他時候（潤飾、Stage 2 校對、下載、登入）完全沒事做，白白佔著。

**中間的補丁**：加了「閒置 30 分鐘自我關閉」，但同時又有「健康檢查每 30 秒發現服務沒在跑就重新拉起」——這兩個機制互相打架，關掉沒多久又被拉起來，記憶體從沒真的被回收過，而且每次重啟都換一個新 port。

**最終方案**：`script.js` 在真的要送 PDF 之前，才透過 `window.webkit.messageHandlers.ocrService.postMessage({action: "start"})` 請桌面殼把服務拉起來，並且**輪詢 `/health` 直到真的可以服務了才送 PDF**（這一步不能省——port 是 process 剛綁定就印出來的，那個當下 Flask 通常還沒真正開始接受連線，只等 port 出現會撞上連線失敗）。
OCR 階段結束（不管成功失敗）都在 `finally` 裡請桌面殼把服務關掉。移除了原本的健康檢查自動重啟機制。

服務的 port 不是固定值，而且會隨著開關而改變，**故意不寫進網址查詢參數裡**（那樣一變動就要重新載入整個頁面，會清掉使用者做到一半的表單狀態）——改成桌面殼用 `evaluateJavaScript` 直接把最新 port 寫進 `window.__OCR_PORT__`，`script.js` 每次要打本機 OCR API 前才即時讀這個值。

### 為什麼用量數字不走輪詢

Stage 1/Stage 2 執行中會輪詢後端查進度，原本 `loadUsage()`（今日 Gemini 額度、Claude token 費用）也掛在同一個輪詢迴圈裡，每輪一起打。
這個數字其實完全不需要即時——使用者不會盯著它看它跳動，需要即時的只有三類：「隨時可能中斷需要恢復的工作狀態」「執行進度」「使用者操作的直接回饋」。用量統計都不屬於這三類。

改成只在「登入時」跟「每個 stage 結束時（含失敗/中斷）」才更新，Stage 1 執行中每輪的請求數因此從 4 個降到 1 個。
這個判斷準則後來寫成了一個通用的稽核方法（`real-time-scenario` skill）：任何「持續輪詢/持續同步」的設計，都該先問「如果這個晚幾秒才更新，誰會發現、會壞掉什麼」，答不出來就不該是即時的。

### Session 儲存

登入後拿到的 session token（見 `zh-cn-to-tw-backend` 的說明，不是原始 Google ID Token）存進 `localStorage`。這在桌面版特別重要——桌面殼改用固定的 `file://` 路徑載入頁面之後，origin 是穩定的，`localStorage` 才能真正跨次啟動保留登入狀態（見 `zh-cn-to-tw-mac` README 的完整說明）。

### 「阿舍老師的叮嚀」：三次失敗才找到的解法

主頁左側那塊純文字提示，內容原本直接放在這個 repo、前端用 `fetch()` 讀同目錄檔案——瀏覽器版沒問題，桌面版 `file://` 底下完全行不通。依序試過三種修法都失敗（`XMLHttpRequest`、隱藏 `<iframe>` + `contentDocument`），原因都一樣：`file://` 底下 JS 執行期沒有任何辦法讀到「同目錄另一個檔案」的內容，不管透過哪個瀏覽器 API 包裝都一樣，是平台層級的限制。最後把內容整個移到 `zh-cn-to-tw-backend`，透過一個不需要登入的 API 端點供應，瀏覽器版跟桌面版從此走同一條路徑。完整過程見 `zh-cn-to-tw-backend` README 的對應段落。

### 檔案結構（`main` 分支）

```
index.html    唯一的頁面骨架
script.js     全部邏輯（登入、Stage 1/2、輪詢、管理員介面、桌面版判斷）
style.css     樣式
favicon.png
```

無建置流程，這四個檔案直接被 `zh-cn-to-tw-mac` 的打包腳本複製進 `.app` bundle。GitHub Pages **不會**部署這個分支——它服務的是另一個獨立的 `update-page` 分支，見上方「為什麼這個 repo 的內容不會出現在 GitHub Pages 上」。

---

# 架設 SOP / Setup Guide

## 本機測試（桌面版畫面）

`file://` 直接打開會被後端 CORS 擋掉（後端只放行 `https://beethoreven.github.io` 跟任意 port 的 `localhost`/`127.0.0.1`），務必用靜態伺服器方式開：

```bash
cd zh-cn-to-tw-web
python3 -m http.server 8000
```

打開 `http://localhost:8000`，預設會打正式的 Render 網址；要測本機 backend，網址列加 `?apiBase=http://localhost:5001`。

## 本機測試（模擬桌面版）

加齊桌面版判斷需要的查詢參數：

```
http://localhost:8000/?desktop=1&ocrToken=test&apiBase=http://localhost:5001
```

這樣會嘗試走本機 OCR 那條路，但因為沒有真正的桌面殼幫你把 `window.__OCR_PORT__` 寫進去、也沒有 `ocrService` 這個 message handler，本機 OCR 相關功能實際上叫不動——這個模式主要是拿來看 UI 判斷邏輯對不對，真正端到端測試桌面路徑要透過 `zh-cn-to-tw-mac` 重新打包整個 App。

## 部署

**`main` 分支不需要、也不會被部署。** Push 到 `main` 只影響 `zh-cn-to-tw-mac` 下次打包時複製到的內容，跟 GitHub Pages 完全無關。

## 更新 GitHub Pages 上的佔位頁（`update-page` 分支）

GitHub Pages 設定成服務 `update-page` 分支的根目錄（Settings → Pages → Source），這個分支跟 `main` 沒有共同的檔案、也沒有共同的 git 歷史（獨立的 orphan 分支），內容只有一個極簡佔位頁：

```bash
git checkout update-page
# 編輯 index.html
git add index.html
git commit -m "..."
git push origin update-page
git checkout main
```

不要在這個分支上動 `main` 的程式碼，也不要把這個分支合併回 `main`（兩者刻意保持沒有共同歷史）。

---

# English

## Script Murder Mystery Traditionalization Assistant — Frontend

The frontend for a Simplified-to-Traditional Chinese script conversion tool. Its only remaining purpose is to be embedded inside the `zh-cn-to-tw-mac` desktop app. Pairs with the backend API: [`zh-cn-to-tw-backend`](https://github.com/beethoreven/zh-cn-to-tw-backend). This document is split into two parts:

- **[Project Report](#project-report)**: why this repo's content never appears on GitHub Pages, and the key decisions behind desktop local OCR.
- **[Setup Guide](#setup-guide)**: how to run it locally.

## Project Report

### What This Is

Vanilla JavaScript (no framework, no build step) — a single `index.html`/`script.js`/`style.css`/`favicon.png`, loaded by `zh-cn-to-tw-mac` via `file://`. It's the sole source of the desktop app's screen.

Whether the page was loaded by the desktop shell is determined from URL query parameters: the shell loads the page with `?desktop=1&ocrToken=<random>&apiBase=<Render URL>`, and `script.js` reads these at startup to decide whether to take the local-OCR path — the PDF is first sent to the local `zh-cn-to-tw-ocr-service` for OCR, and only the resulting text goes to the Render backend (`zh-cn-to-tw-backend`) for conversion/polish.
Without those parameters, it falls back to the older path of uploading the PDF straight to the Render backend, which does the OCR itself — this path is now only reachable during local development (running it via a static server manually, see the Setup Guide below). See the next section for why this whole thing no longer shows up on any public URL.

### Why This Repo's Content Never Appears on GitHub Pages

This repo used to have a single branch (`main`) that played two roles at once: the public URL GitHub Pages deploys from that branch's root (`https://beethoreven.github.io/zh-cn-to-tw-web/`), and the web source embedded by `zh-cn-to-tw-mac` into the packaged desktop app — the exact same files served both roles.

The desktop app is now the only way to use this tool — a plain browser hitting the URL and uploading a PDF straight to Render for OCR inherits Render's free-tier inability to reliably run PaddleOCR (see `zh-cn-to-tw-backend`'s README, "Why OCR Moved to the User's Own Machine"), and shouldn't be something anyone can reach via a URL anymore.

**Tried and abandoned**: switching what GitHub Pages deploys from the repo root to a placeholder, while moving the real web content into an `app/` subfolder under the same branch. The problem: as long as GitHub Pages is enabled for a branch, every file under that branch is still reachable directly (`.../app/`) — nothing was actually unlinked from the root, but the URL itself still worked, just hidden. That's the same "defer the problem, don't fix it" pattern this project has documented elsewhere.

What shipped instead: `main` keeps its original flat structure (`zh-cn-to-tw-mac`'s packaging script still copies from here as before), but a completely separate `update-page` branch was created, holding only a minimal "網站建構中" (site under construction) placeholder — no files in common with `main` at all.
The repo's Pages setting was switched from "serve `main`'s root" to "serve `update-page`'s root." That means the real content on `main` is structurally outside anything Pages ever serves — not "unlinked," but "not present in the served tree at all." The URL `https://beethoreven.github.io/zh-cn-to-tw-web/` itself is unchanged; the plan is eventually to replace `update-page`'s content with a "download/update the desktop app" page, but that hasn't happened yet — for now it's just placeholder text.

`zh-cn-to-tw-mac` builds by copying files from `main`'s local working tree directly — no HTTP involved, and independent of which branch GitHub Pages happens to be serving — so this split doesn't affect desktop packaging at all.

### Why the Desktop OCR Service Is "Start on Use, Stop When Done"

This went through a back-and-forth worth recording:

**Original design**: the desktop shell started `zh-cn-to-tw-ocr-service` at app launch and kept it running for the entire session.
Problem: once PaddleOCR's models load, they sit at a measured **393MB** resident, but the service is only actually useful during Stage 1's OCR step — the rest of the time (polish, Stage 2 proofreading, download, login) it does nothing at all.

**Interim patch**: added a "self-shutdown after 30 minutes idle," but also had "a health check every 30 seconds that respawns the service if it's not running" — the two mechanisms fought each other, so the service kept getting respawned shortly after shutting down, memory was never actually reclaimed, and every respawn came with a new port.

**Final approach**: right before actually sending a PDF, `script.js` asks the desktop shell to start the service via `window.webkit.messageHandlers.ocrService.postMessage({action: "start"})`, and **polls `/health` until the service is actually ready before sending the PDF** (this step can't be skipped — the port is printed the moment the process binds it, at which point Flask typically hasn't started accepting connections yet; waiting only for the port to appear would hit connection failures).
Once the OCR step ends (success or failure), a `finally` block asks the shell to stop the service. The original auto-respawning health check was removed.

The service's port isn't fixed and changes every time it starts/stops, so it's **deliberately not written into the URL query string** (which would require a full page reload on every change, wiping out whatever the user had half-filled in). Instead, the shell pushes the current port straight into `window.__OCR_PORT__` via `evaluateJavaScript`, and `script.js` reads that value fresh right before each local-OCR API call.

### Why Usage Numbers Aren't Polled

Stage 1/Stage 2 poll the backend for progress while running. `loadUsage()` (today's Gemini quota, Claude token cost) originally lived inside that same polling loop, firing on every tick.
That number genuinely never needs to be real-time — nobody watches it tick up live. Only three kinds of thing actually need to be real-time: state that can be interrupted and needs recovery, execution progress, and direct feedback for something the user just did. Usage stats fit none of those.

It now updates only "on login" and "at the end of each stage (including failure/interruption)," dropping Stage 1's per-tick request count from 4 to 1.
This judgment call was later generalized into a reusable audit method (the `real-time-scenario` skill): for any "keeps polling/keeps syncing" design, ask first "if this were a few seconds stale, who would notice, and what would break" — if there's no answer, it shouldn't be real-time.

### Session Storage

The session token obtained after login (see `zh-cn-to-tw-backend`'s notes — not the raw Google ID Token) is stored in `localStorage`. This matters especially on desktop — once the shell switched to loading pages from a fixed `file://` path, the origin became stable, which is what actually lets `localStorage` survive across app restarts (see `zh-cn-to-tw-mac`'s README for the full story).

### The "Teacher's Notes" Sidebar: Three Failed Attempts Before the Fix

The plain-text tip panel on the left originally lived in this repo, read via `fetch()` on a same-directory file — fine in the browser, completely broken under the desktop's `file://`. Three fixes were tried in sequence and all failed (`XMLHttpRequest`, a hidden `<iframe>` + `contentDocument`), for the same underlying reason each time: under `file://`, JS has no way at runtime to read another file in the same directory, regardless of which browser API wraps the attempt — a platform-level limitation, not an API choice. The content was eventually moved entirely into `zh-cn-to-tw-backend`, served through a no-login-required API endpoint, so browser and desktop share one path from then on. Full story in `zh-cn-to-tw-backend`'s README.

### File Layout (`main` branch)

```
index.html    the one page skeleton
script.js     all logic (login, Stage 1/2, polling, admin UI, desktop-mode detection)
style.css     styles
favicon.png
```

No build step — these four files are copied directly into the `.app` bundle by `zh-cn-to-tw-mac`'s packaging script. GitHub Pages does **not** deploy this branch — it serves a separate `update-page` branch instead; see "Why This Repo's Content Never Appears on GitHub Pages" above.

---

# Setup Guide

## Local Testing (Desktop Screen)

Opening via `file://` gets blocked by the backend's CORS (it only allows `https://beethoreven.github.io` and any-port `localhost`/`127.0.0.1`), so always use a static server:

```bash
cd zh-cn-to-tw-web
python3 -m http.server 8000
```

Open `http://localhost:8000` — this hits the production Render URL by default; to test against a local backend, add `?apiBase=http://localhost:5001` to the URL.

## Local Testing (Simulating Desktop Mode)

Add the query parameters desktop-mode detection needs:

```
http://localhost:8000/?desktop=1&ocrToken=test&apiBase=http://localhost:5001
```

This will attempt the local-OCR path, but since there's no real desktop shell pushing `window.__OCR_PORT__` or providing an `ocrService` message handler, local OCR won't actually work — this mode is mainly useful for checking the UI's branching logic. True end-to-end testing of the desktop path requires rebuilding the whole app via `zh-cn-to-tw-mac`.

## Deployment

**The `main` branch needs no deployment and never gets one.** Pushing to `main` only affects what `zh-cn-to-tw-mac` copies in on its next build — it has nothing to do with GitHub Pages.

## Updating the GitHub Pages Placeholder (`update-page` branch)

GitHub Pages is configured to serve the root of the `update-page` branch (Settings → Pages → Source). This branch shares no files, and no git history, with `main` (it's a separate orphan branch) — its content is a single minimal placeholder page:

```bash
git checkout update-page
# edit index.html
git add index.html
git commit -m "..."
git push origin update-page
git checkout main
```

Don't touch `main`'s code on this branch, and don't merge it back into `main` — the two are deliberately kept with no shared history.
