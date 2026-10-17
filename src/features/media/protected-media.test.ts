import {afterEach,it,expect,vi} from 'vitest';
import {ProtectedMediaCache,downloadProtectedMedia} from './protected-media';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()});
it('shares a session download between card and player and retries errors without regeneration',async()=>{
 const cache=new ProtectedMediaCache(),loader=vi.fn(async()=>new Blob(['mp4']));const [card,player]=await Promise.all([cache.get('one',loader),cache.get('one',loader)]);
 expect(card).toBe(player);expect(loader).toHaveBeenCalledTimes(1);expect(await cache.get('one',loader)).toBe(card);
 const fails=vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValue(new Blob(['retry']));await expect(cache.get('two',fails)).rejects.toThrow('disconnected');expect((await cache.get('two',fails)).size).toBe(5);expect(fails).toHaveBeenCalledTimes(2);cache.dispose();
});
it('cancelling a card does not cancel an active player sharing the same file',async()=>{
 const cache=new ProtectedMediaCache(),abort=new AbortController();let finish!:(b:Blob)=>void;const loader=vi.fn(()=>new Promise<Blob>(resolve=>{finish=resolve}));
 const card=cache.get('one',loader,abort.signal),player=cache.get('one',loader);const cancelled=expect(card).rejects.toMatchObject({name:'AbortError'});abort.abort();finish(new Blob(['ok']));await cancelled;expect((await player).size).toBe(2);expect(loader).toHaveBeenCalledTimes(1);cache.dispose();
});
it('limits simultaneous gallery downloads and drops access on logout',async()=>{
 const cache=new ProtectedMediaCache();let active=0,max=0;const loaders=Array.from({length:8},(_,i)=>cache.get(String(i),async signal=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));active--;if(signal.aborted)throw new Error('cancelled');return new Blob(['ok'])}));
 await Promise.all(loaders);expect(max).toBe(3);cache.dispose();await expect(cache.get('0',async()=>new Blob())).rejects.toMatchObject({name:'AbortError'});
});
it('uses actual received bytes and rejects truncated protected downloads',async()=>{
 const progress=vi.fn();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({size:3,type:'video/mp4'})).mockResolvedValueOnce(new Response(new Blob(['mp4']))));
 expect((await downloadProtectedMedia('https://example.invalid/files?id=1',async()=>'test-only',new AbortController().signal,progress)).size).toBe(3);expect(progress.mock.calls.map(([p])=>p)).toEqual([{loaded:0,total:3},{loaded:3,total:3}]);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({size:4,type:'video/mp4'})).mockResolvedValueOnce(new Response(new Blob(['mp4']))));await expect(downloadProtectedMedia('https://example.invalid/files?id=1',async()=>'test-only',new AbortController().signal,progress)).rejects.toThrow('غير مكتمل');
});
it('turns a hanging body into a visible timeout instead of loading forever',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({size:3,type:'video/mp4'})).mockResolvedValueOnce({ok:true,blob:()=>new Promise(()=>{})}));
 const download=downloadProtectedMedia('https://example.invalid/files?id=1',async()=>'test-only',new AbortController().signal,()=>{},100);const failure=expect(download).rejects.toThrow('مهلة');await vi.advanceTimersByTimeAsync(101);await failure;
});
