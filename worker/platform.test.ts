import {describe,it,expect} from 'vitest';
import {platformConfig} from './platform';
describe('private worker platform configuration',()=>{
 it('preserves the installed Windows Chrome and font',()=>{
  const c=platformConfig({},'win32');
  expect(c.chrome).toBe('C:/Program Files/Google/Chrome/Application/chrome.exe');
  expect(c.font).toBe('Arial');
 });
 it('allows Linux deployment without moving the browser session into the repository',()=>{
  const c=platformConfig({MASHHAD_RUNTIME_DIR:'/var/lib/mashhad',MASHHAD_CHROME_PATH:'/usr/bin/google-chrome-stable'},'linux');
  expect(c.root).toBe('/var/lib/mashhad');expect(c.font).toBe('Noto Sans Arabic');
 });
 it('rejects relative session locations and ASS control characters',()=>{
  expect(()=>platformConfig({MASHHAD_RUNTIME_DIR:'public/session'},'linux')).toThrow('absolute');
  expect(()=>platformConfig({MASHHAD_ARABIC_FONT:'Arial,80\n[Events]'},'linux')).toThrow('font');
 });
});
