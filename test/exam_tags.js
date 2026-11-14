const fs=require('fs');
global.window={};
eval(fs.readFileSync('www/decks/kaoyan.js','utf8'));
const W=window.KV_DECK_WORDS;
const by={}; W.forEach(x=>by[x.w]=x);
const t=[];
function c(w){ const x=by[w]; return x&&x.et?x.et:null; }
for(const w of ['credit','credibility','incredible','abandon','steel','intrinsic']){
  t.push([w,c(w)]);
}
let fail=0;
for(const [w,et] of t){
  if(!et){ console.log('✗',w,'无标签'); fail++; }
  else console.log('✓',w,'→',et.join('/'));
}
const withTag=W.filter(x=>x.et&&x.et.length).length;
console.log(`\n有考试标签: ${withTag}/${W.length} (${(withTag/W.length*100).toFixed(1)}%)`);
process.exit(fail?1:0);
