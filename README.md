# update-page

這個分支只服務一個目的：GitHub Pages 從這裡發布
`https://beethoreven.github.io/zh-cn-to-tw-web/`。內容是桌面版 App 的
下載頁（`index.html`）：Mac 分「Mac OS 13（含）以上」「Mac OS 12（含）
以下」兩個下載點，各自**直接連到** `zh-cn-to-tw-mac` repo 對應 GitHub
Release 底下的 DMG 檔案本身（版控真正的來源在那邊，這裡不會自己存
DMG 檔案）；Windows 版還沒做，先顯示「尚未推出」，不放連結。

連結格式是
`https://github.com/<owner>/<repo>/releases/download/<tag>/<檔名>`——
這個網址結構本身完全可預期，不是隨機/雜湊出來的，所以直接連到檔案
本身，不必多繞一層先連到 Release 頁面再讓使用者自己找按鈕點；點下去
就直接開始下載。GitHub Release 資產的檔名刻意用純 ASCII（不含 CJK）：
早期試過用跟本機 DMG 一致的中文檔名（`繁化助手-1.1-13+.dmg`）直接
`gh release create`/`gh release upload` 上傳，結果 `gh` CLI（實測
2.96.0）會把開頭的 CJK 位元組吃掉，上傳出來的資產名稱變成
`-1.1-13+.dmg`——換過 locale 測試過，確認是 `gh` 本身的 bug，不是
呼叫端環境問題。改用 ASCII 檔名上傳可以完全避開這個 bug；`+`/`-`
這種符號本身沒問題（用 `gh api -X PATCH .../releases/assets/<id>`
改資產名稱測過，帶符號但不帶 CJK 的名稱可以正常設定），只有 CJK
前綴會被吃掉。

**這裡的連結網址是釘死特定版本號的**（tag 目前是
`v1.1-13-plus`／`v1.1-12-minus`，檔名目前是
`ZhCnToTw-1.1-13+.dmg`／`ZhCnToTw-1.1-12-.dmg`），出新版時要記得手動
把這個檔案裡的連結一起改成新版的 tag／檔名，不會自動指到最新版。這是
刻意的取捨：換成一個固定不變、每次出新版就移動指向的「rolling tag」
可以省掉這個手動步驟，但會犧牲掉每個版本各自獨立、永久可查的 Release
頁面——目前覺得手動改這個連結的成本不高，值得換取版本歷史留得住。

跟 `main` 分支沒有共同的檔案、也沒有共同的 git 歷史（獨立的 orphan
分支）——`main` 分支放的是 `zh-cn-to-tw-mac`（桌面版 App）打包時用的
網頁原始碼，不會被 GitHub Pages 服務。完整說明見 `main` 分支的
README。

不要把這個分支合併回 `main`，也不要在這裡改 `main` 的程式碼。
