import {it,expect,vi} from 'vitest';
import {filmTransport} from './filmTransport';
it('uses the existing bearer session once and preserves the paid request ID without cookies',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({accepted:true}));
 await filmTransport(async()=>({Authorization:'Bearer synthetic-session'}),()=>true,fetcher)('project.generate',{projectId:'p',rentalId:'r',approved:true},'same-request-id');
 expect(fetcher).toHaveBeenCalledOnce();const [url,init]=fetcher.mock.calls[0];expect(url).toBe('/api/mashhad-film');expect(init?.credentials).toBe('omit');expect(init?.headers).toEqual({Authorization:'Bearer synthetic-session','Content-Type':'application/json'});expect(JSON.parse(init?.body as string)).toEqual({operation:'project.generate',input:{projectId:'p',rentalId:'r',approved:true},requestId:'same-request-id'});
});
it('does not dispatch for a changed actor and never retries an uncertain paid request',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>{throw Error('offline');});
 await expect(filmTransport(async()=>({Authorization:'Bearer fixture'}),()=>false,fetcher)('session',{},'request-id')).rejects.toThrow('تغيّر الحساب');expect(fetcher).not.toHaveBeenCalled();
 await expect(filmTransport(async()=>({Authorization:'Bearer fixture'}),()=>true,fetcher)('rental.start',{},'paid-request-id')).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});
