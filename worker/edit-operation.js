import {receiptDiagnostic} from './diagnostics.js';
import {rejectionDiagnostic} from './diagnostics.js';
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),x=>x.toString(16).padStart(2,'0')).join('');
export async function runEdit({a,user,env,c,fetcher,output,target,fingerprint,operation='edit',method,request,requiredKind,nextKind}){
 const now=new Date().toISOString();
 const claim=await env.DB.prepare("INSERT OR IGNORE INTO deliveries (owner,id,fingerprint,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)").bind(user,a.request_id,fingerprint,now,now).run();
 if(claim.meta.changes!==1){
  const row=await env.DB.prepare('SELECT * FROM deliveries WHERE owner=? AND id=?').bind(user,a.request_id).first();
  if(!row||row.fingerprint!==fingerprint)throw Error('Request ID already used with different content');
  return output({request_id:row.id,status:row.status,message_id:row.message_id??null,...receiptDiagnostic(row),operation,original_request_id:a.original_request_id,duplicate:true,...(['pending','unknown'].includes(row.status)?{do_not_retry:true}:{})},row.status!=='sent');
 }
 const lock=await env.DB.prepare('UPDATE edit_targets SET active_edit_id=? WHERE owner=? AND original_request_id=? AND active_edit_id IS NULL').bind(a.request_id,user,a.original_request_id).run();
 if(lock.meta.changes!==1){
  await env.DB.prepare("UPDATE deliveries SET status='rejected',updated_at=? WHERE owner=? AND id=?").bind(new Date().toISOString(),user,a.request_id).run();
  return output({request_id:a.request_id,status:'rejected',operation,error:'Another edit is pending or unknown; inspect its receipt before changing this message'},true);
 }
 // Re-read type while holding the same lock used by text, caption and media edits.
 const current=await env.DB.prepare('SELECT * FROM edit_targets WHERE owner=? AND original_request_id=?').bind(user,a.original_request_id).first();
 let status='unknown',errorCode=null,errorReason=null,localError;
 if(requiredKind==='text'&&(current.current_kind??'text')!=='text'||requiredKind==='media'&&(current.current_kind??'text')==='text'){
  status='rejected';localError='Unsupported edit for current message type';
 }else try{
  const response=await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',redirect:'manual',...request,signal:AbortSignal.timeout(c.timeoutMs)});
  if(response.status>=300&&response.status<400)throw Error('Telegram redirect refused');
  const data=await response.json();
  if(response.ok&&data.ok===true&&data.result?.message_id===target.message_id&&String(data.result?.chat?.id)===target.chat_id)status='sent';
  else if(data.ok===false){status='rejected';const diagnostic=rejectionDiagnostic(data);errorCode=diagnostic.telegram_error_code;errorReason=diagnostic.telegram_error_reason;}
 }catch{/* Never log credentials, content or raw upstream errors. */}
 try{
  const updates=[env.DB.prepare('UPDATE deliveries SET status=?1,message_id=?2,updated_at=?3,telegram_error_code=?6,telegram_error_reason=?7 WHERE owner=?4 AND id=?5').bind(status,target.message_id,new Date().toISOString(),user,a.request_id,errorCode,errorReason)];
  if(status==='sent'&&nextKind)updates.push(env.DB.prepare('UPDATE edit_targets SET current_kind=? WHERE owner=? AND original_request_id=? AND active_edit_id=?').bind(nextKind,user,a.original_request_id,a.request_id));
  if(status!=='unknown')updates.push(env.DB.prepare('UPDATE edit_targets SET active_edit_id=NULL WHERE owner=? AND original_request_id=? AND active_edit_id=?').bind(user,a.original_request_id,a.request_id));
  await env.DB.batch(updates);
 }catch{return output({request_id:a.request_id,status:'unknown',operation,receipt_save_failed:true,do_not_retry:true},true);}
 return output({request_id:a.request_id,status,operation,original_request_id:a.original_request_id,message_id:target.message_id,...(errorCode?{telegram_error_code:errorCode}:{}),...(errorReason?{telegram_error_reason:errorReason}:{}),...(localError?{error:localError}:{}),...(status==='unknown'?{do_not_retry:true}:{})},status!=='sent');
}
