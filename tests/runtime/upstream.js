// This is the only outbound service. No network service or real credentials exist.
export default {async fetch(request){
 const url=new URL(request.url);
 if(url.hostname!=='api.telegram.org'||request.redirect!=='manual')return new Response('Unexpected request',{status:500});
 if(url.pathname.startsWith('/botREDIRECT/'))return Response.redirect('https://must-not-follow.test/',302);
 if(['/botHTML/sendMessage','/botMARKDOWN/sendMessage'].includes(url.pathname)){
  const body=await request.json();const html=url.pathname.startsWith('/botHTML/');
  const valid=body.parse_mode===(html?'HTML':'MarkdownV2')&&body.text===(html?'<b>中文</b> <a href="https://example.com">来源</a>':'*中文* [来源](https://example.com)')&&body.chat_id==='123'&&body.link_preview_options?.is_disabled===true;
  return Response.json(valid?{ok:true,result:{message_id:43}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname==='/botEDIT/editMessageText'){
  const body=await request.json();const valid=body.chat_id==='123'&&body.message_id===42&&body.text==='<b>更新</b>'&&body.parse_mode==='HTML'&&!Object.hasOwn(body,'message_thread_id')&&body.link_preview_options?.is_disabled===true;
  return Response.json(valid?{ok:true,result:{message_id:42,chat:{id:123}}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname==='/botATTACHMENT/sendDocument'){
  const form=await request.formData();const file=form.get('document');const valid=form.get('chat_id')==='123'&&form.get('caption')==='<b>File</b>'&&form.get('parse_mode')==='HTML'&&file?.name==='example.txt'&&await file.text()==='Hello attachment';
  return Response.json(valid?{ok:true,result:{message_id:44,chat:{id:123}}}:{ok:false,error_code:400},{status:valid?200:400});
 }
 if(url.pathname==='/botFAKE/sendMessage')return Response.json({ok:true,result:{message_id:42}});
 if(url.pathname==='/botFAKE/getWebhookInfo')return Response.json({ok:true,result:{url:''}});
 if(url.pathname==='/botFAKE/getUpdates')return Response.json({ok:true,result:[]});
 return new Response('Unexpected request',{status:500});
}};
