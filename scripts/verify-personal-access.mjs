/* global console, process */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),cli='node_modules/convex/bin/main.js';
async function command(args){return (await run(process.execPath,[cli,...args],{timeout:30000})).stdout.trim();}
const subject=await command(['env','get','OWNER_SUBJECT']),issuer=await command(['env','get','CLERK_JWT_ISSUER_DOMAIN']);
for(const [label,identity] of [['owner',{subject,issuer,email:'basm1998ali@gmail.com'}],['old-customer',{subject:'retired-customer-fixture',issuer,email:'other@gmail.com'}],['wrong-email',{subject,issuer,email:'other@gmail.com'}]]){
 const allowed=JSON.parse(await command(['run','access:customer','{}','--identity',JSON.stringify(identity)]));
 console.log(JSON.stringify({label,allowed}));
 if(allowed!==(label==='owner'))throw Error('Access verification failed');
}
console.log(await command(['run','personalCleanup:inventory','{}']));
try{const key=await command(['env','get','CLERK_SECRET_KEY']);console.log(JSON.stringify({clerkAccountDeletionAvailable:key.startsWith('sk_')}));}catch{console.log(JSON.stringify({clerkAccountDeletionAvailable:false}));}
