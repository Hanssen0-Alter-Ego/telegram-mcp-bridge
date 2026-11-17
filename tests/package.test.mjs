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
  const extractJson=path=>JSON.parse(spawnSync('tar',['-xOzf',archive,'telegram-selfhost/'+path],{encoding:'utf8'}).stdout);
  const portable=extractJson('plugin.json'),legacy=extractJson('.codex-plugin/plugin.json');
  assert.equal(portable.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(extractJson('mcp.json').$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(legacy.interface,portable.extensions['com.openai'].interface);
  assert.equal(legacy.name,portable.name);assert.equal(legacy.version,portable.version);
  for(const field of ['displayName','shortDescription','longDescription','developerName','category','defaultPrompt','logo','composerIcon'])assert.ok(typeof legacy.interface[field]==='string'&&legacy.interface[field].trim(),field);
  assert.ok(legacy.interface.shortDescription.length<=30);
  assert.equal(legacy.interface.category,'Communication');
  assert.equal(legacy.interface.logo,'./assets/icon.svg');
  assert.equal(legacy.interface.composerIcon,legacy.interface.logo);
  const icon=spawnSync('tar',['-xOzf',archive,'telegram-selfhost/assets/icon.svg'],{encoding:'utf8'});
  assert.equal(icon.status,0);assert.match(icon.stdout,/width="256" height="256"/);
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

test('bearer package has required nonblank presentation metadata',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tg-bearer-package-'));try{
  const run=spawnSync(process.execPath,[resolve('scripts/make-plugin.mjs'),'https://example.test/mcp'],{cwd:dir,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(await readFile(join(dir,'telegram-mcp-plugin/plugin.json'),'utf8'));
  const ui=manifest.extensions['com.openai'].interface;
  for(const field of ['displayName','shortDescription','longDescription','developerName','category','defaultPrompt','logo','composerIcon'])assert.ok(typeof ui[field]==='string'&&ui[field].trim(),field);
  assert.ok(ui.shortDescription.length<=30);
  assert.equal(manifest.author.name,ui.developerName);
  assert.match(await readFile(join(dir,'telegram-mcp-plugin/assets/icon.svg'),'utf8'),/width="256" height="256"/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
