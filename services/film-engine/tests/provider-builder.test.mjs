import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerEnvironment} from '../engine/provider.mjs';
test('every isolated provider process selects the tested builder without leaking tokens or changing its parent',()=>{
 const parent={PATH:'fixture',MODAL_TOKEN_ID:'private-fixture',MODAL_TOKEN_SECRET:'private-fixture',MODAL_IMAGE_BUILDER_VERSION:'2026.01',ENGINE_MASTER_KEY:'private-fixture',OPENAI_API_KEY:'private-fixture'};
 for(const input of [{credentials:{}},{credentials:{},source:{}},{credentials:{mode:'local_profile'}}]){
  const env=providerEnvironment(input,parent);assert.equal(env.MODAL_IMAGE_BUILDER_VERSION,'2025.06');assert.equal(env.ENGINE_MASTER_KEY,undefined);assert.equal(env.OPENAI_API_KEY,undefined);
  if(input.credentials.mode!=='local_profile'){assert.equal(env.MODAL_TOKEN_ID,undefined);assert.equal(env.MODAL_TOKEN_SECRET,undefined);}
 }
 assert.equal(parent.MODAL_IMAGE_BUILDER_VERSION,'2026.01');
});
