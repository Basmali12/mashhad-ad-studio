export function parseFlowBalance(text:string):number|null{
 const clean=text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).trim();
 const match=clean.match(/^([\d,٬]+)\s+(?:وحدة من الرصيد في Google Flow|(?:AI\s+)?credits(?:\s+(?:in Google Flow|remaining))?)$/i);
 if(!match)return null;const n=Number(match[1].replace(/[,٬]/g,''));return Number.isSafeInteger(n)&&n>=0?n:null;
}
