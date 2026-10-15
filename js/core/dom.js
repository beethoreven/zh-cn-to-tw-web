// 跟 DOM 有關、各模組共用的小工具。

// 找不到元素就直接丟例外，不要回傳 null 讓錯誤延後到第一次使用才爆出來
// （而且那時候的錯誤訊息只會是 "Cannot read properties of null"，看不出
// 是哪個 id 打錯）。
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`找不到元素 #${id}`);
  return el;
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function setDisabled(elements, disabled) {
  elements.forEach((el) => {
    el.disabled = disabled;
  });
}

export function populateSelect(selectEl, items, valueKey, labelKey) {
  selectEl.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    selectEl.appendChild(opt);
  }
}

export function validateBoundedInput(input, fieldLabel) {
  const value = Number(input.value);
  const min = Number(input.min);
  const max = Number(input.max);
  if (input.value === "" || Number.isNaN(value)) {
    return `${fieldLabel} 必須是數字`;
  }
  if (value < min || value > max) {
    return `${fieldLabel} 必須介於 ${min}-${max} 之間`;
  }
  return null;
}

// 只有使用者本來就停留在（或接近）最底部時，新 log 進來才跟著捲到底；
// 如果使用者已經往上捲去看之前的內容，新 log 進來不該把他們強制拉回
// 最底部，不然完全沒辦法邊跑邊往上看舊的 log
export function isNearBottom(el, threshold) {
  const limit = threshold === undefined ? 24 : threshold;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= limit;
}

// 進度 log 的增量算繪：後端每次輪詢回傳的是「到目前為止的全部 log」，
// 這裡只把還沒畫過的那幾筆加上去。entries 可以是 {message, level} 物件
// （後端 job/review/分析報告）或純字串（本機 OCR 服務）。
export function createLogRenderer(listEl) {
  let rendered = 0;
  return {
    render(entries) {
      if (!entries) return;
      const stick = isNearBottom(listEl);
      for (let i = rendered; i < entries.length; i++) {
        const entry = entries[i];
        const li = document.createElement("li");
        if (typeof entry === "string") {
          li.textContent = entry;
        } else {
          li.textContent = entry.message;
          if (entry.level && entry.level !== "info") li.classList.add(entry.level);
        }
        listEl.appendChild(li);
      }
      rendered = entries.length;
      if (stick) listEl.scrollTop = listEl.scrollHeight;
    },
    reset() {
      rendered = 0;
      listEl.innerHTML = "";
    },
  };
}
