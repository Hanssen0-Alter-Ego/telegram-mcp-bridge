import {createWorker} from './index.js';
const config={enabled:true,destinations:{test:{chatId:'123',description:'Test',purpose:'Offline runtime test',canRead:true,canSend:true,allowedCallerIds:['owner']}},maxTextLength:4096,timeoutMs:1000};
class DB {
 rows=new Map();
 targets=new Map();
 prepare(sql){return {bind:(...args)=>this.statement(sql,args),...this.statement(sql,[])};}
 statement(sql,args){return {
  first:async()=>sql.includes('edit_targets')?this.targets.get(args[0]+':'+args[1]):sql.includes('inbox_cursor')?{next_offset:0,last_received_at:Date.now(),epoch:0}:this.rows.get(args[0]+':'+args[1]),
  all:async()=>({results:[]}),
  run:async()=>{if(sql.startsWith('UPDATE edit_targets SET active_edit_id=?')){const [id,owner,original]=args;const target=this.targets.get(owner+':'+original);if(target.active_edit_id!==null)return {meta:{changes:0}};target.active_edit_id=id;}else if(sql.startsWith('UPDATE edit_targets SET active_edit_id=NULL')){const [owner,original,id]=args;const target=this.targets.get(owner+':'+original);if(target.active_edit_id===id)target.active_edit_id=null;}else if(sql.startsWith('INSERT OR IGNORE INTO deliveries')){const [owner,id,fingerprint,created_at,updated_at]=args;const key=owner+':'+id;if(this.rows.has(key))return {meta:{changes:0}};this.rows.set(key,{owner,id,fingerprint,status:'pending',created_at,updated_at});}else if(sql.startsWith('UPDATE deliveries')){const [status,message_id,updated_at,owner,id]=args;Object.assign(this.rows.get(owner+':'+id),{status,message_id,updated_at});}return {meta:{changes:1}};}
 };}
 async batch(statements){return Promise.all(statements.map(x=>x.run()));}
}
const request=(name,args)=>new Request('https://bridge.test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
async function invoke(name,args,token){const response=await createWorker(config).fetch(request(name,args),{DB:new DB(),TELEGRAM_BOT_TOKEN:token});return JSON.parse((await response.json()).result.content[0].text);}
async function edit(token){
 const db=new DB();db.rows.set('owner:runtime-original',{id:'runtime-original',status:'sent',message_id:42,fingerprint:'previously-verified'});
 db.targets.set('owner:runtime-original',{chat_id:'123',topic_id:0,message_id:42,active_edit_id:null});
 const response=await createWorker(config).fetch(request('telegram_edit',{destination:'test',original_request_id:'runtime-original',request_id:'runtime-edit',text:'<b>更新</b>',parse_mode:'HTML'}),{DB:db,TELEGRAM_BOT_TOKEN:token});
 return JSON.parse((await response.json()).result.content[0].text);
}
export default {async fetch(){return Response.json({
 attachment:await invoke('telegram_send_attachment',{destination:'test',request_id:'runtime-attachment',filename:'example.txt',mime_type:'text/plain',data_base64:btoa('Hello attachment'),caption:'<b>File</b>',parse_mode:'HTML'},'ATTACHMENT'),
 edit:await edit('EDIT'),
 redirectEdit:await edit('REDIRECT'),
 send:await invoke('telegram_send',{destination:'test',text:'Offline fake message',request_id:'runtime-send'},'FAKE'),
 html:await invoke('telegram_send',{destination:'test',text:'<b>中文</b> <a href="https://example.com">来源</a>',parse_mode:'HTML',request_id:'runtime-html'},'HTML'),
 markdown:await invoke('telegram_send',{destination:'test',text:'*中文* [来源](https://example.com)',parse_mode:'MarkdownV2',request_id:'runtime-markdown'},'MARKDOWN'),
 read:await invoke('telegram_read',{destination:'test'},'FAKE'),
 redirectSend:await invoke('telegram_send',{destination:'test',text:'Offline fake message',request_id:'runtime-redirect'},'REDIRECT'),
 redirectRead:await invoke('telegram_read',{destination:'test'},'REDIRECT')
});}};
