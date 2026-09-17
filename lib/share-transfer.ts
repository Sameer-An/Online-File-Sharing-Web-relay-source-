export type TransferPhase = 'queued' | 'uploading' | 'saving' | 'shared' | 'failed' | 'unconfirmed';
export type Transfer = { id:string; name:string; phase:TransferPhase; percent:number|null; loaded:number; total:number; message?:string };
export class TransferError extends Error {
  constructor(message:string, public unconfirmed=false){super(message);}
}
// Upload events measure bytes sent. Only a successful server response confirms storage.
export function sendTransfer(action:'upload'|'text',body:Blob|string,headers:Record<string,string>,onProgress:(value:Partial<Transfer>)=>void):Promise<void>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('POST',`/api/relay?action=${action}`);
  xhr.timeout=10*60*1000;
  for(const [name,value] of Object.entries(headers))xhr.setRequestHeader(name,value);
  xhr.upload.onprogress=e=>onProgress({phase:'uploading',loaded:e.loaded,total:e.lengthComputable?e.total:0,percent:e.lengthComputable?Math.min(100,Math.floor(e.loaded/e.total*100)):null});
  xhr.upload.onload=()=>onProgress({phase:'saving',percent:100});
  xhr.onload=()=>{
   let data:{ok?:boolean;error?:string};
   try{data=JSON.parse(xhr.responseText);}catch{reject(new TransferError('Unexpected response. Check the shared list before retrying.',true));return;}
   if(xhr.status>=200&&xhr.status<300&&data.ok===true){resolve();return;}
   reject(new TransferError(data.error||'Sharing was not accepted. Please retry.',xhr.status>=500));
  };
  xhr.onerror=()=>reject(new TransferError('Connection lost. Check the shared list before retrying; the server may have received this item.',true));
  xhr.ontimeout=()=>reject(new TransferError('Confirmation timed out. Check the shared list before retrying.',true));
  xhr.onabort=()=>reject(new TransferError('Transfer interrupted. Check the shared list before retrying.',true));
  onProgress({phase:'uploading',percent:0,loaded:0});
  xhr.send(body);
 });
}
