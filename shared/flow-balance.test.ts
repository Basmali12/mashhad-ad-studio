import {expect,it} from 'vitest';
import {parseFlowBalance} from './flow-balance';
it('reads only the explicit account balance, including RTL digits',()=>{expect(parseFlowBalance('‫871 وحدة من الرصيد في Google Flow')).toBe(871);expect(parseFlowBalance('١٬٢٠٠ وحدة من الرصيد في Google Flow')).toBe(1200);expect(parseFlowBalance('0 AI credits')).toBe(0);expect(parseFlowBalance('12 credits per generation')).toBe(null);expect(parseFlowBalance('720p')).toBe(null);});
