import { env } from 'cloudflare:workers';
export const db = () => (env as unknown as {DB:D1Database}).DB;
export const bucket = () => (env as unknown as {BUCKET:R2Bucket}).BUCKET;
export const hash = async(s:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export class Fault extends Error { constructor(public status:number,message:string){super(message);} }
export async function limited(req:Request,action:string,max:number,seconds:number){
 const now=Date.now(), window=Math.floor(now/(seconds*1000));
 const key=await hash(`${req.headers.get('cf-connecting-ip')||'local'}:${action}:${window}`);
 const r=await db().prepare('INSERT INTO limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,now+seconds*2000).first<{count:number}>();
 if(!r||r.count>max)throw new Fault(429,'Too many attempts. Please try again later.');
}
export async function cleanupRoom(id:string){
 const files=await db().prepare("SELECT id FROM items WHERE room=? AND kind='file'").bind(id).all<{id:string}>();
 if(files.results.length)await bucket().delete(files.results.map(x=>x.id));
 await db().batch([db().prepare('DELETE FROM items WHERE room=?').bind(id),db().prepare('DELETE FROM sessions WHERE room=?').bind(id),db().prepare('DELETE FROM rooms WHERE id=?').bind(id)]);
}
export async function cleanup(){
 const old=await db().prepare('SELECT id FROM rooms WHERE expires <= ? LIMIT 10').bind(Date.now()).all<{id:string}>();
 for(const room of old.results)await cleanupRoom(room.id);
 await db().prepare('DELETE FROM limits WHERE expires < ?').bind(Date.now()).run();
}
export async function readLimited(req:Request,max:number){
 const reader=req.body?.getReader();if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Fault(413,'Content exceeds the allowed size.');}chunks.push(value);}
 const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;
}
export async function readJson(req:Request,max:number){try{return JSON.parse(new TextDecoder().decode(await readLimited(req,max)));}catch(e){if(e instanceof Fault)throw e;throw new Fault(400,'Invalid request.');}}
export async function session(req:Request){
 const token=req.headers.get('cookie')?.match(/(?:^|;\s*)relay=([^;]+)/)?.[1];
 if(!token)throw new Fault(401,'Create a room or enter a code to continue.');
 const s=await db().prepare('SELECT rooms.*, sessions.owner FROM sessions JOIN rooms ON rooms.id=sessions.room WHERE sessions.token=? AND rooms.expires>?').bind(await hash(token),Date.now()).first<{id:string;code:string;expires:number;owner:number;bytes:number;count:number}>();
 if(!s)throw new Fault(401,'This room has expired or was closed.');return s;
}
export async function attach(room:string,owner:number){
 const token=crypto.randomUUID()+crypto.randomUUID();
 await db().prepare('INSERT INTO sessions (token,room,owner) VALUES (?,?,?)').bind(await hash(token),room,owner).run();
 return `relay=${token}; Path=/api/relay; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
}
