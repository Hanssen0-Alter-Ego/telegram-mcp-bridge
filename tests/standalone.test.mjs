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
