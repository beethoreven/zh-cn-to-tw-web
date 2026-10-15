// 各 Stage 的選項（可選 model、欄位上下限與說明文字）。
//
// /api/options 與 /api/review-options 回傳的都是純靜態設定，整個 session
// 不會變，但好幾個地方都要用（用量列表要 model 的顯示名稱、各 Stage 的
// model 選單…）。快取成 promise 而不是結果本身：登入後這幾支是平行發出、
// 沒有 await 的，同時進來的呼叫者會共用同一個 in-flight 請求，連競態當下
// 都不會重複發。失敗時要把 promise 清掉，否則一次網路錯誤會被永久快取成
// rejected，之後重試也救不回來。

import { API_BASE } from "../core/config.js";
import { authedFetch } from "../core/api.js";

let stage1OptsPromise = null;
let reviewOptsPromise = null;

function cached(getPromise, setPromise, url) {
  if (!getPromise()) {
    setPromise(
      authedFetch(url)
        .then((res) => res.json())
        .catch((err) => {
          setPromise(null);
          throw err;
        })
    );
  }
  return getPromise();
}

// Stage 1 繁化的選項
export function fetchStage1Opts() {
  return cached(
    () => stage1OptsPromise,
    (p) => {
      stage1OptsPromise = p;
    },
    `${API_BASE}/api/options`
  );
}

// Stage 3 校對的選項；Stage 2 分析報告的 model 選單也用這一份
export function fetchReviewOpts() {
  return cached(
    () => reviewOptsPromise,
    (p) => {
      reviewOptsPromise = p;
    },
    `${API_BASE}/api/review-options`
  );
}

// 登出時清掉。目前回傳的是全使用者相同的靜態設定，不清其實也不會錯；但
// 這裡的既有規則是「新帳號不沿用舊帳號的資料」，只要哪天 model 清單變成
// 依角色而異，跨帳號沿用就會變成不報錯、只會安靜顯示錯誤選項的 bug。
export function resetOptionsCache() {
  stage1OptsPromise = null;
  reviewOptsPromise = null;
}

// model 選單共用的算繪邏輯：excludeClaude 為 true 時（選到個人專案），Claude
// 系列完全不會出現在選單裡（不是 disabled 灰字，是直接不存在）。盡量保留
// 原本選到的值，選不到才退回預設值。
export function renderModelOptions(selectEl, opts, descriptionsMap, excludeClaude) {
  const previousValue = selectEl.value;
  selectEl.innerHTML = "";
  Object.keys(opts.models).forEach((value) => {
    if (excludeClaude && value.indexOf("claude") === 0) return;
    const info = opts.models[value];
    const option = document.createElement("option");
    option.value = value;
    option.textContent = info.label;
    selectEl.appendChild(option);
    descriptionsMap[value] = info.description;
  });
  const hasOption = (v) => Array.prototype.some.call(selectEl.options, (o) => o.value === v);
  if (hasOption(previousValue)) {
    selectEl.value = previousValue;
  } else if (hasOption(opts.default_model)) {
    selectEl.value = opts.default_model;
  } else {
    selectEl.value = selectEl.options.length ? selectEl.options[0].value : "";
  }
}

// 一個 model 選單＋說明文字的組合：選項載入、依專案限制重新算繪、切換時
// 更新說明文字，三個 Stage 都是同一套
export function createModelPicker(selectEl, helpEl) {
  const descriptions = {};
  let lastOpts = null;
  selectEl.addEventListener("change", () => {
    helpEl.textContent = descriptions[selectEl.value] || "";
  });
  return {
    render(opts, excludeClaude) {
      lastOpts = opts;
      renderModelOptions(selectEl, opts, descriptions, excludeClaude);
      helpEl.textContent = descriptions[selectEl.value] || "";
    },
    rerender(excludeClaude) {
      if (lastOpts) this.render(lastOpts, excludeClaude);
    },
    // 把選單切到指定的 model（自動串接時沿用上一個 Stage 的 model）；選單
    // 裡沒有這個值就維持原樣
    trySelect(value) {
      if (value && Array.prototype.some.call(selectEl.options, (o) => o.value === value)) {
        selectEl.value = value;
        helpEl.textContent = descriptions[value] || "";
      }
    },
  };
}
