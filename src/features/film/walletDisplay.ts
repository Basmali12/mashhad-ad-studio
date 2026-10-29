/** Display only: truncate fractional dollars without modifying the original microdollar balance. */
export function compactWalletUSD(micros:number|null|undefined){
 if(!Number.isSafeInteger(micros)||micros==null||micros<0)return '—';
 return '$'+(Math.floor(micros/1000)/1000).toFixed(3);
}
