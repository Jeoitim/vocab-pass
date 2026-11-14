/* 考研词汇 · 过词  ------------------------------------------------------------
   纯前端，无依赖。
   进度存储：localStorage 同步快照（秒开）+ IndexedDB 主副本（大容量、可备份）。
   两者都写在浏览器本机，只要不清理该站点数据就一直在。
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  const ALL_DECKS = window.KV_DECKS || [];
  const ALL_WORDS = window.KV_WORDS || [];

  // 词库：W 始终是全量（下标 i 全局唯一，标记键不会错位）；
  // 当前词库只是过词/列表/统计的过滤条件。
  const deckOf = id => ALL_DECKS.find(d => d.id === id) || null;
  let curDeck = (ALL_DECKS.find(d => d.ready) || ALL_DECKS[0] || { id: 'kaoyan', name: '考研英语' }).id;
  let W = ALL_WORDS;        // 当前词库的词（切换时重载）
  let N = W.length;
  let deckSet = new Set();      // 当前词库的词下标
  function buildDeckSet() {
    deckSet = new Set();
    for (let i = 0; i < N; i++) if (W[i].d === curDeck) deckSet.add(i);
  }
  const inDeck = i => deckSet.has(i);
  const LS_KEY = 'kv.state.v2';
  const IDB_NAME = 'kaoyan-vocab';
  const IDB_STORE = 'progress';
  const IDB_KEY = 'state';
  const SCHEMA = 2;
  const MARK = { 0: '未学', 1: '熟悉', 2: '模糊', 3: '不会' };
  const MARK_CLS = { 1: 'known', 2: 'vague', 3: 'unknown' };

  /* ---------------- 状态 ---------------- */
  const DEF = {
    v: SCHEMA,
    marks: {},                 // i -> 1|2|3
    session: null,             // {ids,pos,results,label,kind,round,startedAt}
    settings: {
      phon: true, autoSpeak: false, hideEx: false, skipKnown: true,
      font: 22, theme: 'dark', deck: 'kaoyan'
    },
    updated: 0
  };
  let S = load();
  let saveTimer = null;
  let storageStatus = { ls: false, idb: false, savedAt: 0, bytes: 0, err: '' };

  /* ---------- IndexedDB ---------- */
  const IDB = {
    db: null,
    ready: null,
    open() {
      if (this.ready) return this.ready;
      this.ready = new Promise(resolve => {
        if (!window.indexedDB) { resolve(null); return; }
        let req;
        try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
        setTimeout(() => resolve(this.db), 1500); // 某些隐私模式下会一直挂起
      });
      return this.ready;
    },
    async put(value) {
      const db = await this.open();
      if (!db) return false;
      return new Promise(resolve => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, IDB_KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (e) { resolve(false); }
      });
    },
    async get() {
      const db = await this.open();
      if (!db) return null;
      return new Promise(resolve => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
  };

  function normalize(o) {
    if (!o || typeof o !== 'object') return null;
    const out = JSON.parse(JSON.stringify(DEF));
    out.marks = o.marks && typeof o.marks === 'object' ? o.marks : {};
    out.session = o.session || null;
    out.settings = Object.assign({}, DEF.settings, o.settings || {});
    out.updated = o.updated || 0;
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { storageStatus.ls = true; return normalize(JSON.parse(raw)) || JSON.parse(JSON.stringify(DEF)); }
    } catch (e) { /* 损坏则忽略，后面用 IDB 兜底 */ }
    return JSON.parse(JSON.stringify(DEF));
  }

  // 启动时用 IDB 里的较新副本覆盖内存（localStorage 只是快照）
  async function hydrateFromIDB() {
    const fromIdb = await IDB.get();
    storageStatus.idb = !!(await IDB.open());
    if (!fromIdb) return false;
    const cand = normalize(fromIdb);
    if (!cand) return false;
    if ((cand.updated || 0) > (S.updated || 0)) {
      S = cand;
      persistLS();
      return true;
    }
    return false;
  }

  function persistLS() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(S));
      storageStatus.ls = true;
      return true;
    } catch (e) {
      storageStatus.ls = false;
      storageStatus.err = 'localStorage 写入失败：' + (e && e.name || '');
      return false;
    }
  }

  function save(now) {
    if (saveTimer) clearTimeout(saveTimer);
    const doSave = () => {
      S.updated = Date.now();
      const ok = persistLS();
      const json = JSON.stringify(S);
      storageStatus.bytes = json.length;
      storageStatus.savedAt = S.updated;
      IDB.put(S).then(ok2 => {
        storageStatus.idb = ok2;
        if (!ok && !ok2) toast('保存失败：浏览器存储被禁用');
      });
      return ok;
    };
    if (now) return doSave();
    saveTimer = setTimeout(doSave, 220);
  }
  const markOf = i => S.marks[i] || 0;

  /* ---------------- 工具 ---------------- */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  let toastT = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = esc(msg) + (action ? ' <button>撤销</button>' : '');
    if (action) el.querySelector('button').onclick = () => { action(); el.classList.remove('show'); };
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), action ? 4200 : 1900);
  }

  function syncTheme() {
    document.documentElement.dataset.theme = S.settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.style.setProperty('--fs', S.settings.font + 'px');
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = S.settings.theme === 'light' ? '#f5f6fa' : '#0f1117';
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------- 统计 ---------------- */
  function counts() {
    let k = 0, v = 0, u = 0;
    for (const key in S.marks) {
      if (!inDeck(+key)) continue;
      const m = S.marks[key];
      if (m === 1) k++; else if (m === 2) v++; else if (m === 3) u++;
    }
    const total = deckSet.size;
    return { known: k, vague: v, unknown: u, marked: k + v + u, fresh: total - (k + v + u), total };
  }

  /* ---------------- 视图切换 ---------------- */
  let curView = 'home';
  function go(view) {
    curView = view;
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    if (view === 'list') renderList(true);
    if (view === 'export') renderExport();
    if (view === 'settings') renderSettings();
  }
  $('#tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (t) go(t.dataset.view);
  });

  /* ---------------- 概览 ---------------- */
  const sel = { kind: 'all', round: 'fresh', limit: 50, order: 'rand' };

  function poolFor(kind, round) {
    const out = [];
    for (const i of deckSet) {
      const x = W[i];
      if (kind === 'base' && x.k !== 'b') continue;
      if (kind === 'deriv' && x.k !== 'd') continue;
      if (kind === 'sense' && !x.y) continue;
      const m = markOf(i);
      if (round === 'fresh' && m) continue;
      if (round === 'weak' && m !== 2 && m !== 3) continue;
      if (round === 'vague' && m !== 2) continue;
      if (round === 'unknown' && m !== 3) continue;
      if (round === 'review' && S.settings.skipKnown && m === 1) continue;
      out.push(i);
    }
    return out;
  }

  function updateCounts() {
    const c = counts();
    const set=(id,v)=>{const el=document.getElementById(id); if(el) el.textContent=v;};
    set('st-known',c.known); set('st-vague',c.vague); set('st-unknown',c.unknown); set('st-fresh',c.fresh);
    set('home-done',c.marked); set('home-total','/ '+N);
    const bar=document.getElementById('home-bar'); if(bar) bar.style.width=(c.marked/N*100).toFixed(2)+'%';
    const sub=document.getElementById('home-sub');
    if(sub) sub.textContent=`熟悉 ${c.known} · 模糊 ${c.vague} · 不会 ${c.unknown} · 未学 ${c.fresh}`;
  }

  function renderHome() {
    const c = counts();
    $('#home-done').textContent = c.marked;
    $('#home-total').textContent = '/ ' + N;
    $('#home-bar').style.width = (c.marked / N * 100).toFixed(2) + '%';
    $('#home-sub').textContent =
      `熟悉 ${c.known} · 模糊 ${c.vague} · 不会 ${c.unknown} · 未学 ${c.fresh}`;
    $('#st-known').textContent = c.known;
    $('#st-vague').textContent = c.vague;
    $('#st-unknown').textContent = c.unknown;
    $('#st-fresh').textContent = c.fresh;

    const n = poolFor(sel.kind, sel.round).length;
    $('#start-hint').textContent = n ? `符合条件 ${n} 个词` : '这个范围里没有词了，换个范围试试';

    // 继续上一轮
    const s = S.session;
    const box = $('#home-resume');
    if (s && s.pos < s.ids.length) {
      box.hidden = false;
      $('#resume-info').textContent =
        `${s.label}　已完成 ${s.pos} / ${s.ids.length}，还剩 ${s.ids.length - s.pos} 个`;
    } else {
      box.hidden = true;
    }
  }

  $('#chips-kind').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    sel.kind = b.dataset.kind;
    $$('#chips-kind .chip').forEach(x => x.classList.toggle('active', x === b));
    renderHome();
  });
  $('#chips-round').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    sel.round = b.dataset.round;
    $$('#chips-round .chip').forEach(x => x.classList.toggle('active', x === b));
    renderHome();
  });
  $('#sel-limit').addEventListener('change', e => { sel.limit = +e.target.value; });
  $('#sel-order').addEventListener('change', e => { sel.order = e.target.value; });
  $('#btn-start').addEventListener('click', () => {
    const pool = poolFor(sel.kind, sel.round);
    if (!pool.length) { toast('这个范围里没有词了'); return; }
    startSession(pool, {
      kind: sel.kind, round: sel.round, limit: sel.limit, order: sel.order,
      label: labelOf(sel.kind) + ' · ' + labelOf2(sel.round)
    });
  });
  $('#btn-resume').addEventListener('click', () => {
    if (!S.session) return;
    go('study'); renderCard();
  });
  $('#btn-drop').addEventListener('click', () => {
    S.session = null; save(true); renderHome(); toast('已丢弃上一轮');
  });

  const labelOf = k => ({ all: '全部词', base: '大纲词', deriv: '派生词', sense: '熟词生义' })[k] || '全部词';
  const labelOf2 = r => ({ fresh: '新词', weak: '模糊+不会', vague: '模糊', unknown: '不会', review: '重过' })[r] || r;

  function startSession(pool, opt) {
    let ids = pool.slice();
    if (opt.order === 'seq') {
      ids.sort((a, b) => W[a].w.toLowerCase().localeCompare(W[b].w.toLowerCase()));
    } else if (opt.order === 'rand') {
      shuffle(ids);
    } else {
      // 先新词后已标记，各组内随机
      const fresh = shuffle(ids.filter(i => !markOf(i)));
      const rest = shuffle(ids.filter(i => markOf(i)));
      ids = fresh.concat(rest);
    }
    if (opt.limit > 0) ids = ids.slice(0, opt.limit);
    S.session = {
      ids, pos: 0, results: [], label: opt.label,
      kind: opt.kind, round: opt.round, startedAt: Date.now()
    };
    save(true);
    go('study');
    renderCard();
  }

  /* ---------------- 卡片 ---------------- */
  function renderCard() {
    const s = S.session;
    if (!s) { go('home'); return; }
    if (s.pos >= s.ids.length) { finishSession(); return; }

    $('#study-done').hidden = true;
    $('#study-body').hidden = false;

    const i = s.ids[s.pos];
    const x = W[i];
    const card = $('#card');
    card.classList.remove('revealed');
    document.getElementById('card-detail').hidden = true;
    $('#markbar').hidden = false;

    const total = s.ids.length;
    $('#study-bar').style.width = (s.pos / total * 100).toFixed(1) + '%';
    $('#study-count').textContent = (s.pos + 1) + ' / ' + total;
    $('#study-label').textContent = s.label || '';

    // 徽标
    const badges = [];
    if (x.k === 'd') badges.push('<span class="badge deriv">派生·词形</span>');
    if (x.y) badges.push('<span class="badge rare">含熟词生义</span>');
    const m = markOf(i);
    if (m) badges.push(`<span class="badge">上次：${MARK[m]}</span>`);
    $('#card-badges').innerHTML = badges.join('');
    // 考试标签（高中/CET4/CET6/考研/IELTS/TOEFL/GRE/GMAT/SAT…）
    const etEl = $('#card-exam');
    if (etEl) etEl.innerHTML = examTagsHTML(x);

    $('#card-word').textContent = x.w;
    $('#card-phon').textContent = S.settings.phon ? (x.p || '') : '';
    $('#card-detail').innerHTML = detailHTML(x);
    if (S.settings.hideEx) card.classList.add('hide-ex'); else card.classList.remove('hide-ex');
    card.focus({ preventScroll: true });
  }

  function revealCard() {
    const card = $('#card');
    if (card.classList.contains('revealed')) return;
    card.classList.add('revealed');
    $('#card-detail').hidden = false;
    if (S.settings.autoSpeak) speak(currentWord());
  }

  function currentWord() {
    const s = S.session;
    return s ? W[s.ids[s.pos]] : null;
  }

  function mark(n) {
    const s = S.session;
    if (!s || s.pos >= s.ids.length) return;
    const i = s.ids[s.pos];
    const prev = markOf(i);
    s.results.push({ i, mark: n, prev });
    if (n === 0) delete S.marks[i]; else S.marks[i] = n;
    s.pos++;
    save(true);
    updateCounts();
    if (s.pos >= s.ids.length) finishSession(); else renderCard();
  }

  function undo() {
    const s = S.session;
    if (!s || !s.results.length) { toast('没有可撤销的'); return; }
    const r = s.results.pop();
    if (r.prev) S.marks[r.i] = r.prev; else delete S.marks[r.i];
    s.pos = Math.max(0, s.pos - 1);
    save(true);
    $('#study-done').hidden = true;
    $('#study-body').hidden = false;
    renderCard();
    toast('已撤销：' + W[r.i].w);
  }

  function finishSession() {
    const s = S.session;
    if (!s) return;
    let k = 0, v = 0, u = 0, sk = 0;
    for (const r of s.results) {
      if (r.mark === 1) k++; else if (r.mark === 2) v++; else if (r.mark === 3) u++; else sk++;
    }
    $('#study-body').hidden = true;
    $('#study-done').hidden = false;
    $('#study-bar').style.width = '100%';
    $('#study-count').textContent = s.ids.length + ' / ' + s.ids.length;
    $('#done-title').textContent = s.label + ' · 本轮完成';
    $('#done-stats').innerHTML =
      `<div class="k"><b>${k}</b>熟悉</div>` +
      `<div class="v"><b>${v}</b>模糊</div>` +
      `<div class="u"><b>${u}</b>不会</div>` +
      (sk ? `<div><b>${sk}</b>跳过</div>` : '');
    // 本轮结束后保留一个标记，让「继续」不再提示
    S.session = Object.assign({}, s, { done: true });
    save(true);
  }

  $('#card').addEventListener('click', e => {
    if (e.target.closest('button')) return;
    revealCard();
  });
  $('#markbar').addEventListener('click', e => {
    const b = e.target.closest('.mark');
    if (b) { revealCard(); mark(+b.dataset.mark); }
  });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-skip').addEventListener('click', () => { mark(0); });
  $('#btn-speak').addEventListener('click', () => speak(currentWord()));
  $('#btn-quit').addEventListener('click', () => {
    if (!S.session) return;
    if (S.session.pos >= S.session.ids.length) { go('home'); return; }
    S.session = null; save(true); go('home'); toast('已结束本轮（标记已保存）');
  });
  $('#btn-back-home').addEventListener('click', () => { go('home'); });
  $('#btn-again-weak').addEventListener('click', () => {
    const ids = (S.session ? S.session.ids : []).filter(i => markOf(i) === 2 || markOf(i) === 3);
    if (!ids.length) { toast('这部分都熟了，没有模糊/不会'); return; }
    startSession(ids, { kind: 'all', round: 'weak', limit: 0, order: 'rand', label: '模糊+不会 · 再过一遍' });
  });
  $('#btn-again-fresh').addEventListener('click', () => {
    const pool = poolFor('all', 'fresh');
    if (!pool.length) { toast('新词都过完了'); return; }
    startSession(pool, { kind: 'all', round: 'fresh', limit: sel.limit, order: 'rand', label: '新词' });
  });

  /* ---------------- 释义渲染 ---------------- */
  function detailHTML(x) {
    const out = [];
    // 大纲释义（大纲词）
    if (x.k === 'b' && x.m) {
      out.push(`<div class="outline"><b>大纲释义</b>　${esc(x.m)}</div>`);
    } else if (x.k === 'd' && x.m) {
      out.push(`<div class="outline"><b>词典释义</b>　${esc(x.m)}</div>`);
    }

    if (S.settings.hideEx) {
      out.push(`<button class="btn ghost small ex-toggle" id="ex-toggle">显示例句</button>`);
    }

    const senses = x.s || [];
    if (senses.length) {
      const kindOf = s => (s.g === 0 ? 'core' : s.g === 1 ? 'rare' : 'other');
      const cores = senses.filter(s => kindOf(s) === 'core');
      const rares = senses.filter(s => kindOf(s) === 'rare');
      const others = senses.filter(s => kindOf(s) === 'other');
      if (cores.length) out.push(cores.map(s => senseHTML(s, 'core')).join(''));
      if (rares.length) {
        out.push(`<div class="sense-sep"><span>熟词生义 · 大纲没列、但真题里可能出现</span></div>`);
        out.push(rares.map(s => senseHTML(s, 'rare')).join(''));
      }
      if (others.length) out.push(others.map(s => senseHTML(s, 'other')).join(''));
    } else {
      out.push(`<div class="hint" style="margin:6px 0 10px">该词未收录逐义项释义，以上为词典简释。</div>`);
    }

    // 通用例句
    if (x.g) out.push(exBlock('例句', [x.g]));

    // 真题例句
    if (x.x && x.x.length) {
      out.push(`<div class="extra-block"><h4>真题例句</h4>` +
        x.x.map(e => `<div class="ex"><div class="en">${esc(e[0])}</div><div class="zh">${esc(e[1])}` +
          (e[2] ? `<span class="src">${esc(e[2])}</span>` : '') + `</div></div>`).join('') + `</div>`);
    }

    // 词形变化
    if (x.f && x.f.length) {
      out.push(`<div class="extra-block"><h4>词形变化</h4><div class="forms">` +
        x.f.map(f => `<span class="form">${esc(f[0])} <b>${esc(f[1])}</b></span>`).join('') + `</div></div>`);
    }

    // 同根词
    if (x.r && x.r.length) {
      out.push(`<div class="extra-block"><h4>同根 / 派生</h4>` +
        x.r.map(r => `<div class="kv"><b>${esc(r[0])}</b>${r[1] ? '<span>' + esc(r[1]) + '</span>' : ''}<span>${esc(r[2] || '')}</span></div>`).join('') +
        `</div>`);
    }

    // 短语
    if (x.ph && x.ph.length) {
      out.push(`<div class="extra-block"><h4>常考短语</h4>` +
        x.ph.map(p => `<div class="kv"><b>${esc(p[0])}</b><span>${esc(p[1])}</span></div>`).join('') + `</div>`);
    }

    // 巧记
    if (x.mn) out.push(`<div class="extra-block"><h4>助记</h4><div class="mn">${esc(x.mn)}</div></div>`);

    // 谚语
    if (x.sy) out.push(`<div class="extra-block"><div class="saying">“${esc(x.sy[0])}”<span>${esc(x.sy[1])}</span></div></div>`);

    return out.join('');
  }

  // 考试标签：CET4/CET6 显示成四级/六级，其余原样
  const EXAM_LABEL = {
    'CET4': '四级', 'CET6': '六级', '考研': '考研', 'IELTS': '雅思',
    'TOEFL': '托福', 'GRE': 'GRE', 'GMAT': 'GMAT', 'SAT': 'SAT',
    '高中': '高中', '初中': '初中', '商务英语': '商务'
  };
  function examTagsHTML(x) {
    const tags = x.et || [];
    if (!tags.length) return '';
    // 常见顺序，让视觉稳定
    const ORDER = ['高中', 'CET4', 'CET6', '考研', 'IELTS', 'TOEFL', 'GRE', 'GMAT', 'SAT', '商务英语', '初中'];
    const sorted = tags.slice().sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return sorted.map(t =>
      `<span class="exam-tag">${esc(EXAM_LABEL[t] || t)}</span>`
    ).join('');
  }

  function senseHTML(s, kind) {
    const rare = kind === 'rare';
    const neutral = kind === 'other';
    const ex = (s.e || []).filter(e => e[0] && e[1]);
    let h = `<div class="sense${rare ? ' rare' : ''}${neutral ? ' neutral' : ''}">`;
    h += `<div class="sense-head">`;
    if (s.p) h += `<span class="pos">${esc(s.p)}</span>`;
    if (rare) h += `<span class="tag-rare">生义</span>`;
    h += `<span class="sense-cn">${esc(s.c)}</span></div>`;
    if (ex.length) {
      h += ex.map(e => `<div class="ex"><div class="en">${esc(e[0])}</div><div class="zh">${esc(e[1])}</div></div>`).join('');
    }
    h += `</div>`;
    return h;
  }

  function exBlock(title, list) {
    return `<div class="extra-block"><h4>${title}</h4>` +
      list.map(e => `<div class="ex"><div class="en">${esc(e[0])}</div><div class="zh">${esc(e[1])}</div></div>`).join('') +
      `</div>`;
  }

  // 例句折叠时展开
  document.addEventListener('click', e => {
    if (e.target.id === 'ex-toggle') {
      const card = $('#card');
      card.classList.remove('hide-ex');
      e.target.remove();
    }
  });

  /* ---------------- 发音 ---------------- */
  let voices = [];
  function loadVoices() {
    try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { voices = []; }
  }
  if (window.speechSynthesis) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  function speak(x) {
    if (!x) return;
    if (!window.speechSynthesis) { toast('这台设备不支持朗读'); return; }
    const u = new SpeechSynthesisUtterance(x.w.replace(/-/g, ' '));
    u.lang = 'en-US';
    u.rate = 0.92;
    const v = voices.find(v => /en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
    if (v) u.voice = v;
    try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { }
  }

  /* ---------------- 词表 ---------------- */
  const listState = { filter: 'all', q: '', shown: 80 };
  let listRows = [];

  function renderList(reset) {
    if (reset) { listState.shown = 80; }
    const q = listState.q.trim().toLowerCase();
    let arr = [];
    for (const i of deckSet) {
      const x = W[i];
      const m = markOf(i);
      if (listState.filter === 'known' && m !== 1) continue;
      if (listState.filter === 'vague' && m !== 2) continue;
      if (listState.filter === 'unknown' && m !== 3) continue;
      if (listState.filter === 'fresh' && m !== 0) continue;
      if (listState.filter === 'sense' && !x.y) continue;
      if (q) {
        if (!(x.w.toLowerCase().includes(q) || (x.m || '').toLowerCase().includes(q))) continue;
      }
      arr.push(i);
    }
    arr.sort((a, b) => W[a].w.toLowerCase().localeCompare(W[b].w.toLowerCase()));
    listRows = arr;
    $('#list-info').innerHTML = `<span>共 ${arr.length} 个${arr.length > listState.shown ? '（显示前 ' + listState.shown + '）' : ''}</span>` +
      (arr.length ? `<button class="mini" id="list-train">过这一批 →</button>` : '');
    const slice = arr.slice(0, listState.shown);
    $('#list-body').innerHTML = slice.map(i => liHTML(i)).join('') || '<div class="hint" style="padding:24px 0;text-align:center">没有匹配的词</div>';
    $('#btn-more').hidden = arr.length <= listState.shown;
  }

  function liHTML(i) {
    const x = W[i], m = markOf(i);
    return `<div class="li" data-i="${i}">
      <span class="dot ${m ? MARK_CLS[m] : ''}"></span>
      <div class="li-main">
        <div class="li-w">${esc(x.w)}${x.k === 'd' ? '<em>派生</em>' : ''}${x.y ? '<em style="color:var(--warn)">生义</em>' : ''}</div>
        <div class="li-m">${esc(x.m || '')}</div>
      </div>
      <div class="li-act">
        <button data-m="1" class="${m === 1 ? 'on known' : ''}" title="熟悉">熟</button>
        <button data-m="2" class="${m === 2 ? 'on vague' : ''}" title="模糊">模</button>
        <button data-m="3" class="${m === 3 ? 'on unknown' : ''}" title="不会">不</button>
      </div>
    </div>`;
  }

  $('#list-search').addEventListener('input', e => { listState.q = e.target.value; renderList(true); });
  $('#chips-filter').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    listState.filter = b.dataset.filter;
    $$('#chips-filter .chip').forEach(x => x.classList.toggle('active', x === b));
    renderList(true);
  });
  $('#btn-more').addEventListener('click', () => { listState.shown += 120; renderList(false); });

  // 词表 → 直接拿筛选结果开练
  $('#list-info').addEventListener('click', e => {
    if (e.target.id !== 'list-train') return;
    const ids = listRows.slice();
    if (!ids.length) { toast('列表是空的'); return; }
    startSession(ids, { kind: 'all', round: 'review', limit: 0, order: 'seq',
      label: '词表筛选 · ' + ids.length + ' 词' });
  });

  $('#list-body').addEventListener('click', e => {
    const btn = e.target.closest('.li-act button');
    const row = e.target.closest('.li');
    if (!row) return;
    const i = +row.dataset.i;
    if (btn) {
      e.stopPropagation();
      const m = +btn.dataset.m;
      const cur = markOf(i);
      if (cur === m) delete S.marks[i]; else S.marks[i] = m;
      save();
      renderList(false);
      return;
    }
    openWord(i);
  });

  document.querySelectorAll('.stat').forEach(b => {
    b.addEventListener('click', () => {
      const sc = b.dataset.scope;
      go('list');
      listState.filter = sc;
      $$('#chips-filter .chip').forEach(x => x.classList.toggle('active', x.dataset.filter === sc));
      renderList(true);
    });
  });

  /* ---------------- 单词详情弹层 ---------------- */
  let modalEl = null;
  function openWord(i) {
    const x = W[i];
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.className = 'modal';
      modalEl.innerHTML = `<div class="modal-mask"></div><div class="modal-box">
        <div class="modal-head">
          <div class="modal-word"></div>
          <div class="modal-phon"></div>
          <div class="exam-tags modal-exam"></div>
          <button class="modal-close" aria-label="关闭">✕</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-foot">
          <button class="mark known" data-m="1"><b>熟悉</b></button>
          <button class="mark vague" data-m="2"><b>模糊</b></button>
          <button class="mark unknown" data-m="3"><b>不会</b></button>
        </div>
      </div>`;
      document.body.appendChild(modalEl);
      modalEl.querySelector('.modal-mask').addEventListener('click', closeWord);
      modalEl.querySelector('.modal-close').addEventListener('click', closeWord);
      modalEl.querySelector('.modal-foot').addEventListener('click', ev => {
        const b = ev.target.closest('.mark'); if (!b) return;
        const cur = markOf(+modalEl.dataset.i), m = +b.dataset.m;
        if (cur === m) delete S.marks[+modalEl.dataset.i]; else S.marks[+modalEl.dataset.i] = m;
        save(); closeWord(); renderList(false); renderHome();
        toast(MARK[m] + '：' + W[+modalEl.dataset.i].w);
      });
      modalEl.querySelector('.modal-body').addEventListener('click', ev => {
        const t = ev.target.closest('.rel-link');
        if (t) { ev.stopPropagation(); const w = t.dataset.w; const idx = findWord(w); if (idx >= 0) openWord(idx); }
      });
    }
    // 收起键盘，避免弹层被输入法遮住
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    modalEl.dataset.i = i;
    modalEl.querySelector('.modal-word').textContent = x.w;
    modalEl.querySelector('.modal-phon').textContent = x.p || '';
    const mx = modalEl.querySelector('.modal-exam');
    if (mx) mx.innerHTML = examTagsHTML(x);
    modalEl.querySelector('.modal-body').innerHTML = detailHTML(x);
    const m = markOf(i);
    modalEl.querySelectorAll('.modal-foot .mark').forEach(b => b.classList.toggle('on', +b.dataset.m === m));
    modalEl.classList.add('show');
  }
  function closeWord() { if (modalEl) modalEl.classList.remove('show'); }

  const wIndex = new Map();
  function initIndex() { rebuildIndex(); }
  function findWord(w) { return wIndex.has(w.toLowerCase()) ? wIndex.get(w.toLowerCase()) : -1; }

  /* ---------------- 导出 ---------------- */
  let expSet = 'weak', expFmt = 'detail';

  function exportList(set) {
    const out = [];
    for (const i of deckSet) {
      const m = markOf(i);
      if (set === 'weak' && m !== 2 && m !== 3) continue;
      if (set === 'unknown' && m !== 3) continue;
      if (set === 'vague' && m !== 2) continue;
      if (set === 'known' && m !== 1) continue;
      if (set === 'marked' && !m) continue;
      out.push(i);
    }
    return out;
  }

  function buildText(set, fmt, opt) {
    const ids = exportList(set).sort((a, b) => W[a].w.toLowerCase().localeCompare(W[b].w.toLowerCase()));
    const name = { weak: '模糊+不会', unknown: '不会', vague: '模糊', known: '熟悉', marked: '已标记' }[set];
    const d = new Date();
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!ids.length) return '';
    const withRare = opt.rare !== false;
    const withForm = opt.form !== false;

    if (fmt === 'word') return ids.map(i => W[i].w).join('\n');

    const isRare = s => s.g === 1;
    const sensesOf = x => (x.s || []).filter(s => withRare || !isRare(s));

    if (fmt === 'csv') {
      const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const rows = ['单词,音标,标记,类型,释义,熟词生义,词形变化,例句'];
      for (const i of ids) {
        const x = W[i];
        const cores = (x.s || []).filter(s => s.g !== 1).map(s => (s.p || '') + ' ' + s.c).join('；');
        const rare = withRare ? (x.s || []).filter(s => s.g === 1).map(s => (s.p || '') + ' ' + s.c).join('；') : '';
        const forms = withForm ? (x.f || []).map(f => f[0] + ':' + f[1]).join('；') : '';
        let exs = [];
        for (const s of (x.s || [])) {
          if (!withRare && s.g === 1) continue;
          for (const e of (s.e || [])) { if (e[0] && e[1]) exs.push(e[0] + ' || ' + e[1]); }
        }
        rows.push([x.w, x.p || '', MARK[markOf(i)], x.k === 'b' ? '大纲' : '派生',
          cores || x.m || '', rare, forms, exs.slice(0, 3).join(' / ')].map(q).join(','));
      }
      return '\ufeff' + rows.join('\n');
    }

    const lines = [];
    lines.push(`# 考研词汇 · ${name}（${ids.length} 词）  ${date}`);
    lines.push('');
    let n = 0;
    for (const i of ids) {
      const x = W[i];
      n++;
      const head = `${n}. ${x.w}${x.p ? '  ' + x.p : ''}${x.k === 'd' ? '  [派生]' : ''}`;
      if (fmt === 'brief') {
        lines.push(head);
        lines.push(`   ${x.m || (x.s && x.s[0] && x.s[0].c) || ''}`);
        lines.push('');
        continue;
      }
      lines.push(head);
      if (x.m) lines.push(`   ${x.k === 'b' ? '大纲' : '词典'}：${x.m}`);
      for (const s of sensesOf(x)) {
        const tag = s.g === 1 ? '［生义］' : '';
        lines.push(`   ${tag}${s.p ? s.p + ' ' : ''}${s.c}`);
        for (const e of (s.e || []).slice(0, 1)) {
          if (!e[0] || !e[1]) continue;
          lines.push(`      e.g. ${e[0]}`);
          lines.push(`            ${e[1]}`);
        }
      }
      if (!sensesOf(x).length && x.g) {
        lines.push(`      e.g. ${x.g[0]}`);
        lines.push(`            ${x.g[1]}`);
      }
      if (withForm && x.f && x.f.length) {
        lines.push(`   词形：${x.f.map(f => f[0] + ' ' + f[1]).join(' / ')}`);
      }
      lines.push('');
    }
    return lines.join('\n').trim() + '\n';
  }

  let expOptInit = false;
  function renderExport() {
    if (!expOptInit) {
      expOptInit = true;
      $('#exp-rare').checked = true;
      $('#exp-form').checked = true;
    }
    const ids = exportList(expSet);
    const txt = buildText(expSet, expFmt, { rare: $('#exp-rare').checked, form: $('#exp-form').checked });
    $('#export-info').textContent = ids.length ? `${ids.length} 个词 · 预计 ${(txt.length / 1024).toFixed(0)} KB` : '这个分类下还没有词';
    const lines = txt.split('\n');
    $('#export-preview').textContent = txt ? (lines.slice(0, 60).join('\n') + (lines.length > 60 ? '\n…' : '')) : '（还没有可导出的词）';
  }

  $('#chips-export').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    expSet = b.dataset.set;
    $$('#chips-export .chip').forEach(x => x.classList.toggle('active', x === b));
    renderExport();
  });
  $('#chips-format').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    expFmt = b.dataset.fmt;
    $$('#chips-format .chip').forEach(x => x.classList.toggle('active', x === b));
    renderExport();
  });
  $$('[data-export]').forEach(b => b.addEventListener('click', () => {
    expSet = b.dataset.export;
    go('export');
    $$('#chips-export .chip').forEach(x => x.classList.toggle('active', x.dataset.set === expSet));
    renderExport();
  }));

  $('#exp-rare').addEventListener('change', renderExport);
  $('#exp-form').addEventListener('change', renderExport);
  $('#btn-download').addEventListener('click', () => {
    const txt = buildText(expSet, expFmt, { rare: $('#exp-rare').checked, form: $('#exp-form').checked });
    if (!txt) { toast('没有可导出的词'); return; }
    const name = { weak: '模糊不会', unknown: '不会', vague: '模糊', known: '熟悉', marked: '已标记' }[expSet];
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const ext = expFmt === 'csv' ? 'csv' : 'txt';
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `考研词汇_${name}_${stamp}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已导出 ' + exportList(expSet).length + ' 个词');
  });

  $('#btn-copy').addEventListener('click', async () => {
    const txt = buildText(expSet, expFmt, { rare: $('#exp-rare').checked, form: $('#exp-form').checked });
    if (!txt) { toast('没有可导出的词'); return; }
    try {
      await navigator.clipboard.writeText(txt);
      toast('已复制');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制'); } catch (e2) { toast('复制失败，请用导出文件'); }
      ta.remove();
    }
  });

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    const st = S.settings;
    $('#set-phon').checked = st.phon;
    $('#set-auto-speak').checked = st.autoSpeak;
    $('#set-hide-ex').checked = st.hideEx;
    $('#set-hide-known').checked = st.skipKnown;
    $('#set-font').value = st.font;
    $('#set-theme').value = st.theme;
    const c = counts();
    let used = 0;
    try { used = (localStorage.getItem(LS_KEY) || '').length; } catch (e) { used = 0; }
    if (!used && storageStatus.bytes) used = storageStatus.bytes;
    $('#data-info').innerHTML =
      `词库 ${N} 个词（大纲 ${W.filter(x => x.k === 'b').length} + 派生/词形 ${W.filter(x => x.k === 'd').length}）<br>` +
      `已标记 <b>${c.marked}</b> 个 · 进度约 ${(used / 1024).toFixed(0)} KB<br>` +
      `最后保存：${S.updated ? new Date(S.updated).toLocaleTimeString() : '—'}　` +
      `<span style="color:${storageStatus.idb ? 'var(--good)' : 'var(--dim)'}">IndexedDB ${storageStatus.idb ? '已启用' : '不可用'}</span>`;
    updateStorageBadge();
    davPaint();
  }
  $('#set-phon').addEventListener('change', e => { S.settings.phon = e.target.checked; save(true); if (curView === 'study') renderCard(); });
  $('#set-auto-speak').addEventListener('change', e => { S.settings.autoSpeak = e.target.checked; save(true); });
  $('#set-hide-ex').addEventListener('change', e => { S.settings.hideEx = e.target.checked; save(true); });
  $('#set-hide-known').addEventListener('change', e => { S.settings.skipKnown = e.target.checked; save(true); renderHome(); });
  $('#set-font').addEventListener('input', e => { S.settings.font = +e.target.value; syncTheme(); save(); });
  $('#set-theme').addEventListener('change', e => { S.settings.theme = e.target.value; syncTheme(); save(true); });

  $('#btn-backup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `考研词汇进度_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已备份');
  });
  $('#btn-restore').addEventListener('click', () => $('#file-restore').click());
  $('#file-restore').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result);
        if (!o || typeof o !== 'object' || !o.marks) throw new Error('bad');
        S = {
          marks: o.marks, session: o.session || null,
          settings: Object.assign({}, DEF.settings, o.settings || {}), updated: Date.now()
        };
        curDeck = deckOf(S.settings.deck) ? S.settings.deck : curDeck;
        buildDeckSet(); syncDeckUI();
        save(true); syncTheme(); applySettingsUI(); go('home'); updateStorageBadge();
        toast('进度已恢复');
      } catch (err) { toast('文件格式不对'); }
    };
    r.readAsText(f);
    e.target.value = '';
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('确定清空所有标记和进度？此操作不可恢复（建议先备份）。')) return;
    S = JSON.parse(JSON.stringify(DEF));
    save(true); syncTheme(); go('home'); updateStorageBadge();
    toast('已清空');
  });

  function applySettingsUI() {
    $('#set-phon').checked = S.settings.phon;
    $('#set-auto-speak').checked = S.settings.autoSpeak;
    $('#set-hide-ex').checked = S.settings.hideEx;
    $('#set-hide-known').checked = S.settings.skipKnown;
    $('#set-font').value = S.settings.font;
    $('#set-theme').value = S.settings.theme;
  }

  /* ---------------- 词库切换 ---------------- */
  // 说明：标记按「单词+词库」分别记录，但熟悉的词在切换后仍保留在词表里。
  // 未过的新词只来自当前选择的词库。

  // 加载某个词库的数据分片（同一词库只加载一次）
  const deckCache = new Map([[curDeck, ALL_WORDS]]);
  function loadDeckScript(id) {
    return new Promise((resolve, reject) => {
      if (deckCache.has(id)) { resolve(deckCache.get(id)); return; }
      const sc = document.createElement('script');
      sc.src = 'decks/' + id + '.js';
      sc.onload = () => {
        const data = window.KV_DECK_WORDS || [];
        deckCache.set(id, data);
        resolve(data);
      };
      sc.onerror = () => reject(new Error('无法加载词库数据'));
      document.head.appendChild(sc);
    });
  }

  async function applyDeck(id) {
    const d = deckOf(id);
    if (!d || !d.ready) return;
    if (id !== curDeck) {
      toast('正在加载 ' + d.name + '…');
      try {
        W = await loadDeckScript(id);
        N = W.length;
      } catch (e) {
        toast('词库加载失败：' + e.message);
        return;
      }
    }
    curDeck = id;
    S.settings.deck = id;
    rebuildIndex();
    buildDeckSet();
    S.session = null;          // 换词库后旧会话作废
    save(true);
    syncDeckUI();
    renderHome();
    if (curView === 'list') renderList(true);
  }

  function rebuildIndex() {
    wIndex.clear();
    W.forEach(x => wIndex.set(x.w.toLowerCase(), x.i));
  }

  function syncDeckUI() {
    const d = deckOf(curDeck) || {name: '考研英语'};
    const el = document.getElementById('deck-name');
    if (el) el.textContent = d.name;
    const line = document.getElementById('deck-line');
    if (line) {
      let base = 0;
      for (const i of deckSet) if (W[i].k === 'b') base++;
      line.innerHTML = `当前词库 <b>${esc(d.name)}</b>　大纲 ${base} · 派生/词形 ${deckSet.size - base}`;
    }
  }

  function openDeckPicker() {
    let el = document.getElementById('deck-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'deck-sheet';
      el.className = 'modal center';
      el.innerHTML = `<div class="modal-mask"></div><div class="modal-box">
        <div class="modal-head">
          <div class="modal-word" style="font-size:19px">选择词库</div>
          <div class="modal-phon" style="font-family:inherit">切换后，未过的词只来自新词库；已标记的词继续保留</div>
          <button class="modal-close" aria-label="关闭">✕</button>
        </div>
        <div class="modal-body"><div class="deck-list"></div></div>
      </div>`;
      document.body.appendChild(el);
      el.querySelector('.modal-mask').addEventListener('click', () => el.classList.remove('show'));
      el.querySelector('.modal-close').addEventListener('click', () => el.classList.remove('show'));
      el.querySelector('.deck-list').addEventListener('click', ev => {
        const item = ev.target.closest('.deck-item');
        if (!item || item.classList.contains('off')) return;
        const id = item.dataset.id;
        el.classList.remove('show');
        if (id !== curDeck) {
          applyDeck(id).then(() => {
            renderHome();
            if (curView === 'list') renderList(true);
            toast('已切换到 ' + (deckOf(id) || {}).name);
          });
        }
      });
    }
    const list = el.querySelector('.deck-list');
    list.innerHTML = ALL_DECKS.map((d, i) => {
      const on = d.id === curDeck;
      const ini = d.name.slice(0, 1);
      const count = d.ready ? `${d.count} 词` : '即将支持';
      return `<div class="deck-item ${on ? 'on' : ''} ${d.ready ? '' : 'off'}" data-id="${d.id}">
        <div class="deck-ic">${esc(ini)}</div>
        <div class="deck-tx">
          <div class="deck-nm">${esc(d.name)}${d.ready ? '' : '<span class="tag-soon">待扩充</span>'}</div>
          <div class="deck-sb">${esc(d.sub || '')}</div>
        </div>
        <div class="deck-ct">${count}</div>
      </div>`;
    }).join('');
    el.classList.add('show');
  }

  document.getElementById('deck-pill').addEventListener('click', openDeckPicker);

  /* ---------------- WebDAV（可选） ---------------- */
  const DAV_KEY = 'kv.webdav';
  const DAV_FILE = 'kaoyan-vocab-progress.json';

  function davCfg() {
    try { return JSON.parse(localStorage.getItem(DAV_KEY) || '{}'); } catch (e) { return {}; }
  }
  function davPaint() {
    const cfg = davCfg();
    if (cfg.url) {
      $('#dav-url').value = cfg.url;
      $('#dav-user').value = cfg.user || '';
      $('#dav-pass').value = cfg.pass || '';
    }
    $('#dav-state').textContent = cfg.url ? '已配置' : '未启用';
  }
  function davSaveCfg() {
    const cfg = {
      url: $('#dav-url').value.trim(),
      user: $('#dav-user').value.trim(),
      pass: $('#dav-pass').value
    };
    try { localStorage.setItem(DAV_KEY, JSON.stringify(cfg)); toast('已保存云同步配置'); }
    catch (e) { toast('保存失败'); }
    davPaint();
  }
  function davHeaders(cfg) {
    const h = { 'Content-Type': 'application/json' };
    if (cfg.user || cfg.pass) h['Authorization'] = 'Basic ' + btoa(cfg.user + ':' + cfg.pass);
    return h;
  }
  async function davPush() {
    const cfg = davCfg();
    if (!cfg.url) { toast('先填服务器地址并保存'); return; }
    const url = cfg.url.replace(/\/?$/, '/') + DAV_FILE;
    $('#dav-msg').textContent = '上传中…';
    try {
      const r = await fetch(url, { method: 'PUT', headers: davHeaders(cfg), body: JSON.stringify(S) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      $('#dav-msg').textContent = '已上传 ' + new Date().toLocaleTimeString();
      toast('已推到云端');
    } catch (e) {
      $('#dav-msg').textContent = '上传失败：' + e.message + '（坚果云不支持浏览器跨域，直连会失败）';
    }
  }
  async function davPull() {
    const cfg = davCfg();
    if (!cfg.url) { toast('先填服务器地址并保存'); return; }
    const url = cfg.url.replace(/\/?$/, '/') + DAV_FILE;
    $('#dav-msg').textContent = '拉取中…';
    try {
      const r = await fetch(url, { method: 'GET', headers: davHeaders(cfg), cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const o = JSON.parse(await r.text());
      const cand = normalize(o);
      if (!cand) throw new Error('格式不对');
      if (!confirm('用云端进度覆盖本机？\n云端已标记 ' + Object.keys(cand.marks).length + ' 词')) return;
      S = cand; S.updated = Date.now(); save(true); syncTheme(); applySettingsUI(); go('home');
      $('#dav-msg').textContent = '已从云端恢复';
      toast('已从云端拉取');
    } catch (e) {
      $('#dav-msg').textContent = '拉取失败：' + e.message + '（坚果云不支持浏览器跨域，直连会失败）';
    }
  }
  $('#btn-dav-save').addEventListener('click', davSaveCfg);
  $('#btn-dav-push').addEventListener('click', davPush);
  $('#btn-dav-pull').addEventListener('click', davPull);

  /* ---------------- 键盘 ---------------- */
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select')) return;
    if (curView !== 'study') {
      if (e.key === ' ' && curView === 'home') { e.preventDefault(); $('#btn-start').click(); }
      return;
    }
    const s = S.session;
    if (!s) return;
    const revealed = $('#card').classList.contains('revealed');
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!revealed) revealCard(); else if (s.pos < s.ids.length) mark(1);
      return;
    }
    if (e.key === '1') { revealCard(); mark(1); }
    else if (e.key === '2') { revealCard(); mark(2); }
    else if (e.key === '3') { revealCard(); mark(3); }
    else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 's') { speak(currentWord()); }
    else if (e.key === 'ArrowRight') { mark(0); }
  });

  /* ---------------- 启动 ---------------- */
  async function boot() {
    // 词库：读上次选择，没有就用第一个可用词库
    const savedDeck = S.settings.deck;
    if (!savedDeck || !deckOf(savedDeck)) {
      curDeck = (ALL_DECKS.find(d => d.ready) || { id: 'kaoyan' }).id;
      S.settings.deck = curDeck;
    } else {
      curDeck = savedDeck;
    }
    initIndex();
    buildDeckSet();
    syncTheme();
    applySettingsUI();
    syncDeckUI();

    if (!N) {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#98a2b8">词库加载失败：找不到 data.js</div>';
      return;
    }

    go('home');

    // 用 IndexedDB 里的副本对齐（比 localStorage 更新时覆盖）
    try {
      const changed = await hydrateFromIDB();
      if (changed) { syncTheme(); applySettingsUI(); renderHome(); }
    } catch (e) { }
    updateStorageBadge();

    // 每 30 秒补存（有未完成会话时）
    setInterval(() => { if (saveTimer) return; if (S.session) save(true); }, 30000);
    // 切后台/关闭前再存一次
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
    window.addEventListener('pagehide', () => save(true));
    window.addEventListener('beforeunload', () => save(true));
  }

  function updateStorageBadge() {
    const el = document.getElementById('storage-badge');
    if (!el) return;
    const bits = [];
    bits.push(storageStatus.ls ? 'localStorage ✓' : 'localStorage ×');
    bits.push(storageStatus.idb ? 'IndexedDB ✓' : 'IndexedDB —');
    el.textContent = bits.join('　');
  }

  boot();
})();
