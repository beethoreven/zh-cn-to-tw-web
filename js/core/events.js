// 極簡的事件匯流排：讓模組之間不必互相 import 也能溝通（例如登入模組
// 通知「授權通過了」，各 Stage 自己決定要做什麼），避免模組之間形成
// 循環依賴。事件名稱一律寫成 "範圍:動作"。

const listeners = {};

export function on(name, fn) {
  (listeners[name] = listeners[name] || []).push(fn);
}

export function emit(name, payload) {
  (listeners[name] || []).slice().forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      // 一個監聽者出錯不能讓其他監聽者跟著不執行
      console.error(`[events] ${name} 的監聽者發生錯誤：`, err);
    }
  });
}
