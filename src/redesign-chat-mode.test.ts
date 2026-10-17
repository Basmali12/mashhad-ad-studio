import {it,expect} from 'vitest';
import {selectedChat} from './redesign-chat-mode';
it('keeps general chat separate from selected project and does not fall back to general while waiting for a story selection',()=>{const general={id:'general',name:'General',kind:'conversation' as const,characters:[]},story={id:'story',name:'Story',characters:[]};expect(selectedChat('general',general,story)).toBe(general);expect(selectedChat('story',general,story)).toBe(story);expect(selectedChat('story',general,undefined)).toBeUndefined();});
