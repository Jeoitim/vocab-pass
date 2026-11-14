const fs=require('fs');
const {JSDOM}=require('jsdom');
const fakeIDB=require('fake-indexeddb');
const src=fs.readFileSync('dist/VocabPass.html','utf8');
const dom=new JSDOM(src,{runScripts:'dangerously',url:'https://x.test/',pretendToBeVisual:true,
  beforeParse(w){ w.scrollTo=()=>{}; w.indexedDB=new fakeIDB.IDBFactory(); w.IDBKeyRange=fakeIDB.IDBKeyRange;
    w.speechSynthesis=undefined; }});
setTimeout(()=>{
  const d=dom.window.document;
  const q=s=>d.querySelector(s);
  const W=dom.window.KV_WORDS||[];
  let ok=0,bad=0;
  const t=(c,m)=>{ if(c){console.log('✓',m);ok++;} else {console.error('✗',m);bad++;} };
  t(W.length>12000,'单文件内联词库 '+W.length+' 词');
  t(q('#home-done').textContent==='0','首页渲染');
  q('#btn-start').click();
  t(!q('#view-study').hidden,'开始过词');
  const w1=q('#card-word').textContent;
  q('#card').click();
  t(!q('#card-detail').hidden,'翻卡显示释义');
  t(q('#card-detail').innerHTML.includes('大纲释义')||q('#card-detail').innerHTML.includes('释义'),'释义区块渲染');
  q('#markbar .mark.unknown').click();
  t(dom.window.localStorage.getItem('kv.state.v2').includes('"marks"'),'localStorage 已写入');
  console.log(bad?`\n${bad} 项失败`:'\n单文件版全部通过');
  process.exit(bad?1:0);
},800);
