import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}'),owner={subject:'owner',issuer:'https://owner.clerk.accounts.dev'},customer={...owner,subject:'customer'};
beforeEach(()=>{vi.useFakeTimers();vi.stubEnv('ADMIN_CODE_VERIFIER','test');vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',owner.issuer);vi.stubEnv('OPENAI_API_KEY','fixture')});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals()});
async function setup(){const t=convexTest(schema,modules),a=t.withIdentity(owner),u=t.withIdentity(customer),id=await u.mutation(api.wallets.register,{name:'Customer'});await t.run(async ctx=>{await ctx.db.patch(id,{enabled:true});await ctx.db.insert('adminGates',{subject:'owner',expiresAt:Date.now()+1800000,attempts:0,windowStart:0,lockedUntil:0,version:'1'})});const projectId=await u.mutation(api.films.create,{key:'film',title:'قصة'});return {t,a,u,id,projectId};}
it('requires gated owner for credits, isolates wallets and deduplicates credits',async()=>{
 const {t,a,u,id}=await setup(),command={walletId:id,key:'credit-one',amountMicros:1_000_000,note:'شحن مؤكد'};
 for(const actor of [t,u,t.withIdentity({...owner,issuer:'wrong'})])await expect(actor.mutation(api.wallets.adjustAi,command)).rejects.toThrow();
 const [first,second]=await Promise.all([a.mutation(api.wallets.adjustAi,command),a.mutation(api.wallets.adjustAi,command)]);expect(first).toBe(second);
 expect(await u.query(api.wallets.aiMine,{})).toMatchObject({availableMicros:1_000_000,spentMicros:0});expect((await t.withIdentity({...customer,subject:'other'}).query(api.wallets.aiMine,{})).balanceMicros).toBe(0);
 await expect(a.mutation(api.wallets.adjustAi,{...command,amountMicros:2})).rejects.toThrow('مختلفة');expect((await u.query(api.wallets.mine,{}))?.wallet.balance).toBe(0);
 await t.run(async ctx=>{const gate=await ctx.db.query('adminGates').first();await ctx.db.patch(gate!._id,{expiresAt:0})});await expect(a.query(api.wallets.aiAdmin,{})).rejects.toThrow();
});
it('blocks unfunded calls and settles one shared balance across films once, ignoring old per-film limits',async()=>{
 const {t,a,u,id,projectId}=await setup();const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
 await expect(u.mutation(api.films.send,{projectId,key:'empty',text:'قصة'})).rejects.toThrow('اشحن');expect(fetchMock).not.toHaveBeenCalled();
 await a.mutation(api.wallets.adjustAi,{walletId:id,key:'credit-one',amountMicros:1_000_000,note:'شحن'});
 await t.run(ctx=>ctx.db.patch(projectId,{budgetMicros:1,spentMicros:50_000}));
 for(const p of [projectId,await u.mutation(api.films.create,{key:'second',title:'قصة ثانية'})]){const args={projectId:p,key:'turn',text:'قصة عن طفلين'},turnId=await u.mutation(api.films.send,args);expect(await u.mutation(api.films.send,args)).toBe(turnId);const before=await u.query(api.wallets.aiMine,{});expect(before.heldMicros).toBeGreaterThan(0);await t.mutation(internal.films.claim,{turnId});await t.mutation(internal.films.finish,{turnId,status:'completed',reply:'قصة',brief:'قصة',costMicros:4700});await t.mutation(internal.films.finish,{turnId,status:'completed',costMicros:4700});}
 expect(await u.query(api.wallets.aiMine,{})).toMatchObject({balanceMicros:990600,availableMicros:990600,heldMicros:0,spentMicros:9400});
});
it('keeps uncertain usage held, protects reserved funds from admin debit and releases known zero usage',async()=>{
 const {t,a,u,id,projectId}=await setup();await a.mutation(api.wallets.adjustAi,{walletId:id,key:'credit-one',amountMicros:1_000_000,note:'شحن'});
 const turnId=await u.mutation(api.films.send,{projectId,key:'unknown',text:'قصة'});await t.mutation(internal.films.claim,{turnId});await t.mutation(internal.films.finish,{turnId,status:'unknown'});const held=(await u.query(api.wallets.aiMine,{})).heldMicros;
 expect(held).toBeGreaterThan(0);await expect(a.mutation(api.wallets.adjustAi,{walletId:id,key:'debit-all',amountMicros:-1_000_000,note:'خصم'})).rejects.toThrow('الرصيد');
 const next=await u.mutation(api.films.send,{projectId,key:'rejected',text:'قصة اخرى'});await t.mutation(internal.films.claim,{turnId:next});await t.mutation(internal.films.finish,{turnId:next,status:'failed',costMicros:0});expect(await u.query(api.wallets.aiMine,{})).toMatchObject({balanceMicros:1_000_000,heldMicros:held,spentMicros:0});
});
it('prevents concurrent films from spending the same available balance',async()=>{
 const {t,a,u,id,projectId}=await setup();await a.mutation(api.wallets.adjustAi,{walletId:id,key:'credit-one',amountMicros:1_000_000,note:'شحن'});const turnId=await u.mutation(api.films.send,{projectId,key:'first',text:'قصة'});const held=(await u.query(api.wallets.aiMine,{})).heldMicros;
 await a.mutation(api.wallets.adjustAi,{walletId:id,key:'debit-free',amountMicros:-(1_000_000-held),note:'تصحيح المتاح'});const other=await u.mutation(api.films.create,{key:'second',title:'فيلم آخر'});await expect(u.mutation(api.films.send,{projectId:other,key:'blocked',text:'قصة'})).rejects.toThrow('رصيد');expect((await u.query(api.wallets.aiMine,{})).availableMicros).toBe(0);expect(await t.run(ctx=>ctx.db.get(turnId))).toBeTruthy();
});
it('records all reported usage even above reservation, then blocks further paid calls',async()=>{
 const {t,a,u,id,projectId}=await setup();await a.mutation(api.wallets.adjustAi,{walletId:id,key:'credit-one',amountMicros:1_000_000,note:'شحن'});const turnId=await u.mutation(api.films.send,{projectId,key:'usage',text:'قصة'});await t.mutation(internal.films.claim,{turnId});await t.mutation(internal.films.finish,{turnId,status:'failed',costMicros:1_000_001});expect(await u.query(api.wallets.aiMine,{})).toMatchObject({balanceMicros:-1,heldMicros:0,spentMicros:1_000_001});await expect(u.mutation(api.films.send,{projectId,key:'debt',text:'قصة'})).rejects.toThrow('رصيد');
});
it('does not retroactively charge turns created before wallets were enabled',async()=>{
 const {t,a,u,id,projectId}=await setup();await a.mutation(api.wallets.adjustAi,{walletId:id,key:'credit-one',amountMicros:1_000_000,note:'شحن'});const turnId=await t.run(async ctx=>{await ctx.db.patch(projectId,{heldMicros:1000});return ctx.db.insert('filmTurns',{projectId,subject:customer.subject,key:'legacy-turn',userText:'قصة',status:'running',reserveMicros:1000,dailyKey:'legacy-day',createdAt:0,updatedAt:0})});await t.mutation(internal.films.finish,{turnId,status:'completed',costMicros:800,reply:'قصة'});expect(await u.query(api.wallets.aiMine,{})).toMatchObject({balanceMicros:1_000_000,heldMicros:0,spentMicros:0});expect((await u.query(api.films.state,{projectId})).project.spentMicros).toBe(800);
});
