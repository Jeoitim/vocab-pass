// VocabPass 功能测试：词库切换、义项三分类、导出、持久化
const fs = require('fs');
const { JSDOM } = require('jsdom');
const fakeIDB = require('fake-indexeddb');

const html = fs.readFileSync('www/index.html', 'utf8')
  .replace('<script src="data.js"></script>', '')
  .replace('<script src="app.js"></script>', '');
const dataSrc = fs.readFileSync('www/data.js', 'utf8');
const appSrc = fs.readFileSync('www/app.js', 'utf8');

let fails = 0;
const assert = (c, m) => { if (!c) { console.error('✗', m); fails++; } else console.log('✓', m); };
const tick = ms => new Promise(r => setTimeout(r, ms || 0));

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://x.test/', pretendToBeVisual: true });
const w = dom.window;
w.scrollTo = () => {};
w.indexedDB = new fakeIDB.IDBFactory();
w.IDBKeyRange = fakeIDB.IDBKeyRange;
const errs = [];
w.addEventListener('error', e => errs.push(e.message));
w.eval(dataSrc);
w.eval(appSrc);

(async function () {
  await tick(600);
  const $ = s => w.document.querySelector(s);

  // ---- 基础 ----
  assert((w.KV_WORDS || []).length > 12000, '词库加载 ' + w.KV_WORDS.length + ' 词');
  assert((w.KV_DECKS || []).length >= 2, '词库列表 ' + w.KV_DECKS.length + ' 个');
  assert($('#deck-name').textContent === '考研英语', '顶栏显示当前词库');
  assert($('#home-done').textContent === '0', '初始进度 0');

  // ---- 生义判定（重点）----
  const by = {}; w.KV_WORDS.forEach(x => by[x.w] = x);
  const rare = by['rare'];
  assert(!!rare, 'rare 在词库');
  const rares = rare.s.filter(s => s.g === 1);
  const cores = rare.s.filter(s => s.g !== 1);
  assert(cores.some(s => s.c.includes('稀薄')), 'rare 的「稀薄」判为大纲义');
  assert(cores.some(s => s.c.includes('少见') || s.c.includes('稀罕')), 'rare 的「少见/稀罕」判为大纲义');
  assert(rares.some(s => s.c.includes('半熟')), 'rare 的「半熟」判为生义');

  const drawer = by['drawer'];
  assert(!drawer.s.some(s => s.g === 1 && s.c.includes('开票人')), 'drawer「开票人」不再误标生义');
  assert(drawer.s.some(s => s.g === 0 && s.c.includes('抽屉')), 'drawer「抽屉」是核心义');

  const credit = by['credit'];
  const cr = credit.s.filter(s => s.g === 1);
  // 「学分」带四级标签，属于大纲要求掌握，应为核心义而非生义
  assert(!cr.some(s => s.c.includes('学分')), 'credit「学分」判为大纲义（带四级标签）');
  assert(cr.some(s => s.c.includes('补助') || s.c.includes('余额')), 'credit「补助/余额」判为生义');
  assert(cr.every(s => (s.e || []).length), 'credit 生义都带例句');
  assert(cr[0].e[0][1].match(/[\u4e00-\u9fff]/), '生义例句有中文翻译');

  const last = by['last'];
  assert(last.s.filter(s => s.g !== 1).some(s => s.c.includes('最近')), 'last「最近的」判为大纲义');

  // ---- 词库切换 ----
  const beforeList = w.document.querySelectorAll('.deck-item').length;
  $('#deck-pill').click();
  const sheet = w.document.getElementById('deck-sheet');
  assert(sheet && sheet.classList.contains('show'), '词库选择弹层打开');
  const items = w.document.querySelectorAll('#deck-sheet .deck-item');
  assert(items.length === w.KV_DECKS.length, '列出全部 ' + items.length + ' 个词库');
  const ready = [...items].filter(e => !e.classList.contains('off'));
  assert(ready.length === w.KV_DECKS.filter(d => d.ready).length,
    '可选择词库数 = 已就绪数（' + ready.length + ' 个）');
  for (const d of w.KV_DECKS) {
    assert(!!d.count, '词库 ' + d.name + ' 有词数 ' + d.count);
  }

  // ---- 过词 ----
  w.document.querySelector('.tab[data-view=study]').click();
  w.document.querySelector('.tab[data-view=home]').click();
  $('#btn-start').click();
  assert(!$('#view-study').hidden, '开始过词');
  const w1 = $('#card-word').textContent;
  $('#card').click();
  assert(!$('#card-detail').hidden, '翻卡显示释义');
  const detail = $('#card-detail').innerHTML;
  assert(detail.length > 40, '释义有内容');

  $('#markbar .mark.known').click();
  const w2 = $('#card-word').textContent;
  assert(w2 !== w1, '进入下一张');
  $('#markbar .mark.vague').click();
  $('#markbar .mark.unknown').click();
  assert($('#st-vague').textContent === '1' && $('#st-unknown').textContent === '1', '统计正确');

  // ---- 持久化 ----
  await tick(150);
  const ls = JSON.parse(w.localStorage.getItem('kv.state.v2'));
  assert(Object.keys(ls.marks).length === 3, 'localStorage 保存 3 条标记');
  assert(ls.settings.deck === 'kaoyan', '设置里记录了当前词库');

  // ---- 词表 / 导出 ----
  w.document.querySelector('.tab[data-view=list]').click();
  assert($('#list-info').textContent.includes('共'), '词表正常');
  w.document.querySelector('.tab[data-view=export]').click();
  w.document.querySelector('#chips-export .chip[data-set=marked]').click();
  assert($('#export-preview').textContent.length > 0, '导出预览有内容');

  // 生义开关
  const withRare = $('#export-preview').textContent;
  $('#exp-rare').checked = false;
  $('#exp-rare').dispatchEvent(new w.Event('change', { bubbles: true }));
  const noRare = $('#export-preview').textContent;
  $('#exp-rare').checked = true;
  $('#exp-rare').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert(withRare.length >= noRare.length, '关闭生义后导出内容变少或持平');

  assert(errs.length === 0, '无 JS 运行时错误' + (errs.length ? '：' + errs[0] : ''));

  console.log('\n词库：' + w.KV_DECKS.filter(d => d.ready).map(d => d.name + ' ' + d.count + '词').join('，'));
  console.log('含生义词：' + w.KV_WORDS.filter(x => x.y).length);
  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
