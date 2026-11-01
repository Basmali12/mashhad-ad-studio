import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import AccountSetup from './AccountSetup';
import {linkAndPlan,planLinkedAccount,transferView,accountInputError} from './accountSetupModel';
import type {FilmRequest} from './filmClient';
it('validates each credential field and rejects command text or swapped tokens before dispatch',()=>{
 const good={name:'نور',tokenId:'ak-synthetic12345678',tokenSecret:'as-synthetic12345678'};
 expect(accountInputError(good)).toBeNull();
 expect(accountInputError({...good,tokenId:'modal token set --token-id ak-synthetic12345678'})).toContain('Token ID');
 expect(accountInputError({...good,tokenSecret:good.tokenId})).toContain('Token Secret');
 expect(accountInputError({...good,tokenId:'invalid-id'})).toContain('ak-');
});
it('saving verifies, inspects and quotes in order, without dispatching paid work',async()=>{
 const calls:string[]=[],stages:string[]=[],linked:string[]=[];
 const request:FilmRequest=async op=>{calls.push(op);return op==='admin.account.link'?{id:'account'}:op==='admin.prepare.quote'?{id:'quote'}:{ready:false};};
 expect(await linkAndPlan(request,{name:'نور'},s=>stages.push(s),id=>linked.push(id))).toEqual({id:'quote'});
 expect(calls).toEqual(['admin.account.link','session','admin.account.inspect','admin.prepare.quote']);
 expect(stages).toEqual(['connection','inspection','quote','approval']);expect(linked).toEqual(['account']);
});
it('a rejected link stops immediately and preserves the safe server error',async()=>{
 let calls=0;await expect(linkAndPlan(async()=>{calls++;return {error:'ACCOUNT_ALREADY_LINKED',message:'الحساب مربوط مسبقاً'};},{},()=>{},()=>{})).rejects.toThrow('الحساب مربوط مسبقاً');expect(calls).toBe(1);
});
it('a failed inspection retains the saved account without automatically relinking',async()=>{
 const calls:string[]=[],linked:string[]=[];
 await expect(linkAndPlan(async op=>{calls.push(op);return op==='admin.account.link'?{id:'saved'}:op==='session'?{capabilities:{}}:{error:'OFFLINE',message:'انقطع الاتصال'};},{},()=>{},id=>linked.push(id))).rejects.toThrow('انقطع الاتصال');
 expect(linked).toEqual(['saved']);expect(calls).toEqual(['admin.account.link','session','admin.account.inspect']);
});
it('only verified completion and stopped resources imply ready, never an accepted job',()=>{
 expect(transferView({status:'queued'}).ready).toBe(false);
 expect(transferView({status:'completed',result:{ready:true}}).ready).toBe(false);
 expect(transferView({status:'completed',cloudStopped:true,result:{ready:false}}).ready).toBe(false);
 expect(transferView({status:'completed',cloudStopped:true,result:{ready:true}}).ready).toBe(true);
});
it('hashing bytes remain a stage measurement, not fabricated upload progress',()=>{
 const view=transferView({events:[{phase:'transfer',kind:'progress',transferred:50,required:100,unit:'source_bytes_hashed'},{phase:'upload',kind:'phase_start'},{phase:'integrity',kind:'file_verified',file:'one'},{phase:'integrity',kind:'file_verified',file:'one'}]});
 expect(view.phase).toBe('integrity');expect(view.measurement).toBeUndefined();expect(view.verified).toBe(1);expect(view.ready).toBe(false);
});
it('uncertain transport is followed until resources are confirmed stopped, never advertised as ready',()=>{
 expect(transferView({status:'uncertain',cloudStopped:false}).terminal).toBe(false);
 expect(transferView({status:'failed',cloudStopped:false}).terminal).toBe(false);
 expect(transferView({status:'failed',cloudStopped:true}).terminal).toBe(true);
 expect(transferView({status:'completed',cloudStopped:false,result:{ready:true}}).ready).toBe(false);
});
it('rendering is inert and exposes saved job follow-up without any secrets or automatic GPU',()=>{
 const html=renderToStaticMarkup(<AccountSetup request={async()=>{throw Error('NO_NETWORK');}} accounts={[{id:'a',label:'نور',prepareJobId:'job'}]} onRefresh={async()=>{}}/>);
 expect(html).toContain('حفظ وفحص التجهيز');expect(html).toContain('متابعة تجهيز نور');expect(html).not.toContain('value="ak-');
});

it('new-model account verification never reaches the retired inspection or preparation path',async()=>{
 const calls:string[]=[],stages:string[]=[],linked:string[]=[];
 const request:FilmRequest=async op=>{calls.push(op);if(op==='admin.account.link')return {id:'saved'};if(op==='session')return {capabilities:{genericEngineDefinitions:true,legacyProduction:false}};throw Error('RETIRED_PATH_MUST_NOT_RUN');};
 expect(await linkAndPlan(request,{name:'نور'},s=>stages.push(s),id=>linked.push(id))).toBeNull();
 expect(calls).toEqual(['admin.account.link','session']);expect(linked).toEqual(['saved']);expect(stages).toEqual(['connection','linked']);
});
it('retrying a verified new-model account keeps the same capability guard and never relinks',async()=>{
 const calls:string[]=[],stages:string[]=[];
 const request:FilmRequest=async op=>{calls.push(op);if(op==='session')return {capabilities:{genericEngineDefinitions:true,legacyProduction:false}};throw Error('RETIRED_PATH_MUST_NOT_RUN');};
 expect(await planLinkedAccount(request,'saved',s=>stages.push(s))).toBeNull();
 expect(calls).toEqual(['session']);expect(stages).toEqual(['linked']);
});
it('an unavailable capability read preserves the verified account and does not guess a preparation path',async()=>{
 const calls:string[]=[],linked:string[]=[];
 await expect(linkAndPlan(async op=>{calls.push(op);return op==='admin.account.link'?{id:'saved'}:{error:'OFFLINE',message:'تعذر فحص الحالة'};},{},()=>{},id=>linked.push(id))).rejects.toThrow('تعذر فحص الحالة');
 expect(linked).toEqual(['saved']);expect(calls).toEqual(['admin.account.link','session']);
});
