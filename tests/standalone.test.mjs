import test from 'node:test';
import assert from 'node:assert/strict';
import {createStandalone} from '../worker/standalone.js';
const c={enabled:false,destinations:{a:{chatId:'123',description:'a',purpose:'a',canRead:true,canSend:true,allowedCallerIds:['alice']},b:{chatId:'456',description:'b',purpose:'b',canRead:true,canSend:true,allowedCallerIds:['bob']}},maxTextLength:4096,timeoutMs:1000};
const clients={alice:{secretEnv:'MCP_CLIENT_ALICE'},bob:{secretEnv:'MCP_CLIENT_BOB'}};
const env={MCP_CLIENT_ALICE:'a'.repeat(43),MCP_CLIENT_BOB:'b'.repeat(43)};
function req(token,spoof='bob'){return new Request('https://example.test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':spoof,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'telegram_status'}})});}
test('standalone rejects Sites header spoof, missing/invalid bearer before network',async()=>{const w=createStandalone(c,clients,()=>assert.fail('network'));for(const t of [null,'bad','c'.repeat(43)])assert.equal((await w.fetch(req(t),env)).status,401);});
test('standalone derives principal from key, not spoofed header',async()=>{const r=await createStandalone(c,clients).fetch(req(env.MCP_CLIENT_ALICE),env);const j=JSON.parse((await r.json()).result.content[0].text);assert.equal(j.caller_id,'alice');assert.deepEqual(j.destinations.map(d=>d.alias),['a']);assert.equal(JSON.stringify(j).includes(env.MCP_CLIENT_ALICE),false);});
test('standalone duplicate secret values fail closed',async()=>assert.equal((await createStandalone(c,clients).fetch(req(env.MCP_CLIENT_ALICE),{...env,MCP_CLIENT_BOB:env.MCP_CLIENT_ALICE})).status,401));
test('standalone rotated key denies old credential',async()=>assert.equal((await createStandalone(c,clients).fetch(req(env.MCP_CLIENT_ALICE),{...env,MCP_CLIENT_ALICE:'d'.repeat(43)})).status,401));
function pathReq(path,headers={}){return new Request('https://example.test'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'telegram_status'}})});}
test('private path key authenticates per-client and sanitizes responses',async()=>{
 const r=await createStandalone(c,clients).fetch(pathReq('/mcp/'+env.MCP_CLIENT_ALICE,{'oai-authenticated-user-id':'bob'}),{...env,PUBLIC_ORIGIN:'https://example.test'});
 assert.equal(r.status,200);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 const text=await r.text();assert.ok(!text.includes(env.MCP_CLIENT_ALICE));
 const j=JSON.parse(JSON.parse(text).result.content[0].text);assert.equal(j.caller_id,'alice');assert.deepEqual(j.destinations.map(d=>d.alias),['a']);
});
test('path auth fails closed for malformed, query, competing, browser and origin cases',async()=>{
 const w=createStandalone(c,clients,()=>assert.fail('network')),e={...env,PUBLIC_ORIGIN:'https://example.test'};
 for(const [path,h] of [['/mcp/bad',{}],['/mcp/'+env.MCP_CLIENT_ALICE+'?q=1',{}],['/mcp/'+env.MCP_CLIENT_ALICE+'/',{}],['/mcp/'+env.MCP_CLIENT_ALICE,{authorization:'Bearer '+env.MCP_CLIENT_BOB}],['/mcp/'+env.MCP_CLIENT_ALICE,{origin:'https://example.test'}]])assert.equal((await w.fetch(pathReq(path,h),e)).status,401);
 for(const origin of [undefined,'https://other.test','https://example.test/'])assert.equal((await w.fetch(pathReq('/mcp/'+env.MCP_CLIENT_ALICE),{...env,PUBLIC_ORIGIN:origin})).status,401);
});
test('path key rotation and duplicate keys fail closed',async()=>{
 const w=createStandalone(c,clients),r=()=>pathReq('/mcp/'+env.MCP_CLIENT_ALICE);
 assert.equal((await w.fetch(r(),{...env,PUBLIC_ORIGIN:'https://example.test',MCP_CLIENT_ALICE:'x'.repeat(43)})).status,401);
 assert.equal((await w.fetch(r(),{...env,PUBLIC_ORIGIN:'https://example.test',MCP_CLIENT_BOB:env.MCP_CLIENT_ALICE})).status,401);
});
test('path authenticated notification supports empty 204 response',async()=>{
 const r=new Request('https://example.test/mcp/'+env.MCP_CLIENT_ALICE,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
 const response=await createStandalone(c,clients).fetch(r,{...env,PUBLIC_ORIGIN:'https://example.test'});assert.equal(response.status,204);assert.equal(await response.text(),'');
});
test('path credential cannot select another client destination',async()=>{
 const r=new Request('https://example.test/mcp/'+env.MCP_CLIENT_ALICE,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'telegram_read',arguments:{destination:'b'}}})});
 const response=await createStandalone({...c,enabled:true},clients,()=>assert.fail('network')).fetch(r,{...env,PUBLIC_ORIGIN:'https://example.test'});assert.equal((await response.json()).result.isError,true);
});
