/**
 * 提问统计模块（Supabase 云端收集）
 * -------------------------------------------------------------
 * 作用：老师每次提问 → 自动上报到 Supabase → 管理员输入口令看统计
 *
 * 老师端：完全无感，不弹任何东西
 * 管理端：页面右下角点「📊」→ 输口令 → 看 Top 高频问题 / 未答问题 / 趋势 / 导出
 */

/* ============ 配置区（只需要改这里） ============ */
const STATS_CONFIG = {
  /* Supabase 项目地址，形如 https://abcdefgh.supabase.co （结尾不要加 /） */
  supabaseUrl: "https://wwwgdknmsjnhacfntqxs.supabase.co",
  /* Supabase 的 anon public key（可公开，专门用于前端，受行级权限保护） */
  supabaseKey: "sb_publishable_jH2RJn7denv56scjfR_xhw_xM1JY1dc",
  /* 数据表名，建表时用这个名字 */
  table: "qa_logs",
  /* 管理口令（看统计时要输入，随便设一个你自己记得的，改了才生效） */
  adminPass: "huangpu2026"
};

/* ============ 内部工具 ============ */
function _statsReady(){
  return !!(STATS_CONFIG.supabaseUrl && STATS_CONFIG.supabaseKey);
}
function _statsHeaders(){
  return {
    'apikey': STATS_CONFIG.supabaseKey,
    'Authorization': 'Bearer ' + STATS_CONFIG.supabaseKey,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };
}
/* 给每台设备生成一个匿名ID，用于区分"多少人问过"，不含任何个人信息 */
function _deviceId(){
  try{
    let id = localStorage.getItem('qa_did');
    if (!id){
      id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('qa_did', id);
    }
    return id;
  }catch(e){ return 'unknown'; }
}

/* ============ 上报一条提问记录 ============ */
/**
 * @param {string} q      老师问的原始问题
 * @param {object} r      answer() 的返回结果
 * @param {string} mode   命中方式：'local'(本地直接答) / 'candidate'(给了候选) / 'fallback'(没答案) / 'ai'(AI回答)
 * @param {string} hitId  命中的知识条目 id（没有则空）
 */
function logQuestion(q, mode, hitId){
  if (!_statsReady()) return;               // 未配置则静默跳过
  if (!q || q.length > 500) q = String(q || '').slice(0, 500);
  const payload = {
    question: q,
    mode: mode || 'unknown',
    hit_id: hitId || null,
    device_id: _deviceId(),
    created_at: new Date().toISOString()
  };
  // fire-and-forget，绝不阻塞、绝不报错给老师看
  fetch(STATS_CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + STATS_CONFIG.table, {
    method: 'POST',
    headers: _statsHeaders(),
    body: JSON.stringify(payload)
  }).catch(()=>{});
}

/* ============ 读取统计数据 ============ */
async function fetchStats(days){
  const since = new Date(Date.now() - (days || 30) * 86400000).toISOString();
  const url = STATS_CONFIG.supabaseUrl.replace(/\/$/, '')
    + '/rest/v1/' + STATS_CONFIG.table
    + '?select=question,mode,hit_id,device_id,created_at'
    + '&created_at=gte.' + encodeURIComponent(since)
    + '&order=created_at.desc&limit=5000';
  const resp = await fetch(url, { headers: _statsHeaders() });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.json();
}

