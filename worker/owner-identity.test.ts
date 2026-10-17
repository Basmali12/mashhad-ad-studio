import {it,expect,vi} from 'vitest';
import type {Page} from 'playwright';
import {assertOwnerFlowAccount} from './owner-identity';
function fixture(emails:string[]){const rows={count:async()=>emails.length,first(){return this;},waitFor:async()=>{},allTextContents:async()=>emails};const page={getByText:()=>({filter:()=>rows}),getByRole:()=>({click:vi.fn()}),keyboard:{press:vi.fn().mockResolvedValue(undefined)}} as unknown as Page;return page;}
it('accepts only the actual Flow email of the personal owner',async()=>{await expect(assertOwnerFlowAccount(fixture(['Basm1998Ali@gmail.com']))).resolves.toBeUndefined();});
it('blocks other, missing and ambiguous Google identities without exposing their emails',async()=>{for(const emails of [['other@gmail.com'],[],['basm1998ali@gmail.com','other@gmail.com']])await expect(assertOwnerFlowAccount(fixture(emails))).rejects.toThrow('LOGIN_REQUIRED: حساب Flow المفتوح لا يطابق basm1998ali@gmail.com');});
