import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
// Runs as the service identity before any provider dispatch; never changes owners.
export async function verifyArtifactStorage(folder,jobId){
 let probe,handle,created=false;
 try{
  const root=path.resolve(folder,'artifacts');await fs.mkdir(root,{recursive:true,mode:0o700});
  const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error();
  if(jobId&&!/^[a-zA-Z0-9-]{1,100}$/.test(jobId))throw Error();
  const destination=jobId?path.join(root,jobId):root;
  await fs.mkdir(destination,{recursive:true,mode:0o700});
  if((await fs.lstat(destination)).isSymbolicLink())throw Error();
  probe=path.join(destination,'.write-probe-'+randomUUID());
  handle=await fs.open(probe,'wx',0o600);created=true;
  await handle.writeFile('artifact-write-check');await handle.sync();
 }catch{throw Error('LOCAL_ARTIFACT_NOT_WRITABLE');}
 finally{await handle?.close().catch(()=>{});if(created)await fs.unlink(probe).catch(()=>{});}
}
