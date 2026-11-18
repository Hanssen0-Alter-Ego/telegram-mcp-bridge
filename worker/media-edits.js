import {attachmentTool,prepareAttachment,attachmentContent} from './attachments.js';
import {digest,runEdit} from './edit-operation.js';
const fileFields=Object.fromEntries(Object.entries(attachmentTool.inputSchema.properties).filter(([k])=>!['destination','request_id','reply_to'].includes(k)));
const common={destination:{type:'string'},request_id:{type:'string',minLength:8,maxLength:128},original_request_id:{type:'string',minLength:8,maxLength:128},original_text:{type:'string',minLength:1,maxLength:4096},original_parse_mode:{type:'string',enum:['HTML','MarkdownV2']},original_attachment:{type:'object',properties:fileFields,required:['filename','mime_type','data_base64'],additionalProperties:false,description:'Legacy attachment receipt proof: exact original bytes, filename, mime_type, kind, caption and parse_mode. Never send this to Telegram.'}};
export const mediaEditTools=[
 {name:'telegram_edit_media',description:'Replace a verified bridge-sent standalone media message, or convert its text to media, keeping message_id and existing reply relationship. Requires owner edit authorization. Actual canonical base64 only, 8 MiB; photo/video/audio/document, no albums, animation, inline or business messages. Caption is replaced (omit to clear). Never deletes/resends or changes reply targets. Reuse request_id only with identical input; pending/unknown locks all edits.',inputSchema:{type:'object',properties:{...common,...fileFields},required:['destination','request_id','original_request_id','filename','mime_type','data_base64'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true}},
 {name:'telegram_edit_caption',description:'Replace or clear a verified bridge-sent media caption while preserving media, message_id and reply relationship. Explicit owner edit authorization required. caption is required; empty string clears it. No text-message captions or reply changes. Unknown edits lock all edits.',inputSchema:{type:'object',properties:{...common,caption:fileFields.caption,parse_mode:fileFields.parse_mode},required:['destination','request_id','original_request_id','caption'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true}}
];
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x);
const fail=()=>{throw Error('Invalid media edit arguments or destination not allowed');};
export async function editMedia(a,user,env,c,fetcher,output,name){
 const media=name==='telegram_edit_media',schema=mediaEditTools.find(t=>t.name===name).inputSchema;
 if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!Object.hasOwn(schema.properties,k))||!validId(a.request_id)||!validId(a.original_request_id)||a.request_id===a.original_request_id||typeof a.destination!=='string'||!Object.hasOwn(c.destinations,a.destination))fail();
 const d=c.destinations[a.destination];if(!d.canSend||!d.allowedCallerIds.includes(user))fail();
 if(!c.enabled||!env.TELEGRAM_BOT_TOKEN||!env.DB)throw Error('Sending is not configured');
 if(a.original_text!==undefined&&(typeof a.original_text!=='string'||!a.original_text.trim()||a.original_text.length>4096)||a.original_parse_mode!==undefined&&(!['HTML','MarkdownV2'].includes(a.original_parse_mode)||a.original_text===undefined)||a.original_attachment!==undefined&&a.original_text!==undefined)fail();
 let file;if(media)file=prepareAttachment(a);else if(typeof a.caption!=='string'||a.caption.length>1024||a.parse_mode!==undefined&&(!['HTML','MarkdownV2'].includes(a.parse_mode)||!a.caption))fail();
 const original=await env.DB.prepare('SELECT * FROM deliveries WHERE owner=? AND id=?').bind(user,a.original_request_id).first();
 if(!original||original.status!=='sent'||!Number.isSafeInteger(original.message_id)||original.message_id<1)throw Error('Historical send proof required or does not match');
 let initialKind=original.send_kind==='attachment'?'media':'text';
 if(original.send_kind&&(!['text','attachment'].includes(original.send_kind)||original.send_chat_id!==d.chatId||original.send_topic_id!==(d.threadId??0)))fail();
 let proof;
 if(a.original_text!==undefined){proof=[d.chatId,d.threadId??null,a.original_text];if(a.original_parse_mode!==undefined)proof.push(a.original_parse_mode);initialKind='text';}
 if(a.original_attachment!==undefined){
  const old=a.original_attachment;if(!old||typeof old!=='object'||Array.isArray(old)||Object.keys(old).some(k=>!Object.hasOwn(fileFields,k)))fail();
  const input={...old,request_id:a.original_request_id};const parsed=prepareAttachment(input);proof=await attachmentContent(input,d,parsed.bytes,parsed.kind);initialKind='media';
 }
 if(proof){if(original.reply_to_json)proof.push({reply_to:JSON.parse(original.reply_to_json)});if(await digest(proof)!==original.fingerprint)throw Error('Historical send proof required or does not match');}
 let target=await env.DB.prepare('SELECT * FROM edit_targets WHERE owner=? AND original_request_id=?').bind(user,a.original_request_id).first();
 if(!target){
  if(!original.send_kind&&!proof)throw Error('Historical send proof required or does not match');
  await env.DB.prepare('INSERT OR IGNORE INTO edit_targets (owner,original_request_id,chat_id,topic_id,message_id,current_kind) VALUES (?,?,?,?,?,?)').bind(user,a.original_request_id,d.chatId,d.threadId??0,original.message_id,initialKind).run();
  target=await env.DB.prepare('SELECT * FROM edit_targets WHERE owner=? AND original_request_id=?').bind(user,a.original_request_id).first();
 }
 if(!target||target.chat_id!==d.chatId||target.topic_id!==(d.threadId??0)||target.message_id!==original.message_id)fail();
 const fingerprint=await digest([name,a.original_request_id,d.chatId,d.threadId??0,target.message_id,media?await attachmentContent(a,d,file.bytes,file.kind):[a.caption,a.parse_mode??null]]);
 let request;
 if(media){
  const form=new FormData();form.set('chat_id',d.chatId);form.set('message_id',String(target.message_id));
  form.set('media',JSON.stringify({type:file.kind,media:'attach://replacement',caption:a.caption??'',...(a.parse_mode?{parse_mode:a.parse_mode}:{}),...(file.kind==='document'?{disable_content_type_detection:true}:{})}));
  form.set('replacement',new Blob([file.bytes],{type:a.mime_type}),a.filename);request={body:form};
 }else request={headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:d.chatId,message_id:target.message_id,caption:a.caption,...(a.parse_mode?{parse_mode:a.parse_mode}:{})})};
 return runEdit({a,user,env,c,fetcher,output,target,fingerprint,operation:media?'edit_media':'edit_caption',method:media?'editMessageMedia':'editMessageCaption',request,requiredKind:media?null:'media',nextKind:media?file.kind:null});
}
