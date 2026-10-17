import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {BunnyStorage,bunnyConfig} from './bunny-storage';
const config={zone:'fixture',endpoint:'https://storage.bunnycdn.com',accessKey:'private-fixture-key'};
it('streams and verifies an exact private copy; reports progress without exposing the key',async()=>{
 const bytes=new TextEncoder().encode('original bytes'),blob=new Blob([bytes],{type:'video/mp4'}),hash=createHash('sha256').update(bytes).digest('hex'),progress:number[]=[];
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{if(init?.method==='PUT'){const reader=(init.body as ReadableStream<Uint8Array>).getReader();while(!(await reader.read()).done){/* consume upload */}return new Response('',{status:201});}return new Response(bytes);});
 const storage=new BunnyStorage(config,fetcher as typeof fetch),asset=await storage.upload('owner',blob,hash,n=>progress.push(n));expect(asset.size).toBe(bytes.length);expect(asset.verified).toBe(true);expect(progress.at(-1)).toBe(bytes.length);expect(JSON.stringify(asset)).not.toContain(config.accessKey);expect(JSON.stringify(storage)).not.toContain(config.accessKey);expect(fetcher).toHaveBeenCalledTimes(2);
 await expect(storage.read('other',asset)).rejects.toThrow('لا يخص');expect(fetcher).toHaveBeenCalledTimes(2);
 await expect(storage.removeAfterPublication('owner',asset,['ig','yt'],[{targetId:'ig',status:'published'},{targetId:'yt',status:'accepted'}],true)).rejects.toThrow('جميع');expect(fetcher).toHaveBeenCalledTimes(2);
 await storage.removeAfterPublication('owner',asset,['ig','yt'],[{targetId:'ig',status:'published'},{targetId:'yt',status:'published'}],true);expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
});
it('rejects unsafe endpoints, traversal and corrupted copies; no automatic deletion',async()=>{
 expect(bunnyConfig({})).toBeNull();expect(()=>new BunnyStorage({...config,endpoint:'http://storage.bunnycdn.com'})).toThrow();expect(()=>new BunnyStorage({...config,endpoint:'https://attacker.example'})).toThrow();
 const fetcher=vi.fn(async(_url:unknown,_init?:RequestInit)=>{void _url;void _init;return new Response('corrupt');}),storage=new BunnyStorage(config,fetcher as typeof fetch);
 await expect(storage.verify('owner','../fixture','a'.repeat(64),7)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 const path='media/'+createHash('sha256').update('owner').digest('hex')+'/'+'a'.repeat(64)+'.mp4';await expect(storage.verify('owner',path,'a'.repeat(64),7)).rejects.toThrow('تطابق');expect(fetcher.mock.calls.every(c=>(c[1] as RequestInit|undefined)?.method!=='DELETE')).toBe(true);
});
it('serves only owner-bound verified byte ranges and rejects mismatched responses',async()=>{
 const asset={subject:'owner',path:'media/'+createHash('sha256').update('owner').digest('hex')+'/'+'a'.repeat(64)+'.mp4',sha256:'a'.repeat(64),size:100,type:'video/mp4',verified:true as const};
 const fetcher=vi.fn(async()=>new Response(new Uint8Array([3,4]),{status:206,headers:{'Content-Range':'bytes 3-4/100'}}));const storage=new BunnyStorage(config,fetcher);
 expect(await new Response(await storage.readRange('owner',asset,3,4)).arrayBuffer()).toEqual(new Uint8Array([3,4]).buffer);
 await expect(storage.readRange('other',asset,3,4)).rejects.toThrow('لا يخص');await expect(storage.readRange('owner',asset,100,101)).rejects.toThrow('غير صالح');expect(fetcher).toHaveBeenCalledTimes(1);
 fetcher.mockImplementation(async()=>new Response(new Uint8Array([3,4]),{status:200}));await expect(storage.readRange('owner',asset,3,4)).rejects.toThrow('غير مطابق');
});
