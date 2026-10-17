import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {privateStorageDirectory,type StagedAsset} from './bunny-local-store';
export async function persistLocalAsset(asset:StagedAsset,ticketId?:string){
 const fixture=join(privateStorageDirectory,'local-convex-04');const env=await readFile(join(fixture,'.env.local'),'utf8');
 if(!/^CONVEX_DEPLOYMENT=anonymous:/m.test(env)||!env.includes('http://127.0.0.1:43240'))throw Error('التخزين المحلي المعزول غير جاهز.');
 const config=JSON.parse(await readFile(join(fixture,'.convex','local','default','config.json'),'utf8')) as {ports:{cloud:number};adminKey:string};
 if(config.ports.cloud!==43240)throw Error('يمنع تعديل قاعدة خارج بيئة الاختبار.');const client=new ConvexHttpClient('http://127.0.0.1:43240');
 (client as ConvexHttpClient & {setAdminAuth(key:string):void}).setAdminAuth(config.adminKey);
 return await client.mutation(makeFunctionReference<'mutation'>('mediaAssets:recordVerified'),{subject:asset.subject,key:asset.sha256,objectPath:asset.path,sha256:asset.sha256,size:asset.size,type:asset.type,ticketId});
}
