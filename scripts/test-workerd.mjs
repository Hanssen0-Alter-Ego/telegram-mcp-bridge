// Real Workers-runtime regression test. Requires workerd on PATH or WORKERD_BIN.
// No Telegram requests: all subrequests are routed to an in-process fake service.
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'telegram-workerd-'));
let child,logs='';
try {
 for(const [from,to] of [['worker/index.js','index.js'],['config/destinations.js','destinations.js'],['tests/runtime/handler.js','handler.js'],['tests/runtime/upstream.js','upstream.js']])await copyFile(new URL('../'+from,import.meta.url),join(directory,to));
 // Preserve the source's relative import without changing its implementation.
 const {mkdir}=await import('node:fs/promises');await mkdir(join(directory,'config'));await mkdir(join(directory,'worker'));
 await copyFile(join(directory,'index.js'),join(directory,'worker/index.js'));
 await copyFile(new URL('../worker/attachments.js',import.meta.url),join(directory,'worker/attachments.js'));
 await copyFile(new URL('../worker/diagnostics.js',import.meta.url),join(directory,'worker/diagnostics.js'));
 await copyFile(join(directory,'destinations.js'),join(directory,'config/destinations.js'));
 await copyFile(join(directory,'handler.js'),join(directory,'worker/handler.js'));
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 await writeFile(join(directory,'config.capnp'),`using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
services = [
(name="main",worker=(compatibilityDate="2026-10-26",globalOutbound="mock",modules=[
(name="worker/handler.js",esModule=embed "worker/handler.js"),
(name="worker/index.js",esModule=embed "worker/index.js"),
(name="worker/attachments.js",esModule=embed "worker/attachments.js"),
(name="worker/diagnostics.js",esModule=embed "worker/diagnostics.js"),
(name="config/destinations.js",esModule=embed "config/destinations.js")
])),
(name="mock",worker=(compatibilityDate="2026-10-26",modules=[(name="upstream.js",esModule=embed "upstream.js")]))
],sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);`);
 child=spawn(process.env.WORKERD_BIN||'workerd',['serve',join(directory,'config.capnp')],{stdio:['ignore','pipe','pipe']});
 let launchError;child.on('error',e=>{launchError=e});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 let response;
 for(let attempt=0;attempt<100;attempt++){
  if(launchError)throw launchError;if(child.exitCode!==null)throw Error(`workerd exited: ${logs}`);
  try{response=await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(5000)});break;}catch{await new Promise(r=>setTimeout(r,50));}
 }
 assert.ok(response,`workerd did not start: ${logs}`);const result=await response.json();
 assert.equal(result.attachmentBoundary.status,'sent');assert.equal(result.attachmentBoundary.message_id,45);
 assert.equal(result.attachment.status,'sent');assert.equal(result.attachment.message_id,44);
 assert.equal(result.send.status,'sent');assert.equal(result.send.message_id,42);
 assert.equal(result.edit.status,'sent');assert.equal(result.edit.message_id,42);
 assert.equal(result.redirectEdit.status,'unknown');assert.equal(result.redirectEdit.do_not_retry,true);
 assert.equal(result.html.status,'sent');assert.equal(result.html.message_id,43);
 assert.equal(result.markdown.status,'sent');assert.equal(result.markdown.message_id,43);
 assert.equal(result.read.sync.status,'synced');assert.deepEqual(result.read.messages,[]);
 assert.equal(result.redirectSend.status,'unknown');assert.equal(result.redirectSend.do_not_retry,true);
 assert.equal(result.redirectRead.sync.status,'retrieval_failed');
 console.log('PASS: real workerd multipart attachment, plain/HTML/MarkdownV2 sends, edit, read, and refused redirects (offline mock upstream).');
} finally {
 if(child?.pid&&child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}
 await rm(directory,{recursive:true,force:true});
}
