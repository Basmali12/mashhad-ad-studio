// Timing out a Convex request does not cancel server work. Callers must keep
// the same idempotency key when checking its outcome, never send a new request.
export async function analysisDeadline<T>(task:(signal:AbortSignal)=>Promise<T>,ms:number,label:string):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([task(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error(`انتهت مهلة ${label}. تحقق من الاتصال؛ لا توجد إعادة تلقائية. إذا حُفظ الطلب نتابع نفس معرّفه.`));},ms)})]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
