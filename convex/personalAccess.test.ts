import {afterEach,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}');
afterEach(()=>vi.unstubAllEnvs());
it('personal studio admits only pinned owner and rejects old enabled customers without creating accounts',async()=>{
 vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture.clerk');vi.stubEnv('PERSONAL_STUDIO_ONLY','true');vi.stubEnv('CUSTOMER_ACCESS_DISABLED','true');
 const t=convexTest(schema,modules),identity={subject:'owner',issuer:'https://fixture.clerk',email:'basm1998ali@gmail.com'};
 await t.run(c=>c.db.insert('pointWallets',{subject:'old',publicId:'old',name:'old',balance:0,enabled:true,models:[],maxClips:1,createdAt:1,updatedAt:1}));
 expect(await t.withIdentity(identity).query(api.access.customer,{})).toBe(true);
 for(const wrong of [{...identity,subject:'old'},{...identity,email:'other@gmail.com'},{...identity,issuer:'https://wrong.clerk'},{...identity,subject:'new'}]){
  const actor=t.withIdentity(wrong);expect(await actor.query(api.access.customer,{})).toBe(false);
  await expect(actor.mutation(api.onboarding.enter,{})).rejects.toThrow('المصرح');
 }
 await expect(t.mutation(api.onboarding.enter,{})).rejects.toThrow();
 expect(await t.run(c=>c.db.query('pointWallets').collect())).toHaveLength(1);
});
