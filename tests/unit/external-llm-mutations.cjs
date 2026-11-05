'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');let killed=0;
for(const [name,needle,replacement] of [
 ['provider gate removed','if (isProvider(input)) assertEnabled();',''],
 ['loose opt-in',"process.env.TSM_EXTERNAL_LLM_OPT_IN === 'synthetic-only'","!!process.env.TSM_EXTERNAL_LLM_OPT_IN"],
 ['browser egress gate removed',"if (!enabled()) res.setHeader('Content-Security-Policy', \"connect-src 'self'\");",'']
]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'llm-gate-mutant-'));
 try{
  fs.mkdirSync(path.join(dir,'server'),{recursive:true});fs.mkdirSync(path.join(dir,'tests/unit'),{recursive:true});
  const src=fs.readFileSync(path.join(root,'server/external-llm-policy.js'),'utf8');assert.equal(src.split(needle).length,2);
  fs.writeFileSync(path.join(dir,'server/external-llm-policy.js'),src.replace(needle,replacement));
  fs.copyFileSync(path.join(__dirname,'external-llm-policy.test.cjs'),path.join(dir,'tests/unit/external-llm-policy.test.cjs'));
  const r=spawnSync(process.execPath,['--test',path.join(dir,'tests/unit/external-llm-policy.test.cjs')],{encoding:'utf8',timeout:15000});
  assert.equal(r.signal,null);assert.notEqual(r.status,0,name+' survived');assert.match(r.stdout+r.stderr,/ERR_ASSERTION|AssertionError/);killed++;console.log('KILLED '+name);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
console.log(JSON.stringify({killed,total:3}));
