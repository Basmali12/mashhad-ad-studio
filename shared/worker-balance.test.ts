import {it,expect} from 'vitest';
import {freshWorkerBalance} from './worker-balance';
it('does not replay an expired balance as part of an otherwise healthy worker heartbeat',()=>{const now=10000000;expect(freshWorkerBalance({at:now-3600001,credits:50},now)).toBeUndefined();expect(freshWorkerBalance({at:now+60001,credits:50},now)).toBeUndefined();expect(freshWorkerBalance({at:now,credits:50},now)).toEqual({at:now,credits:50});});
