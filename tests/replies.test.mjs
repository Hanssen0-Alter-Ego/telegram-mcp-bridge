import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../worker/index.js';
class DB {
 constructor(){this.s=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())this.s.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));}
 prepare(sql){const make=args=>({bind:(...a)=>make(a),first:async()=>this.s.prepare(sql).get(...args),all:async()=>({results:this.s.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(this.s.prepare(sql).run(...args).changes)}})});return make([]);}
 async batch(items){this.s.exec('BEGIN');try{const out=[];for(const i of items)out.push(await i.run());this.s.exec('COMMIT');return out;}catch(e){this.s.exec('ROLLBACK');throw e;}}
}
const dest={chatId:'-10099',threadId:12,description:'Test',purpose:'Offline',canRead:true,canSend:true,allowedCallerIds:['alice','bob']};
const config={enabled:true,maxTextLength:4096,timeoutMs:1000,destinations:{team:dest,other:{...dest,chatId:'-10098'},topic:{...dest,threadId:13},sendonly:{...dest,canRead:false}}};
const send={destination:'team',request_id:'original-001',text:'original'};
const reply={destination:'team',request_id:'reply-0001',text:'reply',reply_to:{request_id:send.request_id}};
const file={destination:'team',request_id:'file-0001',filename:'test.txt',mime_type:'text/plain',data_base64:btoa('file')};
function setup(){
 const db=new DB(),env={DB:db,TELEGRAM_BOT_TOKEN:'FAKE'},seen=[];let response;
 const w=createWorker(config,async(url,o)=>{seen.push([url,o]);if(response)return response(url,o);if(url.endsWith('/getWebhookInfo'))return Response.json({ok:true,result:{url:''}});if(url.endsWith('/getUpdates'))return Response.json({ok:true,result:[{update_id:1,message:{message_id:55,chat:{id:-10099},message_thread_id:12,text:'untrusted',date:1}}]});return Response.json({ok:true,result:{message_id:7,chat:{id:-10099},message_thread_id:12}});});
 const call=async(a,name='telegram_send',user='alice')=>{const r=await w.fetch(new Request('https://test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':user},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:a}})}),env);return JSON.parse((await r.json()).result.content[0].text);};
 return {db,call,seen,setResponse:f=>response=f};
}
test('reply to own text and attachment receipts; persisted target; reply can itself be edited and replied to',async()=>{
 const {call,seen}=setup();assert.equal((await call(send)).status,'sent');
 assert.equal((await call(reply)).status,'sent');assert.deepEqual(JSON.parse(seen[1][1].body).reply_parameters,{message_id:7,allow_sending_without_reply:false});
 assert.deepEqual((await call({request_id:reply.request_id},'telegram_receipt')).reply_to,{message_id:7,request_id:send.request_id});
 assert.equal((await call({...reply,request_id:'reply-0002',reply_to:{request_id:reply.request_id}})).status,'sent');
 assert.equal((await call({destination:'team',request_id:'edit-0001',original_request_id:reply.request_id,original_text:reply.text,text:'edited'},'telegram_edit')).status,'sent');
 assert.equal((await call(file,'telegram_send_attachment')).status,'sent');assert.equal((await call({...reply,request_id:'reply-file',reply_to:{request_id:file.request_id}})).status,'sent');
});
test('read target supports text and multipart; arbitrary or wrong-topic IDs never send',async()=>{
 const {call,seen}=setup();const read=await call({destination:'team'},'telegram_read');assert.equal(read.messages[0].message_id,55);
 const r={...reply,reply_to:{message_id:55}};assert.equal((await call(r)).status,'sent');
 assert.equal((await call({...file,reply_to:r.reply_to},'telegram_send_attachment')).status,'sent');assert.deepEqual(JSON.parse(seen.at(-1)[1].body.get('reply_parameters')),{message_id:55,allow_sending_without_reply:false});
 const count=seen.length;
 for(const diff of [{destination:'other'},{destination:'topic'},{destination:'sendonly'},{reply_to:{message_id:999}},{reply_to:{message_id:55,chat_id:'-10099'}}])assert.ok((await call({...r,request_id:'invalid-01',...diff})).error);
 assert.equal(seen.length,count);
});
test('receipt targets reject another owner, destination/topic, unsent/edit receipts and malformed references',async()=>{
 const {call,seen,db}=setup();await call(send);const count=seen.length;
 for(const diff of [{destination:'other'},{destination:'topic'},{reply_to:{request_id:'missing-001'}},{reply_to:{request_id:send.request_id,message_id:7}},{reply_to:{}},{reply_to:null},{reply_to:{message_id:0}},{reply_to:{request_id:send.request_id,original_text:'ignored?'}}])assert.ok((await call({...reply,...diff})).error);
 assert.ok((await call(reply,'telegram_send','bob')).error);
 for(const status of ['pending','unknown','rejected']){db.s.prepare('UPDATE deliveries SET status=?').run(status);assert.ok((await call(reply)).error);}
 db.s.exec("UPDATE deliveries SET status='sent',send_kind=NULL,fingerprint='edit fingerprint'");assert.ok((await call(reply)).error);assert.equal(seen.length,count);
});
test('legacy text receipt requires exact proof, legacy verified edits work; old attachment cannot be guessed',async()=>{
 const {call,db}=setup();await call({...send,text:'<b>old</b>',parse_mode:'HTML'});db.s.exec('UPDATE deliveries SET send_kind=NULL,send_chat_id=NULL,send_topic_id=NULL');
 assert.ok((await call(reply)).error);assert.ok((await call({...reply,reply_to:{request_id:send.request_id,original_text:'wrong'}})).error);
 assert.equal((await call({...reply,reply_to:{request_id:send.request_id,original_text:'<b>old</b>',original_parse_mode:'HTML'}})).status,'sent');
 db.s.prepare('INSERT INTO edit_targets(owner,original_request_id,chat_id,topic_id,message_id) VALUES(?,?,?,?,?)').run('alice',send.request_id,'-10099',12,7);
 assert.equal((await call({...reply,request_id:'legacy-map'})).status,'sent');
});
test('reply identity prevents conflicts and identical concurrent retries send once, text and attachment',async()=>{
 for(const attachment of [false,true]){const {call,seen}=setup();await call(send);const a=attachment?{...file,reply_to:reply.reply_to}:reply;const name=attachment?'telegram_send_attachment':'telegram_send';
 await Promise.all([call(a,name),call(a,name)]);assert.equal(seen.length,2);assert.equal((await call(a,name)).duplicate,true);
 assert.match((await call({...a,reply_to:undefined},name)).error,/different content/);
 await call({...send,request_id:'original-002'});assert.match((await call({...a,reply_to:{request_id:'original-002'}},name)).error,/different content/);assert.equal(seen.length,3);
 }
});
test('deleted targets and Telegram errors persist without fallback; unknown/pending never resend',async()=>{
 for(const attachment of [false,true])for(const outcome of ['rejected','unknown','pending']){
 const {call,seen,setResponse,db}=setup();await call(send);const a=attachment?{...file,reply_to:reply.reply_to}:reply;const name=attachment?'telegram_send_attachment':'telegram_send';
 setResponse(()=>{if(outcome!=='rejected')throw Error('FAKE secret');return Response.json({ok:false,error_code:400,description:'Bad Request: message to be replied not found'},{status:400});});
 const r=await call(a,name);assert.equal(r.status,outcome==='pending'?'unknown':outcome);
 if(outcome==='pending')db.s.prepare("UPDATE deliveries SET status='pending' WHERE id=?").run(a.request_id);
 const again=await call(a,name);assert.equal(again.status,outcome);assert.equal(seen.length,2);
 const receipt=await call({request_id:a.request_id},'telegram_receipt');if(outcome==='rejected')assert.equal(receipt.telegram_error_reason,'reply_target_not_found');else assert.equal(receipt.do_not_retry,true);
 }
});
test('migration readiness fails before a send claim and schema excludes replies from edits',async()=>{
 const {call,db,seen}=setup();assert.equal((await call({},'telegram_status')).replies_supported,true);
 db.s.exec('ALTER TABLE deliveries DROP COLUMN reply_to_json');assert.equal((await call({},'telegram_status')).ready,false);assert.match((await call(send)).error,/migration/);assert.equal(seen.length,0);
});

