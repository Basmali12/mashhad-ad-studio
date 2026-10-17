import {it,expect} from 'vitest';
import {imageEditPrompt,IMAGE_EDIT_PRESERVATION} from './image-edit-prompt';
it('ends every edit with identity and age preservation while keeping the requested change',()=>{
 const prompt=imageEditPrompt('Add one child beside the elderly couple.');
 expect(prompt.startsWith('Add one child')).toBe(true);expect(prompt.endsWith(IMAGE_EDIT_PRESERVATION)).toBe(true);
 expect(prompt).toContain('Preserve elderly faces, wrinkles');expect(prompt).toContain('keep ALL original people intact');
 expect(imageEditPrompt(prompt)).toBe(prompt);
});
