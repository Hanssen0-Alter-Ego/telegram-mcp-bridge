// Never expose or persist Telegram's raw description, parameters, or request data.
const reasons=new Map([
 ['bad request: image_process_failed','image_processing_failed'],
 ['bad request: photo_invalid_dimensions','invalid_photo_dimensions'],
 ['bad request: photo_invalid','invalid_photo'],
 ['bad request: file must be non-empty','empty_file'],
 ['bad request: file is too big','file_too_large'],
 ['request entity too large','file_too_large'],
 ['bad request: chat not found','chat_not_found'],
 ['bad request: message thread not found','thread_not_found'],
 ['bad request: topic_closed','topic_closed'],
 ['bad request: not enough rights to send photos to the chat','photo_permission_denied'],
 ['bad request: not enough rights to send videos to the chat','video_permission_denied'],
 ['bad request: not enough rights to send documents to the chat','document_permission_denied'],
 ['bad request: not enough rights to send audios to the chat','audio_permission_denied'],
 ['bad request: message caption is too long','caption_too_long'],
 ['bad request: there is no photo in the request','missing_photo'],
 ['forbidden: bot was blocked by the user','bot_blocked'],
 ['forbidden: bot was kicked from the group chat','bot_removed'],
 ['forbidden: bot is not a member of the channel chat','bot_not_member'],
 ['unauthorized','bot_authentication_failed']
]);
const allowed=new Set([...reasons.values(),'invalid_caption_format','rate_limited','telegram_rejected']);
export function rejectionDiagnostic(data){
 const code=Number.isInteger(data?.error_code)&&data.error_code>=100&&data.error_code<=599?data.error_code:null;
 const description=typeof data?.description==='string'?data.description.slice(0,512).toLowerCase():'';
 const reason=reasons.get(description)??(description.startsWith("bad request: can't parse entities")?'invalid_caption_format':code===429?'rate_limited':'telegram_rejected');
 return {telegram_error_code:code,telegram_error_reason:reason};
}
export function receiptDiagnostic(row){
 if(row?.status!=='rejected')return {};
 return {...(Number.isInteger(row.telegram_error_code)&&row.telegram_error_code>=100&&row.telegram_error_code<=599?{telegram_error_code:row.telegram_error_code}:{}),...(allowed.has(row.telegram_error_reason)?{telegram_error_reason:row.telegram_error_reason}:{})};
}
