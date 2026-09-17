import {db,bucket,hash,Fault,limited,cleanup,cleanupRoom,readLimited,readJson,session,attach} from '@/lib/relay-server';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data:unknown,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
async function run(req:Request){
 try {
  if(req.method!=='GET' && req.headers.get('origin')!==new URL(req.url).origin)throw new Fault(403,'Request origin is not allowed.');
  const url=new URL(req.url),action=url.searchParams.get('action');
  if(req.method==='POST' && (action==='create'||action==='join')){
   await limited(req,action,action==='create'?10:15,600);
   if(Number(req.headers.get('content-length'))>2048)throw new Fault(413,'Request too large.');
   const body=await readJson(req,2048) as {code?:string;minutes?:number};
   await cleanup();
   if(action==='join'){
    if(!/^\d{8}$/.test(body.code||''))throw new Fault(400,'Enter all 8 digits.');
    const room=await db().prepare('SELECT id FROM rooms WHERE code=? AND expires>?').bind(await hash(body.code!),Date.now()).first<{id:string}>();
    if(!room)throw new Fault(404,'Code unavailable. Check the code or ask for a new room.');
    return json({ok:true},200,{'Set-Cookie':await attach(room.id,0)});
   }
   const minutes=[15,60,360,1440].includes(body.minutes||0)?body.minutes!:60;
   const id=crypto.randomUUID(),expires=Date.now()+minutes*60000;
   for(let i=0;i<8;i++){
    // Rejection sampling avoids modulo bias in the eight-digit access code.
    let n:number; do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=4200000000);
    const code=String(n%100000000).padStart(8,'0');
    const result=await db().prepare('INSERT OR IGNORE INTO rooms (id,code,expires,bytes,count) VALUES (?,?,?,0,0)').bind(id,await hash(code),expires).run();
    if(result.meta.changes)return json({code},201,{'Set-Cookie':await attach(id,1)});
   }
   throw new Fault(503,'Unable to create a room. Try again.');
  }
  const room=await session(req);
  if(req.method==='GET'){
   if(action==='download'){
    const item=await db().prepare("SELECT id,name FROM items WHERE id=? AND room=? AND kind='file'").bind(url.searchParams.get('id'),room.id).first<{id:string;name:string}>();
    if(!item)throw new Fault(404,'File no longer available.');
    const file=await bucket().get(item.id);if(!file)throw new Fault(404,'File no longer available.');
    return new Response(file.body,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(item.name.split('/').pop()||'download')}`,'Content-Security-Policy':"sandbox; default-src 'none'"}});
   }
   const items=await db().prepare('SELECT id,name,body,size,kind,created FROM items WHERE room=? ORDER BY created DESC, id DESC').bind(room.id).all();
   return json({room:{expires:room.expires,owner:!!room.owner,bytes:room.bytes},items:items.results});
  }
  await limited(req,'write',120,60);
  if(req.method==='DELETE'){
   if(action==='close'){
    if(!room.owner)throw new Fault(403,'Only the creator can close this room.');
    await db().prepare('UPDATE rooms SET expires=0 WHERE id=?').bind(room.id).run();await cleanupRoom(room.id);return json({ok:true});
   }
   const id=url.searchParams.get('id');
   const item=await db().prepare('SELECT id,kind,size FROM items WHERE id=? AND room=?').bind(id,room.id).first<{id:string;kind:string;size:number}>();
   if(!item)throw new Fault(404,'Item already removed.');
   if(item.kind==='file')await bucket().delete(item.id);
   // Quota reflects cumulative writes, so concurrent deletion cannot undercount.
   await db().prepare('DELETE FROM items WHERE id=? AND room=?').bind(id,room.id).run();return json({ok:true});
  }
  if(req.method==='POST' && action==='leave')return json({ok:true},200,{'Set-Cookie':'relay=; Path=/api/relay; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
  if(req.method!=='POST')throw new Fault(405,'Method not allowed.');
  let name='Text note',body:string|null=null,size=0,kind='text';const id=crypto.randomUUID();
  let bytes:ArrayBuffer|undefined;
  if(action==='upload'){
   kind='file';
   const length=Number(req.headers.get('content-length'));if(!length||length>20*1024*1024)throw new Fault(413,'Choose a non-empty file up to 20 MB.');
   name=decodeURIComponent(req.headers.get('x-file-name')||'file');
   if(name.length>300||name.split('/').some(p=>p==='..'||p==='.')||/[\x00-\x1f\\]/.test(name))throw new Fault(400,'Invalid file path.');
   bytes=(await readLimited(req,20*1024*1024)).buffer as ArrayBuffer;size=bytes.byteLength;if(size>20*1024*1024)throw new Fault(413,'File exceeds 20 MB.');
  }else if(action==='text'){
   if(Number(req.headers.get('content-length'))>24000)throw new Fault(413,'Text is too long.');
   const data=await readJson(req,24000) as {text?:string};body=data.text?.trim()||'';
   if(!body||body.length>5000)throw new Fault(400,'Enter between 1 and 5,000 characters.');size=new TextEncoder().encode(body).length;
  }else throw new Fault(400,'Unknown action.');
  const reserved=await db().prepare('UPDATE rooms SET bytes=bytes+?,count=count+1 WHERE id=? AND bytes+?<=104857600 AND count<100 AND expires>? RETURNING id').bind(size,room.id,size,Date.now()).first();
  if(!reserved)throw new Fault(413,'Room limit reached: 100 items or 100 MB uploaded. Create a new room.');
  try{
   if(bytes)await bucket().put(id,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
   await db().prepare('INSERT INTO items (id,room,name,body,size,created,kind) VALUES (?,?,?,?,?,?,?)').bind(id,room.id,name,body,size,Date.now(),kind).run();
  }catch(e){if(bytes)await bucket().delete(id);await db().prepare('UPDATE rooms SET bytes=MAX(0,bytes-?),count=MAX(0,count-1) WHERE id=?').bind(size,room.id).run();throw e;}
  // If expiration raced the upload, remove the newly written object immediately.
  const alive=await db().prepare('SELECT id FROM rooms WHERE id=? AND expires>?').bind(room.id,Date.now()).first();
  if(!alive){if(bytes)await bucket().delete(id);await db().prepare('DELETE FROM items WHERE id=?').bind(id).run();throw new Fault(410,'Room expired during upload.');}
  return json({ok:true},201);
 }catch(e){if(e instanceof Fault)return json({error:e.message},e.status);console.error('Relay storage operation failed',e instanceof Error?e.message:'unknown');return json({error:'Sharing is temporarily unavailable. Your unsent content has been kept. Please retry.'},503);}
}
export const GET=run;export const POST=run;export const DELETE=run;
