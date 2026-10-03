# update-page

這個分支只服務一個目的：GitHub Pages 從這裡發布 `https://beethoreven.github.io/zh-cn-to-tw-web/`。內容是桌面版 App 的下載頁（`index.html`），這裡不會自己存安裝檔，每個下載點都**直接連到**對應 repo 的 GitHub Release 底下的檔案本身（版控真正的來源在那邊）：

| 平台 | 下載點 | Release 所在 repo | tag | 檔名 |
|---|---|---|---|---|
| Mac | Mac OS 11（含）以上 | `zh-cn-to-tw-mac` | `v<版本>-11-plus` | `ZhCnToTw-<版本>-11+.dmg` |
| Mac | Mac OS 10.15 | `zh-cn-to-tw-mac` | `v<版本>-10-15` | `ZhCnToTw-<版本>-10.15.dmg` |
| Windows | Windows 10（1607 以上）／ Windows 11，64 位元 | `zh-cn-to-tw-windows` | `v<版本>` | `ZhCnToTw-Setup-<版本>.exe` |

連結格式是 `https://github.com/<owner>/<repo>/releases/download/<tag>/<檔名>`——這個網址結構本身完全可預期，不是隨機/雜湊出來的，所以直接連到檔案本身，不必多繞一層先連到 Release 頁面再讓使用者自己找按鈕點；點下去就直接開始下載。

GitHub Release 資產的檔名刻意用純 ASCII（不含 CJK）：早期試過用跟本機 DMG 一致的中文檔名（`繁化助手-1.1-13+.dmg`）直接 `gh release create`/`gh release upload` 上傳，結果 `gh` CLI（實測 2.96.0）會把開頭的 CJK 位元組吃掉，上傳出來的資產名稱變成 `-1.1-13+.dmg`——換過 locale 測試過，確認是 `gh` 本身的 bug，不是呼叫端環境問題。改用 ASCII 檔名上傳可以完全避開這個 bug；`+`/`-` 這種符號本身沒問題（用 `gh api -X PATCH .../releases/assets/<id>` 改資產名稱測過，帶符號但不帶 CJK 的名稱可以正常設定），只有 CJK 前綴會被吃掉。Windows 的安裝檔檔名同樣維持 ASCII。

## 出新版時要改什麼

**這裡的連結網址是釘死特定版本號的**，不會自動指到最新版，出新版時要手動改 `index.html`。這是刻意的取捨：換成一個固定不變、每次出新版就移動指向的「rolling tag」可以省掉這個手動步驟，但會犧牲掉每個版本各自獨立、永久可查的 Release 頁面——目前覺得手動改這個連結的成本不高，值得換取版本歷史留得住。

1. **新增一個 `.version-block`，放在該平台區塊的最上面**（新版在前）。不要改寫既有的 `.version-block`——舊版要留著供人回退。2026-08-18 到 2026-08-23 之間曾經被悄悄改成「只改寫最上面那個區塊、不新增」，導致 1.2、1.3、1.4 三個版本先後被直接覆寫、沒有留下任何痕跡，發現後才照最初的設計恢復。分隔線靠 `.version-block + .version-block` 這個相鄰兄弟選擇器自動出現，不用改其他地方。
2. **要移除某個舊版本，只在使用者明確要求時才動**（例如那個版本被 force update 政策淘汰，已經不該再被使用）。
3. **在「更新說明」區塊最上面補上這一版的說明。**
4. Mac 跟 Windows 各自獨立：兩邊不一定每個版號都有對應的發布，哪一邊真的發了 Release 才加那一邊的區塊，不要先放一個還不存在的連結。

頁面最下面的「安裝說明」不是寫在這個檔案裡的，是載入時向後端 `GET /api/download_notice` 抓的，內容來源是 `zh-cn-to-tw-backend` repo 根目錄的 `download_notice.txt`——要改安裝說明去改那份檔案，不用碰這個分支。

## 跟 main 分支的關係

跟 `main` 分支沒有共同的檔案、也沒有共同的 git 歷史（獨立的 orphan 分支）——`main` 分支放的是桌面版 App（`zh-cn-to-tw-mac`、`zh-cn-to-tw-windows`）打包時內嵌的網頁原始碼，不會被 GitHub Pages 服務。完整說明見 `main` 分支的 README。

不要把這個分支合併回 `main`，也不要在這裡改 `main` 的程式碼。
