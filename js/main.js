// 入口：把各模組接起來、依序初始化。index.html 只載入這一支。
//
// 資料夾分工：
// - core/   跟這個 App 的業務無關的基礎設施（設定、桌面殼溝通、呼叫後端、
//           下載、提示訊息、事件）
// - auth/   登入
// - app/    跨 Stage 的共用功能（流程控制、串接、用量、劇本案、選項）
// - stages/ 三個 Stage 各自的畫面與流程
// - admin/  管理員介面
//
// 依賴方向是單向的：stages 可以用 app 與 core，app/chain.js 與
// app/bootstrap.js 是唯二會 import stages 的 app 模組，core 不 import 任何
// 上層模組。不要讓 stages 之間互相 import——它們之間的溝通走事件
// （js/core/events.js），串接邏輯集中在 app/chain.js。

import { exposeToShell } from "./core/bridge.js";
import { showToast } from "./core/toast.js";
import { startKeepAlive } from "./core/version.js";
import { initLogin } from "./auth/login.js";
import { initBootstrap } from "./app/bootstrap.js";
import { initChain } from "./app/chain.js";
import { initProjectPicker } from "./app/project.js";
import { initStageCards } from "./app/stage-card.js";
import { initTaNotice } from "./app/ta-notice.js";
import { initWorkflow, refreshLockStates } from "./app/workflow.js";
import { initStage1 } from "./stages/stage1.js";
import { initStage2 } from "./stages/stage2.js";
import { initStage3 } from "./stages/stage3.js";
import { initAdmin } from "./admin/admin.js";

// 桌面殼（Mac）下載完成時會直接呼叫 showToast，見 js/core/bridge.js
exposeToShell("showToast", showToast);

startKeepAlive();
// 不需要登入，無論有沒有登入都直接載入，也不受頁面鎖定影響
initTaNotice();

initWorkflow();
initStageCards();
initProjectPicker();
initStage1();
initStage2();
initStage3();
initChain();
initBootstrap();
initAdmin();
refreshLockStates();

// 最後才開始登入流程：它可能馬上觸發授權檢查與 auth:authorized 事件，
// 所有監聽者都要先就位
initLogin();