test('all text sends require confirmed chat/topic before they can become reply targets',async()=>{
 for(const m of [{message_id:7},{message_id:7,chat:{id:-10098},message_thread_id:12},{message_id:7,chat:{id:-10099},message_thread_id:13}]){
 const {call,seen,setResponse}=setup();setResponse(()=>Response.json({ok:true,result:m}));assert.equal((await call(send)).status,'unknown');assert.ok((await call(reply)).error);assert.equal(seen.length,1);
 }
});

test('media replacement, text-to-media and caption edits retain ID/reply and share original receipt',async()=>{
 const {call,seen,db}=setup();await call(send);await call(reply);
 const edit={...file,request_id:'media-edit-001',original_request_id:reply.request_id,caption:'<b>caption</b>',parse_mode:'HTML'};
 assert.equal((await call(edit,'telegram_edit_media')).status,'sent');
 const [url,o]=seen.at(-1);assert.ok(url.endsWith('/editMessageMedia'));assert.equal(o.body.get('message_id'),'7');assert.equal(o.body.has('reply_parameters'),false);
 assert.deepEqual(JSON.parse(o.body.get('media')),{type:'document',media:'attach://replacement',caption:edit.caption,parse_mode:'HTML',disable_content_type_detection:true});assert.equal(await o.body.get('replacement').text(),'file');
 const cap={destination:'team',request_id:'caption-001',original_request_id:reply.request_id,caption:''};assert.equal((await call(cap,'telegram_edit_caption')).status,'sent');
 assert.deepEqual(JSON.parse(seen.at(-1)[1].body),{chat_id:'-10099',message_id:7,caption:''});
 assert.deepEqual((await call({request_id:reply.request_id},'telegram_receipt')).reply_to,{message_id:7,request_id:send.request_id});
 assert.equal(db.s.prepare('SELECT current_kind FROM edit_targets WHERE original_request_id=?').get(reply.request_id).current_kind,'document');
 const before=seen.length;assert.equal((await call({destination:'team',request_id:'text-edit-late',original_request_id:reply.request_id,text:'cannot remove media'},'telegram_edit')).status,'rejected');assert.equal(seen.length,before);
});
test('legacy attachment proof permits historical caption/media edits without uploading proof; wrong proof fails',async()=>{
 const {call,db,seen}=setup();await call(file,'telegram_send_attachment');db.s.exec('UPDATE deliveries SET send_kind=NULL,send_chat_id=NULL,send_topic_id=NULL');
 const {destination,request_id,...proof}=file;
 const a={destination,request_id:'legacy-caption',original_request_id:request_id,caption:'new',original_attachment:proof};
 assert.ok((await call({...a,original_attachment:undefined},'telegram_edit_caption')).error);
 assert.ok((await call({...a,original_attachment:{...proof,filename:'wrong.txt'}},'telegram_edit_caption')).error);
 assert.equal((await call(a,'telegram_edit_caption')).status,'sent');assert.deepEqual(JSON.parse(seen.at(-1)[1].body),{chat_id:'-10099',message_id:7,caption:'new'});
 assert.equal((await call({...file,request_id:'legacy-replace',original_request_id:request_id},'telegram_edit_media')).status,'sent');
 assert.equal((await call({...reply,reply_to:{request_id:file.request_id}})).status,'sent');
});
test('media edits validate unsupported inputs, owner/scope, types and exact historical text proof',async()=>{
 const {call,seen,db}=setup();await call(send);const a={...file,request_id:'media-edit-001',original_request_id:send.request_id};const count=seen.length;
 for(const diff of [{destination:'topic'},{destination:'other'},{kind:'animation'},{kind:'voice'},{kind:'photo'},{reply_to:{message_id:7}},{media_group_id:'album'},{data_base64:'Zh=='},{caption:'x'.repeat(1025)},{original_request_id:'missing-id'},{original_attachment:{url:'https://bad'}}])assert.ok((await call({...a,...diff},'telegram_edit_media')).error);
 assert.ok((await call(a,'telegram_edit_media','bob')).error);assert.equal(seen.length,count);
 assert.equal((await call({destination:'team',request_id:'no-caption-text',original_request_id:send.request_id,caption:'x'},'telegram_edit_caption')).status,'rejected');
 db.s.exec('UPDATE deliveries SET send_kind=NULL,send_chat_id=NULL,send_topic_id=NULL');db.s.exec('DELETE FROM edit_targets');
 assert.ok((await call(a,'telegram_edit_media')).error);assert.equal((await call({...a,original_text:send.text},'telegram_edit_media')).status,'sent');
});
test('all supported media kinds, idempotency conflicts and no repeat requests',async()=>{
 for(const [mime,data,kind] of [['image/png',Buffer.from([137,80,78,71,13,10,26,10]),'photo'],['video/mp4',Buffer.from('\0\0\0\x14ftypisom'),'video'],['audio/mpeg',Buffer.from('ID3test'),'audio'],['text/plain',Buffer.from('file'),'document']]){
 const {call,seen}=setup();await call(file,'telegram_send_attachment');const a={...file,request_id:'replace-001',original_request_id:file.request_id,mime_type:mime,data_base64:data.toString('base64')};
 assert.equal((await call(a,'telegram_edit_media')).status,'sent');assert.equal(JSON.parse(seen.at(-1)[1].body.get('media')).type,kind);
 assert.equal((await call(a,'telegram_edit_media')).duplicate,true);assert.match((await call({...a,filename:'new.txt'},'telegram_edit_media')).error,/different content/);assert.equal(seen.length,2);
 const cap={destination:'team',request_id:'caption-001',original_request_id:file.request_id,caption:'caption'};
 assert.equal((await call(cap,'telegram_edit_caption')).status,'sent');assert.equal((await call(cap,'telegram_edit_caption')).duplicate,true);assert.match((await call({...cap,caption:'different'},'telegram_edit_caption')).error,/different content/);
 }
});
test('unknown media/caption edit locks all edit types; rejection releases lock without fallback',async()=>{
 for(const name of ['telegram_edit_media','telegram_edit_caption'])for(const uncertain of [true,false]){
 const {call,seen,setResponse}=setup();await call(file,'telegram_send_attachment');
 const a=name==='telegram_edit_media'?{...file,request_id:'media-edit-001',original_request_id:file.request_id}:{destination:'team',request_id:'caption-001',original_request_id:file.request_id,caption:'new'};
 setResponse(()=>{if(uncertain)throw Error('secret');return Response.json({ok:false,error_code:400,description:'private detail'},{status:400});});
 assert.equal((await call(a,name)).status,uncertain?'unknown':'rejected');assert.equal((await call(a,name)).duplicate,true);assert.equal(seen.length,2);
 const next=await call({...file,request_id:'media-edit-002',original_request_id:file.request_id},'telegram_edit_media');assert.equal(next.status,'rejected');assert.equal(seen.length,uncertain?2:3);
 }
});
test('editing replied text does not emit reply parameters or replace message ID',async()=>{
 const {call,seen}=setup();await call(send);await call(reply);const result=await call({destination:'team',request_id:'reply-text-edit',original_request_id:reply.request_id,original_text:reply.text,text:'updated'},'telegram_edit');
 assert.equal(result.message_id,7);assert.deepEqual(JSON.parse(seen.at(-1)[1].body),{chat_id:'-10099',message_id:7,text:'updated',link_preview_options:{is_disabled:true}});assert.equal((await call({request_id:reply.request_id},'telegram_receipt')).reply_to.request_id,send.request_id);
});

