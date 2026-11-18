import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.js';
const config={enabled:true,destinations:{owner:{chatId:'1234',description:'Owner',purpose:'Tests',canRead:true,canSend:true,allowedCallerIds:['alice']},team:{chatId:'-10099',threadId:12,description:'Team',purpose:'Tests',canRead:true,canSend:true,allowedCallerIds:['bob']}},maxTextLength:4096,timeoutMs:1000};
class DB {
 rows=new Map();
 prepare(sql){return {bind:(...args)=>({first:async()=>this.rows.get(args[0]+':'+args[1])??null,run:async()=>{
 if(sql.startsWith('INSERT')){const [owner,id,fingerprint,created_at,updated_at]=args;const k=owner+':'+id;if(this.rows.has(k))return {meta:{changes:0}};this.rows.set(k,{owner,id,fingerprint,status:'pending',created_at,updated_at});return {meta:{changes:1}};}
 const [status,message_id,updated_at,owner,id]=args;Object.assign(this.rows.get(owner+':'+id),{status,message_id,updated_at});return {meta:{changes:1}};
 }})};}
}
function req(name,args={},user='alice'){return new Request('https://example.test/mcp',{method:'POST',headers:{'content-type':'application/json',...(user?{'oai-authenticated-user-id':user}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});}
const payload={destination:'owner',text:'Hello',request_id:'request-001'};
const parse=async r=>{const j=await r.json();return j.result?JSON.parse(j.result.content[0].text):j;};
test('no caller identity fails closed',async()=>assert.equal((await createWorker(config).fetch(req('telegram_status',{},''),{})).status,401));
test('status filters destinations and never returns secret',async()=>{const x=await parse(await createWorker(config).fetch(req('telegram_status'),{TELEGRAM_BOT_TOKEN:'SECRET'}));assert.deepEqual(x.destinations.map(x=>x.alias),['owner']);assert.equal(JSON.stringify(x).includes('SECRET'),false);});
test('unconfigured sends do not touch network',async()=>{let n=0;const w=createWorker({...config,enabled:false},()=>{n++;});const x=await parse(await w.fetch(req('telegram_send',payload),{DB:new DB(),TELEGRAM_BOT_TOKEN:'SECRET'}));assert.match(x.error,/not configured/);assert.equal(n,0);});
test('cross-caller destinations and raw IDs rejected',async()=>{let n=0;const w=createWorker(config,()=>{n++;});for(const p of [{...payload,destination:'team'},{...payload,chat_id:'1234'},{...payload,destination:'1234'}]){const x=await parse(await w.fetch(req('telegram_send',p),{DB:new DB(),TELEGRAM_BOT_TOKEN:'SECRET'}));assert.ok(x.error);}assert.equal(n,0);});
test('concurrent duplicate sends once; reuse with changed content fails',async()=>{let n=0;const db=new DB();const w=createWorker(config,async(url,opts)=>{n++;assert.equal(url,'https://api.telegram.org/botSECRET/sendMessage');assert.equal(opts.redirect,'manual');assert.deepEqual(JSON.parse(opts.body),{chat_id:'1234',text:'Hello',link_preview_options:{is_disabled:true}});return Response.json({ok:true,result:{message_id:7,chat:{id:1234}}});});const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};await Promise.all([w.fetch(req('telegram_send',payload),env),w.fetch(req('telegram_send',payload),env)]);assert.equal(n,1);const x=await parse(await w.fetch(req('telegram_send',payload),env));assert.equal(x.message_id,7);assert.equal(x.duplicate,true);const y=await parse(await w.fetch(req('telegram_send',{...payload,text:'Changed'}),env));assert.match(y.error,/different content/);assert.equal(n,1);});
test('unknown network outcome is persisted, never blindly retried',async()=>{let n=0;const db=new DB();const w=createWorker(config,async()=>{n++;throw Error('secret-bearing-url');});const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};const x=await parse(await w.fetch(req('telegram_send',payload),env));assert.equal(x.status,'unknown');assert.equal(x.do_not_retry,true);await w.fetch(req('telegram_send',payload),env);assert.equal(n,1);assert.equal(JSON.stringify(x).includes('secret'),false);});
test('receipts isolated by caller',async()=>{const db=new DB();const w=createWorker(config,async()=>Response.json({ok:true,result:{message_id:7,chat:{id:1234}}}));const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};await w.fetch(req('telegram_send',payload),env);assert.equal((await parse(await w.fetch(req('telegram_receipt',{request_id:payload.request_id},'bob'),env))).status,'not_found');});
test('Telegram rejection sanitized and persisted',async()=>{const w=createWorker(config,async()=>Response.json({ok:false,error_code:403,description:'sensitive detail'},{status:403}));const x=await parse(await w.fetch(req('telegram_send',payload),{DB:new DB(),TELEGRAM_BOT_TOKEN:'SECRET'}));assert.equal(x.status,'rejected');assert.equal(x.telegram_error_code,403);assert.equal(JSON.stringify(x).includes('sensitive'),false);});
test('request body is bounded while streaming, before JSON parsing',async()=>{let cancelled=false;const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(17000));},cancel(){cancelled=true;}});const r=new Request('https://example.test/mcp',{method:'POST',duplex:'half',headers:{'content-type':'application/json','oai-authenticated-user-id':'alice'},body:stream});assert.equal((await createWorker(config).fetch(r,{})).status,413);assert.equal(cancelled,true);});

