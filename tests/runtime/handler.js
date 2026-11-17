import {createWorker} from './index.js';
const config={enabled:true,destinations:{test:{chatId:'123',description:'Test',purpose:'Offline runtime test',canRead:true,canSend:true,allowedCallerIds:['owner']}},maxTextLength:4096,timeoutMs:1000};
class DB {
 rows=new Map();
 prepare(sql){return {bind:(...args)=>this.statement(sql,args),...this.statement(sql,[])};}
 statement(sql,args){return {
  first:async()=>sql.includes('inbox_cursor')?{next_offset:0,last_received_at:Date.now(),epoch:0}:this.rows.get(args[0]+':'+args[1]),
  all:async()=>({results:[]}),
  run:async()=>{if(sql.startsWith('INSERT OR IGNORE INTO deliveries')){const [owner,id,fingerprint,created_at,updated_at]=args;const key=owner+':'+id;if(this.rows.has(key))return {meta:{changes:0}};this.rows.set(key,{owner,id,fingerprint,status:'pending',created_at,updated_at});}else if(sql.startsWith('UPDATE deliveries')){const [status,message_id,updated_at,owner,id]=args;Object.assign(this.rows.get(owner+':'+id),{status,message_id,updated_at});}return {meta:{changes:1}};}
 };}
 async batch(statements){return Promise.all(statements.map(x=>x.run()));}
}
const request=(name,args)=>new Request('https://bridge.test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
async function invoke(name,args,token){const response=await createWorker(config).fetch(request(name,args),{DB:new DB(),TELEGRAM_BOT_TOKEN:token});return JSON.parse((await response.json()).result.content[0].text);}
export default {async fetch(){return Response.json({
 send:await invoke('telegram_send',{destination:'test',text:'Offline fake message',request_id:'runtime-send'},'FAKE'),
 read:await invoke('telegram_read',{destination:'test'},'FAKE'),
 redirectSend:await invoke('telegram_send',{destination:'test',text:'Offline fake message',request_id:'runtime-redirect'},'REDIRECT'),
 redirectRead:await invoke('telegram_read',{destination:'test'},'REDIRECT')
});}};