test('concurrent media/caption edits share one lock and a save failure keeps it locked',async()=>{
 const {call,seen,setResponse,db}=setup();await call(file,'telegram_send_attachment');
 let entered,release;const started=new Promise(r=>entered=r),done=new Promise(r=>release=r);
 setResponse(async()=>{entered();await done;return Response.json({ok:true,result:{message_id:7,chat:{id:-10099},message_thread_id:12}});});
 const a={...file,request_id:'concurrent-media',original_request_id:file.request_id};const sending=call(a,'telegram_edit_media');await started;
 const cap={destination:'team',request_id:'concurrent-caption',original_request_id:file.request_id,caption:'new'};
 assert.equal((await call(cap,'telegram_edit_caption')).status,'rejected');assert.equal(seen.length,2);release();assert.equal((await sending).status,'sent');
 setResponse(()=>Response.json({ok:true,result:{message_id:7,chat:{id:-10099}}}));db.batch=async()=>{throw Error('storage failed');};
 const result=await call({...cap,request_id:'caption-savefail'},'telegram_edit_caption');assert.equal(result.receipt_save_failed,true);assert.equal(result.do_not_retry,true);
 assert.equal((await call({...a,request_id:'media-afterfail'},'telegram_edit_media')).status,'rejected');assert.equal(seen.length,3);
});

test('missing media migration advertises no edit readiness and rejects before edit claims',async()=>{
 const {call,db,seen}=setup();await call(send);db.s.exec('ALTER TABLE edit_targets DROP COLUMN current_kind');
 const status=await call({},'telegram_status');assert.equal(status.ready,false);assert.equal(status.editing_supported,false);assert.equal(status.media_editing_supported,false);
 assert.match((await call({...file,request_id:'missing-migration',original_request_id:send.request_id},'telegram_edit_media')).error,/migration/);assert.equal(seen.length,1);assert.equal(db.s.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);
});
