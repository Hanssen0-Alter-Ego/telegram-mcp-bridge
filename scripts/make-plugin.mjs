import {mkdirSync,writeFileSync} from 'node:fs';
const u=new URL(process.argv[2]);
if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/mcp')throw Error('Supply actual deployed HTTPS /mcp endpoint, without credentials or query');
const out='telegram-mcp-plugin';mkdirSync(out,{recursive:true});
writeFileSync(`${out}/plugin.json`,JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'telegram-selfhost',version:'0.1.0',description:'Explicit authorized Telegram reading and sending; configuration-file access rules.',extensions:{'com.openai':{interface:{displayName:'Telegram Self-hosted',shortDescription:'Read and send approved chats',capabilities:[]}}}},null,2)+'\n');
writeFileSync(`${out}/mcp.json`,JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{telegram:{type:'streamable-http',url:u.href,extensions:{'com.openai':{auth:{type:'api_key',headerScheme:'bearer'}}}}}},null,2)+'\n');
console.log(`Wrote ${out}. No credential included. Verify endpoint before creating/installing plugin.`);
