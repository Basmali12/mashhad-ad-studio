import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {filmTransport} from './filmTransport';
beforeEach(()=>vi.stubEnv('VITE_FILM_API_ORIGIN',''));
afterEach(()=>vi.unstubAllEnvs());
it('a rejected field is not misreported as an unavailable service and never echoes raw diagnostics',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({error:'INVALID_TOKEN_FORMAT',message:'private token diagnostic'},{status:400}));
 await expect(filmTransport(async()=>({Authorization:'Bearer fixture'}),()=>true,fetcher)('admin.account.link',{},'invalid-input-check')).rejects.toThrow('ak-');
 expect(fetcher).toHaveBeenCalledOnce();
 const unknown=filmTransport(async()=>({Authorization:'Bearer fixture'}),()=>true,async()=>Response.json({error:'RAW',message:'private token diagnostic'},{status:503}));
 await expect(unknown('session')).rejects.toThrow('HTTP 503');
 await expect(unknown('session')).rejects.not.toThrow('private token');
});
it('uses the configured scan gateway for the Pages deployment without cookies or redirects',async()=>{
 vi.stubEnv('VITE_FILM_API_ORIGIN','https://scan.iraqaistudio.com');
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({enabled:true}));
 await filmTransport(async()=>({Authorization:'Bearer synthetic-session'}),()=>true,fetcher)('session',{},'session-check');
 expect(fetcher.mock.calls[0][0]).toBe('https://scan.iraqaistudio.com/api/mashhad-film');
 expect(fetcher.mock.calls[0][1]?.credentials).toBe('omit');expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
});
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
