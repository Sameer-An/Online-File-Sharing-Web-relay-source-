import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
const source=await fs.readFile('lib/share-transfer.ts','utf8');
const code=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022});
let current;
class FakeXHR {
 constructor(){current=this;this.upload={};this.headers={};}
 open(method,url){this.method=method;this.url=url;}
 setRequestHeader(name,value){this.headers[name]=value;}
 send(body){this.body=body;}
}
const {sendTransfer}=new Function('XMLHttpRequest',code.replace(/export /g,'')+'\nreturn {sendTransfer};')(FakeXHR);
let values=[],confirmed=false;
const pending=sendTransfer('upload',new Blob(['test']),{'X-File-Name':'test.txt'},p=>values.push(p)).then(()=>{confirmed=true;});
assert.equal(current.url,'/api/relay?action=upload');
current.upload.onprogress({loaded:2,total:4,lengthComputable:true});assert.equal(values.at(-1).percent,50);
current.upload.onload();await Promise.resolve();assert.equal(values.at(-1).phase,'saving');assert.equal(confirmed,false);
current.status=201;current.responseText='{"ok":true}';current.onload();await pending;assert.equal(confirmed,true);
const rejected=sendTransfer('text','{"text":"hello"}',{'Content-Type':'application/json'},()=>{});
current.status=413;current.responseText='{"error":"Room limit reached"}';current.onload();await assert.rejects(rejected,e=>e.message==='Room limit reached'&&!e.unconfirmed);
const uncertain=sendTransfer('upload',new Blob(['x']),{},()=>{});current.onerror();await assert.rejects(uncertain,e=>e.unconfirmed&&e.message.includes('Check the shared list'));
const timeout=sendTransfer('text','{}',{},()=>{});current.ontimeout();await assert.rejects(timeout,e=>e.unconfirmed);
const unknown=sendTransfer('text','{}',{},()=>{});current.status=200;current.responseText='<html>login</html>';current.onload();await assert.rejects(unknown,e=>e.unconfirmed);
console.log('PASS: byte progress, no success before confirmation, confirmed success, server rejection, network uncertainty, timeout and unexpected response.');
