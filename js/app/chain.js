// Stage 之間的串接：「做完接下一個」與「下一步」按鈕。
//
// 規則（跟畫面上的說明文字一致）：
// - Stage 1 完成：依「完成後接續」選單，不接／接 Stage 2／接 Stage 3。
// - Stage 2 完成：「接續 Stage 3 校對」開著就接 Stage 3（不等分析報告，那
//   只是給人看的提醒）。
// - 自動接到 Stage 2／Stage 3 時：如果這次流程是從 Stage 1 開始的，用到 LLM
//   的地方（Stage 2 的分析報告、Stage 3 校對）一律沿用 Stage 1 選的 model
//   （Stage 3 是 1.x「直接進行校對」的既有行為，Stage 2 比照）；從 Stage 2
//   開始的則用 Stage 3 自己的設定。輸出格式跟著前一個 Stage。

import { byId } from "../core/dom.js";
import { on } from "../core/events.js";
import { scrollToStage, setCollapsed } from "./stage-card.js";
import { getCurrentRun } from "./workflow.js";
import * as stage1 from "../stages/stage1.js";
import * as stage2 from "../stages/stage2.js";
import * as stage3 from "../stages/stage3.js";

export function initChain() {
  const chainSelect = byId("stage1-chain-select");
  const patternChainToggle = byId("pattern-chain-toggle");

  on("stage1:done", (event) => {
    if (chainSelect.value === "stage2") {
      stage2.startFromUpstream(event.jobId, "Stage 1 的結果", { model: stage1.getSelectedModel() });
    } else if (chainSelect.value === "stage3") {
      stage3.startFromUpstream(event.jobId, "Stage 1 的結果", "stage1", {
        model: stage1.getSelectedModel(),
        docx: stage1.wantsDocx(),
      });
    }
  });

  on("stage2:done", (event) => {
    if (!patternChainToggle.checked) return;
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
