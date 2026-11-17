import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.js';
import {MAX_ATTACHMENT_BYTES} from '../worker/attachments.js';
class DB {
 constructor(){this.s=new DatabaseSync(':memory:');this.s.exec(readFileSync(new URL('../drizzle/0000_delivery_receipts.sql',import.meta.url),'utf8'));}
 prepare(sql){const make=args=>({bind:(...a)=>make(a),first:async()=>this.s.prepare(sql).get(...args),run:async()=>({meta:{changes:Number(this.s.prepare(sql).run(...args).changes)}})});return make([]);}
}
const destination={chatId:'-10099',threadId:12,description:'Test',purpose:'Offline tests',canRead:true,canSend:true,allowedCallerIds:['alice']};
const config={enabled:true,destinations:{team:destination},maxTextLength:4096,timeoutMs:1000};
const base={destination:'team',request_id:'attachment-001',filename:'报告.txt',mime_type:'text/plain',data_base64:Buffer.from('Hello 中文').toString('base64')};
const png=Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64');
function setup(fetcher=async()=>Response.json({ok:true,result:{message_id:7,chat:{id:-10099},message_thread_id:12}}),cfg=config){
 const env={DB:new DB(),TELEGRAM_BOT_TOKEN:'SECRET'},seen=[];
 const w=createWorker(cfg,async(url,o)=>{seen.push([url,o]);return fetcher(url,o);});
 const call=async(a=base,name='telegram_send_attachment',user='alice')=>{
 const r=await w.fetch(new Request('https://test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':user},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:a}})}),env);
 const b=await r.json();return b.result?JSON.parse(b.result.content[0].text):{http:r.status,...b};
 };return {call,seen,env};
}
test('multipart txt with exact bytes, filename, caption, topic and receipt',async()=>{
 const {call,seen}=setup();const a={...base,caption:'<b>报告</b>',parse_mode:'HTML'};
 assert.equal((await call(a)).status,'sent');assert.equal(seen.length,1);const [url,opts]=seen[0];assert.ok(url.endsWith('/sendDocument'));assert.equal(opts.redirect,'manual');assert.equal(opts.headers,undefined);
 const f=opts.body;assert.equal(f.get('chat_id'),'-10099');assert.equal(f.get('message_thread_id'),'12');assert.equal(f.get('caption'),a.caption);assert.equal(f.get('parse_mode'),'HTML');assert.equal(f.get('document').name,'报告.txt');assert.equal(await f.get('document').text(),'Hello 中文');assert.equal(f.get('disable_content_type_detection'),'true');
 assert.equal((await call({request_id:base.request_id},'telegram_receipt')).message_id,7);
});
test('auto chooses native photo, video, audio; document keeps originals',async()=>{
 for(const [mime,data,method] of [['image/png',png,'Photo'],['image/jpeg',Buffer.from([255,216,255,0]).toString('base64'),'Photo'],['video/mp4',Buffer.from('\0\0\0\x14ftypisom').toString('base64'),'Video'],['audio/mp4',Buffer.from('\0\0\0\x14ftypM4A ').toString('base64'),'Audio'],['audio/mpeg',Buffer.from('ID3test').toString('base64'),'Audio'],['audio/ogg',Buffer.from('OggS').toString('base64'),'Document']]){
 const {call,seen}=setup();assert.equal((await call({...base,mime_type:mime,data_base64:data})).status,'sent');assert.ok(seen[0][0].endsWith('/send'+method));
 }const {call,seen}=setup();await call({...base,mime_type:'image/png',data_base64:png,kind:'document'});assert.ok(seen[0][0].endsWith('/sendDocument'));
});
test('concurrent duplicate sends once; conflicting bytes, filename, kind, caption and target rejected',async()=>{
 const {call,seen}=setup();await Promise.all([call(),call()]);assert.equal(seen.length,1);assert.equal((await call()).duplicate,true);
 for(const diff of [{filename:'other.txt'},{data_base64:btoa('different')},{caption:'new'},{mime_type:'application/octet-stream'}])assert.match((await call({...base,...diff})).error,/different content/);assert.equal(seen.length,1);
});
test('invalid inputs and denied caller never send or claim',async()=>{
 const {call,seen,env}=setup();
 for(const diff of [{filename:'../secret'},{filename:'bad\nfile'},{filename:' '},{mime_type:'text/plain; x=1'},{mime_type:'image/png'},{data_base64:'Zh=='},{data_base64:'data:image/png;base64,AA=='},{data_base64:''},{data_base64:'AA='},{data_base64:btoa('x'.repeat(MAX_ATTACHMENT_BYTES+1))},{caption:'x'.repeat(1025)},{parse_mode:'HTML'},{caption:'x',parse_mode:'Markdown'},{kind:'voice'},{kind:'photo'},{destination:'-10099'},{url:'https://example.com/secret'}])assert.ok((await call({...base,...diff})).error);
 assert.ok((await call(base,'telegram_send_attachment','bob')).error);assert.equal(seen.length,0);assert.equal(env.DB.s.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);
});
test('unknown/rejected/malformed/redirect outcomes never retried, no secrets leaked',async()=>{
 for(const [fetcher,status] of [[()=>{throw Error('SECRET');},'unknown'],[()=>new Response(null,{status:302}),'unknown'],[()=>Response.json({ok:true,result:{message_id:7,chat:{id:5}}}),'unknown'],[()=>Response.json({ok:false,error_code:400,description:'SECRET'},{status:400}),'rejected']]){
 const {call,seen}=setup(fetcher);const result=await call();assert.equal(result.status,status);assert.ok(!JSON.stringify(result).includes('SECRET'));if(status==='unknown')assert.equal(result.do_not_retry,true);await call();assert.equal(seen.length,1);
 }
});
test('receipt save failure preserves pending claim and forbids resend',async()=>{
 const {call,seen,env}=setup();const original=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>{if(sql.startsWith('UPDATE deliveries'))throw Error('storage failed');return original(sql);};
 const r=await call();assert.equal(r.receipt_save_failed,true);assert.equal(r.status,'unknown');assert.equal((await call()).status,'pending');assert.equal(seen.length,1);
});
test('revoked permission/disabled config and changed topic respect existing receipts',async()=>{
 for(const cfg of [{...config,enabled:false},{...config,destinations:{team:{...destination,canSend:false}}}]){const {call,seen}=setup(undefined,cfg);assert.ok((await call()).error);assert.equal(seen.length,0);}
 const {call,seen}=setup();await call();destination.threadId=13;try{assert.match((await call()).error,/different content/);}finally{destination.threadId=12;}assert.equal(seen.length,1);
});
test('accepts exact decoded size boundary without regex stack exhaustion',async()=>{
 const {call,seen}=setup();const data_base64=Buffer.alloc(MAX_ATTACHMENT_BYTES,65).toString('base64');assert.equal((await call({...base,data_base64})).status,'sent');assert.equal(seen.length,1);assert.equal(seen[0][1].body.get('document').size,MAX_ATTACHMENT_BYTES);
});
