import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/package-private-plugin.mjs');
test('private packager only includes client credential, restricts files and permissions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tg-package-test-'));try{
  const key='p'.repeat(43),bot='fake-bot-token-never-include';const input=join(dir,'input'),out=join(dir,'out');
  await writeFile(input,`PUBLIC_ORIGIN=https://example.test\nMCP_CLIENT_KEY=${key}\nTELEGRAM_BOT_TOKEN=${bot}\nUNRELATED_SECRET=fake-other-secret\n`);
  const run=spawnSync(process.execPath,[script,'--env-file',input,'--output-dir',out],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.ok(!run.stdout.includes(key));assert.ok(!run.stderr.includes(key));
  const archive=join(out,'telegram-mcp-private.tar.gz');assert.equal((await stat(archive)).mode&0o777,0o600);
  const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8'}).stdout;assert.ok(!listing.includes('.env'));assert.ok(!listing.includes('clients.js'));
  const manifest=spawnSync('tar',['-xOzf',archive,'telegram-selfhost/mcp.json'],{encoding:'utf8'}).stdout;assert.equal(JSON.parse(manifest).mcpServers.telegram.url,`https://example.test/mcp/${key}`);assert.equal(JSON.parse(manifest).mcpServers.telegram.extensions['com.openai'].auth.type,'none');
  const all=spawnSync('tar',['-xOzf',archive],{encoding:'utf8'}).stdout;assert.ok(!all.includes(bot));assert.ok(!all.includes('fake-other-secret'));assert.deepEqual(await readdir(out),['telegram-mcp-private.tar.gz']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('packager rejects secret URL, mismatch formats and avoids echoing values',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tg-package-test-'));try{
  for(const origin of ['http://example.test','https://example.test/path','https://example.test/?secret=hidden','https://user:password@example.test','https://example.test/']){
   const input=join(dir,'input');await writeFile(input,`PUBLIC_ORIGIN=${origin}\nMCP_CLIENT_KEY=${'p'.repeat(43)}\n`);
   const r=spawnSync(process.execPath,[script,'--env-file',input,'--output-dir',join(dir,'out')],{encoding:'utf8'});assert.equal(r.status,1);assert.ok(!r.stderr.includes(origin));
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
