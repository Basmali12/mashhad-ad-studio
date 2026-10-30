// Reattach approved persisted transfers without a browser, never redispatch them.
export function preparationRecovery({store,resume,intervalMs=15000,now=Date.now,onError=()=>{}}){
 let closed=false,scanning=false;const next=new Map();
 const scan=async()=>{
  if(closed||scanning)return;scanning=true;
  try{
   for(const job of await store.all('job')){
    if(closed)break;
    if(job.action!=='prepare'||job.plan?.transport!=='modal-cpu-cloud'||job.cloudStopped===true||!['queued','running','recovery_required','uncertain','stopping'].includes(job.status))continue;
    if((next.get(job.id)||0)>now())continue;
    // The original dispatch owns queued work until it has entered run().
    if(job.status==='queued'&&!job.startedAt)continue;
    next.set(job.id,now()+60000);resume(job);
   }
  }catch{onError();}finally{scanning=false;}
 };
 const timer=setInterval(()=>void scan(),intervalMs);timer.unref?.();
 void scan();
 return {scan,close(){closed=true;clearInterval(timer);}};
}
