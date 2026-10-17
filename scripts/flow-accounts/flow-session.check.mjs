import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEmail,verifyFlowAccount,readVerifiedGoogleStage} from './flow-session.mjs';
function fixture(email,path='/u/2/project/abc-123'){
 const rows={first(){return this},count:async()=>1,waitFor:async()=>{},allTextContents:async()=>[email]},page={url:()=> 'https://flow.google.com'+path,getByRole:()=>({count:async()=>1,click:async()=>{}}),getByText:()=>({filter:()=>rows}),locator:()=>({count:async()=>1}),keyboard:{press:async()=>{}}};return {contexts:()=>[{pages:()=>[page]}]};
}
test('completed Google login advances automatically after verified identity without requiring a project',async()=>{
 assert.equal((await readVerifiedGoogleStage(fixture('right@example.com'),{},'right@example.com')).stage,'ready');
 assert.equal((await readVerifiedGoogleStage(fixture('right@example.com','/'),{},'right@example.com')).stage,'ready');
 assert.equal((await readVerifiedGoogleStage(fixture('wrong@example.com'),{},'right@example.com')).stage,'manual');
});
test('linking accepts same-account tabs and rejects a conflicting or unverified account',async()=>{
 const home=fixture('right@example.com','/').contexts()[0].pages()[0],wrong=fixture('wrong@example.com','/').contexts()[0].pages()[0];
 const browser=pages=>({contexts:()=>[{pages:()=>pages}]});
 assert.equal((await verifyFlowAccount(browser([home,home]),'right@example.com',{identityOnly:true})).ready,true);
 assert.equal((await verifyFlowAccount(browser([home,wrong]),'right@example.com',{identityOnly:true})).ready,false);
 home.getByRole=()=>({count:async()=>0});
 assert.equal((await verifyFlowAccount(browser([home]),'right@example.com',{identityOnly:true})).ready,false);
});
test('requires the selected email and matches the actual Google account',async()=>{
 assert.equal((await verifyFlowAccount(fixture('right@example.com'),'RIGHT@example.com')).ready,true);
 assert.equal((await verifyFlowAccount(fixture('wrong@example.com'),'right@example.com')).ready,false);
 assert.equal((await verifyFlowAccount(fixture('right@example.com'))).ready,false);
 assert.equal((await verifyFlowAccount(fixture('right@example.com','/u/2/'),'right@example.com')).ready,false);
 assert.equal((await verifyFlowAccount(fixture('right@example.com','/u/2/'),'right@example.com',{balanceOnly:true})).ready,true);
 assert.equal((await verifyFlowAccount(fixture('wrong@example.com','/'),'right@example.com',{balanceOnly:true})).ready,false);
});
test('rejects invalid account choices and ambiguous workspace tabs',async()=>{
 for(const email of ['','person','a@b\nother@host.test'])assert.throws(()=>normalizeEmail(email));
 const b=fixture('right@example.com'),p=b.contexts()[0].pages()[0];assert.equal((await verifyFlowAccount({contexts:()=>[{pages:()=>[p,p]}]},'right@example.com')).ready,false);
 const home=fixture('right@example.com','/').contexts()[0].pages()[0];assert.equal((await verifyFlowAccount({contexts:()=>[{pages:()=>[home,p]}]},'right@example.com',{balanceOnly:true})).ready,true);
});
