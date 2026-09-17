// Runs the actual route source against local D1/R2 emulators; never touches production.
import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {getPlatformProxy} from 'wrangler';
const proxy=await getPlatformProxy({configPath:'dist/server/wrangler.json',persist:false});
try {
 const migration=await fs.readFile('drizzle/0000_natural_talon.sql','utf8');
 for(const sql of migration.split('--> statement-breakpoint'))if(sql.trim())await proxy.env.DB.prepare(sql).run();
 const source=(await fs.readFile('lib/relay-server.ts','utf8')).replace("import { env } from 'cloudflare:workers';",'');
 const route=(await fs.readFile('app/api/relay/route.ts','utf8')).replace(/^import .*?;\n/,'');
 const compiled=ts.transpile(source+'\n'+route,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
 const factory=new Function('env',compiled.replace(/export /g,'')+'\nreturn {GET,POST,DELETE,hash};');
 const api=factory(proxy.env);
 const origin='https://relay.test';
 async function request(method,query='',cookie='',body,extra={}){
  const headers={Origin:origin,...extra};if(cookie)headers.Cookie=cookie;
  if(body && typeof body==='object'){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  if(body!==undefined)headers['Content-Length']=String(new TextEncoder().encode(body).length);
  return api[method](new Request(origin+'/api/relay'+(query?'?'+query:''),{method,headers,body}));
 }
 const created=await request('POST','action=create','',{minutes:15});assert.equal(created.status,201);const {code}=await created.json();assert.match(code,/^\d{8}$/);const owner=created.headers.get('set-cookie').split(';')[0];assert.match(created.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await request('GET')).status,401);
 assert.equal((await request('POST','action=text',owner,{text:'blocked'},{Origin:'https://foreign.test'})).status,403);
 assert.equal((await request('POST','action=text',owner,{text:'<script>alert(1)</script> test note'})).status,201);
 const joined=await request('POST','action=join','',{code});assert.equal(joined.status,200);const guest=joined.headers.get('set-cookie').split(';')[0];
 const view=await (await request('GET','',guest)).json();assert.equal(view.items[0].body,'<script>alert(1)</script> test note');assert.equal(view.room.owner,false);
 assert.equal((await request('DELETE','action=close',guest)).status,403);
 assert.equal((await request('POST','action=upload',owner,'file bytes',{'x-file-name':'folder%2Fhello.txt'})).status,201);
 const files=await (await request('GET','',guest)).json();const file=files.items.find(i=>i.kind==='file');assert.equal(file.name,'folder/hello.txt');
 const downloaded=await request('GET','action=download&id='+file.id,guest);assert.equal(await downloaded.text(),'file bytes');assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.match(downloaded.headers.get('content-disposition'),/^attachment/);
 const second=await request('POST','action=create','',{minutes:15});const outsider=second.headers.get('set-cookie').split(';')[0];assert.equal((await request('GET','action=download&id='+file.id,outsider)).status,404);assert.equal((await request('DELETE','id='+file.id,outsider)).status,404);
 assert.equal((await request('POST','action=upload',owner,'bad',{'x-file-name':'..%2Fbad.txt'})).status,400);
 assert.equal((await request('DELETE','id='+file.id,guest)).status,200);assert.equal((await request('GET','action=download&id='+file.id,owner)).status,404);
 assert.equal((await request('DELETE','action=close',owner)).status,200);assert.equal((await request('GET','',guest)).status,401);
 const expCode=(await second.json()).code;await proxy.env.DB.prepare('UPDATE rooms SET expires=0 WHERE code=?').bind(await api.hash(expCode)).run();assert.equal((await request('GET','',outsider)).status,401);
 let limited=false;for(let i=0;i<16;i++){const r=await request('POST','action=join','',{code:'not-code'});if(r.status===429){limited=true;break;}}assert.equal(limited,true);
 console.log('PASS: create, code, cookie flags, join, text, folder path upload, byte-exact download, unauthorized access, cross-room isolation, CSRF rejection, traversal rejection, delete, creator-only close, expiry, join rate limiting.');
} finally {await proxy.dispose();}
