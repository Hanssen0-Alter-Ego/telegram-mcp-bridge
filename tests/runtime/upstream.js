// This is the only outbound service. No network service or real credentials exist.
export default {async fetch(request){
 const url=new URL(request.url);
 if(url.hostname!=='api.telegram.org'||request.redirect!=='manual')return new Response('Unexpected request',{status:500});
 if(url.pathname.startsWith('/botMEDIA_EDIT/')){
  let valid=false;
  if(url.pathname.endsWith('/editMessageMedia')){const form=await request.formData();const media=JSON.parse(form.get('media'));valid=form.get('chat_id')==='123'&&form.get('message_id')==='56'&&!form.has('reply_parameters')&&media.type==='document'&&media.media==='attach://replacement'&&media.caption==='<b>Updated</b>'&&media.parse_mode==='HTML'&&await form.get('replacement').text()==='updated file';}
  if(url.pathname.endsWith('/editMessageCaption')){const body=await request.json();valid=body.chat_id==='123'&&body.message_id===56&&body.caption===''&&!Object.hasOwn(body,'reply_parameters');}
  return Response.json(valid?{ok:true,result:{message_id:56,chat:{id:123},reply_to_message:{message_id:55}}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname.startsWith('/botREPLY')){
  const attachment=url.pathname.endsWith('/sendDocument');const body=attachment?await request.formData():await request.json();
  const r=attachment?JSON.parse(body.get('reply_parameters')):body.reply_parameters;
  const valid=r?.message_id===55&&r.allow_sending_without_reply===false&&!Object.hasOwn(r,'chat_id')&&(attachment?body.get('chat_id'):body.chat_id)==='123';
  if(!valid)return Response.json({ok:false,error_code:400});
  if(url.pathname.startsWith('/botREPLY_MISSING/'))return Response.json({ok:false,error_code:400,description:'Bad Request: message to be replied not found'},{status:400});
  return Response.json({ok:true,result:{message_id:56,chat:{id:123}}});
 }
 if(url.pathname.startsWith('/botREDIRECT/'))return Response.redirect('https://must-not-follow.test/',302);
 if(['/botHTML/sendMessage','/botMARKDOWN/sendMessage'].includes(url.pathname)){
  const body=await request.json();const html=url.pathname.startsWith('/botHTML/');
  const valid=body.parse_mode===(html?'HTML':'MarkdownV2')&&body.text===(html?'<b>中文</b> <a href="https://example.com">来源</a>':'*中文* [来源](https://example.com)')&&body.chat_id==='123'&&body.link_preview_options?.is_disabled===true;
  return Response.json(valid?{ok:true,result:{message_id:43,chat:{id:123}}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname==='/botEDIT/editMessageText'){
  const body=await request.json();const valid=body.chat_id==='123'&&body.message_id===42&&body.text==='<b>更新</b>'&&body.parse_mode==='HTML'&&!Object.hasOwn(body,'message_thread_id')&&body.link_preview_options?.is_disabled===true;
  return Response.json(valid?{ok:true,result:{message_id:42,chat:{id:123}}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname==='/botBOUNDARY/sendDocument'){
  const form=await request.formData();const file=form.get('document');const valid=file?.size===8*1024*1024;
  return Response.json(valid?{ok:true,result:{message_id:45,chat:{id:123}}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname==='/botATTACHMENT/sendDocument'){
  const form=await request.formData();const file=form.get('document');const valid=form.get('chat_id')==='123'&&form.get('caption')==='<b>File</b>'&&form.get('parse_mode')==='HTML'&&file?.name==='example.txt'&&await file.text()==='Hello attachment';
  return Response.json(valid?{ok:true,result:{message_id:44,chat:{id:123}}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname==='/botFAKE/sendMessage')return Response.json({ok:true,result:{message_id:42,chat:{id:123}}});
 if(url.pathname==='/botFAKE/getWebhookInfo')return Response.json({ok:true,result:{url:''}});
 if(url.pathname==='/botFAKE/getUpdates')return Response.json({ok:true,result:[]});
 return new Response('Unexpected request',{status:500});
}};
