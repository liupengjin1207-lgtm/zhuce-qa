/**
 * 检索匹配引擎 v2
 * 策略：三段式
 *   ① 主体词定向（谁在问 / 问什么对象）—— 最高优先级
 *   ② 关键词 IDF 加权
 *   ③ 文本相似度兜底
 */

function bigrams(text) {
  const s = String(text).replace(/[\s，。、；：？！「」【】（）《》,.\-—…·~!?"'()\[\]{}]/g, "");
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  if (s.length === 1) out.push(s);
  return out;
}

function dice(aSet, bSet) {
  let inter = 0;
  for (const g of aSet) if (bSet.has(g)) inter++;
  return (2 * inter) / (aSet.size + bSet.size || 1);
}

/* 口语归一化：把"19年/19年初/19年弄的"等还原为 2019 这样的四位年份 */
function normalize(text) {
  let s = String(text);
  // 20xx年 完整四位保留；处理「19年」「22年」「21年」这类两位缩写
  s = s.replace(/(^|[^\d])(\d{2})年/g, (m, pre, yy) => {
    const n = parseInt(yy, 10);
    // 90-99 → 19xx；00-30 → 20xx
    let full;
    if (n >= 90) full = '19' + yy;
    else full = '20' + yy;
    return pre + full + '年';
  });
  return s;
}

/* IDF 表：每个关键词出现在多少个条目中 */
let _kwDocFreq = null;
function buildDF() {
  const m = new Map();
  for (const item of KNOWLEDGE) {
    const seen = new Set();
    for (const kw of item.keywords) {
      if (seen.has(kw)) continue;
      seen.add(kw);
      m.set(kw, (m.get(kw) || 0) + 1);
    }
  }
  return m;
}

function search(query, topK = 3) {
  const q = normalize(String(query)).trim();
  if (!q) return [];
  if (!_kwDocFreq) _kwDocFreq = buildDF();

  const qClean = q.replace(/[\s，。、；：？！「」【】（）《》,.\-—…·~!?"'()\[\]{}]/g, "");
  const qGrams = new Set(bigrams(q));
  const qLower = q.toLowerCase();
  const N = KNOWLEDGE.length;

  // 年份语义：如果问到 2021/2020/2019 等「2021年及之前」的年份 → 指向 who-2021
  const yearM = qClean.match(/(20\d{2})年/);
  const earlyYear = yearM && parseInt(yearM[1], 10) <= 2021;

  const results = KNOWLEDGE.map(item => {
    let score = 0;
    let subjScore = 0;   // 主体词定向分（决定性）
    let specScore = 0;   // 高区分度关键词分
    let maxKw = 0;

    // ① 主体词定向：命中「对象标签」直接大幅加分
    for (const tag of (item.tags || [])) {
      if (qClean.includes(tag)) {
        subjScore += 40 + tag.length * 4;
      }
    }

    // ② 关键词命中（IDF 加权）
    for (const kw of item.keywords) {
      if (qClean.includes(kw) || qLower.includes(kw.toLowerCase())) {
        const df = _kwDocFreq.get(kw) || 1;
        const idf = Math.log(N / df) + 1;
        const lenW = 1 + kw.length * kw.length * 0.05;
        const s = 5 * idf * lenW;
        score += s;
        if (kw.length >= 3 && df <= 3) specScore += s;
        maxKw = Math.max(maxKw, kw.length);
      }
    }

    // ③ 标准问题相似度
    const qSim = dice(qGrams, new Set(bigrams(item.q)));
    score += qSim * 26;

    // ④ 答案正文相似度
    const aSim = dice(qGrams, new Set(bigrams(item.a.slice(0, 260))));
    score += aSim * 7;

    // ⑤ 类别名命中
    if (qClean.includes(item.cat)) score += 7;

    // ⑥ 年份语义：问到 2021 及之前的年份 + 涉及注册 → 强烈指向 who-2021
    if (earlyYear && item.id === 'who-2021' && /注册|弄过|申请|办理|合格/.test(qClean)) {
      subjScore += 45;
    }

    const total = score + subjScore;
    return { item, score: total, base: score, subj: subjScore, spec: specScore, maxKw };
  });

  return results
    .filter(r => r.score > 1.5)
    .sort((a, b) => {
      // 第一优先级：主体词定向分
      if (Math.abs(a.subj - b.subj) > 8) return b.subj - a.subj;
      // 第二优先级：高区分度关键词
      const aSpec = a.spec > 0, bSpec = b.spec > 0;
      if (aSpec !== bSpec) return bSpec - aSpec;
      if (Math.abs(a.spec - b.spec) > 3) return b.spec - a.spec;
      // 第三优先级：基础总分
      if (Math.abs(a.base - b.base) < 2.5) return b.maxKw - a.maxKw;
      return b.base - a.base;
    })
    .slice(0, topK);
}

function answer(query) {
  const res = search(query, 3);
  if (!res.length) return { type: "fallback", query };

  const top = res[0];
  // 置信度分级：≥13 直接作答；≥6.5 给候选；否则老实兜底
  const confident = top.score >= 13;

  if (!confident) {
    if (top.score < 6.5) return { type: "fallback", query };
    return { type: "candidates", query, list: res };
  }

  return {
    type: "answer",
    query,
    main: top.item,
    others: res.slice(1).filter(r => r.score >= 9).map(r => r.item),
    score: top.score
  };
}
