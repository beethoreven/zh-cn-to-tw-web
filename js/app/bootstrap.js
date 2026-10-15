// 登入且授權通過之後要載入的初始資料（只載一次，登出後重置）。
//
// 這幾支原本是「發出去就不管」——沒有 await、沒有 catch，失敗時完全靜默。
// 實際踩到過（2026-08-26，使用者錄影回報）：Render 冷啟動時這幾支全部卡住，
// 而頁面當時是解鎖的，使用者看到一個可以完整操作、但 Model 與劇本案下拉
// 選單都是空的表單，按下送出後拿到一個看不懂的 400，從頭到尾沒有任何訊息
// 告訴他發生了什麼事。現在任何一支失敗都會：鎖回頁面、顯示常駐提示、跳一個
// error toast。

import { on } from "../core/events.js";
import { showConnectionNotice, showToast } from "../core/toast.js";
import { setPageLocked } from "../auth/login.js";
import { resetOptionsCache } from "./options.js";
import { loadMyProjects } from "./project.js";
import { loadUsage } from "./usage.js";
import { resetRun, setBusy } from "./workflow.js";
import { loadStage1Options } from "../stages/stage1.js";
import { loadStage2Options } from "../stages/stage2.js";
import { loadStage3Options } from "../stages/stage3.js";

let appDataLoaded = false;

async function loadInitialAppData() {
  // loadUsage 自己有 try/catch 吞掉錯誤（用量數字載不到不影響操作），所以
  // 永遠不會被算成失敗——這是刻意的。
  //
  // 刻意不用 Promise.allSettled（相容性下限的關係，見 js/core/config.js），
  // 手寫等價物只有三行。
  const settle = (p) =>
    Promise.resolve(p).then(
      () => null,
      (reason) => reason || new Error("unknown failure")
    );

  const failed = (
    await Promise.all([
      settle(loadStage1Options()),
      settle(loadStage2Options()),
      settle(loadStage3Options()),
      settle(loadUsage()),
      settle(loadMyProjects()),
    ])
  ).filter((reason) => reason !== null);

  if (failed.length === 0) return;

  console.error("[init] 初始資料載入失敗：", failed);
  setPageLocked(true);
  // 放行下一次授權檢查重試；不重置的話這個畫面的生命週期內永遠不會再載入
  appDataLoaded = false;
  showConnectionNotice(
    "資料載入失敗，目前無法使用。\n" +
      "如果久未使用，伺服器可能正在冷啟動（約需 1 分鐘），請稍候再重新整理頁面。",
    true
  );
  showToast("資料載入失敗，請稍後重新整理頁面", "error");
}

export function initBootstrap() {
  on("auth:authorized", () => {
    if (appDataLoaded) return;
    appDataLoaded = true;
    loadInitialAppData();
  });
  on("auth:signed-out", () => {
    appDataLoaded = false;
    resetOptionsCache();
    // 登出時如果還有 Stage 在跑，它的輪詢已經被各 Stage 清掉了，這裡把
    // 「處理中」也一併解除，不然新登入的帳號會面對一個永遠鎖住的畫面
    setBusy(false);
    resetRun();
  });
}
