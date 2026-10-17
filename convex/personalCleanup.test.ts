import {afterEach,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {internal} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}');
afterEach(()=>vi.unstubAllEnvs());
it('removes legacy account permissions while preserving owner, project and balance',async()=>{
 vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('PERSONAL_STUDIO_ONLY','true');
 const t=convexTest(schema,modules);
 await t.run(async c=>{for(const subject of ['owner','old']){await c.db.insert('pointWallets',{subject,publicId:subject,name:subject,balance:0,enabled:true,models:[],maxClips:1,createdAt:1,updatedAt:1});await c.db.insert('flowAccounts',{subject,key:subject,state:'ready',updatedAt:1});await c.db.insert('flowBalances',{subject,credits:463,at:1,requestedAt:1});}});
 await t.mutation(internal.personalCleanup.removeAccounts,{confirmation:'REMOVE_LEGACY_ACCOUNTS'});
 expect(await t.query(internal.personalCleanup.inventory,{})).toEqual({oldWallets:0,oldFlowProfiles:0,ownerWallets:1});
 expect(await t.run(c=>c.db.query('flowBalances').collect())).toMatchObject([{subject:'owner',credits:463}]);
 expect(await t.mutation(internal.personalCleanup.removeAccounts,{confirmation:'REMOVE_LEGACY_ACCOUNTS'})).toEqual({removed:0});
 vi.stubEnv('PERSONAL_STUDIO_ONLY','false');await expect(t.mutation(internal.personalCleanup.removeAccounts,{confirmation:'REMOVE_LEGACY_ACCOUNTS'})).rejects.toThrow();
});
