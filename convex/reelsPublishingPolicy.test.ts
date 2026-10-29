import {it,expect,vi,afterEach} from 'vitest';
import {personalPublishingAllowed,assertJobPublishing} from './reelsPublishingPolicy';
afterEach(()=>vi.unstubAllEnvs());
it('enables customer personal sends explicitly without changing owner cutover or allowing old customer work',()=>{
 enable();vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');vi.stubEnv('REELS_CUSTOMER_PERSONAL_ENABLED','true');vi.stubEnv('REELS_CUSTOMER_LIVE_START_AT','1500');
 expect(personalPublishingAllowed('customer','buffer-customer')).toBe(true);
 expect(personalPublishingAllowed('owner','buffer-owner')).toBe(true);
 expect(personalPublishingAllowed('customer','buffer-owner')).toBe(false);
 expect(personalPublishingAllowed('owner','buffer-customer')).toBe(false);
 const job={subject:'customer',authMode:'personal' as const,createdAt:1500,dueAt:2000};expect(()=>assertJobPublishing(job,'buffer-customer')).not.toThrow();
 expect(()=>assertJobPublishing({...job,createdAt:1499},'buffer-customer')).toThrow('سابقة');
 expect(()=>assertJobPublishing({...job,dueAt:1499},'buffer-customer')).toThrow('سابقة');
 expect(()=>assertJobPublishing({...job,subject:'owner',createdAt:1000},'buffer-owner')).not.toThrow();
 vi.stubEnv('REELS_CUSTOMER_PERSONAL_ENABLED','false');expect(personalPublishingAllowed('customer','buffer-customer')).toBe(false);
});
function enable(){vi.stubEnv('CONVEX_SITE_URL','https://fixture.convex.site');vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('REELS_OWNER_PERSONAL_ENABLED','true');vi.stubEnv('REELS_OWNER_BUFFER_ACCOUNT_ID','buffer-owner');vi.stubEnv('PUBLISHING_SAAS_ENABLED','false');vi.stubEnv('PUBLISHING_REAL_SEND_ENABLED','true');vi.stubEnv('REELS_LIVE_START_AT','1000');}
it('allows only the explicitly pinned owner account while commercial access remains closed',()=>{enable();expect(personalPublishingAllowed('owner','buffer-owner')).toBe(true);expect(personalPublishingAllowed('other','buffer-owner')).toBe(false);expect(personalPublishingAllowed('owner','other-buffer')).toBe(false);vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');expect(personalPublishingAllowed('owner','buffer-owner')).toBe(true);});
it('fails closed without cutover, explicit enable or a valid hosted/local origin',()=>{enable();vi.stubEnv('REELS_OWNER_PERSONAL_ENABLED','false');expect(personalPublishingAllowed('owner','buffer-owner')).toBe(false);vi.stubEnv('REELS_OWNER_PERSONAL_ENABLED','true');vi.stubEnv('REELS_LIVE_START_AT','');expect(personalPublishingAllowed('owner','buffer-owner')).toBe(false);});
it('rejects legacy work, all non-owner keys and the kill switch before acquiring send credentials',()=>{enable();const job={subject:'owner',authMode:'personal' as const,createdAt:1000,dueAt:2000};expect(()=>assertJobPublishing(job,'buffer-owner')).not.toThrow();expect(()=>assertJobPublishing({...job,createdAt:999},'buffer-owner')).toThrow('سابقة');expect(()=>assertJobPublishing({...job,dueAt:999},'buffer-owner')).toThrow('سابقة');expect(()=>assertJobPublishing({...job,subject:'other'},'buffer-owner')).toThrow();vi.stubEnv('PUBLISHING_REAL_SEND_ENABLED','false');expect(()=>assertJobPublishing(job,'buffer-owner')).toThrow();});
