import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export async function invokeStudio(args:string[]){const result=await run(process.execPath,['node_modules/convex/bin/main.js',...args],{cwd:process.cwd(),timeout:30000,maxBuffer:500000});return result.stdout.trim();}
let identity:Promise<string>|undefined;
export async function studioOwnerIdentity(){identity??=(async()=>{const [subject,issuer]=await Promise.all([invokeStudio(['env','get','OWNER_SUBJECT']),invokeStudio(['env','get','CLERK_JWT_ISSUER_DOMAIN'])]);if(!subject||!issuer)throw Error('هوية المالك غير متاحة.');return JSON.stringify({subject,issuer});})();return identity;}
