// Read-only reconciliation; excludes prompts, names, email and credentials.
import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import {pathToFileURL} from 'node:url';
if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
for(const line of fs.readFileSync('/etc/iraq-ai-film-platform-staging/film.env','utf8').split('\n')){const at=line.indexOf('=');if(at>0&&!line.startsWith('#'))process.env[line.slice(0,at)]=line.slice(at+1).trim();}
const {openStore}=await import(pathToFileURL('/srv/iraq-ai-studio-staging/current/services/film-engine/engine/open-store.mjs'));
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try{
 const charges=await store.all('film-ai-charge'),ledger=await store.all('film-ledger'),lots=await store.all('film-credit');
 console.log(JSON.stringify({charges:charges.length,recent:charges.sort((a,b)=>b.createdAt-a.createdAt).slice(0,5).map(r=>{const net=ledger.filter(l=>l.chargeId===r.id).reduce((n,l)=>n+l.microUSD,0);return {id:r.id,kind:r.kind,state:r.state,heldMicroUSD:r.heldMicroUSD,amountMicroUSD:r.amountMicroUSD,uncoveredMicroUSD:r.uncoveredMicroUSD??0,ledgerNetMicroUSD:net,reconciled:r.state==='settled'?net+r.amountMicroUSD===(r.uncoveredMicroUSD||0):null,availableMicroUSD:lots.filter(l=>l.customerId===r.customerId&&l.expiresAt>Date.now()).reduce((n,l)=>n+l.remaining,0)};}),activeRentals:(await store.all('rental')).filter(r=>r.state!=='closed').length}));
}finally{await store.close();}
