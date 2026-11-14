// 测试词库切换：加载分片、标记隔离、考试标签
const fs=require('fs');
const {JSDOM}=require('jsdom');
const fakeIDB=require('fake-indexeddb');
const html=fs.readFileSync('www/index.html','utf8')
  .replace('<script src="data.js"></script>','')
  .replace('<script src="app.js"></script>','');
let fails=0;
const t=(c,m)=>{ if(!c){console.error('✗',m);fails++;} else console.log('✓',m); };

const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://x.test/',pretendToBeVisual:true});
const w=dom.window;
w.scrollTo=()=>{}; w.indexedDB=new fakeIDB.IDBFactory(); w.IDBKeyRange=fakeIDB.IDBKeyRange;
// 模拟脚本加载：decks/xxx.js
const origCreate=w.document.createElement.bind(w.document);
w.document.createElement=function(tag){
  const el=origCreate(tag);
  if(tag==='script'){
    Object.defineProperty(el,'src',{
      set(v){
        el._src=v;
        setTimeout(()=>{
          const f=v.replace('./','');
          if(fs.existsSync('www/'+f)){
            w.eval(fs.readFileSync('www/'+f,'utf8'));
            el.onload && el.onload();
          } else { el.onerror && el.onerror(new Error('404')); }
        },10);
      }, get(){ return el._src; }
    });
  }
  return el;
};
w.eval(fs.readFileSync('www/data.js','utf8'));
w.eval(fs.readFileSync('www/app.js','utf8'));

(async()=>{
  await new Promise(r=>setTimeout(r,600));
  const $=s=>w.document.querySelector(s);
  t($('#deck-name').textContent==='考研英语','初始词库为考研');
  t($('#home-total').textContent.includes('12818'),'考研 12818 词');

  // 打开选择器
  $('#deck-pill').click();
  await new Promise(r=>setTimeout(r,50));
  const items=[...w.document.querySelectorAll('#deck-sheet .deck-item')];
  t(items.length===6,`列出 6 个词库`);
  const ready=items.filter(e=>!e.classList.contains('off'));
  t(ready.length===6,'六个词库都可用（没有待扩充）');

  // 切到四级
  const cet4=items.find(e=>e.dataset.id==='cet4');
  cet4.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,500));
  t($('#deck-name').textContent==='四级','切换到四级');
  t(/1131|11312/.test($('#home-total').textContent),'四级词数更新: '+$('#home-total').textContent);

  // 过词验证
  $('#btn-start').click();
  await new Promise(r=>setTimeout(r,50));
  t(!$('#view-study').hidden,'四级可开始过词');
  const w1=$('#card-word').textContent;
  t(w1.length>0,'显示单词: '+w1);
  const et=$('#card-exam').textContent.trim();
  t(et.length>0,'显示考试标签: '+et);

  // 标记
  $('#card').click();
  $('#markbar .mark.known').click();
  await new Promise(r=>setTimeout(r,100));
  const ls=JSON.parse(w.localStorage.getItem('kv.state.v2'));
  const marked=Object.keys(ls.marks).length;
  t(marked===1,'标记已保存');
  t(ls.settings.deck==='cet4','记住了当前词库');

  // 切回考研，标记应保留
  $('#deck-pill').click();
  await new Promise(r=>setTimeout(r,50));
  const k=[...w.document.querySelectorAll('#deck-sheet .deck-item')].find(e=>e.dataset.id==='kaoyan');
  k.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,500));
  t($('#deck-name').textContent==='考研英语','切回考研');
  const ls2=JSON.parse(w.localStorage.getItem('kv.state.v2'));
  t(Object.keys(ls2.marks).length===1,'切换后标记仍保留');

  console.log(fails?`\n${fails} 项失败`:'\n全部通过');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
