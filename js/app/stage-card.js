// Stage 卡片的收合與標題列摘要，以及流程進度條（三個圓）。
//
// 收合只是視覺上的差異：內容原封不動留在 DOM 裡，打開就看得到。只有重新
// 整理、開始新工作或換了劇本案才會清空（那是各 Stage 自己的事）。
//
// 預設三張卡片都是收起來的（index.html 直接寫好 is-collapsed，免得載入時
// 先展開再收起來閃一下）；換了劇本案也會全部收回去。
//
// 自動行為：某個 Stage 開始跑時，把它的卡片打開；如果它是流程自動串接
// 過來的，前面已經做完的卡片收起來、捲到它，畫面不會越拉越長（Stage 2
// 有分析報告時例外，不收）。點流程
// 進度條的圓圈、按「下一步」也會打開對應的卡片。使用者隨時可以自己點標題
// 列打開或收起任何一張卡片。

import { byId } from "../core/dom.js";
import { on } from "../core/events.js";
import { registerLock } from "./workflow.js";

const STATUS_LABELS = {
  idle: "",
  planned: "等等會執行",
  running: "執行中",
  skipped: "這次不執行",
  done: "已完成",
  failed: "失敗或中斷",
};

const cards = {};
const details = { 1: "", 2: "", 3: "" };
const statuses = { 1: "idle", 2: "idle", 3: "idle" };

function cardEls(stage) {
  if (!cards[stage]) {
    const card = byId(`stage${stage}-card`);
    cards[stage] = {
      card,
      header: card.querySelector(".stage-card__header"),
      summary: byId(`stage${stage}-summary`),
    };
  }
  return cards[stage];
}

export function setCollapsed(stage, collapsed) {
  const els = cardEls(stage);
  els.card.classList.toggle("is-collapsed", collapsed);
  els.header.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function renderSummary(stage) {
  const els = cardEls(stage);
  const label = STATUS_LABELS[statuses[stage]];
  const detail = details[stage];
  els.summary.textContent = detail ? (label ? `${label}・${detail}` : detail) : label;
  els.summary.classList.toggle("is-error", statuses[stage] === "failed");
}

// 各 Stage 補充標題列上的摘要（例如「規則修改 12 處」），收起來也看得到
export function setStageDetail(stage, text) {
  details[stage] = text || "";
  renderSummary(stage);
}

export function scrollToStage(stage) {
  cardEls(stage).card.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Stage 2 這次有做分析報告（不論還在跑或已經跑完）。報告常常在 Stage 3
// 開始後沒多久就出來，自動收起的話使用者還得自己再打開，所以這種情況
// Stage 2 不主動收起，交給使用者自己收。分析區塊只在真的送出分析時才會
// 顯示（見 stages/stage2.js 的 startAnalysis），換新工作時會隱藏。
function hasAnalysisReport() {
  return !byId("pattern-analysis").hidden;
}

function renderStepper(stage, status) {
  const step = document.querySelector(`.stepper__step[data-stage="${stage}"]`);
  if (!step) return;
  step.setAttribute("data-status", status);
  step.querySelector(".stepper__status").textContent = STATUS_LABELS[status];
}

export function initStageCards() {
  [1, 2, 3].forEach((stage) => {
    const els = cardEls(stage);
    els.header.addEventListener("click", () => {
      setCollapsed(stage, !els.card.classList.contains("is-collapsed"));
    });
  });

  // 還沒確定劇本案：整條進度條灰掉、圓圈點不了，並顯示提示。按下確定
  // 之前畫面上其他地方看起來都一樣，不鎖住的話使用者看不出按確定有沒有
  // 起作用、下一步該做什麼。
  const stepperEl = byId("stepper");
  const lockHintEl = byId("stepper-lock-hint");
  registerLock((s) => {
    const locked = !s.projectConfirmed;
    const wasLocked = stepperEl.classList.contains("is-locked");
    stepperEl.classList.toggle("is-locked", locked);
    lockHintEl.hidden = !locked;
    stepperEl.querySelectorAll(".stepper__jump").forEach((btn) => {
      btn.disabled = locked;
    });
    // 從鎖住變成解鎖的那一刻閃一下，讓「解鎖了」這件事被看見
    if (wasLocked && !locked) {
      stepperEl.classList.remove("is-unlocking");
      void stepperEl.offsetWidth;
      stepperEl.classList.add("is-unlocking");
    }
  });
  stepperEl.addEventListener("animationend", (e) => {
    if (e.target === stepperEl) stepperEl.classList.remove("is-unlocking");
  });

  document.querySelectorAll(".stepper__jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = Number(btn.closest(".stepper__step").getAttribute("data-stage"));
      setCollapsed(stage, false);
      scrollToStage(stage);
    });
  });

  on("workflow:status", (event) => {
    const stage = event.stage;
    const status = event.status;
    statuses[stage] = status;
    renderSummary(stage);
    renderStepper(stage, status);

    [1, 2, 3].forEach((n) => cardEls(n).card.classList.toggle("is-active", statuses[n] === "running"));

    if (status === "running") {
      setCollapsed(stage, false);
      const run = event.run;
      // 只有自動串接過來的 Stage 才收起前面、捲過去；使用者自己按「開始」
      // 時人就在那張卡片上，捲動反而會把剛出現的進度區捲離畫面
      if (run && stage > run.origin) {
        for (let earlier = run.origin; earlier < stage; earlier++) {
          if (earlier === 2 && hasAnalysisReport()) continue;
          setCollapsed(earlier, true);
        }
        scrollToStage(stage);
      }
    }
  });
}
