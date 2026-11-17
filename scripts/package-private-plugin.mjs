import {readFile,mkdir,mkdtemp,writeFile,copyFile,chmod,rename,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: npm run plugin:build -- [--env-file .env.plugin] [--output-dir artifacts]';
let stage;const mask=process.umask(0o077);
try{
 const args=process.argv.slice(2);let input=resolve('.env.plugin'),out=resolve('artifacts');const seen=new Set();
 if(args.length===1&&args[0]==='--help'){console.log(usage);process.exit(0);}
 for(let i=0;i<args.length;i++){
  const k=args[i];if(!['--env-file','--output-dir'].includes(k)||seen.has(k)||!args[i+1]||args[i+1].startsWith('--'))throw Error();seen.add(k);
  if(k==='--env-file')input=resolve(args[++i]);else out=resolve(args[++i]);
 }
 const env=parseEnv(await readFile(input,'utf8'));const origin=new URL(env.PUBLIC_ORIGIN);
 if(origin.protocol!=='https:'||origin.origin!==env.PUBLIC_ORIGIN||origin.username||origin.password||! /^[A-Za-z0-9_-]{43,128}$/.test(env.MCP_CLIENT_KEY??''))throw Error();
 await mkdir(out,{recursive:true,mode:0o700});stage=await mkdtemp(join(out,'.telegram-private-'));
 const folder=join(stage,'telegram-selfhost');await mkdir(join(folder,'skills/telegram'),{recursive:true,mode:0o700});
 const manifest={name:'telegram-selfhost',version:'0.2.0',description:'Explicit read and authorized send for configured Telegram destinations.',author:{name:'Hanssen0-Alter-Ego'},extensions:{'com.openai':{interface:{displayName:'Telegram Self-hosted',shortDescription:'Read and send approved chats',capabilities:['Read','Write']}}}};
 const server={type:'streamable-http',url:origin.origin+'/mcp/'+env.MCP_CLIENT_KEY,extensions:{'com.openai':{auth:{type:'none'}}}};
 await writeFile(join(folder,'plugin.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 await writeFile(join(folder,'mcp.json'),JSON.stringify({mcpServers:{telegram:server}},null,2)+'\n',{mode:0o600});
 await mkdir(join(folder,'.codex-plugin'),{mode:0o700});
 await writeFile(join(folder,'.codex-plugin/plugin.json'),JSON.stringify({name:manifest.name,version:manifest.version,description:manifest.description,author:manifest.author,interface:manifest.extensions['com.openai'].interface,skills:'./skills',mcpServers:'./.mcp.json'},null,2)+'\n',{mode:0o600});
 await writeFile(join(folder,'.mcp.json'),JSON.stringify({mcpServers:{telegram:{...server,type:'http'}}},null,2)+'\n',{mode:0o600});
 await copyFile(join(root,'plugin/skills/telegram/SKILL.md'),join(folder,'skills/telegram/SKILL.md'));await chmod(join(folder,'skills/telegram/SKILL.md'),0o600);
 await writeFile(join(folder,'INSTALL.md'),'# PRIVATE plugin archive\n\nThis contains a client capability key. Anyone holding it can use that client’s configured Telegram permissions. Never publish it or its endpoint URL. It does not contain the Bot Token.\n\nUpload only through your private Plugin Creator installation flow; request installation/update without displaying connection configuration. auth=none means the platform adds no credential: the server still authenticates the secret path. If bundled MCP is not activated, use Plugins > Add custom MCP server, paste the endpoint locally and select None. Preserve the existing connection when adding the skill. Do not paste the endpoint into chat. Verify tools and actually call telegram_status. Do not send test messages without recipient/content authorization. Rotate this client key if the archive leaks.\n',{mode:0o600});
 const temp=join(stage,'archive.tar.gz');const tar=spawnSync('tar',['-czf',temp,'-C',stage,'telegram-selfhost'],{stdio:'pipe',shell:false});if(tar.status!==0)throw Error();await chmod(temp,0o600);
 await rename(temp,join(out,'telegram-mcp-private.tar.gz'));
 console.log('Created private plugin archive in output directory. Contains MCP client credential; do not share publicly. No secret printed.');
}catch{console.error('Private packaging failed. Check HTTPS PUBLIC_ORIGIN, MCP_CLIENT_KEY, local file permissions and tar. Never pass secrets as command arguments.');process.exitCode=1;}
finally{if(stage)await rm(stage,{recursive:true,force:true});process.umask(mask);}
