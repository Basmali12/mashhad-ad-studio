import {it,expect,vi} from 'vitest';
import {preparePersonalConnection,personalCredentialForOwner,personalConnectionView,selectPersonalChannels} from './buffer-personal-preparation';
const encryption=btoa('e'.repeat(32)),policy={environment:'test' as const,personalKeysApproved:true};
function provider(label:string){return vi.fn(async(_url:unknown,init?:RequestInit)=>{
 const query=JSON.parse(String(init?.body)).query as string;
 return Response.json({data:query.includes('organizations')?{account:{id:label,organizations:[{id:'org-'+label}]}}:{channels:[{id:'channel-'+label,name:label,organizationId:'org-'+label,service:'youtube',type:'channel',isDisconnected:false,isLocked:false}]}});
});}
it('keeps two mocked customer keys, channels, selections and encrypted records separate',async()=>{
 const a=await preparePersonalConnection('user-a','test-only-key-for-a',encryption,policy,provider('A'));
 const b=await preparePersonalConnection('user-b','test-only-key-for-b',encryption,policy,provider('B'));
 expect(personalConnectionView('user-a',a).channels[0].name).toBe('A');
 expect(personalConnectionView('user-b',b).channels[0].name).toBe('B');
 await expect(personalCredentialForOwner('user-a',b,encryption)).rejects.toThrow('wrong_owner');
 await expect(personalCredentialForOwner('user-b',{...a,subject:'user-b'},encryption)).rejects.toThrow();
 expect(()=>selectPersonalChannels('user-a',a,['channel-B'])).toThrow('invalid_selection');
 expect(()=>personalConnectionView('user-b',a)).toThrow('wrong_owner');
 expect(selectPersonalChannels('user-a',a,['channel-A']).selectedChannelIds).toEqual(['channel-A']);
 expect(JSON.stringify(a)).not.toContain('test-only-key-for-a');
 expect(JSON.stringify(personalConnectionView('user-a',a))).not.toContain(a.encryptedKey);
 expect(await personalCredentialForOwner('user-a',a,encryption)).toBe('test-only-key-for-a');
 expect(a.writePermission).toBe('unverified');
});
it('requires explicit operator authorization in every environment; never uses an owner key',async()=>{
 const fetcher=provider('A');
 for(const p of [{environment:'production' as const,personalKeysApproved:false},{environment:'test' as const,personalKeysApproved:false}])await expect(preparePersonalConnection('u','test-only-key-for-a',encryption,p,fetcher)).rejects.toThrow('disabled');
 await expect(preparePersonalConnection('u','',encryption,policy,fetcher)).rejects.toThrow('invalid_key');expect(fetcher).not.toHaveBeenCalled();
});
it('only sends read queries to the exact Buffer endpoint and forbids redirects',async()=>{
 const fetcher=provider('A');await preparePersonalConnection('u','test-only-key-for-a',encryption,policy,fetcher);
 for(const [url,init] of fetcher.mock.calls){expect(url).toBe('https://api.buffer.com');expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body)).query).not.toContain('mutation');}
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not expose provider reflections of secrets or retry rate-limited reads automatically',async()=>{
 const secret='test-only-private-fixture',fetcher=vi.fn(async()=>Response.json({errors:[{message:secret}]},{status:429,headers:{'Retry-After':'90'}}));
 await expect(preparePersonalConnection('u',secret,encryption,policy,fetcher)).rejects.toMatchObject({code:'rate_limited',retryAfterSeconds:90});expect(fetcher).toHaveBeenCalledTimes(1);
 await expect(preparePersonalConnection('u',secret,encryption,policy,async()=>Response.json({errors:[{message:secret}]}))).rejects.toThrow('invalid_response');
});
it('rejects channels belonging to a different organization and malformed keys',async()=>{
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>JSON.parse(String(init?.body)).query.includes('organizations')?Response.json({data:{account:{id:'a',organizations:[{id:'org'}]}}}):Response.json({data:{channels:[{id:'channel',name:'x',organizationId:'foreign',service:'youtube',type:'channel',isDisconnected:false,isLocked:false}]}}));
 await expect(preparePersonalConnection('u','test-only-key-for-a',encryption,policy,fetcher)).rejects.toThrow('invalid_response');
 await expect(preparePersonalConnection('u','test-only-key\nheader',encryption,policy,fetcher)).rejects.toThrow('invalid_key');
});

it.each([['مشهد 1','مشهد 1'],[null,'old-handle'],[undefined,'old-handle'],['   ','old-handle']])('prefers the provider TikTok display name %s without replacing its identity',async(displayName,expected)=>{
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>JSON.parse(String(init?.body)).query.includes('organizations')?Response.json({data:{account:{id:'same-account',organizations:[{id:'same-org'}]}}}):Response.json({data:{channels:[{id:'same-channel',name:'old-handle',displayName,organizationId:'same-org',service:'tiktok',type:'profile',isDisconnected:false,isLocked:false}]}}));
 const result=await preparePersonalConnection('same-user','test-only-key-for-a',encryption,policy,fetcher);expect(result.channels[0]).toMatchObject({id:'same-channel',name:expected,service:'tiktok',organizationId:'same-org'});expect(result.accountId).toBe('same-account');expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).query).toContain('displayName');expect(fetcher).toHaveBeenCalledTimes(2);
});