test('redirect response is never parsed or followed, and ambiguous send stays unknown',async()=>{let n=0,parsed=false;const db=new DB();const w=createWorker(config,async(url,opts)=>{n++;assert.equal(opts.redirect,'manual');return {status:302,json:()=>{parsed=true;throw Error('redirect body must not be read');}};});const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};const x=await parse(await w.fetch(req('telegram_send',payload),env));assert.equal(x.status,'unknown');assert.equal(x.do_not_retry,true);await w.fetch(req('telegram_send',payload),env);assert.equal(n,1);assert.equal(parsed,false);});

test('format capabilities advertised in status and tools schema',async()=>{
 const w=createWorker(config);const status=await parse(await w.fetch(req('telegram_status'),{}));
 assert.equal(status.plain_text_only,false);assert.equal(status.default_format,'plain_text');assert.deepEqual(status.supported_parse_modes,['HTML','MarkdownV2']);
 const r=req('telegram_status');const body=await r.json();body.method='tools/list';
 const result=await (await w.fetch(new Request(r.url,{method:'POST',headers:r.headers,body:JSON.stringify(body)}),{})).json();
 const schema=result.result.tools.find(x=>x.name==='telegram_send').inputSchema;
 assert.equal(result.result.tools.find(x=>x.name==='telegram_edit').annotations.destructiveHint,true);
 assert.deepEqual(schema.properties.parse_mode.enum,['HTML','MarkdownV2']);assert.equal(schema.required.includes('parse_mode'),false);
});
test('HTML and MarkdownV2 forwarded unchanged including Unicode, URLs, and topic',async()=>{
 for(const [parse_mode,text] of [['HTML','😀 <b>中文 &amp; 更新</b> <a href="https://example.com/?a=1&amp;b=2">来源</a>'],['MarkdownV2','😀 *中文* [来源](https://example.com/path) \\!']]){
 let n=0;const w=createWorker(config,async(url,opts)=>{n++;assert.deepEqual(JSON.parse(opts.body),{chat_id:'-10099',message_thread_id:12,text,parse_mode,link_preview_options:{is_disabled:true}});return Response.json({ok:true,result:{message_id:9,chat:{id:-10099},message_thread_id:12}});});
 const x=await parse(await w.fetch(req('telegram_send',{...payload,destination:'team',text,parse_mode},'bob'),{DB:new DB(),TELEGRAM_BOT_TOKEN:'SECRET'}));assert.equal(x.status,'sent');assert.equal(n,1);
 }
});
test('invalid parse modes and raw entities rejected before network or receipt writes',async()=>{
 let n=0;const db=new DB();const w=createWorker(config,()=>{n++;});
 for(const fields of [{parse_mode:null},{parse_mode:''},{parse_mode:'Markdown'},{parse_mode:'html'},{parse_mode:1},{parse_mode:{}},{entities:[]}]){
 const x=await parse(await w.fetch(req('telegram_send',{...payload,...fields}),{DB:db,TELEGRAM_BOT_TOKEN:'SECRET'}));assert.ok(x.error);
 }assert.equal(n,0);assert.equal(db.rows.size,0);
});
test('legacy plain receipt is unchanged; formatting changes cannot reuse its ID',async()=>{
 let n=0;const db=new DB();const legacy=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['1234',null,payload.text]))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 db.rows.set('alice:'+payload.request_id,{id:payload.request_id,fingerprint:legacy,status:'sent',message_id:77});
 const w=createWorker(config,()=>{n++;});const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};
 const x=await parse(await w.fetch(req('telegram_send',payload),env));assert.equal(x.duplicate,true);assert.equal(x.message_id,77);
 for(const parse_mode of ['HTML','MarkdownV2'])assert.match((await parse(await w.fetch(req('telegram_send',{...payload,parse_mode}),env))).error,/different content/);
 assert.equal(n,0);
});
test('formatted concurrent duplicate sends once; format removal and change are conflicts',async()=>{
 let n=0;const db=new DB();const w=createWorker(config,async()=>{n++;return Response.json({ok:true,result:{message_id:8,chat:{id:1234}}});});const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};const html={...payload,parse_mode:'HTML'};
 await Promise.all([w.fetch(req('telegram_send',html),env),w.fetch(req('telegram_send',html),env)]);assert.equal(n,1);
 for(const p of [payload,{...payload,parse_mode:'MarkdownV2'}])assert.match((await parse(await w.fetch(req('telegram_send',p),env))).error,/different content/);
 assert.equal(n,1);
});
test('format parsing rejection is persisted without fallback or error body disclosure',async()=>{
 let n=0;const db=new DB();const w=createWorker(config,async()=>{n++;return Response.json({ok:false,error_code:400,description:'private content invalid HTML'},{status:400});});const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};const p={...payload,parse_mode:'HTML',text:'<b>unclosed'};
 const x=await parse(await w.fetch(req('telegram_send',p),env));assert.equal(x.status,'rejected');assert.equal(x.telegram_error_code,400);assert.equal(JSON.stringify(x).includes('private'),false);
 assert.equal((await parse(await w.fetch(req('telegram_send',p),env))).duplicate,true);assert.equal(n,1);
});
test('formatting does not bypass permission or text limits',async()=>{
 let n=0;const db=new DB();const w=createWorker(config,async()=>{n++;return Response.json({ok:true,result:{message_id:2,chat:{id:1234}}});});const env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'};
 for(const p of [{...payload,destination:'team',parse_mode:'HTML'},{...payload,text:'x'.repeat(4097),parse_mode:'HTML'},{...payload,text:'   ',parse_mode:'MarkdownV2'}])assert.ok((await parse(await w.fetch(req('telegram_send',p),env))).error);
 assert.equal(db.rows.size,0);assert.equal(n,0);
 assert.equal((await parse(await w.fetch(req('telegram_send',{...payload,text:'x'.repeat(4096),parse_mode:'HTML'}),env))).status,'sent');assert.equal(n,1);
});
