import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectionDiagnostic,receiptDiagnostic} from '../worker/diagnostics.js';
test('only fixed classifications leave the boundary, never raw or reflected values',()=>{
 for(const [description,expected] of [['Bad Request: IMAGE_PROCESS_FAILED','image_processing_failed'],['Bad Request: PHOTO_INVALID_DIMENSIONS','invalid_photo_dimensions'],['Bad Request: chat not found','chat_not_found'],['Bad Request: message thread not found','thread_not_found'],["Bad Request: can't parse entities: SECRET at byte 99",'invalid_caption_format'],['Forbidden: bot was blocked by the user','bot_blocked'],['Bad Request: chat not found SECRET','telegram_rejected'],['SECRET URL','telegram_rejected'],[{},'telegram_rejected']]){
  const d=rejectionDiagnostic({error_code:400,description});assert.equal(d.telegram_error_reason,expected);assert.ok(!JSON.stringify(d).includes('SECRET'));
 }
 assert.equal(rejectionDiagnostic({error_code:429,description:'retry after PRIVATE'}).telegram_error_reason,'rate_limited');
 assert.equal(rejectionDiagnostic({error_code:999999999}).telegram_error_code,null);
 assert.deepEqual(receiptDiagnostic({status:'rejected',telegram_error_code:999999999,telegram_error_reason:'SECRET'}),{});
 assert.deepEqual(receiptDiagnostic({status:'sent',telegram_error_code:400,telegram_error_reason:'image_processing_failed'}),{});
});
