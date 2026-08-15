# update-page

這個分支只服務一個目的：GitHub Pages 從這裡發布
`https://beethoreven.github.io/zh-cn-to-tw-web/`。內容是桌面版 App 的
下載頁（`index.html`）：Mac 分「Mac OS 13（含）以上」「Mac OS 12（含）
以下」兩個下載點，各自連到 `zh-cn-to-tw-mac` repo 對應的 GitHub
Release 頁面（版控真正的來源在那邊，這裡只是連結過去，不會自己存
DMG 檔案）；Windows 版還沒做，先顯示「尚未推出」，不放連結。

版本更新時，`zh-cn-to-tw-mac` 那邊照 `packaging/build_dmg_all.sh` 打包
出新版 DMG，建立對應的 GitHub Release、上傳 DMG——**這裡的連結網址
是連到特定版本號的 tag**（目前是 `v1.1-13-plus`／`v1.1-12-minus`），
出新版時要記得手動把這個檔案裡的連結改成新版的 tag，不會自動指到
最新版。這是刻意的取捨：換成一個固定不變、每次出新版就移動指向的
「rolling tag」可以省掉這個手動步驟，但會犧牲掉每個版本各自獨立、
永久可查的 Release 頁面——目前覺得手動改這個連結的成本不高，值得
換取版本歷史留得住。

跟 `main` 分支沒有共同的檔案、也沒有共同的 git 歷史（獨立的 orphan
分支）——`main` 分支放的是 `zh-cn-to-tw-mac`（桌面版 App）打包時用的
網頁原始碼，不會被 GitHub Pages 服務。完整說明見 `main` 分支的
README。

不要把這個分支合併回 `main`，也不要在這裡改 `main` 的程式碼。
