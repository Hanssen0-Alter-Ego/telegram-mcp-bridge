// Reply references never accept arbitrary chat IDs, topics or Telegram options.
export const replySchema={type:'object',properties:{request_id:{type:'string',minLength:8,maxLength:128},message_id:{type:'integer',minimum:1},original_text:{type:'string',minLength:1,maxLength:4096},original_parse_mode:{type:'string',enum:['HTML','MarkdownV2']}},additionalProperties:false,oneOf:[{required:['request_id']},{required:['message_id']}],description:'Reply in this exact destination/topic. Use your successful send request_id, or a message_id stored by telegram_read (requires read permission). Legacy text receipts require exact original_text/original_parse_mode unless previously verified by an edit. Missing/deleted targets never fall back to an ordinary send.'};
const fail=()=>{throw Error('Reply target unavailable or destination does not match');};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),x=>x.toString(16).padStart(2,'0')).join('');
export async function resolveReply(a,user,db,d){
 const r=a.reply_to;if(r===undefined)return null;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!Object.hasOwn(replySchema.properties,k))||(r.request_id===undefined)===(r.message_id===undefined))fail();
 if(r.original_text!==undefined&&(typeof r.original_text!=='string'||!r.original_text.trim()||r.original_text.length>4096)||r.original_parse_mode!==undefined&&(!['HTML','MarkdownV2'].includes(r.original_parse_mode)||r.original_text===undefined))fail();
 let id;
 if(r.message_id!==undefined){
  if(!Number.isSafeInteger(r.message_id)||r.message_id<1||r.original_text!==undefined||r.original_parse_mode!==undefined||!d.canRead)fail();
  const m=await db.prepare('SELECT message_id FROM inbox_v2 WHERE chat_id=? AND topic_id=? AND message_id=? LIMIT 1').bind(d.chatId,d.threadId??0,r.message_id).first();
  if(!m)fail();id=m.message_id;
 }else{
  if(typeof r.request_id!=='string'||! /^[A-Za-z0-9_-]{8,128}$/.test(r.request_id)||r.request_id===a.request_id)fail();
  const row=await db.prepare('SELECT * FROM deliveries WHERE owner=? AND id=?').bind(user,r.request_id).first();
  if(!row||row.status!=='sent'||!Number.isSafeInteger(row.message_id)||row.message_id<1)fail();
  if(row.send_kind){
   if(!['text','attachment'].includes(row.send_kind)||row.send_chat_id!==d.chatId||row.send_topic_id!==(d.threadId??0))fail();
   // Proof fields are only for historical receipts; do not silently ignore them.
   if(r.original_text!==undefined||r.original_parse_mode!==undefined)fail();
  }else if(r.original_text!==undefined){
   const proof=[d.chatId,d.threadId??null,r.original_text];if(r.original_parse_mode!==undefined)proof.push(r.original_parse_mode);
   if(await digest(proof)!==row.fingerprint)fail();
  }else{
   const target=await db.prepare('SELECT * FROM edit_targets WHERE owner=? AND original_request_id=?').bind(user,r.request_id).first();
   if(!target||target.chat_id!==d.chatId||target.topic_id!==(d.threadId??0)||target.message_id!==row.message_id)fail();
  }
  id=row.message_id;
 }
 return {message_id:id,...(r.request_id!==undefined?{request_id:r.request_id}:{})};
}
export const replyParameters=r=>r?{reply_parameters:{message_id:r.message_id,allow_sending_without_reply:false}}:{};
export const replyReceipt=row=>row?.reply_to_json?{reply_to:JSON.parse(row.reply_to_json)}:{};
export const claimSend=(db,user,a,fingerprint,now,d,kind,reply)=>db.prepare("INSERT OR IGNORE INTO deliveries (owner,id,fingerprint,status,created_at,updated_at,send_chat_id,send_topic_id,send_kind,reply_to_json) VALUES (?,?,?,'pending',?,?,?,?,?,?)").bind(user,a.request_id,fingerprint,now,now,d.chatId,d.threadId??0,kind,reply?JSON.stringify(reply):null).run();
