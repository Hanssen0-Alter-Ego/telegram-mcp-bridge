import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../worker/index.js';
class DB {
 constructor(){this.s=new DatabaseSync(':memory:');for(const p of ['0000_delivery_receipts','0004_message_edits'])this.s.exec(readFileSync(new URL(`../drizzle/${p}.sql`,import.meta.url),'utf8'));}
 prepare(sql){const make=args=>({bind:(...a)=>make(a),first:async()=>this.s.prepare(sql).get(...args),run:async()=>({meta:{changes:Number(this.s.prepare(sql).run(...args).changes)}})});return make([]);}
 async batch(items){this.s.exec('BEGIN');try{const r=[];for(const i of items)r.push(await i.run());this.s.exec('COMMIT');return r;}catch(e){this.s.exec('ROLLBACK');throw e;}}
}
const dest={chatId:'-10099',threadId:12,description:'Team',purpose:'Tests',canRead:true,canSend:true,allowedCallerIds:['alice','bob']};
const config={enabled:true,destinations:{team:dest,other:{...dest,chatId:'-10098'},topic:{...dest,threadId:13}},maxTextLength:4096,timeoutMs:1000};
const send={destination:'team',text:'Old report 😀',request_id:'original-001'};
const edit={destination:'team',original_request_id:send.request_id,original_text:send.text,text:'<b>新简报 😀</b>',parse_mode:'HTML',request_id:'edit-0001'};
async function call(w,env,args,name='telegram_edit',user='alice'){
 const r=await w.fetch(new Request('https://bridge.test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':user},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);
 return JSON.parse((await r.json()).result.content[0].text);
}
async function setup(editFetch=async()=>Response.json({ok:true,result:{message_id:7,chat:{id:-10099}}}),original=send){
 const db=new DB(),env={DB:db,TELEGRAM_BOT_TOKEN:'SECRET'},seen=[];
 const w=createWorker(config,async(url,opts)=>{if(url.endsWith('/sendMessage'))return Response.json({ok:true,result:{message_id:7}});seen.push([url,opts]);return editFetch(url,opts);});
 assert.equal((await call(w,env,original,'telegram_send')).status,'sent');return {w,env,db,seen};
}
test('old send proof enables edit, then later edits omit proof and default to plain',async()=>{
 const {w,env,db,seen}=await setup();const result=await call(w,env,edit);assert.equal(result.status,'sent');assert.equal(result.operation,'edit');
 assert.ok(seen[0][0].endsWith('/editMessageText'));assert.equal(seen[0][1].redirect,'manual');
 assert.deepEqual(JSON.parse(seen[0][1].body),{chat_id:'-10099',message_id:7,text:edit.text,parse_mode:'HTML',link_preview_options:{is_disabled:true}});
 const next={destination:'team',original_request_id:send.request_id,request_id:'edit-0002',text:'Plain'};assert.equal((await call(w,env,next)).status,'sent');assert.equal(Object.hasOwn(JSON.parse(seen[1][1].body),'parse_mode'),false);
 assert.equal(db.s.prepare('SELECT active_edit_id FROM edit_targets').get().active_edit_id,null);
 assert.equal((await call(w,env,{request_id:edit.request_id},'telegram_receipt')).status,'sent');
});
test('formatted original proof requires matching mode, and supports MarkdownV2 edit',async()=>{
 const original={...send,text:'<b>Old</b>',parse_mode:'HTML'};const {w,env,seen}=await setup(undefined,original);
 assert.match((await call(w,env,{...edit,original_text:original.text})).error,/does not match/);
 assert.equal((await call(w,env,{...edit,original_text:original.text,original_parse_mode:'HTML',text:'*更新*',parse_mode:'MarkdownV2'})).status,'sent');assert.equal(seen.length,1);
});
test('cross-caller, wrong chat/topic/body, missing receipt/proof, and raw IDs never edit',async()=>{
 const {w,env,seen,db}=await setup();
 for(const args of [{...edit,destination:'other'},{...edit,destination:'topic'},{...edit,original_text:'wrong'},{...edit,original_request_id:'missing-000'},{...edit,original_text:undefined},{...edit,message_id:7},{...edit,parse_mode:null},{...edit,original_parse_mode:'Markdown'},{...edit,request_id:send.request_id}])assert.ok((await call(w,env,args)).error);
 assert.ok((await call(w,env,edit,'telegram_edit','bob')).error);assert.equal(seen.length,0);assert.equal(db.s.prepare('SELECT COUNT(*) n FROM edit_targets').get().n,0);
});
test('non-sent original receipts cannot be edited',async()=>{
 const {w,env,db,seen}=await setup();for(const status of ['unknown','pending','rejected']){db.s.prepare('UPDATE deliveries SET status=?').run(status);assert.ok((await call(w,env,edit)).error);}assert.equal(seen.length,0);
});
test('destination reassignment and revoked send permission fail even after proof cached',async()=>{
 const {w,env,seen}=await setup();await call(w,env,edit);
 for(const d of [{...dest,chatId:'-10088'},{...dest,threadId:99},{...dest,canSend:false}]){
 const changed=createWorker({...config,destinations:{team:d}},()=>{throw Error('must not call');});assert.ok((await call(changed,env,{...edit,original_text:undefined,request_id:'edit-0002'})).error);
 }assert.equal(seen.length,1);
});
test('same edit request is idempotent; changed text or format cannot reuse it',async()=>{
 const {w,env,seen}=await setup();const results=await Promise.all([call(w,env,edit),call(w,env,edit)]);assert.equal(seen.length,1);assert.ok(results.some(x=>x.status==='sent'));assert.equal((await call(w,env,edit)).duplicate,true);
 for(const args of [{...edit,text:'different'},{...edit,parse_mode:undefined}])assert.match((await call(w,env,args)).error,/different content/);assert.equal(seen.length,1);
});
test('distinct concurrent edits are serialized; unknown outcome retains lock',async()=>{
 let resolve;const blocker=new Promise(r=>resolve=r);const {w,env,seen,db}=await setup(async()=>{await blocker;throw Error('SECRET URL');});
 const first=call(w,env,edit);while(seen.length===0)await new Promise(r=>setTimeout(r,1));
 const second=await call(w,env,{...edit,request_id:'edit-0002'});assert.equal(second.status,'rejected');assert.match(second.error,/pending or unknown/);assert.equal(seen.length,1);
 resolve();const x=await first;assert.equal(x.status,'unknown');assert.equal(x.do_not_retry,true);assert.equal(JSON.stringify(x).includes('SECRET'),false);
 assert.equal(db.s.prepare('SELECT active_edit_id FROM edit_targets').get().active_edit_id,edit.request_id);
 assert.equal((await call(w,env,edit)).duplicate,true);assert.equal((await call(w,env,{...edit,request_id:'edit-0003'})).status,'rejected');assert.equal(seen.length,1);
});
test('Telegram rejection is sanitized, saved, and releases edit lock',async()=>{
 const {w,env,seen,db}=await setup(async()=>Response.json({ok:false,error_code:400,description:'SECRET parse error'},{status:400}));
 const x=await call(w,env,edit);assert.equal(x.status,'rejected');assert.equal(x.telegram_error_code,400);assert.equal(JSON.stringify(x).includes('SECRET'),false);assert.equal(db.s.prepare('SELECT active_edit_id FROM edit_targets').get().active_edit_id,null);
 await call(w,env,edit);assert.equal(seen.length,1);await call(w,env,{...edit,request_id:'edit-0002'});assert.equal(seen.length,2);
});
test('redirect, malformed response, or wrong returned message stays unknown',async()=>{
 for(const response of [()=>new Response(null,{status:302}),()=>new Response('not json'),()=>Response.json({ok:true,result:{message_id:8,chat:{id:-10099}}}),()=>Response.json({ok:true,result:{message_id:7,chat:{id:-10098}}})]){
 const {w,env,db}=await setup(response);assert.equal((await call(w,env,edit)).status,'unknown');assert.equal(db.s.prepare('SELECT active_edit_id FROM edit_targets').get().active_edit_id,edit.request_id);
 }
});
test('receipt-save failure leaves pending receipt and edit lock, never retries',async()=>{
 const {w,env,db,seen}=await setup();db.batch=async()=>{throw Error('failed save');};const x=await call(w,env,edit);assert.equal(x.status,'unknown');assert.equal(x.receipt_save_failed,true);assert.equal(db.s.prepare('SELECT active_edit_id FROM edit_targets').get().active_edit_id,edit.request_id);
 assert.equal((await call(w,env,edit)).status,'pending');assert.equal(seen.length,1);
});
test('edit receipt cannot become an editable source, and cannot be replayed as send',async()=>{
 const {w,env,seen}=await setup();await call(w,env,edit);
 assert.ok((await call(w,env,{...edit,original_request_id:edit.request_id,original_text:edit.text,original_parse_mode:'HTML',request_id:'edit-0002'})).error);
 assert.match((await call(w,env,{...send,request_id:edit.request_id},'telegram_send')).error,/different content/);assert.equal(seen.length,1);
});
