import {ConvexError} from 'convex/values';
// Browser routing and billing are independent; no customer can select the owner's profile.
export function pointsDisabled(){return process.env.PLATFORM_POINTS_DISABLED==='true';}
export function personalFlowConnected(subject:string){return process.env.OWNER_PERSONAL_FLOW_ENABLED==='true'&&!!process.env.OWNER_SUBJECT&&subject===process.env.OWNER_SUBJECT;}
export function personalFlow(subject:string,customerConnected=false){return (pointsDisabled()||process.env.OWNER_PERSONAL_FLOW_FREE_POINTS_ENABLED==='true')&&(personalFlowConnected(subject)||customerConnected);}
export function requirePersonalAccount(subject:string,customerConnected=false){if(pointsDisabled()&&!personalFlowConnected(subject)&&!customerConnected)throw new ConvexError('اربط حساب Flow الخاص أولاً؛ حساب المنصة غير متاح للتوليد.');}
