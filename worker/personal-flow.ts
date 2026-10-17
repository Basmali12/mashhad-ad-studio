import {AsyncLocalStorage} from 'node:async_hooks';
const account=new AsyncLocalStorage<boolean|{endpoint:string;valid:()=>boolean}>();
export function withPersonalFlow<T>(personal:boolean|undefined,work:()=>Promise<T>){return account.run(personal===true,work);}
export function withInspectionFlow<T>(work:()=>Promise<T>){return withPersonalFlow(process.env.MASHHAD_OWNER_ONLY==='true',work);}
export function withCustomerFlow<T>(endpoint:string,work:()=>Promise<T>,valid:()=>boolean=()=>true){if(endpoint!=='http://127.0.0.1:9433')throw new Error('Invalid private customer browser');return account.run({endpoint,valid},work);}
export function personalFlowEndpoint(){const selected=account.getStore();if(!selected)return undefined;if(typeof selected==='object'){if(!selected.valid())throw new Error('LOGIN_REQUIRED: انتهى اتصال متصفح حسابك الخاص.');return selected.endpoint;}const endpoint=process.env.OWNER_FLOW_ENDPOINT;if(endpoint!=='http://127.0.0.1:9432')throw new Error('LOGIN_REQUIRED: متصفح Flow الخاص غير متصل؛ لا نستخدم حساب المنصة بدلًا منه.');return endpoint;}
