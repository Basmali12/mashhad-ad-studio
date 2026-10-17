// Delays between attempts: 2m, 5m, 15m, 1h, 6h, 24h. Errors consume attempts too.
export const STATUS_DELAYS_MS = [120000,300000,900000,3600000,21600000,86400000] as const;
export const MAX_STATUS_CHECKS = STATUS_DELAYS_MS.length;
export function nextStatusAt(now:number,checks:number):number|undefined {
 return checks < MAX_STATUS_CHECKS ? now + STATUS_DELAYS_MS[Math.max(0,checks)] : undefined;
}
export interface BudgetWindow {windowSeconds:number;remaining:number;resetAt:number}
export function quotaDecision(windows:BudgetWindow[],now:number,blockedUntil=0) {
 if(blockedUntil>now)return {allowed:false,retryAt:blockedUntil};
 const exhausted=windows.filter(w=>w.remaining<=0&&w.resetAt>now);
 if(exhausted.length)return {allowed:false,retryAt:Math.max(...exhausted.map(w=>w.resetAt))+5000};
 // An absent/expired snapshot permits one serialized probe, not an assumed full refill.
 return {allowed:true,retryAt:now};
}
