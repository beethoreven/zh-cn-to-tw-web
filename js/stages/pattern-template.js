// Stage 2「套用範本修改」的範本格式檢查（前端版）。
//
// 跟後端 zh-cn-to-tw-backend/pattern/template.py 的 parse_template 是同一套
// 規則、同一套訊息，兩邊要一起改。前端這份讓使用者選個人範本檔案的當下
// 就看到錯誤，不必等網路；送到後端套用時還會再檢查一次（後端那份是權威）。
//
// 格式：一行一條「修改前 → 修改後」（箭頭是 U+2192），# 開頭是註解，空行略過。

const ARROW = "→";
const PUNCT_MAP = {
  ",": "，",
  "!": "！",
  "?": "？",
  ":": "：",
  ";": "；",
  "(": "（",
  ")": "）",
};
const MAX_RULES = 5000;
const MAX_TEMPLATE_CHARS = 500000;

function isPunctOnlyRule(source, target) {
  let converted = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (!Object.prototype.hasOwnProperty.call(PUNCT_MAP, ch)) return false;
    converted += PUNCT_MAP[ch];
  }
  return converted === target;
}

// 回傳 {rules: [{source, target, line}], errors: [{line, message}], warnings: [...]}
export function parseTemplate(text) {
  const result = { rules: [], errors: [], warnings: [] };
  if (text.length > MAX_TEMPLATE_CHARS) {
    result.errors.push({ line: 0, message: `範本太大（超過 ${MAX_TEMPLATE_CHARS.toLocaleString()} 字）` });
    return result;
  }
  const body = text.charAt(0) === "\ufeff" ? text.slice(1) : text;
  const seen = {};
  body.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (!line || line.charAt(0) === "#") return;
    if (line.split(ARROW).length - 1 !== 1) {
      result.errors.push({ line: lineNo, message: `每一行要剛好有一個「${ARROW}」：${line}` });
      return;
    }
    const parts = line.split(ARROW);
    const source = parts[0].trim();
    const target = parts[1].trim();
    if (!source || !target) {
      result.errors.push({ line: lineNo, message: `「${ARROW}」左右兩邊都要有字：${line}` });
      return;
    }
    if (/\s/.test(source) || /\s/.test(target)) {
      result.errors.push({
        line: lineNo,
        message: `規則裡不能有空白（空白肉眼看不出來，多打一個就會讓規則默默對不上）：${line}`,
      });
      return;
    }
    if (source === target) {
      result.warnings.push({ line: lineNo, message: `修改前後一樣，略過：${line}` });
      return;
    }
    const previous = Object.prototype.hasOwnProperty.call(seen, source) ? seen[source] : null;
    if (previous) {
      if (previous.target === target) {
        result.warnings.push({ line: lineNo, message: `跟第 ${previous.line} 行重複，只留一條：${line}` });
      } else {
        result.errors.push({
          line: lineNo,
          message: `「${source}」在第 ${previous.line} 行要改成「${previous.target}」，這裡又要改成「${target}」，不知道該聽哪一條`,
        });
      }
      return;
    }
    if (isPunctOnlyRule(source, target)) {
      result.warnings.push({ line: lineNo, message: `標點本來就會自動轉全形，這條可以刪掉：${line}` });
    }
    const rule = { source, target, line: lineNo };
    seen[source] = rule;
    result.rules.push(rule);
  });
  if (result.rules.length > MAX_RULES) {
    result.errors.push({ line: 0, message: `規則太多（${result.rules.length} 條，上限 ${MAX_RULES} 條）` });
  }
  return result;
}

export function formatIssue(issue) {
  return issue.line ? `第 ${issue.line} 行：${issue.message}` : issue.message;
}
