// Stage 之間的串接：「做完接下一個」與「下一步」按鈕。
//
// 規則（跟畫面上的說明文字一致）：
// - 接下去要跑哪個 Stage，一律看 js/app/workflow.js 的 planFrom 排出來的
//   planned（Stage 1 的「完成後自動接續執行」選單、Stage 2 的「接續 Stage 3
//   校對」開關都在那裡算），這裡不自己再判斷一次開關。Stage 2 接 Stage 3
//   不等分析報告，那只是給人看的提醒。
// - 自動接到 Stage 2／Stage 3 時：如果這次流程是從 Stage 1 開始的，用到 LLM
//   的地方（Stage 2 的分析報告、Stage 3 校對）一律沿用 Stage 1 選的 model
//   （Stage 3 是 1.x「直接進行校對」的既有行為，Stage 2 比照），輸出格式也
//   沿用 Stage 1 的（Stage 2 跟著 Stage 1，Stage 3 跟著 Stage 2，等於一路都是
//   Stage 1 的）。Stage 1 完全沒用到 LLM 的話，Stage 2 不做分析報告。
// - 從 Stage 2 開始的，Stage 3 用自己的 model，輸出格式跟著 Stage 2。

import { on } from "../core/events.js";
import { scrollToStage, setCollapsed } from "./stage-card.js";
import { getCurrentRun, getStageStatus, runSkipsLlm } from "./workflow.js";
import * as stage1 from "../stages/stage1.js";
import * as stage2 from "../stages/stage2.js";
import * as stage3 from "../stages/stage3.js";

export function initChain() {
  on("stage1:done", (event) => {
    const run = getCurrentRun();
    if (getStageStatus(2) === "planned") {
      stage2.startFromUpstream(event.jobId, "Stage 1 的結果", {
        model: run ? run.stage1Model : stage1.getSelectedModel(),
        docx: stage1.wantsDocx(),
        skipAnalysis: runSkipsLlm(),
      });
    } else if (getStageStatus(3) === "planned") {
      stage3.startFromUpstream(event.jobId, "Stage 1 的結果", "stage1", {
        model: run ? run.stage1Model : stage1.getSelectedModel(),
        docx: stage1.wantsDocx(),
      });
    }
  });

  on("stage2:done", (event) => {
    if (getStageStatus(3) !== "planned") return;
    const run = getCurrentRun();
    stage3.startFromUpstream(event.jobId, "Stage 2 的結果", "stage2", {
      model: run && run.origin === 1 ? run.stage1Model : null,
      docx: stage2.wantsDocx(),
    });
  });

  on("stage1:next", (event) => {
    if (event.stage === 2) {
      stage2.acceptSource(event.jobId, "Stage 1 的結果");
    } else {
      stage3.acceptSource(event.jobId, "Stage 1 的結果", "stage1");
    }
    setCollapsed(event.stage, false);
    scrollToStage(event.stage);
  });

  on("stage2:next", (event) => {
    stage3.acceptSource(event.jobId, "Stage 2 的結果", "stage2");
    setCollapsed(3, false);
    scrollToStage(3);
  });
}
