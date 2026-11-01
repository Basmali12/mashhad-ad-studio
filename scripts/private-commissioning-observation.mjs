/** Private launcher observer. Never dispatches/retries a production command. */
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';

export function privateWatchdogProcessAlive(pid){try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
/** Independently check freshness AND process liveness. Reading a stale file
 * whose status still says watching is never evidence of a live stop monitor. */
export function assertPrivateWatchdogLiveness(state,{control={},now=Date.now(),isProcessAlive=privateWatchdogProcessAlive,allowArmed=false}={}){
 const globalEnd=Date.parse(state?.globalDeadlineISO??'');
 if(!state||!['watching',...(allowArmed?['armed']:[])].includes(state.status)||state.cloudStopped===true||state.stopReason||control.stopRequested===true||['failed','completed','stopped'].includes(control.mainStatus)||!Number.isSafeInteger(now)||!Number.isSafeInteger(state.heartbeatAt)||state.heartbeatAt>now+1000||now-state.heartbeatAt>20000||!Number.isSafeInteger(state.watchdogPID)||state.watchdogPID<=0||state.watchdogPID===process.pid||!isProcessAlive(state.watchdogPID)||!Number.isSafeInteger(state.deadline)||now>=state.deadline||!Number.isFinite(globalEnd)||now>=globalEnd)throw Error('PRIVATE_TRIAL_WATCHDOG_STOP');
}
export async function waitForCommissioningTest(initial,{observe,continueAllowed=async()=>{},onGuardFailure=async()=>{},onProgress=()=>{},wait=async()=>{}}){
 let snapshot=initial;
 const guard=async()=>{try{await continueAllowed();}catch(error){try{await onGuardFailure(error);}catch{error.cleanupUnconfirmed=true;}throw error;}};
 for(;;){
  await guard();
  const test=snapshot?.latestTest;
  if(!test||typeof test.status!=='string')throw Error('PRIVATE_TRIAL_TEST_PROTOCOL');
  if(test.status==='uncertain')throw Error('PRIVATE_TRIAL_TEST_UNCERTAIN');
  if(!['queued','running'].includes(test.status))return test;
  onProgress(test);await wait();await guard();snapshot=await observe();
 }
}


/** Keep the independent stop lease checked while a native bridge call is still
 * building/deploying/inferring. A guard failure never starts another operation.
 * The in-flight call must settle before the final STOP-only reconciliation. */
export async function runWithPrivateWatchdog(operation,{continueAllowed,onGuardFailure,onSettledAfterFailure,intervalMs=2000,wait=()=>delay(intervalMs)}){
 try{await continueAllowed();}catch(error){try{await onGuardFailure(error);}catch{error.cleanupUnconfirmed=true;}throw error;}
 let settled=false,outcome;
 const pending=Promise.resolve().then(operation).then(value=>{settled=true;outcome={value};},error=>{settled=true;outcome={error};});
 try{
  while(!settled){await Promise.race([pending,wait()]);await continueAllowed();}
 }catch(error){
  try{await onGuardFailure(error);}catch{error.cleanupUnconfirmed=true;}
  await pending;
  try{const result=await onSettledAfterFailure(error);if(result?.cloudStopped===true)error.cleanupUnconfirmed=false;else error.cleanupUnconfirmed=true;}catch{error.cleanupUnconfirmed=true;}
  throw error;
 }
 if(outcome.error)throw outcome.error;return outcome.value;
}
/** Retry Windows transient rename locks only; never recreate identity state. */
export async function retryPrivateRename(rename,{wait=ms=>delay(ms)}={}){
 for(let attempt=0;;attempt++)try{return await rename();}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=5)throw error;await wait(attempt?50:25);}
}
