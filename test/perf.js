const fs=require('fs');
function bench(file){
  const t0=process.hrtime.bigint();
  const src=fs.readFileSync(file,'utf8');
  const t1=process.hrtime.bigint();
  const iW=src.indexOf('window.KV_WORDS=');
  const wordsSrc=src.slice(iW+'window.KV_WORDS='.length).replace(/;\s*$/,'');
  const arr=JSON.parse(wordsSrc);
  const t2=process.hrtime.bigint();
  // 模拟首屏需要的遍历
  let senses=0, base=0;
  for(const x of arr){ if(x.s) senses+=x.s.length; if(x.k==='b') base++; }
  const t3=process.hrtime.bigint();
  const ms=(a,b)=>Number(b-a)/1e6;
  console.log(file);
  console.log('  体积      ', (fs.statSync(file).size/1e6).toFixed(1)+' MB');
  console.log('  读文件    ', ms(t0,t1).toFixed(0)+' ms');
  console.log('  JSON 解析 ', ms(t1,t2).toFixed(0)+' ms');
  console.log('  遍历统计  ', ms(t2,t3).toFixed(0)+' ms');
  console.log('  词条      ', arr.length, '(大纲', base+')  义项', senses);
}
bench('dist/site/data.js');
