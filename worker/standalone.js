import {createWorker} from './index.js';
import config from '../config/destinations.js';
import clients from '../config/clients.js';

// Authenticate the transport before deriving identity. Never trust public
// oai-authenticated-* headers; those are only meaningful behind Sites dispatch.
export function createStandalone(c=config, principals=clients, fetcher=fetch){
 const entries=Object.entries(principals);
 if(entries.some(([id,p])=>!id||!/^MCP_CLIENT_[A-Z0-9_]+$/.test(p.secretEnv)))throw Error('Invalid client configuration');
 if(new Set(entries.map(([,p])=>p.secretEnv)).size!==entries.length)throw Error('Client secrets must be distinct');
 const core=createWorker(c,fetcher);
 return {async fetch(request,env){
  const deny=()=>new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store','www-authenticate':'Bearer realm="telegram-mcp"'}});
  const auth=request.headers.get('authorization');
  if(!auth||!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(auth))return deny();
  const supplied=auth.slice(7);
  // Fixed-size digests keep equality independent of the secret length/content.
  const hash=async x=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)));
  const incoming=await hash(supplied);let matched=[];
  for(const [id,p] of entries){
   const secret=env[p.secretEnv];
   if(typeof secret!=='string'||! /^[A-Za-z0-9_-]{43,128}$/.test(secret))continue;
   const expected=await hash(secret);let mismatch=0;
   for(let i=0;i<32;i++)mismatch|=incoming[i]^expected[i];
   if(mismatch===0)matched.push(id);
  }
  // Duplicate key values are configuration errors, never pick a caller.
  if(matched.length!==1)return deny();
  const headers=new Headers(request.headers);
  for(const key of [...headers.keys()])if(key.startsWith('oai-')||key==='authorization')headers.delete(key);
  headers.set('oai-authenticated-user-id',matched[0]);
  return core.fetch(new Request(request,{headers}),env);
 }};
}
export default createStandalone();
