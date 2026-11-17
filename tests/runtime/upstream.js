// This is the only outbound service. No network service or real credentials exist.
export default {fetch(request){
 const url=new URL(request.url);
 if(url.hostname!=='api.telegram.org'||request.redirect!=='manual')return new Response('Unexpected request',{status:500});
 if(url.pathname.startsWith('/botREDIRECT/'))return Response.redirect('https://must-not-follow.test/',302);
 if(url.pathname==='/botFAKE/sendMessage')return Response.json({ok:true,result:{message_id:42}});
 if(url.pathname==='/botFAKE/getWebhookInfo')return Response.json({ok:true,result:{url:''}});
 if(url.pathname==='/botFAKE/getUpdates')return Response.json({ok:true,result:[]});
 return new Response('Unexpected request',{status:500});
}};
