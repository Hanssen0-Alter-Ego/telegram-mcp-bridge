// Bounded inline uploads: no arbitrary URL fetch, filesystem read or durable blob storage.
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENT_BASE64 = 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3);
export const attachmentTool = {
 name:'telegram_send_attachment',
 description:'Upload an owner-authorized attachment to a configured destination alias. Provide actual file bytes as canonical base64, never a URL or local path. Maximum 8 MiB. auto previews JPEG/PNG photos, MP4 video and MP3/M4A audio; other files are documents. document preserves original bytes. Caption supports HTML or MarkdownV2 (1024 source characters maximum). Inspect files for secrets and metadata before sharing. Use one request_id per intended send and reuse identical payload on retry; check telegram_receipt for pending/unknown, never blindly retry with another ID. Does not edit existing media.',
 inputSchema:{type:'object',properties:{destination:{type:'string'},request_id:{type:'string',minLength:8,maxLength:128},data_base64:{type:'string',minLength:4,maxLength:MAX_ATTACHMENT_BASE64},filename:{type:'string',minLength:1,maxLength:128},mime_type:{type:'string',maxLength:100},kind:{type:'string',enum:['auto','photo','video','audio','document']},caption:{type:'string',maxLength:1024},parse_mode:{type:'string',enum:['HTML','MarkdownV2']}},required:['destination','request_id','data_base64','filename','mime_type'],additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}
};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const fail=()=>{throw Error('Invalid attachment arguments or destination not allowed');};
export async function sendAttachment(a,user,env,c,fetcher,output){
 if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!Object.hasOwn(attachmentTool.inputSchema.properties,k)))fail();
 if(typeof a.destination!=='string'||!Object.hasOwn(c.destinations,a.destination)||!c.destinations[a.destination].allowedCallerIds.includes(user)||!c.destinations[a.destination].canSend)fail();
 if(!c.enabled||!env.TELEGRAM_BOT_TOKEN||!env.DB)throw Error('Sending is not configured');
 if(typeof a.request_id!=='string'||! /^[A-Za-z0-9_-]{8,128}$/.test(a.request_id)||typeof a.filename!=='string'||!a.filename.trim()||a.filename.length>128||/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(a.filename)||['.','..'].includes(a.filename)||typeof a.mime_type!=='string'||a.mime_type.length>100||! /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(a.mime_type)||a.kind!==undefined&&!['auto','photo','video','audio','document'].includes(a.kind)||a.caption!==undefined&&(typeof a.caption!=='string'||a.caption.length>1024)||a.parse_mode!==undefined&&(!['HTML','MarkdownV2'].includes(a.parse_mode)||!a.caption))fail();
 const b64=a.data_base64;
 if(typeof b64!=='string'||!b64.length||b64.length>MAX_ATTACHMENT_BASE64||b64.length%4||/[^A-Za-z0-9+/=]/.test(b64)||b64.slice(0,-2).includes('=')||b64.endsWith('=')&&b64.at(-2)==='='&&b64.length<4||b64.at(-2)==='='&&!b64.endsWith('='))fail();
 const binary=atob(b64);if(!binary.length||binary.length>MAX_ATTACHMENT_BYTES||btoa(binary)!==b64)fail();
 const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
 const prefix=(...values)=>values.every((v,i)=>bytes[i]===v);
 const mp4=binary.slice(4,8)==='ftyp';
 // Signature checks select native previews; they are not a malware scan or a full codec parser.
 const native={
  'image/png':prefix(137,80,78,71,13,10,26,10)?'photo':null,
  'image/jpeg':prefix(255,216,255)?'photo':null,
  'video/mp4':mp4?'video':null,
  'audio/mp4':mp4?'audio':null,
  'audio/mpeg':binary.startsWith('ID3')||(bytes[0]===255&&(bytes[1]&224)===224)?'audio':null
 }[a.mime_type];
 if(Object.hasOwn({'image/png':1,'image/jpeg':1,'video/mp4':1,'audio/mp4':1,'audio/mpeg':1},a.mime_type)&&!native)fail();
 const kind=!a.kind||a.kind==='auto'?(native??'document'):a.kind;
 if(kind!=='document'&&kind!==native)fail();
 const d=c.destinations[a.destination];
 const fingerprint=await hash(new TextEncoder().encode(JSON.stringify(['attachment',d.chatId,d.threadId??null,await hash(bytes),a.filename,a.mime_type,kind,a.caption??'',a.parse_mode??null])));
 const now=new Date().toISOString();
 const claim=await env.DB.prepare("INSERT OR IGNORE INTO deliveries (owner,id,fingerprint,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)").bind(user,a.request_id,fingerprint,now,now).run();
 if(claim.meta.changes!==1){
  const row=await env.DB.prepare('SELECT * FROM deliveries WHERE owner=? AND id=?').bind(user,a.request_id).first();
  if(!row||row.fingerprint!==fingerprint)throw Error('Request ID already used with different content');
  return output({request_id:a.request_id,status:row.status,message_id:row.message_id??null,kind,duplicate:true,...(['pending','unknown'].includes(row.status)?{do_not_retry:true}:{})},row.status!=='sent');
 }
 let status='unknown',messageId=null,errorCode=null;
 try{
  const form=new FormData();form.set('chat_id',d.chatId);if(d.threadId)form.set('message_thread_id',String(d.threadId));
  form.set(kind,new Blob([bytes],{type:a.mime_type}),a.filename);
  if(a.caption!==undefined)form.set('caption',a.caption);if(a.parse_mode!==undefined)form.set('parse_mode',a.parse_mode);
  if(kind==='document')form.set('disable_content_type_detection','true');
  const method={photo:'sendPhoto',video:'sendVideo',audio:'sendAudio',document:'sendDocument'}[kind];
  const response=await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',redirect:'manual',body:form,signal:AbortSignal.timeout(c.timeoutMs)});
  if(response.status>=300&&response.status<400)throw Error('Redirect refused');
  const data=await response.json(),m=data.result;
  if(response.ok&&data.ok===true&&Number.isSafeInteger(m?.message_id)&&m.message_id>0&&String(m.chat?.id)===d.chatId&&(m.message_thread_id??0)===(d.threadId??0)){status='sent';messageId=m.message_id;}
  else if(data.ok===false){status='rejected';errorCode=Number.isInteger(data.error_code)?data.error_code:null;}
 }catch{/* Never log media bytes, filenames, captions, credentials or remote errors. */}
 try{await env.DB.prepare('UPDATE deliveries SET status=?,message_id=?,updated_at=? WHERE owner=? AND id=?').bind(status,messageId,new Date().toISOString(),user,a.request_id).run();}
 catch{return output({request_id:a.request_id,status:'unknown',receipt_save_failed:true,do_not_retry:true},true);}
 return output({request_id:a.request_id,status,message_id:messageId,kind,...(errorCode?{telegram_error_code:errorCode}:{}),...(status==='unknown'?{do_not_retry:true}:{})},status!=='sent');
}
