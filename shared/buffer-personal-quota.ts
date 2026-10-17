export interface PersonalQuotaWindow {windowSeconds:number;remaining:number;resetSeconds:number;capacity?:number}
export function personalQuota(headers:Headers):PersonalQuotaWindow[]{
 const limits=(headers.get('ratelimit')??'').split(/,\s*(?=")/),policies=(headers.get('ratelimit-policy')??'').split(/,\s*(?=")/);
 return limits.flatMap(value=>{const m=value.match(/"([^"\n]+)"\s*;\s*r=(\d+)\s*;\s*t=(\d+)/);if(!m)return [];const p=policies.map(s=>s.match(/"([^"\n]+)"\s*;\s*q=(\d+)\s*;\s*w=(\d+)/)).find(p=>p?.[1]===m[1]);
 const windowSeconds=p?Number(p[3]):/15min/.test(m[1])?900:/1day/.test(m[1])?86400:/30days/.test(m[1])?2592000:0;
 if(![900,86400,2592000].includes(windowSeconds))return [];return [{windowSeconds,remaining:Number(m[2]),resetSeconds:Number(m[3]),...(p?{capacity:Number(p[2])}:{})}];
 });
}
