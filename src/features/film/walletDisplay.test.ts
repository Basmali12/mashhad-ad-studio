import {it,expect} from 'vitest';
import {compactWalletUSD} from './walletDisplay';
it('shows three fractional dollar digits without overstating the available balance',()=>{
 expect(compactWalletUSD(9883915)).toBe('$9.883');
 expect(compactWalletUSD(0)).toBe('$0.000');
 expect(compactWalletUSD(999)).toBe('$0.000');
 expect(compactWalletUSD(1000)).toBe('$0.001');
 expect(compactWalletUSD(10000000)).toBe('$10.000');
});
it('unavailable or invalid balances are not presented as zero',()=>{
 for(const value of [null,undefined,NaN,-1,1.5])expect(compactWalletUSD(value)).toBe('—');
});
