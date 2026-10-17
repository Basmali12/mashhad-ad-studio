// Published OpenAI standard rates checked 2026-10-09. Preview search has free
// search-content tokens; its tool fee differs from non-preview web_search.
export const STORY_SEARCH_CAP=100_000;
export const STORY_SEARCH_MODEL='gpt-4.1-mini';
export type SearchResponse={status?:string;usage?:{input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number}};output?:Array<{type:string;status?:string;action?:{type?:string;sources?:Array<{url:string;title?:string}>};content?:Array<{type:string;text?:string;annotations?:Array<{type:string;url?:string;title?:string}>}>}>};
export function searchUsage(r:SearchResponse){
 const input=r.usage?.input_tokens,output=r.usage?.output_tokens,cached=r.usage?.input_tokens_details?.cached_tokens??0;
 if(![input,output,cached].every(n=>Number.isSafeInteger(n)&&n!>=0)||cached>input!)throw new Error('الاستخدام غير محسوم؛ الحجز يبقى محفوظًا ولا يعاد الطلب.');
 const calls=(r.output??[]).filter(o=>o.type==='web_search_call'&&o.action?.type==='search').length;
 if(calls>1)throw new Error('تجاوز البحث الحد المتفق عليه.');
 return {inputTokens:input!,outputTokens:output!,cachedTokens:cached,searchCalls:calls,cost:Math.ceil((input!-cached)*.4+cached*.1+output!*1.6+calls*25000)};
}
export function searchResult(r:SearchResponse){
 const result=(r.output??[]).flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text??'').join('\n').trim();
 const candidates=(r.output??[]).flatMap(o=>[...(o.action?.sources??[]),...(o.content??[]).flatMap(c=>(c.annotations??[]).filter(a=>a.type==='url_citation'&&a.url).map(a=>({url:a.url!,title:a.title}))) ]);
 const sources: {url:string;title:string}[]=[];
 for(const c of candidates){try{const u=new URL(c.url);if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||u.hostname.endsWith('.local')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')||sources.some(s=>s.url===u.href))continue;sources.push({url:u.href,title:(c.title??u.hostname).slice(0,200)});}catch{/* Ignore invalid provider URLs. */}}
 if(r.status!=='completed'||!result||result.length>12000||!sources.length)throw new Error('لم يرجع البحث نتيجة مكتملة بمصادر قابلة للعرض؛ لا توجد إعادة تلقائية.');
 return {result,sources:sources.slice(0,20)};
}
