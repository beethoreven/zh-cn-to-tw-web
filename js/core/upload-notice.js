// 直接上傳 Word 檔時，後端會略過設成「隱藏」的文字（在 Word 裡看不到、卻會被
// 讀進來送給 LLM，見 zh-cn-to-tw-backend 的 output_utils/docx_export.py），並在
// 回應帶上略過的字數。這裡用對話框告訴使用者：toast 幾秒就消失，而少讀了內容
// 是使用者需要知道的事。舊版後端沒有這個欄位，就什麼都不做。
export function warnHiddenTextSkipped(hiddenChars) {
  if (!hiddenChars || hiddenChars <= 0) return;
  alert(
    `這個 Word 檔裡有 ${hiddenChars} 個字設成了「隱藏」（在 Word 裡看不到），已經略過，沒有讀進來。\n\n` +
      "如果那些字是劇本內容，請在 Word 裡取消隱藏後重新上傳。"
  );
}
