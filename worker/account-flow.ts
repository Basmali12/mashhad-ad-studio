import {connection} from './runtime';
import {withCustomerFlow,withPersonalFlow} from './personal-flow';
export async function withAccountFlow<T>(subject:string|undefined,owner:boolean|undefined,personal:boolean|undefined,work:()=>Promise<T>,balanceOnly=false){
 if(owner||!personal)return withPersonalFlow(owner,work);
 if(!subject)throw new Error('LOGIN_REQUIRED: حساب Flow الخاص غير محدد.');
 const config=await connection();
 const call=async<T>(args:object):Promise<T>=>{const r=await fetch('http://127.0.0.1:43137/internal/session',{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error('LOGIN_REQUIRED: متصفح حسابك الخاص مشغول أو غير متصل؛ لا نستخدم حساب المنصة.');return r.json() as Promise<T>;};
 const {endpoint,lease}=await call<{endpoint:string;lease:string}>({op:balanceOnly?'balance':'open',subject});let lost=false,validUntil=Date.now()+45000;
 const timer=setInterval(()=>{void call({op:'pulse',lease}).then(()=>{validUntil=Date.now()+45000;}).catch(()=>{lost=true;});},10000);
 try{return await withCustomerFlow(endpoint,work,()=>!lost&&Date.now()<validUntil);}finally{clearInterval(timer);await call({op:'release',lease}).catch(()=>undefined);}
}
