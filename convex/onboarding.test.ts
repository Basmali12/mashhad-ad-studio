import {beforeEach,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}'),issuer='https://onboard.clerk.accounts.dev';
beforeEach(()=>{vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',issuer);vi.stubEnv('ADMIN_CODE_VERIFIER','test')});
async function setup(){const t=convexTest(schema,modules),a=t.withIdentity({subject:'owner',issuer}),u=t.withIdentity({subject:'new-user',issuer,name:'علي'});await t.run(ctx=>ctx.db.insert('adminGates',{subject:'owner',expiresAt:Date.now()+60000,attempts:0,windowStart:0,lockedUntil:0,version:'1'}));return {t,a,u};}
it('automatically grants 10 once, creates a stable ID, enables homepage access and isolates users',async()=>{
 const {t,u}=await setup();const [first,second]=await Promise.all([u.mutation(api.onboarding.enter,{}),u.mutation(api.onboarding.enter,{})]);expect(first).toBe(second);
 expect((await u.query(api.wallets.mine,{}))?.wallet).toMatchObject({publicId:`MS-${first}`,balance:10,enabled:true,name:'علي'});expect(await u.query(api.access.customer,{})).toBe(true);
 await t.run(ctx=>ctx.db.patch(first,{balance:3}));await u.mutation(api.onboarding.enter,{});expect((await u.query(api.wallets.mine,{}))?.wallet.balance).toBe(3);expect(await t.run(ctx=>ctx.db.query('pointLedger').collect())).toHaveLength(1);
 expect(await t.withIdentity({subject:'other',issuer}).query(api.wallets.mine,{})).toBeNull();
});
it('allows only gated admin settings; new values do not change existing balances',async()=>{
 const {t,a,u}=await setup();await u.mutation(api.onboarding.enter,{});
 for(const actor of [t,u,t.withIdentity({subject:'owner',issuer:'wrong'})]){await expect(actor.mutation(api.onboarding.save,{points:12})).rejects.toThrow();await expect(actor.query(api.onboarding.settings,{})).rejects.toThrow()}
 for(const points of [-1,1.5,1000001])await expect(a.mutation(api.onboarding.save,{points})).rejects.toThrow();
 for(const points of [12,6,0]){await a.mutation(api.onboarding.save,{points});const other=t.withIdentity({subject:'new-'+points,issuer});await other.mutation(api.onboarding.enter,{});expect((await other.query(api.wallets.mine,{}))?.wallet).toMatchObject({balance:points,enabled:true})}
 expect((await u.query(api.wallets.mine,{}))?.wallet.balance).toBe(10);
});
it('upgrades untouched legacy registration but respects admin disabling and existing balances',async()=>{
 const {t,a,u}=await setup();const id=await u.mutation(api.wallets.register,{name:'legacy'});await u.mutation(api.onboarding.enter,{});expect((await u.query(api.wallets.mine,{}))?.wallet.balance).toBe(10);
 await a.mutation(api.wallets.permissions,{walletId:id,enabled:false,models:[],maxClips:1});await u.mutation(api.onboarding.enter,{});expect(await u.query(api.access.customer,{})).toBe(false);
 const old=t.withIdentity({subject:'admin-disabled',issuer}),disabledId=await old.mutation(api.wallets.register,{name:'blocked'});await a.mutation(api.wallets.permissions,{walletId:disabledId,enabled:false,models:[],maxClips:1});await old.mutation(api.onboarding.enter,{});expect((await old.query(api.wallets.mine,{}))?.wallet).toMatchObject({enabled:false,balance:0});
 const funded=t.withIdentity({subject:'funded',issuer}),fundedId=await funded.mutation(api.wallets.register,{name:'old'});await a.mutation(api.wallets.adjust,{walletId:fundedId,key:'existing-credit',amount:20,note:'old credit'});await funded.mutation(api.onboarding.enter,{});expect((await funded.query(api.wallets.mine,{}))?.wallet.balance).toBe(20);
 await expect(t.mutation(api.onboarding.enter,{})).rejects.toThrow();await expect(t.withIdentity({subject:'bad',issuer:'wrong'}).mutation(api.onboarding.enter,{})).rejects.toThrow();
});