/* ============ 汇总分析 ============ */
function analyzeStats(rows){
  const byQ = {};       // 问题归类计数
  const unresolved = {};// 未答问题
  const byDay = {};     // 按天
  const devices = new Set();
  let unresolvedCnt = 0, aiCnt = 0;

  for (const row of rows){
    const raw = String(row.question || '').trim();
    if (!raw) continue;
    const key = _normQ(raw);
    devices.add(row.device_id || '');
    byQ[key] = byQ[key] || { text: raw, count: 0, mode: row.mode, last: row.created_at };
    byQ[key].count++;
    if (row.created_at > byQ[key].last) byQ[key].last = row.created_at;

    const day = String(row.created_at || '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;

    if (row.mode === 'fallback' || row.mode === 'candidate'){
      unresolved[key] = unresolved[key] || { text: raw, count: 0 };
      unresolved[key].count++;
      if (row.mode === 'fallback') unresolvedCnt++;
    }
    if (row.mode === 'ai') aiCnt++;
  }

  const topQ = Object.values(byQ).sort((a, b) => b.count - a.count);
  const topU = Object.values(unresolved).sort((a, b) => b.count - a.count);
  return { total: rows.length, devices: devices.size, topQ, topU, byDay, unresolvedCnt, aiCnt };
}

/* 归一化问题文本，便于合并同类问题 */
function _normQ(s){
  return String(s)
    .replace(/\s+/g, '')
    .replace(/[，。？！、；：""''（）()【】\[\]…~～!?,.;:]/g, '')
    .replace(/[?？]+$/, '')
    .toLowerCase();
}

/* ============ 管理看板 UI ============ */
let _statsOpen = false;
function openStatsPanel(){
  if (_statsOpen) return;
  _statsOpen = true;

  const mask = document.createElement('div');
  mask.className = 'st-mask';
  mask.innerHTML = `
    <div class="st-panel">
      <div class="st-head">
        <div class="st-title">📊 提问统计</div>
        <button class="st-close" aria-label="关闭">✕</button>
      </div>
      <div class="st-body" id="stBody"></div>
    </div>`;
  document.body.appendChild(mask);
  const body = mask.querySelector('#stBody');

  mask.addEventListener('click', e=>{
    if (e.target === mask || e.target.classList.contains('st-close')){
      mask.remove(); _statsOpen = false;
    }
  });

  if (!_statsReady()){
    body.innerHTML = `<div class="st-err">统计功能未启用<br><span style="font-size:12px;color:#8b97a8">请在 stats.js 里填写 Supabase 地址和 Key</span></div>`;
    return;
  }

  // 口令校验（本地校验，简单防护；真正的数据安全靠 Supabase 权限设置）
  body.innerHTML = `
    <div class="st-login">
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px">请输入管理口令查看统计</div>
      <input type="password" id="stPass" placeholder="管理口令" autocomplete="off">
      <button id="stEnter">进入</button>
    </div>`;
  const passInput = body.querySelector('#stPass');
  const doEnter = ()=>{
    if (passInput.value !== STATS_CONFIG.adminPass){
      passInput.value = '';
      passInput.placeholder = '口令不对，请重试';
      passInput.classList.add('shake');
      setTimeout(()=>passInput.classList.remove('shake'), 400);
      return;
    }
    try{ sessionStorage.setItem('st_ok', '1'); }catch(e){}
    renderStatsMain(body);
  };
  body.querySelector('#stEnter').addEventListener('click', doEnter);
  passInput.addEventListener('keydown', e=>{ if (e.key === 'Enter') doEnter(); });
}

async function renderStatsMain(body){
  body.innerHTML = `<div class="st-loading"><div class="typing"><i></i><i></i><i></i></div> 正在读取数据…</div>`;
  let rows;
  try{
    rows = await fetchStats(30);
  }catch(err){
    body.innerHTML = `<div class="st-err">读取失败：${err.message}<br>
      <span style="font-size:12px;color:#8b97a8">请检查 Supabase 地址/Key 是否填写正确、数据表是否已建</span></div>`;
    return;
  }
  const s = analyzeStats(rows);

  if (!s.total){
    body.innerHTML = `<div class="st-err" style="color:#5a6371">最近 30 天还没有提问记录<br>
      <span style="font-size:12px;color:#8b97a8">等老师使用后就会有数据了</span></div>`;
    return;
  }

  // 概览卡片
  let html = `<div class="st-cards">
    <div class="st-card"><div class="n">${s.total}</div><div class="l">总提问次数</div></div>
    <div class="st-card"><div class="n">${s.topQ.length}</div><div class="l">不同问题</div></div>
    <div class="st-card"><div class="n">${s.devices}</div><div class="l">提问设备数</div></div>
    <div class="st-card warn"><div class="n">${s.unresolvedCnt}</div><div class="l">没答案次数</div></div>
  </div>`;

  // 趋势（近14天简易柱状图）
  const days = Object.keys(s.byDay).sort().slice(-14);
  if (days.length){
    const mx = Math.max(...days.map(d => s.byDay[d]));
    html += `<div class="st-sec"><div class="st-sec-t">近 14 天提问趋势</div><div class="st-bars">`;
    for (const d of days){
      const h = Math.max(6, Math.round(s.byDay[d] / mx * 56));
      html += `<div class="st-bar-wrap" title="${d}：${s.byDay[d]} 次">
        <div class="st-bar" style="height:${h}px"></div>
        <div class="st-bar-n">${s.byDay[d]}</div>
        <div class="st-bar-d">${d.slice(5)}</div>
      </div>`;
    }
    html += `</div></div>`;
  }

  // 未答问题榜
  html += `<div class="st-sec"><div class="st-sec-t">⚠️ 没答案的问题（优先补知识库）<span class="st-cnt">${s.topU.length}</span></div>`;
  if (!s.topU.length){
    html += `<div class="st-empty">暂无，所有问题都答上了 👍</div>`;
  } else {
    html += `<div class="st-list">`;
    s.topU.slice(0, 20).forEach((u, i)=>{
      html += `<div class="st-item u"><span class="st-idx">${i+1}</span>
        <span class="st-q">${escHtml(u.text)}</span>
        <span class="st-num">${u.count}次</span></div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;

  // 高频问题榜
  html += `<div class="st-sec"><div class="st-sec-t">🔥 高频问题 Top 20</div><div class="st-list">`;
  s.topQ.slice(0, 20).forEach((q, i)=>{
    const badge = q.mode === 'fallback' ? '<i class="st-tag bad">没答上</i>'
                : q.mode === 'candidate' ? '<i class="st-tag warn">给候选</i>'
                : q.mode === 'ai' ? '<i class="st-tag ai">AI答</i>' : '';
    html += `<div class="st-item"><span class="st-idx">${i+1}</span>
      <span class="st-q">${escHtml(q.text)}${badge}</span>
      <span class="st-num">${q.count}次</span></div>`;
  });
  html += `</div></div>`;

  // 导出按钮
  html += `<div class="st-actions">
    <button id="stExport">⬇️ 导出 Excel（CSV）</button>
    <button id="stRefresh">🔄 刷新</button>
  </div>`;

  body.innerHTML = html;

  body.querySelector('#stRefresh').addEventListener('click', ()=>renderStatsMain(body));
  body.querySelector('#stExport').addEventListener('click', ()=>exportStatsCSV(s));
}

function exportStatsCSV(s){
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  let csv = '\uFEFF'; // BOM，防 Excel 乱码
  csv += '=== 概览 ===\n';
  csv += `总提问次数,${s.total}\n不同问题数,${s.topQ.length}\n提问设备数,${s.devices}\n没答案次数,${s.unresolvedCnt}\n\n`;
  csv += '=== 没答案的问题 ===\n问题,次数\n';
  s.topU.forEach(u => { csv += `${esc(u.text)},${u.count}\n`; });
  csv += '\n=== 高频问题 ===\n问题,次数,回答方式\n';
  s.topQ.forEach(q => { csv += `${esc(q.text)},${q.count},${q.mode}\n`; });
  csv += '\n=== 每日趋势 ===\n日期,次数\n';
  Object.keys(s.byDay).sort().forEach(d => { csv += `${d},${s.byDay[d]}\n`; });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '提问统计_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============ 右下角统计入口（长按或点5次触发，避免老师误点） ============ */
function initStatsEntry(){
  const btn = document.createElement('button');
  btn.id = 'statsBtn';
  btn.className = 'stats-btn';
  btn.title = '管理统计';
  btn.textContent = '📊';
  document.body.appendChild(btn);

  let clicks = 0, timer = null;
  btn.addEventListener('click', ()=>{
    clicks++;
    if (clicks === 1){
      timer = setTimeout(()=>{ clicks = 0; btn.classList.remove('hot'); }, 2500);
    }
    if (clicks >= 3){            // 连点3次才会打开，老师不会误触
      clearTimeout(timer);
      clicks = 0;
      openStatsPanel();
    } else {
      btn.classList.add('hot');
    }
  });
}
