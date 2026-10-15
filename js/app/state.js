// 跨模組共用的狀態。各 Stage 自己的工作狀態（job id、review id…）放在
// 各自的模組裡，這裡只放好幾個模組都要讀寫的東西。改了之後記得呼叫
// workflow.refreshLockStates() 重新整理畫面上的鎖定狀態。

export const state = {
  // 登入且通過白名單授權
  authorized: false,
  isAdmin: false,

  // 使用者登入後必須先選定「本案處理劇本」並按下確定，下方各 Stage 才會
  // 解鎖——確定的專案 ID 之後每次呼叫 model 都會帶上，記進
  // usage_log.project，讓「本案使用 Claude token 狀況」能統計出正確數字
  projectConfirmed: false,
  currentProjectId: null,
  isPersonalProject: false,

  // 有任何一個 Stage 正在跑（Stage 2 的分析報告除外，它只是背景提醒，見
  // workflow.setBackgroundTask）。跑的時候所有表單都鎖住，一次只做一件事。
  busy: false,

  // 使用者是不是已經把「目前最新一份」結果存到本機了——只跟按鍵動作綁定：
  // 開始任何一個 Stage 時變 false（新的、還沒下載的結果即將產生），任何
  // 下載真的成功時變 true。給桌面殼在系統即將睡眠前判斷「有沒有東西該幫
  // 使用者搶救」，見 workflow.js 的 __attemptAutoSaveBeforeSleep。
  hasDownloaded: false,
};
