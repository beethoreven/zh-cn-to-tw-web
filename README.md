# 中文

## 劇本殺繁化助手 — 前端

劇本殺劇本簡繁轉換工具的前端，唯一目標是被兩個桌面版 App（`zh-cn-to-tw-mac`、`zh-cn-to-tw-windows`）內嵌使用。搭配後端 API：[`zh-cn-to-tw-backend`](https://github.com/beethoreven/zh-cn-to-tw-backend)。這份文件分成兩部分：

- **[專案報告](#專案報告)**：2.0 的直向流程與拆檔怎麼設計、為什麼這個 repo 的內容不會出現在 GitHub Pages 上、桌面版本機 OCR 的關鍵決策是什麼。
- **[架設 SOP](#架設-sop)**：本機怎麼跑起來測試、什麼時候可以合併進 `main`。

這兩部分刻意分開，不要交叉閱讀；報告是背景知識，SOP 是操作手冊。

---

## 專案報告

### 這是什麼

Vanilla JavaScript（無框架、無建置流程），被桌面殼內嵌載入，是桌面版 App 畫面唯一的來源。2.0 起從單一份 `script.js`（2621 行）／`style.css`（881 行）拆成 `js/` 底下 29 個 ES module 跟 `css/` 底下 15 個樣式檔，見「2.0：為什麼拆檔、怎麼拆」。

處理流程分成三個 Stage（2.0 起；1.x 只有兩個，1.x 的 Stage 2 就是現在的 Stage 3）：

- **Stage 1 繁化**：PDF 在使用者本機 OCR，OCR 完的文字送後端做簡轉繁與 LLM 潤飾。
- **Stage 2 通用修改（2.0 新增）**：套用範本修改——後端用程式把半形標點轉全形、套用「修改前 → 修改後」的替換範本（半形空格一律不動），產出修改報告；可選擇請 LLM 看過字詞類的修改、提醒可能改錯的地方（只提醒、不改字）。
- **Stage 3 校對**：LLM 挑出錯字／用詞問題，使用者勾選要套用的建議。

判斷現在是不是桌面殼載入的，靠網址的查詢參數：桌面殼載入頁面時會帶 `?desktop=1&ocrToken=<隨機值>&apiBase=<Render網址>&appMajor=..&appMinor=..&osTier=..`，`js/core/config.js` 一開始就讀這些參數。有 `desktop=1` 時 Stage 1 的 PDF 先送本機的 `zh-cn-to-tw-ocr-service`（Mac 10.15 分流改用 Apple Vision）做 OCR，OCR 完的文字才送 Render 後端。沒有這些參數（純瀏覽器打開）時，按 Stage 1 只會提示要改用桌面版、不會送出任何請求；Stage 2、Stage 3 用直接上傳的 .docx/.txt 不需要 OCR，照樣能用。

### 系統架構

```
zh-cn-to-tw/                     ← meta-repo，本機開發統一入口，本身不部署
├── zh-cn-to-tw-backend/         ← 後端 API，部署到 Render(Flask)
├── zh-cn-to-tw-web/             ← 本 repo：main 分支被桌面版 App 內嵌；GitHub Pages 服務的是另一個獨立的 update-page 分支（下載頁）
├── zh-cn-to-tw-mac/             ← macOS 桌面殼（Swift/SwiftUI + WKWebView）
├── zh-cn-to-tw-windows/         ← Windows 桌面殼（.NET 8 WPF + WebView2）
└── zh-cn-to-tw-ocr-service/     ← 只在使用者本機跑的 OCR 服務，被桌面殼當子行程拉起
```

### 2.0：直向流程與三個 Stage

加進 Stage 2 之後，原本「Stage 1、Stage 2 左右並排，加上左側叮嚀」的橫向版面已經塞不下第三個 Stage，而且橫向只會越來越有極限。2.0 改成：左側「阿舍老師的叮嚀」固定不動，右側由上往下排三張 Stage 卡片，最上面是流程進度條。所有 1.x 的功能都保留。

**收合只是視覺上的差異**：卡片預設是收起來的。收起來時內容原封不動留在畫面裡，打開就看得到；只有重新整理、開始新的工作或換了劇本案才會清掉。流程自動接續到下一個 Stage 時，會收起前面做完的卡片、捲到正在跑的那張；使用者自己按「開始」時不捲動——人就在那張卡片上，捲動反而會把剛出現的進度區捲離畫面（實測撞過）。

**流程進度條**：三個圓用一條線串起來，每個圓有六種狀態：還沒開始、等等會執行、執行中、這次不執行、已完成、失敗或中斷。「等等會執行／這次不執行」是從接續設定算出來的：Stage 1 的「完成後接續」選單（不接／接 Stage 2／接 Stage 3），以及 Stage 2 的「接續 Stage 3 校對」開關。流程跑到一半改了接續設定，還沒開始的 Stage 會跟著更新。

**鎖定規則**：「開始」類按鈕在任何工作進行中都鎖住；後面 Stage 的設定在前面 Stage 跑的時候仍然可以改（等等自動接續時會用到），輪到自己跑才鎖——唯一的例外是下面說的 model 選單。直接上傳檔案的那一兩秒也算「處理中」——不然上傳完成時清掉其他 Stage 的動作，會把剛按下開始的工作清掉，畫面卡在「執行中」（known-issue-check 第 2 條）。

**接續時用哪個 model**：流程是從 Stage 1 開始的，接下去用到 LLM 的地方——Stage 2 的分析報告、Stage 3 校對——一律沿用 Stage 1 選的 model（Stage 3 是 1.x「直接進行校對」的既有行為，Stage 2 比照）。這段期間 Stage 2、Stage 3 的 model 選單會直接顯示那個 model 並鎖住，下面標示「沿用 Stage 1 選的 Model」，不讓人以為改那裡有用；Stage 1 自己就算沒開潤飾，只要後面會用到，model 欄位也不鎖。從 Stage 2 開始的，用各 Stage 自己的設定。輸出格式（txt／docx）跟著前一個 Stage。

**劇本案**：有工作在進行時（任何 Stage 在跑、分析報告還在背景跑，或流程還有排定要接續的 Stage）劇本案選單會鎖住——跑到一半換劇本案，後面接續的 Stage 會用新的劇本案送出，用量就記錯案子。真的換了另一個劇本案，三個 Stage 的進度全部清掉、卡片收回去；選同一個再按一次「確定」不清，避免誤按把還沒下載的結果清掉。

**Stage 2 在前端做的事**：套用與報告都是後端用程式做的（見 `zh-cn-to-tw-backend` README）。前端負責兩件事：
- **個人範本**：使用者下載目前的範本、自己增減、再選回來。下載、選檔的按鈕一直看得到，「使用個人範本」關著時鎖住，打開才能用。只存在這個畫面的記憶體裡，重新整理、關掉 App 或登出就清掉，不會蓋掉後端的預設範本。選檔當下就用 `js/stages/pattern-template.js` 檢查格式——跟後端同一套規則、訊息逐字相同——有錯誤當場報錯、不採用；後端套用時還會再檢查一次，那一份才是權威。
- **分析報告**：在背景輪詢，不鎖畫面、也不擋接續 Stage 3（它只是給人看的提醒），但會讓桌面殼別把系統睡掉。伺服器重啟中斷時會提示，可以按「重新分析」再跑一次。

半形轉全形在 Stage 2 用程式做掉，所以 Stage 3 的請求會帶 `skip_fullwidth_punct=true`，校對的前置處理就不再叫 LLM 轉全形。1.x 不會帶這個參數，後端對它維持原本的行為（見 `zh-cn-to-tw-backend` README）。

### 2.0：為什麼拆檔、怎麼拆

單一份 `script.js` 有 2621 行，狀態全是全域變數，再加第三個 Stage 會讓「誰能改哪個狀態」更難追。2.0 依職責拆成分層的 ES module：

- `core/`：跟畫面流程無關的基礎——設定、API、DOM 工具、事件、下載、版本檢查、跟殼的橋接。
- `auth/`：登入。
- `app/`：跨 Stage 的流程——共用狀態、鎖定、流程進度條、接續、劇本案、用量。
- `stages/`：三個 Stage 各自的畫面與流程，以及本機 OCR。
- `admin/`：管理員介面。

依賴方向固定是 core → auth → app → stages，沒有循環。Stage 之間不互相 import，「做完接下一個」集中在 `app/chain.js`；模組之間用一個很小的事件匯流排（`core/events.js`）溝通。只有 `app/chain.js` 跟 `app/bootstrap.js` 會 import Stage 模組。CSS 依 tokens → base → layout → components → pages → utilities 的順序載入，優先權靠載入順序控制。

**ES module 不能在 `file://` 底下用**：`file://` 頁面的 Origin 是 `"null"`，而 module script 一律走 CORS，會被擋下、整頁什麼都不執行。所以 2.0 換掉 `file://`，改成同樣固定、但有正常來源的網址：Windows 用 WebView2 虛擬主機 `https://zh-cn-to-tw.example`（已完成），Mac 用自訂 scheme `zhcntotw://app`（`WKURLSchemeHandler` 從 `.app` 裡的 `Resources/web/` 供應檔案，見 meta-repo 歷史裡的交接報告：`git show def41aa:docs/handoff/mac-2.0.md`）。來源依然固定，所以登入狀態一樣能跨次啟動保留；但 1.x 升級到 2.0 時來源換了，要重新登入一次。

**語法上限是 Safari 13.0**：Mac 10.15 分流出廠的 Safari 13.0 不支援 `??`、`?.`、`||=`、`replaceAll`、`Array#at`、private fields、top-level await、`Promise.allSettled`、`replaceChildren`。只要有一個模組用到其中一個，那個模組跟 import 它的模組全部不會執行，症狀是整頁「看起來載入了但什麼都沒有」。CSS 也避開 `@layer`、巢狀語法、`inset`。（ES module 本身 Safari 11 就支援。）

**殼與網頁的約定集中在 `js/core/bridge.js`**：網頁 → 殼走 `window.webkit.messageHandlers.<channel>.postMessage(...)`（WebView2 沒有這個物件，Windows 殼在頁面載入前自己注入一段 shim 補上），目前的 channel 有 `desktopSignIn`、`ocrService`、`activityGuard`、`legacyDownload`、`visionOcr`（只有 Mac 10.15），另外 `consoleLog` 是殼自己注入的腳本用來把 console 訊息轉給殼記錄。殼 → 網頁是直接執行一段 JS，會呼叫的全域名稱有 `handleCredentialResponse`、`showToast`、`window.__attemptAutoSaveBeforeSleep`、`window.__visionOcrProgress`，殼也會直接寫入 `window.__OCR_PORT__`。ES module 裡宣告的函式預設不是全域的，一定要經過 `exposeToShell` 掛上去，否則殼呼叫時只會得到 ReferenceError，畫面上什麼都不會發生。新增或改名任何一個，兩個殼都要跟著改。

**半路上的非同步結果要能作廢**：輪詢沿用 1.x 的 generation 守門（known-issue-check 第 2 條）。2.0 另外加了一個「登出 epoch」（`app/workflow.js` 的 `getRunEpoch()`）：登出時遞增，還在半路上的流程——最長的是 Stage 1 的本機 OCR，可能跑好幾分鐘——回來時發現 epoch 變了就整個放棄。它不會把上一個登入狀態的結果寫進現在的畫面，不會用現在（可能是另一個帳號）的登入送出去，也不會把現在的「處理中」解除掉。

### 為什麼這個 repo 的內容不會出現在 GitHub Pages 上

這個 repo 以前只有一個分支（`main`），同時扮演兩個角色：GitHub Pages 從這個分支的根目錄部署出去的公開網址（`https://beethoreven.github.io/zh-cn-to-tw-web/`），跟被桌面版 App 內嵌打包的網頁來源，是同一份檔案。

桌面版才是這個工具現在唯一的使用方式——單純瀏覽器打開網址、PDF 直接上傳給 Render 做 OCR 的那條路，繼承了 Render 免費方案扛不住 PaddleOCR 的資源風險（見 `zh-cn-to-tw-backend` README「為什麼 OCR 搬到使用者本機」），不該再是任何人能透過網址碰到的東西。2026-10-03 起 backend 那支收 PDF 的 `POST /api/jobs` 已經整個拔掉，前端在非桌面版模式下按 Stage 1 只會跳提示、要求改用桌面版，不會送出任何請求。

**曾經考慮過、後來放棄的方案**：把 GitHub Pages 服務的根目錄換成佔位頁，真正的網頁內容搬進同一個分支底下的 `app/` 子資料夾。這個方案的問題是 GitHub Pages 只要對某個分支開著，那個分支底下所有檔案都還是能被直接打開（`.../app/`）——只是沒有從根目錄連結出去，並沒有真正解決「這個網址打得到」的問題，只是藏起來，跟這個專案自己在別處記錄過的「延後問題、沒有根治」是同一種模式。

最後採用的方案：`main` 分支放真正的網頁內容（桌面殼打包時照樣從這裡複製檔案），另外開一個完全獨立的 `update-page` 分支，跟 `main` 沒有共同的檔案。GitHub repo 的 Pages 設定從「服務 `main` 分支的根目錄」改成「服務 `update-page` 分支的根目錄」。這樣一來，`main` 分支上的真實內容從結構上就完全不在 Pages 的服務範圍內——不是「沒連結」，是「根本不存在於被服務的那份檔案裡」。`https://beethoreven.github.io/zh-cn-to-tw-web/` 這個網址完全不變，`update-page` 現在的內容是桌面版的下載頁（Mac、Windows 安裝檔的連結）。

兩個桌面殼打包時都是直接從這個 repo 本機 clone 的工作目錄複製 `main` 分支的檔案，完全不透過 HTTP、跟 GitHub Pages 服務哪個分支無關，所以這個切分不影響桌面版打包。

### 為什麼桌面版的本機 OCR 服務是「用到才開、用完就關」

這是一段來回修正的過程，值得記錄：

**最早的設計**：桌面殼啟動時就把 `zh-cn-to-tw-ocr-service` 拉起來，整個 App 執行期間一直開著。問題是 PaddleOCR 模型載入後常駐佔用實測 **393MB** 記憶體，而它只在 Stage 1 的 OCR 那一步用得到，其他時候（潤飾、Stage 2、Stage 3、下載、登入）完全沒事做，白白佔著。

**中間的補丁**：加了「閒置 30 分鐘自我關閉」，但同時又有「健康檢查每 30 秒發現服務沒在跑就重新拉起」——這兩個機制互相打架，關掉沒多久又被拉起來，記憶體從沒真的被回收過，而且每次重啟都換一個新 port。

**最終方案**：`js/stages/ocr.js` 在真的要送 PDF 之前，才透過 `ocrService` channel 請桌面殼把服務拉起來，並且**輪詢 `/health` 直到真的可以服務了才送 PDF**（這一步不能省——port 是 process 剛綁定就印出來的，那個當下 Flask 通常還沒真正開始接受連線，只等 port 出現會撞上連線失敗）。OCR 階段結束（不管成功失敗）都在 `finally` 裡請桌面殼把服務關掉。移除了原本的健康檢查自動重啟機制。

服務的 port 不是固定值，而且會隨著開關而改變，**故意不寫進網址查詢參數裡**（那樣一變動就要重新載入整個頁面，會清掉使用者做到一半的表單狀態）——改成桌面殼直接把最新 port 寫進 `window.__OCR_PORT__`，`desktopOcrBase()` 每次要打本機 OCR API 前才即時讀這個值。

### 為什麼桌面版有工作在跑時要請系統別睡掉

`js/app/workflow.js` 有兩個入口：`setBusy()`（任何 Stage 在跑、或正在直接上傳檔案）跟 `setBackgroundTask()`（不鎖畫面的背景工作，目前是 Stage 2 的分析報告）。兩者任一個成立，就透過 `activityGuard` channel 通知桌面殼 `start`，全部結束才 `stop`；殼收到後請系統在這段期間別把整台機器睡掉（各殼的做法見各自 README）——使用者可能把一份大劇本丟著跑一整晚，工作進行到一半被系統睡掉打斷，代價是已經付費的 LLM 呼叫全部作廢，比單純多耗一點電更貴。

這個保護只在工作**真的在跑**的時候生效，工作一完成就解除——但「工作跑完」跟「使用者真的把結果存到本機」中間還有一段空窗，使用者完全可能把工作丟著跑一整晚、隔天早上才來看，這段空窗遠比工作實際執行的時間長。為了接住這段空窗，另外用一個 `hasDownloaded` 旗標追蹤「目前最新一份結果使用者存下來了沒」，規則只跟按鍵動作綁定：任何 Stage 開始（包含自動接續觸發的那次）一律變 `false`，真的下載成功（不是只是點了按鍵）一律變 `true`。Mac 殼在系統即將睡眠前，會呼叫 `window.__attemptAutoSaveBeforeSleep()`，如果 `hasDownloaded` 還是 `false`，就依 Stage 3 → Stage 2 → Stage 1 的順序找第一個可以按的下載鍵自動點一次（最後面的結果最完整）——**這是 best-effort，不是保證機制**：`NSWorkspace` 的睡眠通知沒辦法真的延後睡眠，來不來得及跑完（尤其 Render 剛好進入休眠、要 30-90 秒喚醒的情況）沒有保證，完整取捨見 `zh-cn-to-tw-mac` README。

### 桌面版的強制更新檢查

桌面殼載入頁面時，網址除了 `desktop=1&ocrToken=...&apiBase=...`，還會多帶 `appMajor`/`appMinor`（這個 App 自己的版本號，只有兩碼，見各殼的 README）。每個真正會開始跑工作的動作——Stage 1 送出、Stage 2 套用、Stage 3 開始校對與重新校對，包含自動接續觸發的那幾次——都先呼叫 `js/core/version.js` 的 `checkVersionOrBlock()` 打 `GET /api/version_check`，把 `appMajor`/`appMinor` 帶過去問 backend 這個版本夠不夠新。

`force_update` 是 `true` 就跳出對話框告知使用者版本過舊、附上更新頁網址（`https://beethoreven.github.io/zh-cn-to-tw-web/`，見上方「為什麼這個 repo 的內容不會出現在 GitHub Pages 上」），並且**擋下這次操作**（呼叫端直接 `return`，不會真的送出工作）。查詢本身失敗（網路問題、Render 剛好在冷啟動）視為不擋——查不到版本狀態不該變成擋住使用者工作的理由，只有明確查到「版本太舊」才生效。純瀏覽器開啟（沒有 `desktop=1`）完全不會觸發這個檢查，瀏覽器版沒有「App 版本」這個概念。

網址上還會多帶一個 `osTier`（Mac 是 `"11+"` 或 `"10.15"`，省略當 `"11+"`；Windows 是 `"windows"`）——Mac 桌面殼分成兩個獨立版控的 build，`10.15` 那包（部署目標壓到 10.15，見 `zh-cn-to-tw-mac` README「版本分流」）Stage 1 改用 Apple 原生 Vision framework 做 OCR，不透過 `zh-cn-to-tw-ocr-service`。這個值決定：

- **`checkVersionOrBlock()` 打 `version_check` 時帶哪個分流**：`os_version` 查詢參數直接帶這個值，後端 `app_versions` 表按 `(os, os_version)` 分開存各分流的門檻（見 `zh-cn-to-tw-backend` README「版本檢查」）。`os` 參數目前寫死 `macos`，Windows 靠 `osTier=windows` 在表裡查無資料而不受擋（見 `zh-cn-to-tw-windows` README）。
- **本機 OCR 走哪條路**：`js/stages/ocr.js` 的 `runLocalOcr()` 是 Stage 1 唯一的入口；一般走 HTTP 輪詢（`ensureDesktopOcrReady()`/`pollLocalOcrJob()`，對本機的 `zh-cn-to-tw-ocr-service`），`osTier === "10.15"` 改走 `visionOcr` channel（見下方「10.15 分流的本機 OCR」）。
- **下載走哪條路**：`js/core/download.js` 平常用 `fetch` 拿 blob、組一個 `blob:` URL 模擬點擊觸發下載——這條路在 Mac 靠 `WKDownload`，`10.15` 那包的 WKWebView 部署目標低於 `WKDownload` 要求的 macOS 11.3，完全沒有東西接手。`osTier === "10.15"` 時改把整份檔案內容轉成 base64，直接交給殼的 `legacyDownload` channel，由殼自己解碼寫進下載資料夾（見 `zh-cn-to-tw-mac` 的 `WebView.swift`）。

### 10.15 分流的本機 OCR

一般的本機 OCR（`ensureDesktopOcrReady()` 拉起 `zh-cn-to-tw-ocr-service` subprocess，`fetch` 打它的 `/ocr/pdf/start`、輪詢 `/ocr/pdf/status/<job_id>`）在 `10.15` 分流用不了——那支 Python service 依賴的 onnxruntime 編譯二進位檔 `minos` 寫死 11.0，10.15 上跑不動（見 `zh-cn-to-tw-mac` README「版本分流」）。`10.15` 分流改用 `runVisionOcrJob()`：

1. 用 `FileReader.readAsDataURL` 把 PDF 讀成 base64，交給殼的 `visionOcr` channel，帶 `jobId`/`pdfBase64`/`dpi`/`detectCover`。
2. 殼那邊用 Apple 原生 Vision framework（`VNRecognizeTextRequest`）在同一個 process 裡處理（見 `zh-cn-to-tw-mac` 的 `VisionOCRManager.swift`），沒有 subprocess，也就不需要 `ensureDesktopOcrReady()`/`releaseDesktopOcr()` 那套「用到才開、用完就關」的機制。
3. 進度／結果透過殼呼叫 `window.__visionOcrProgress(payload)` 推播回來，`payload` 的欄位形狀（`phase`/`currentPage`/`totalPages`/`logs`/`status`/`pages`/`error`）刻意跟 `zh-cn-to-tw-ocr-service` 的 job 狀態對齊，兩條路共用同一套進度顯示（Stage 1 傳進來的 `onStatus`/`onLogs`）。
4. 兩條路最後都只交出 OCR 完的頁面文字，Stage 1「本機 OCR 完成後 POST 去 `/api/jobs/from-ocr-text`」那段程式碼完全共用，不用分兩套邏輯。

### 為什麼用量數字不走輪詢

各 Stage 執行中會輪詢後端查進度，1.x 早期的 `loadUsage()`（今日 Gemini 額度、Claude token 費用）也掛在同一個輪詢迴圈裡，每輪一起打。這個數字其實完全不需要即時——使用者不會盯著它看它跳動，需要即時的只有三類：「隨時可能中斷需要恢復的工作狀態」「執行進度」「使用者操作的直接回饋」。用量統計都不屬於這三類。

改成只在「登入時」跟「每個 Stage 結束時（含失敗／中斷）」才更新（`js/app/usage.js` 的 `refreshUsageAfterStage()`），Stage 1 執行中每輪的請求數因此從 4 個降到 1 個。這個判斷準則後來寫成了一個通用的稽核方法（`real-time-scenario` skill）：任何「持續輪詢／持續同步」的設計，都該先問「如果這個晚幾秒才更新，誰會發現、會壞掉什麼」，答不出來就不該是即時的。

### Session 儲存

登入後拿到的 session token（見 `zh-cn-to-tw-backend` 的說明，不是原始 Google ID Token）存進 `localStorage`。這在桌面版特別重要——`localStorage` 是照來源分開存的，桌面殼用固定來源載入頁面（1.x 是固定的 `file://` 路徑，2.0 起是固定的虛擬主機／自訂 scheme），登入狀態才能真正跨次啟動保留（見各殼 README 的完整說明）。來源一換就讀不到舊的登入狀態，所以 1.x 升級到 2.0 要重新登入一次。

### 「阿舍老師的叮嚀」：三次失敗才找到的解法

主頁左側那塊純文字提示，內容原本直接放在這個 repo、前端用 `fetch()` 讀同目錄檔案——瀏覽器版沒問題，桌面版 `file://` 底下完全行不通。依序試過三種修法都失敗（`XMLHttpRequest`、隱藏 `<iframe>` + `contentDocument`），原因都一樣：`file://` 底下 JS 執行期沒有任何辦法讀到「同目錄另一個檔案」的內容，不管透過哪個瀏覽器 API 包裝都一樣，是平台層級的限制。最後把內容整個移到 `zh-cn-to-tw-backend`，透過一個不需要登入的 API 端點供應，瀏覽器版跟桌面版從此走同一條路徑。完整過程見 `zh-cn-to-tw-backend` README 的對應段落。

### 檔案結構

```
index.html                 唯一的頁面骨架
assets/favicon.png
css/
  tokens.css               顏色、間距等設計變數（含深色模式）
  base.css / layout.css    基本元素、整頁版面（左側叮嚀＋右側直向流程）
  components/              各元件：帳號、叮嚀、開關、流程進度條、Stage 卡片、
                           進度紀錄、校對建議、範本修改、提示、對話框
  pages/admin.css          管理員介面
  utilities.css            最後載入的通用 class（例如 [hidden]）
js/
  main.js                  進入點：依序初始化各模組，最後才初始化登入
  core/                    config、api、dom、events、toast、download、version、modal、bridge
  auth/login.js            登入、登出
  app/                     state、workflow（鎖定／流程進度）、stage-card、chain（接續）、
                           bootstrap（登入後載入資料）、options、project、usage、ta-notice
  stages/                  stage1、stage2、stage3、ocr（本機 OCR）、pattern-template（範本檢查）
  admin/                   管理員介面（使用者、權限、劇本案）
```

無建置流程，整個資料夾直接被兩個桌面殼的打包腳本複製進 App。GitHub Pages **不會**部署這個分支——它服務的是另一個獨立的 `update-page` 分支，見上方「為什麼這個 repo 的內容不會出現在 GitHub Pages 上」。

### 已知限制

- 1.x 升級到 2.0 要重新登入一次（網頁來源換了，見「Session 儲存」）。
- 語法上限是 Safari 13.0，寫新程式碼前先看「2.0：為什麼拆檔、怎麼拆」那一段的清單。
- `version_check` 的 `os` 參數仍寫死 `macos`，強制更新政策目前對 Windows 不生效。

---

# 架設 SOP / Setup Guide

## Part A. 本機測試（瀏覽器）

ES module 一定要用 http 開，直接雙擊 `index.html`（`file://`）整頁不會執行。用 Python 內建的靜態伺服器：

```bash
cd zh-cn-to-tw-web
python3 -m http.server 8000
```

打開 `http://localhost:8000`，預設會打正式的 Render 網址；要測本機 backend，網址列加 `?apiBase=http://localhost:5001`（後端的 CORS 允許任意 port 的 `localhost`/`127.0.0.1`）。瀏覽器模式下 Stage 1 只會提示要改用桌面版，Stage 2、Stage 3 可以用直接上傳的檔案測。

## Part B. 本機測試（模擬桌面版）

加齊桌面版判斷需要的查詢參數：

```
http://localhost:8000/?desktop=1&ocrToken=test&apiBase=http://localhost:5001
```

這樣會嘗試走本機 OCR 那條路，但因為沒有真正的桌面殼幫你把 `window.__OCR_PORT__` 寫進去、也沒有 `ocrService` 這個 message handler，本機 OCR 相關功能實際上叫不動——這個模式主要是拿來看 UI 判斷邏輯對不對，真正端到端測試桌面路徑要在桌面殼裡測（見 Part C）。

## Part C. 在桌面殼裡測還沒合併的前端

- **Windows，直接跑開發版**：照 `zh-cn-to-tw-windows` README 用 `dotnet run`，搭配 `WEB_BASE_URL_OVERRIDE` 指到 Part A 的本機伺服器。
- **Windows，打包成安裝檔**：執行打包前先設 `WEB_REPO_OVERRIDE` 指到這份前端的資料夾（例如放在一個 git worktree 裡、還沒合併的分支），見 `zh-cn-to-tw-windows` README「Part D. 打包成安裝檔」。
- **Mac**：打包前設 `WEB_SRC_DIR` 指到這份前端的資料夾，見 `zh-cn-to-tw-mac` 的 `packaging/build_app_*.sh`。

## Part D. 部署與合併時機

**`main` 分支不需要、也不會被部署。** Push 到 `main` 只影響兩個桌面殼下次打包時複製到的內容，跟 GitHub Pages 完全無關。

**需要殼一起改的前端改動，先放在別的分支**：Mac、Windows 打包都是直接從 `main` 複製網頁，`main` 上的前端必須是兩個殼現在都載得起來的版本。像 2.0 換載入方式這種要殼配合的改動，先在別的分支做（2.0 用的是 `v2` 分支，Windows 用 `WEB_REPO_OVERRIDE`、Mac 用 `WEB_SRC_DIR` 指過去測），兩個殼都改好、測過之後再合併進 `main`。用到新 API 的改動，也要等後端先部署。

## Part E. 更新 GitHub Pages 上的下載頁（`update-page` 分支）

GitHub Pages 設定成服務 `update-page` 分支的根目錄（Settings → Pages → Source），這個分支跟 `main` 沒有共同的檔案、也沒有共同的 git 歷史（獨立的 orphan 分支），內容是桌面版的下載頁。連結直接指到 GitHub Release 上的安裝檔，網址釘死版本號，**每次出新版都要手動更新**：

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

The frontend for a Simplified-to-Traditional Chinese script conversion tool. Its only purpose is to be embedded inside the two desktop apps (`zh-cn-to-tw-mac`, `zh-cn-to-tw-windows`). Pairs with the backend API: [`zh-cn-to-tw-backend`](https://github.com/beethoreven/zh-cn-to-tw-backend). This document is split into two parts:

- **[Project Report](#project-report)**: how 2.0's vertical flow and file split are designed, why this repo's content never appears on GitHub Pages, and the key decisions behind desktop local OCR.
- **[Setup Guide](#setup-guide)**: how to run it locally, and when it can be merged into `main`.

The two parts are deliberately separate — don't read them interleaved; the report is background knowledge, the guide is an operating manual.

## Project Report

### What This Is

Vanilla JavaScript (no framework, no build step), embedded by the desktop shells — it's the sole source of the desktop app's screen. From 2.0 on, the single `script.js` (2,621 lines) / `style.css` (881 lines) is split into 29 ES modules under `js/` and 15 stylesheets under `css/`; see "2.0: Why and How the Files Were Split".

Processing runs in three Stages (from 2.0; 1.x had two, and 1.x's Stage 2 is today's Stage 3):

- **Stage 1 Convert**: the PDF is OCR'd on the user's own machine, and the OCR'd text goes to the backend for Simplified-to-Traditional conversion and LLM polish.
- **Stage 2 General Edits (new in 2.0)**: Apply Template — the backend, in plain code, converts half-width punctuation to full-width and applies a "before → after" replacement template (half-width spaces are never touched), and produces an edit report; optionally, an LLM looks over the word-level edits and flags ones that may be wrong (it only flags; it never changes text).
- **Stage 3 Proofread**: an LLM picks out typos/wording problems, and the user ticks the suggestions to apply.

Whether the page was loaded by a desktop shell is determined from URL query parameters: the shell loads the page with `?desktop=1&ocrToken=<random>&apiBase=<Render URL>&appMajor=..&appMinor=..&osTier=..`, and `js/core/config.js` reads these at startup. With `desktop=1`, Stage 1 first sends the PDF to the local `zh-cn-to-tw-ocr-service` (Apple Vision on the Mac 10.15 tier) for OCR, and only the resulting text goes to the Render backend. Without those parameters (a plain browser), pressing Stage 1 only shows a notice to use the desktop app and sends no request; Stage 2 and Stage 3 need no OCR and still work with a directly-uploaded .docx/.txt.

### System Architecture

```
zh-cn-to-tw/                     ← meta-repo, unified local-dev entry, never deployed itself
├── zh-cn-to-tw-backend/         ← backend API, deployed to Render (Flask)
├── zh-cn-to-tw-web/             ← this repo: main is embedded in the desktop apps; GitHub Pages serves a separate update-page branch (the download page)
├── zh-cn-to-tw-mac/             ← macOS desktop shell (Swift/SwiftUI + WKWebView)
├── zh-cn-to-tw-windows/         ← Windows desktop shell (.NET 8 WPF + WebView2)
└── zh-cn-to-tw-ocr-service/     ← local-only OCR service, launched as a subprocess by the desktop shell
```

### 2.0: The Vertical Flow and Three Stages

Once Stage 2 was added, the old horizontal layout ("Stage 1 and Stage 2 side by side, plus the notes on the left") could not fit a third Stage, and a horizontal layout only gets more cramped from here. 2.0 keeps "阿舍老師的叮嚀" (the teacher's notes) fixed on the left and stacks three Stage cards top to bottom on the right, with a progress stepper on top. Every 1.x feature is kept.

**Collapsing is purely visual**: cards start collapsed. A collapsed card keeps its content on the page untouched, and opening it shows everything again; content is only cleared by reloading, starting a new job, or switching to another script project. When the flow automatically chains into the next Stage, the finished cards above it collapse and the page scrolls to the running one; when the user presses "start" themselves, it does not scroll — the user is already on that card, and scrolling would push the freshly-shown progress area off screen (hit in practice).

**The stepper**: three circles joined by a line, each in one of six states: not started, will run, running, won't run this time, done, failed or interrupted. "Will run / won't run this time" is computed from the chaining settings: Stage 1's "continue with" select (none / Stage 2 / Stage 3) and Stage 2's "continue to Stage 3 proofreading" switch. Changing a chaining setting mid-flow updates the Stages that haven't started yet.

**Locking rules**: "start"-type buttons are locked while any job is running; a later Stage's settings stay editable while an earlier Stage runs (they'll be used when the flow chains into it), and lock only when that Stage itself runs — the one exception is the model select described below. The second or two of a direct file upload also counts as "processing" — otherwise the upload's completion, which clears the other Stages, would wipe out a job that had just been started, leaving the screen stuck on "running" (known-issue-check item 2).

**Which model is used when chaining**: if the flow started at Stage 1, everything downstream that calls an LLM — Stage 2's analysis report and Stage 3 proofreading — uses Stage 1's model (for Stage 3 this is the existing 1.x "proofread directly" behavior; Stage 2 follows suit). Meanwhile the Stage 2 and Stage 3 model selects show that model, locked, with a note "沿用 Stage 1 選的 Model" (using Stage 1's model) underneath, so nobody thinks changing them would matter; and Stage 1's own model field stays unlocked whenever a later Stage will use it, even if Stage 1 itself does no LLM polish. If the flow started at Stage 2, each Stage uses its own setting. The output format (txt/docx) follows the previous Stage.

**Script projects**: while work is in progress (any Stage running, an analysis report still running in the background, or Stages still planned in the current flow) the script-project picker is locked — switching projects mid-flow would make the chained Stages submit under the new project and bill usage to the wrong one. Actually switching to another project clears all three Stages and collapses the cards; confirming the same project again clears nothing, so a stray click can't wipe results that haven't been downloaded yet.

**What the frontend does for Stage 2**: applying the template and producing the report happen on the backend in plain code (see `zh-cn-to-tw-backend`'s README). The frontend handles two things:
- **Personal templates**: the user downloads the current template, edits it, and picks it back in. The download and pick-a-file buttons are always visible, locked while "use personal template" is off and usable once it is on. It lives only in this page's memory and is cleared by reloading, closing the app, or signing out; it never overwrites the backend's default template. A chosen file is checked immediately by `js/stages/pattern-template.js` — the same rules as the backend, with word-for-word identical messages — and any error is reported on the spot and the file is not used; the backend checks again when applying, and that check is the authoritative one.
- **The analysis report**: polled in the background; it doesn't lock the page and doesn't hold up chaining into Stage 3 (it's only a reminder for humans), but it does keep the desktop shell from letting the system sleep. If a server restart interrupts it, the page says so and offers "re-analyze".

Half-width-to-full-width conversion is done in code in Stage 2, so Stage 3's request carries `skip_fullwidth_punct=true` and proofreading's preprocessing no longer asks the LLM to convert punctuation. 1.x never sends this parameter, and the backend keeps the old behavior for it (see `zh-cn-to-tw-backend`'s README).

### 2.0: Why and How the Files Were Split

The single `script.js` was 2,621 lines with all state in global variables; adding a third Stage would have made "who may change which state" even harder to follow. 2.0 splits it by responsibility into layered ES modules:

- `core/`: foundations unrelated to the page flow — config, API, DOM helpers, events, downloads, the version check, the bridge to the shell.
- `auth/`: sign-in.
- `app/`: cross-Stage flow — shared state, locking, the stepper, chaining, script projects, usage.
- `stages/`: each of the three Stages' screens and flows, plus local OCR.
- `admin/`: the admin interface.

Dependencies always point core → auth → app → stages, with no cycles. Stages never import each other; "when one finishes, start the next" lives in `app/chain.js`, and modules talk through a tiny event bus (`core/events.js`). Only `app/chain.js` and `app/bootstrap.js` import Stage modules. CSS loads in the order tokens → base → layout → components → pages → utilities, and precedence is controlled by that order.

**ES modules cannot be used under `file://`**: a `file://` page's Origin is `"null"`, and module scripts always go through CORS, so they get blocked and nothing on the page runs. So 2.0 replaces `file://` with an address that is just as fixed but has a proper origin: Windows uses a WebView2 virtual host, `https://zh-cn-to-tw.example` (done), and Mac uses a custom scheme, `zhcntotw://app` (a `WKURLSchemeHandler` serves the files from `Resources/web/` inside the `.app`; see the handoff report in the meta-repo's history: `git show def41aa:docs/handoff/mac-2.0.md`). The origin is still fixed, so sign-in still survives restarts; but because the origin changes between 1.x and 2.0, upgrading means signing in once more.

**The syntax ceiling is Safari 13.0**: the Safari 13.0 that ships with the Mac 10.15 tier doesn't support `??`, `?.`, `||=`, `replaceAll`, `Array#at`, private fields, top-level await, `Promise.allSettled`, or `replaceChildren`. If any module uses one of them, that module and every module importing it fail to run, and the symptom is a page that "looks loaded but does nothing". CSS likewise avoids `@layer`, nesting, and `inset`. (ES modules themselves are supported from Safari 11.)

**The contract between the shell and the page lives in `js/core/bridge.js`**: page → shell goes through `window.webkit.messageHandlers.<channel>.postMessage(...)` (WebView2 has no such object, so the Windows shell injects a shim before the page loads). The current channels are `desktopSignIn`, `ocrService`, `activityGuard`, `legacyDownload`, and `visionOcr` (Mac 10.15 only); `consoleLog` is used by the shell's own injected script to forward console messages to the shell's log. Shell → page works by running a piece of JS directly, and the global names it calls are `handleCredentialResponse`, `showToast`, `window.__attemptAutoSaveBeforeSleep`, and `window.__visionOcrProgress`; the shell also writes `window.__OCR_PORT__` directly. Functions declared in an ES module are not global by default, so they must be attached through `exposeToShell` — otherwise the shell's call just gets a ReferenceError and nothing visibly happens. Adding or renaming any of these means changing both shells too.

**Async results that come back late must be discardable**: polling keeps 1.x's generation guard (known-issue-check item 2). 2.0 also adds a "sign-out epoch" (`getRunEpoch()` in `app/workflow.js`): it increments on sign-out, and a flow still in flight — the longest is Stage 1's local OCR, which can run for minutes — abandons itself entirely when it comes back and sees the epoch changed. It never writes the previous sign-in's result into the current page, never submits with the current (possibly different) account's sign-in, and never clears the current "processing" state.

### Why This Repo's Content Never Appears on GitHub Pages

This repo used to have a single branch (`main`) that played two roles at once: the public URL GitHub Pages deploys from that branch's root (`https://beethoreven.github.io/zh-cn-to-tw-web/`), and the web source embedded into the packaged desktop app — the exact same files served both roles.

The desktop app is now the only way to use this tool — a plain browser hitting the URL and uploading a PDF straight to Render for OCR inherits Render's free-tier inability to reliably run PaddleOCR (see `zh-cn-to-tw-backend`'s README, "Why OCR Moved to the User's Own Machine"), and shouldn't be something anyone can reach via a URL anymore. As of 2026-10-03, the backend's PDF-accepting `POST /api/jobs` has been removed entirely; outside desktop mode, pressing Stage 1 only shows a notice asking the user to switch to the desktop app, without sending any request.

**Tried and abandoned**: switching what GitHub Pages deploys from the repo root to a placeholder, while moving the real web content into an `app/` subfolder under the same branch. The problem: as long as GitHub Pages is enabled for a branch, every file under that branch is still reachable directly (`.../app/`) — nothing was actually unlinked from the root, but the URL itself still worked, just hidden. That's the same "defer the problem, don't fix it" pattern this project has documented elsewhere.

What shipped instead: `main` holds the real web content (the desktop shells' packaging scripts still copy from here), and a completely separate `update-page` branch shares no files with `main`. The repo's Pages setting was switched from "serve `main`'s root" to "serve `update-page`'s root." That means the real content on `main` is structurally outside anything Pages ever serves — not "unlinked," but "not present in the served tree at all." The URL `https://beethoreven.github.io/zh-cn-to-tw-web/` itself is unchanged, and `update-page` now holds the desktop download page (links to the Mac and Windows installers).

Both desktop shells build by copying `main`'s files from this repo's local working tree directly — no HTTP involved, and independent of which branch GitHub Pages happens to be serving — so this split doesn't affect desktop packaging at all.

### Why the Desktop OCR Service Is "Start on Use, Stop When Done"

This went through a back-and-forth worth recording:

**Original design**: the desktop shell started `zh-cn-to-tw-ocr-service` at app launch and kept it running for the entire session. Problem: once PaddleOCR's models load, they sit at a measured **393MB** resident, but the service is only actually useful during Stage 1's OCR step — the rest of the time (polish, Stage 2, Stage 3, download, login) it does nothing at all.

**Interim patch**: added a "self-shutdown after 30 minutes idle," but also had "a health check every 30 seconds that respawns the service if it's not running" — the two mechanisms fought each other, so the service kept getting respawned shortly after shutting down, memory was never actually reclaimed, and every respawn came with a new port.

**Final approach**: right before actually sending a PDF, `js/stages/ocr.js` asks the desktop shell to start the service through the `ocrService` channel, and **polls `/health` until the service is actually ready before sending the PDF** (this step can't be skipped — the port is printed the moment the process binds it, at which point Flask typically hasn't started accepting connections yet; waiting only for the port to appear would hit connection failures). Once the OCR step ends (success or failure), a `finally` block asks the shell to stop the service. The original auto-respawning health check was removed.

The service's port isn't fixed and changes every time it starts/stops, so it's **deliberately not written into the URL query string** (which would require a full page reload on every change, wiping out whatever the user had half-filled in). Instead, the shell writes the current port straight into `window.__OCR_PORT__`, and `desktopOcrBase()` reads that value fresh right before each local-OCR API call.

### Why the Desktop Build Asks the System Not to Sleep While a Job Is Running

`js/app/workflow.js` has two entry points: `setBusy()` (any Stage running, or a direct file upload in progress) and `setBackgroundTask()` (background work that doesn't lock the page — currently Stage 2's analysis report). Whenever either holds, the desktop shell is told `start` through the `activityGuard` channel, and `stop` once everything has ended; the shell then asks the system not to let the whole machine sleep for that stretch (each shell's mechanism is in its own README) — a user might leave a big script running overnight, and having the job interrupted mid-way by system sleep costs already-paid-for LLM calls, which is worse than a bit of extra power draw.

This protection only holds while a job is genuinely **running** — it lifts the moment the job finishes. But there's a gap between "job done" and "user actually saved the result locally," and a user can easily leave a finished job sitting untouched overnight, far longer than the job itself took to run. To catch that gap, a separate `hasDownloaded` flag tracks whether the latest result has been saved, with rules tied purely to button actions: any Stage starting (including one triggered by chaining) always sets it to `false`; a download that actually succeeds (not just a click) always sets it to `true`. Right before the system sleeps, the Mac shell calls `window.__attemptAutoSaveBeforeSleep()`, which — if `hasDownloaded` is still `false` — clicks the first available download button in the order Stage 3 → Stage 2 → Stage 1 (the latest result is the most complete) — **this is best-effort, not a guarantee**: `NSWorkspace`'s sleep notification can't actually delay sleep, so whether this finishes in time (especially if Render happens to be asleep and needs 30–90 seconds to wake) isn't assured. Full tradeoff discussion in `zh-cn-to-tw-mac`'s README.

### Desktop Forced-Update Check

When a desktop shell loads the page, the URL carries `appMajor`/`appMinor` alongside `desktop=1&ocrToken=...&apiBase=...` — the app's own version number, only two digits (see each shell's README). Every action that actually kicks off work — Stage 1 submit, Stage 2 apply, Stage 3 start and rerun, including the ones triggered by chaining — first calls `checkVersionOrBlock()` in `js/core/version.js`, which hits `GET /api/version_check` with `appMajor`/`appMinor` to ask the backend whether this version is new enough.

If `force_update` comes back `true`, it shows a dialog telling the user their version is too old, with a link to the update page (`https://beethoreven.github.io/zh-cn-to-tw-web/`, see "Why This Repo's Content Never Appears on GitHub Pages" above), and **blocks the action** — the caller just `return`s, no work actually gets submitted. A failed query (network hiccup, Render mid-cold-start) is treated as non-blocking — being unable to check the version shouldn't be a reason to block the user's work; only an explicit "version too old" answer takes effect. Plain browser opens (no `desktop=1`) never trigger this check at all — the browser build has no concept of an "app version."

The URL also carries `osTier` (on Mac `"11+"` or `"10.15"`, defaulting to `"11+"` if absent; on Windows `"windows"`) — the Mac shell ships as two independently-versioned builds, and the `10.15` one (deployment target down at 10.15, see `zh-cn-to-tw-mac`'s README, "Version Tiers") does Stage 1 OCR natively via Apple's Vision framework instead of `zh-cn-to-tw-ocr-service`. This value drives:

- **Which tier `checkVersionOrBlock()` queries**: passed straight through as the `os_version` query parameter — the backend's `app_versions` table keys its thresholds by `(os, os_version)`, one row per tier (see `zh-cn-to-tw-backend`'s README, "Version Check"). The `os` parameter is still hardcoded to `macos`; Windows escapes blocking because `osTier=windows` has no row in the table (see `zh-cn-to-tw-windows`'s README).
- **Which local-OCR path is used**: `runLocalOcr()` in `js/stages/ocr.js` is Stage 1's single entry point; normally it uses HTTP polling (`ensureDesktopOcrReady()`/`pollLocalOcrJob()`, talking to the local `zh-cn-to-tw-ocr-service`), and with `osTier === "10.15"` it uses the `visionOcr` channel instead (see "Local OCR on the 10.15 Tier" below).
- **Which download path is used**: `js/core/download.js` normally fetches the file as a blob and simulates a click on a `blob:` URL — on Mac that path relies on `WKDownload`, which needs macOS 11.3+; the `10.15` build's WKWebView sits below that floor, so nothing picks up the navigation. When `osTier === "10.15"`, the file content is base64-encoded and handed to the shell's `legacyDownload` channel instead, which decodes it and writes it to the Downloads folder natively (see `WebView.swift` in `zh-cn-to-tw-mac`).

### Local OCR on the 10.15 Tier

The normal local-OCR path (`ensureDesktopOcrReady()` launches the `zh-cn-to-tw-ocr-service` subprocess, `fetch`es its `/ocr/pdf/start`, polls `/ocr/pdf/status/<job_id>`) doesn't work on the `10.15` tier — that Python service's onnxruntime dependency has its `minos` hardcoded to 11.0 in the compiled binary, so it can't run on 10.15 (see `zh-cn-to-tw-mac`'s README, "Version Tiers"). The `10.15` tier uses `runVisionOcrJob()` instead:

1. Reads the PDF as base64 via `FileReader.readAsDataURL`, then hands it to the shell's `visionOcr` channel, carrying `jobId`/`pdfBase64`/`dpi`/`detectCover`.
2. The shell processes it natively, in-process, via Apple's Vision framework (`VNRecognizeTextRequest`) — see `VisionOCRManager.swift` in `zh-cn-to-tw-mac`. No subprocess means no need for the `ensureDesktopOcrReady()`/`releaseDesktopOcr()` "launch on demand, release when done" dance.
3. Progress and results come back through the shell calling `window.__visionOcrProgress(payload)` — `payload`'s shape (`phase`/`currentPage`/`totalPages`/`logs`/`status`/`pages`/`error`) is deliberately aligned with `zh-cn-to-tw-ocr-service`'s job state, so both paths share the same progress display (the `onStatus`/`onLogs` hooks Stage 1 passes in).
4. Both paths end by handing over only the OCR'd page text, so the "POST the OCR'd pages to `/api/jobs/from-ocr-text`" step of the Stage 1 submit flow is shared code between both paths, not two separate implementations.

### Why Usage Numbers Aren't Polled

Each Stage polls the backend for progress while running. In early 1.x, `loadUsage()` (today's Gemini quota, Claude token cost) lived inside that same polling loop, firing on every tick. That number genuinely never needs to be real-time — nobody watches it tick up live. Only three kinds of thing actually need to be real-time: state that can be interrupted and needs recovery, execution progress, and direct feedback for something the user just did. Usage stats fit none of those.

It now updates only "on login" and "at the end of each Stage (including failure/interruption)" (`refreshUsageAfterStage()` in `js/app/usage.js`), dropping Stage 1's per-tick request count from 4 to 1. This judgment call was later generalized into a reusable audit method (the `real-time-scenario` skill): for any "keeps polling/keeps syncing" design, ask first "if this were a few seconds stale, who would notice, and what would break" — if there's no answer, it shouldn't be real-time.

### Session Storage

The session token obtained after login (see `zh-cn-to-tw-backend`'s notes — not the raw Google ID Token) is stored in `localStorage`. This matters especially on desktop — `localStorage` is kept per origin, and it's because the desktop shells load the page from a fixed origin (a fixed `file://` path in 1.x; a fixed virtual host / custom scheme from 2.0) that sign-in actually survives across app restarts (see each shell's README for the full story). A changed origin can't read the old sign-in, which is why upgrading from 1.x to 2.0 means signing in once more.

### The "Teacher's Notes" Sidebar: Three Failed Attempts Before the Fix

The plain-text tip panel on the left originally lived in this repo, read via `fetch()` on a same-directory file — fine in the browser, completely broken under the desktop's `file://`. Three fixes were tried in sequence and all failed (`XMLHttpRequest`, a hidden `<iframe>` + `contentDocument`), for the same underlying reason each time: under `file://`, JS has no way at runtime to read another file in the same directory, regardless of which browser API wraps the attempt — a platform-level limitation, not an API choice. The content was eventually moved entirely into `zh-cn-to-tw-backend`, served through a no-login-required API endpoint, so browser and desktop share one path from then on. Full story in `zh-cn-to-tw-backend`'s README.

### File Layout

```
index.html                 the one page skeleton
assets/favicon.png
css/
  tokens.css               design variables such as colors and spacing (incl. dark mode)
  base.css / layout.css    base elements, page layout (notes on the left + vertical flow on the right)
  components/              components: account, notes, switch, stepper, Stage card,
                           progress log, proofreading suggestions, template edits, toast, modal
  pages/admin.css          admin interface
  utilities.css            general-purpose classes loaded last (e.g. [hidden])
js/
  main.js                  entry point: initializes each module in order, sign-in last
  core/                    config, api, dom, events, toast, download, version, modal, bridge
  auth/login.js            sign-in, sign-out
  app/                     state, workflow (locking / stepper), stage-card, chain (chaining),
                           bootstrap (loading data after sign-in), options, project, usage, ta-notice
  stages/                  stage1, stage2, stage3, ocr (local OCR), pattern-template (template checks)
  admin/                   admin interface (users, permissions, script projects)
```

No build step — the whole folder is copied straight into the app by both desktop shells' packaging scripts. GitHub Pages does **not** deploy this branch — it serves a separate `update-page` branch instead; see "Why This Repo's Content Never Appears on GitHub Pages" above.

### Known Limitations

- Upgrading from 1.x to 2.0 means signing in once more (the page's origin changed; see "Session Storage").
- The syntax ceiling is Safari 13.0; check the list in "2.0: Why and How the Files Were Split" before writing new code.
- `version_check`'s `os` parameter is still hardcoded to `macos`, so the forced-update policy currently doesn't apply to Windows.

---

# Setup Guide

## Part A. Local Testing (Browser)

ES modules must be served over http — double-clicking `index.html` (`file://`) runs nothing on the page. Use Python's built-in static server:

```bash
cd zh-cn-to-tw-web
python3 -m http.server 8000
```

Open `http://localhost:8000` — this hits the production Render URL by default; to test against a local backend, add `?apiBase=http://localhost:5001` to the URL (the backend's CORS allows any-port `localhost`/`127.0.0.1`). In browser mode Stage 1 only tells you to use the desktop app; Stage 2 and Stage 3 can be tested with directly-uploaded files.

## Part B. Local Testing (Simulating Desktop Mode)

Add the query parameters desktop-mode detection needs:

```
http://localhost:8000/?desktop=1&ocrToken=test&apiBase=http://localhost:5001
```

This will attempt the local-OCR path, but since there's no real desktop shell writing `window.__OCR_PORT__` or providing an `ocrService` message handler, local OCR won't actually work — this mode is mainly useful for checking the UI's branching logic. True end-to-end testing of the desktop path has to happen inside a desktop shell (see Part C).

## Part C. Testing an Unmerged Frontend Inside a Desktop Shell

- **Windows, running the dev build**: use `dotnet run` per `zh-cn-to-tw-windows`'s README, with `WEB_BASE_URL_OVERRIDE` pointed at Part A's local server.
- **Windows, packaging an installer**: set `WEB_REPO_OVERRIDE` to this frontend's folder before packaging (for example, an unmerged branch checked out in a git worktree); see `zh-cn-to-tw-windows`'s README, "Part D. Packaging an Installer".
- **Mac**: set `WEB_SRC_DIR` to this frontend's folder before packaging; see `packaging/build_app_*.sh` in `zh-cn-to-tw-mac`.

## Part D. Deployment and When to Merge

**The `main` branch needs no deployment and never gets one.** Pushing to `main` only affects what the two desktop shells copy in on their next build — it has nothing to do with GitHub Pages.

**Frontend changes that need the shells to change too go on another branch first**: both the Mac and Windows packaging copy the web files straight from `main`, so the frontend on `main` must always be one both shells can currently load. A change that needs the shells' cooperation, like 2.0's new loading method, is built on another branch first (2.0 used the `v2` branch, tested by pointing Windows' `WEB_REPO_OVERRIDE` and Mac's `WEB_SRC_DIR` at it) and merged into `main` only after both shells are changed and tested. Changes that use a new API also wait until the backend has deployed it.

## Part E. Updating the GitHub Pages Download Page (`update-page` branch)

GitHub Pages is configured to serve the root of the `update-page` branch (Settings → Pages → Source). This branch shares no files, and no git history, with `main` (it's a separate orphan branch); its content is the desktop download page. Its links point straight at the installers on GitHub Releases with the version number pinned in the URL, so **they must be updated by hand for every new release**:

```bash
git checkout update-page
# edit index.html
git add index.html
git commit -m "..."
git push origin update-page
git checkout main
```

Don't touch `main`'s code on this branch, and don't merge it back into `main` — the two are deliberately kept with no shared history.
