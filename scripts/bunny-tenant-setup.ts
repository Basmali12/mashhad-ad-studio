import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {privateStorageDirectory} from './bunny-local-store.ts';
const invoke=promisify(execFile),envFile=join(privateStorageDirectory,'local-convex-direct.private.env'),direct=await readFile(envFile,'utf8');
if(!direct.includes('CONVEX_SELF_HOSTED_URL=http://127.0.0.1:43240\n'))throw Error('يمنع تغيير إعدادات أي نشر غير محلي.');
const text=await readFile(join(privateStorageDirectory,'convex-env.private.txt'),'utf8'),issuer=text.match(/^CLERK_JWT_ISSUER_DOMAIN=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');if(!issuer?.startsWith('https://'))throw Error('مصدر Clerk غير مهيأ.');
for(const [name,value] of [['CLERK_JWT_ISSUER_DOMAIN',issuer],['PUBLISHING_SAAS_ENABLED','true']]){await invoke(process.execPath,['node_modules/convex/bin/main.js','env','set',name,value,'--env-file',envFile]);console.log(name+' configured on local loopback only');}
