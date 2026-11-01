import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createEngineAPI} from './engine/api.mjs';
import {createFilmPlatform} from './engine/film-platform.mjs';
import {openStore} from './engine/open-store.mjs';

// Dedicated deployment only. Never inherit the historical engine's data default.
export function transferWorkerApp(env){
 const name=env.ENGINE_CLOUD_TRANSFER_APP?.trim()||'mashhad-model-cloud-copy-v1';
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name))throw Error('INVALID_TRANSFER_WORKER_APP');
 return name;
}
export async function createFilmService({env=process.env,engine:providedEngine}={}){
 const folder=env.FILM_DATA_DIR,origin=env.FILM_PUBLIC_ORIGIN,secret=env.FILM_BRIDGE_SECRET;
 if(!folder||!path.isAbsolute(folder)||env.FILM_DEDICATED_DATA_CONFIRMED!=='YES')throw Error('DEDICATED_FILM_DATA_REQUIRED');
 if(!['sqlite','postgres'].includes(env.ENGINE_DATABASE_DRIVER))throw Error('EXPLICIT_DATABASE_DRIVER_REQUIRED');
 if(!/^[a-zA-Z0-9_-]{8,80}$/.test(env.FILM_DEPLOYMENT_ID||''))throw Error('DEDICATED_DEPLOYMENT_ID_REQUIRED');
 if(env.ENGINE_DATABASE_DRIVER==='postgres'&&!/^film_platform_[a-z0-9_]+$/.test(env.ENGINE_DATABASE_NAME||''))throw Error('DEDICATED_FILM_DATABASE_REQUIRED');
 if(!secret||secret.length<32||secret===env.ENGINE_MASTER_KEY)throw Error('SEPARATE_BRIDGE_SECRET_REQUIRED');
 if(!origin||new URL(origin).protocol!=='https:')throw Error('HTTPS_ORIGIN_REQUIRED');
 const enabled=env.CUSTOMER_PLATFORM_ENABLED==='YES';
 const referenceCustomerByteLimit=Number(env.FILM_REFERENCE_CUSTOMER_LIMIT_BYTES??67108864);if(!Number.isSafeInteger(referenceCustomerByteLimit)||referenceCustomerByteLimit<4000000||referenceCustomerByteLimit>10*1024**3)throw Error('REFERENCE_QUOTA_CONFIGURATION');
 let store;
 if(!providedEngine){
  store=await openStore(folder,env.ENGINE_MASTER_KEY);
  try{
   if(!store)throw Error('VAULT_KEY_REQUIRED');
   const marker=await store.get('film-deployment','identity');
   if(marker&&marker.deploymentId!==env.FILM_DEPLOYMENT_ID)throw Error('DEPLOYMENT_ID_MISMATCH');
   if(!marker){for(const kind of ['account','job','config','rental','film-customer'])if((await store.all(kind)).length)throw Error('EXISTING_DATA_REQUIRES_APPROVED_IMPORT');}
   if(enabled&&!await store.rentalsReady())throw Error('RENTAL_MIGRATION_002_REQUIRED');
   if(!marker)await store.put('film-deployment',{id:'identity',deploymentId:env.FILM_DEPLOYMENT_ID});
  }catch(e){await store?.close();throw e;}
 }
 const engine=providedEngine||await createEngineAPI({folder,key:env.ENGINE_MASTER_KEY,store,origin,cloudTransferApp:transferWorkerApp(env),allowPaid:env.ENGINE_ALLOW_PAID_ACTIONS==='YES',allowCustomerRentals:enabled});
 const platform=createFilmPlatform({engine,origin,secret,enabled,latentSyncPaidEnabled:env.FILM_LATENTSYNC_PAID_ENABLED==="YES",latentSyncLicenseAccepted:env.FILM_LATENTSYNC_LICENSE_ACCEPTED==="YES",latentSyncFaceRightsApproved:env.FILM_LATENTSYNC_FACE_RIGHTS_APPROVED==="YES",latentSyncRightsEvidence:env.FILM_LATENTSYNC_RIGHTS_EVIDENCE||null,productionDirectorEnabled:env.FILM_DIRECTOR_ENABLED==="YES",fluxPaidEnabled:env.FILM_FLUX_PAID_ENABLED==="YES",qwenPaidEnabled:env.FILM_QWEN_PAID_ENABLED==="YES",wanPaidEnabled:env.FILM_WAN_PAID_ENABLED==="YES",hunyuanPaidEnabled:env.FILM_HUNYUAN_PAID_ENABLED==="YES",hunyuanLicenseAccepted:env.FILM_HUNYUAN_LICENSE_ACCEPTED==="YES",speechPaidEnabled:env.FILM_SPEECH_PAID_ENABLED==="YES",audarLicenseAccepted:env.FILM_AUDAR_LICENSE_ACCEPTED==="YES",audarCodecLicenseAccepted:env.FILM_AUDAR_CODEC_LICENSE_ACCEPTED==="YES",referenceCustomerByteLimit,mediaOrigins:(env.FILM_MEDIA_ORIGINS||'').split(',').filter(Boolean),textEnabled:env.FILM_TEXT_ENABLED==='YES',textBudgetMicroUSD:Number(env.FILM_TEXT_ADMIN_BUDGET_MICRO_USD||0)});
 const handler=async(req,res)=>{
  try{if(await platform.handler(req,res))return;
   // Legacy engine routes remain behind their existing admin authentication.
   if(env.FILM_LEGACY_ADMIN_ENABLED==='YES'&&await engine.handler(req,res))return;
   res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"NOT_FOUND"}');
  }catch{if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"SERVICE_FAILED"}');}else res.destroy();}
 };
 return {engine,platform,handler,async close(){await platform.close();await engine.close();}};
}

export async function main(){
 const service=await createFilmService();
 const tlsCert=process.env.FILM_TLS_CERT_FILE,tlsKey=process.env.FILM_TLS_KEY_FILE;
 const server=tlsCert&&tlsKey?https.createServer({cert:fs.readFileSync(tlsCert),key:fs.readFileSync(tlsKey)},service.handler):http.createServer(service.handler);
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;
 // A reverse proxy must terminate HTTPS; only loopback forwarded HTTPS is accepted.
 await new Promise(resolve=>server.listen(Number(process.env.FILM_PORT||3477),'127.0.0.1',resolve));
 let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;server.close();const deadline=setTimeout(()=>process.exit(1),8000);try{await service.close();clearTimeout(deadline);process.exit(0);}catch{process.exit(1);}};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);return {server,service};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('FILM_SERVICE_START_FAILED: check explicit configuration and approved database readiness');process.exitCode=1;});
