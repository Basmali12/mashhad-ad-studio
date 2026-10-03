import {connection} from './runtime';
import {hashFile} from './montage-media';
import {resolve} from 'node:path';
const cfg=await connection();
for(const op of ['editPending','editClaim','editFile','editUpload','editFinish']){
 const r=await fetch(`${cfg.site}/runner`,{method:'POST',headers:{Authorization:'Bearer invalid','Content-Type':'application/json'},body:JSON.stringify({op,args:{}})});if(r.status!==401)throw new Error(`Anonymous access ${op}: ${r.status}`);
}
const r=await fetch(`${cfg.site}/runner`,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json'},body:JSON.stringify({op:'editFile',args:{exportId:'jh738c9beh1je20qj1x701tszx8fk4bp',storageId:'kg288f22szadt8hve740257gwx8fkvbd',metadata:true}})});
if(!r.ok)throw new Error(`Source verification ${r.status}`);const info=await r.json() as {hash:string;size:number};
const actual=await hashFile(resolve('../../../work/mashhad-worker/montage/jh738c9beh1je20qj1x701tszx8fk4bp/source-0.mp4'));
if(info.hash!==actual)throw new Error('Source hash mismatch');console.log('PASS: live protected metadata matches cached source SHA256; anonymous montage operations rejected.');
