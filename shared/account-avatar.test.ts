import {it,expect} from 'vitest';
import {accountAvatar} from './account-avatar';
it('keeps HTTPS profile photos while rejecting credentials and unsafe image sources',()=>{
 expect(accountAvatar('https://cdn.example/profile.jpg?size=80')).toBe('https://cdn.example/profile.jpg?size=80');
 for(const value of ['javascript:alert(1)','http://cdn.example/a','https://user:password@cdn.example/a','https://cdn.example/a?access_token=secret','https://cdn.example/a?client_secret=secret',null])expect(accountAvatar(value)).toBeUndefined();
});
