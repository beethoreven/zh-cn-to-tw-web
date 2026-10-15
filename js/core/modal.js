// 工作被伺服器重啟打斷時的對話窗。
//
// Render 重啟（部署、平台搬機器）會讓正在跑的背景工作直接消失，後端啟動時
// 會把這種工作標成 interrupted（見後端 db_utils/job_store.py）。這裡原本有
// 一顆「重試」按鈕，已經移除——後端沒有任何路徑能把 interrupted 改回
// running，前端讀得到 interrupted 就代表執行緒早就隨著重啟消失了，「重試」
// 只是再輪詢一次、答案永遠一樣。真正會成功的重試（網路暫時不通、Render
// 重啟中回 502）在輪詢的 catch 裡就被靜默處理掉了，根本不會走到這裡。
// 剩下兩個選擇都是「這份工作到此為止」，差別只在要不要把中斷前已經完成、
// 而且已經付費算出來的部分收下來。

export function showInterruptedDialog(options) {
  const hasPartial = options.hasPartial;
  const onDownload = options.onDownload;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const box = document.createElement("div");
  box.className = "modal-box";

  const title = document.createElement("h3");
  title.textContent = "伺服器異常，工作已中斷";
  box.appendChild(title);

  const desc = document.createElement("p");
  desc.textContent = "由於伺服器問題，工作必須暫時中斷，請選擇放棄或下載當前進度。";
  box.appendChild(desc);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const abandonBtn = document.createElement("button");
  abandonBtn.type = "button";
  abandonBtn.textContent = "結束此階段工作";
  abandonBtn.addEventListener("click", () => overlay.remove());
  actions.appendChild(abandonBtn);

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.textContent = "下載當前進度";
  // 完全沒有任何已完成的批次時，這顆按下去後端只會回 409（沒有東西可以
  // 保留），與其讓它跳一個錯誤，不如直接停用並說明
  if (!hasPartial) {
    downloadBtn.disabled = true;
    downloadBtn.title = "這次工作還沒有任何已完成的部分可以下載";
  } else {
    downloadBtn.addEventListener("click", () => {
      overlay.remove();
      onDownload();
    });
  }
  actions.appendChild(downloadBtn);

  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
