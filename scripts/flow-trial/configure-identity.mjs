/* global URL, console */
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {homedir} from 'node:os';
const text=await readFile(new URL('../../.env.local',import.meta.url),'utf8');
const value=name=>text.match(new RegExp('^'+name+'=(.*)$','m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'');
const publishableKey=value('VITE_CLERK_PUBLISHABLE_KEY'),convexUrl=value('VITE_CONVEX_URL');
if(!publishableKey?.startsWith('pk_')||!/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(convexUrl??''))throw Error('Public identity configuration unavailable');
const child=spawn('ssh',['-i',join(homedir(),'.ssh','iraq_ai_studio_semantic_benchmark_ed25519'),'-o','BatchMode=yes','root@187.126.115.198','install -o mashhad-trial -g mashhad-trial -m 600 /dev/stdin /var/lib/mashhad-flow-trial/identity.json'],{stdio:['pipe','ignore','ignore'],windowsHide:true});
child.stdin.end(JSON.stringify({publishableKey,convexUrl}));
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});if(code!==0)throw Error('Could not save identity configuration');console.log('Owner identity gate configured. No secret keys transferred.');
