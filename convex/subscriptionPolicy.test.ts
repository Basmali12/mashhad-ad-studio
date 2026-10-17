import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}'),issuer='https://subscription.clerk.accounts.dev';
beforeEach(()=>{vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',issuer);vi.stubEnv('CUSTOMER_ACCESS_DISABLED','false');});
afterEach(()=>vi.unstubAllEnvs());
it('blocks existing customers, new registrations and owner studio access without changing wallets or projects',async()=>{
 const t=convexTest(schema,modules),user=t.withIdentity({subject:'customer',issuer}),owner=t.withIdentity({subject:'owner',issuer}),fresh=t.withIdentity({subject:'new',issuer});
 await user.mutation(api.onboarding.enter,{});
 await user.mutation(api.films.create,{key:'prior-project',title:'قصة محفوظة'});
 const before=await t.run(async ctx=>({wallets:await ctx.db.query('pointWallets').collect(),projects:await ctx.db.query('filmProjects').collect()}));
 vi.stubEnv('CUSTOMER_ACCESS_DISABLED','true');
 for(const actor of [user,owner,fresh]){
  expect(await actor.query(api.access.customer,{})).toBe(false);
  await expect(actor.mutation(api.onboarding.enter,{})).rejects.toThrow('تواصل للاشتراك');
  await expect(actor.mutation(api.films.create,{key:'blocked-project',title:'لا تنشأ'})).rejects.toThrow('تواصل للاشتراك');
  await expect(actor.query(api.films.list,{})).rejects.toThrow('تواصل للاشتراك');
  await expect(actor.query(api.wallets.mine,{})).rejects.toThrow('تواصل للاشتراك');
  await expect(actor.mutation(api.wallets.register,{name:'جديد'})).rejects.toThrow('تواصل للاشتراك');
 }
 expect(await t.run(async ctx=>({wallets:await ctx.db.query('pointWallets').collect(),projects:await ctx.db.query('filmProjects').collect()}))).toEqual(before);
 expect(await owner.query(api.access.allowed,{})).toBe(true);
 vi.stubEnv('CUSTOMER_ACCESS_DISABLED','false');
 expect(await user.query(api.access.customer,{})).toBe(true);
 expect(await user.query(api.films.list,{})).toHaveLength(1);
});
it('provides the subscription contact publicly without exposing account information',async()=>{
 vi.stubEnv('CUSTOMER_ACCESS_DISABLED','true');
 const t=convexTest(schema,modules),status=await t.query(api.access.subscriptionStatus,{});
 expect(status.closed).toBe(true);
 expect(Object.keys(status).sort()).toEqual(['closed','contact']);
 expect(new URL(status.contact).pathname).toBe('/9647729373260');
 expect(new URL(status.contact).searchParams.get('text')).toContain('تفعيل حسابي');
});
