import {afterEach,describe,expect,it,vi} from 'vitest';
import {newerRelease,releaseUrl,watchRelease} from './release-check';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('release detection',()=>{
 it('only offers a valid newer release, including rebuilt versions',()=>{
  expect(newerRelease('2026.10.07.4-200','2026.10.07.3-500')).toBe(true);
  expect(newerRelease('2026.10.07.4-201','2026.10.07.4-200')).toBe(true);
  for(const value of ['2026.10.07.4-200','2026.10.07.3-999',undefined,'garbage'])expect(newerRelease(value,'2026.10.07.4-200')).toBe(false);
 });
 it('refreshes the document URL without dropping its path, selection or hash',()=>{
  const url=new URL(releaseUrl('https://example.com/admin/?app-version=old&film=42#settings','2026.10.07.4-201',500));
  expect(url.pathname).toBe('/admin/');expect(url.searchParams.get('film')).toBe('42');expect(url.hash).toBe('#settings');expect(url.searchParams.get('app-version')).toBe('2026.10.07.4-201');expect(url.searchParams.get('update-check')).toBe('500');
 });
 it('checks launch, resume and polling, recovers after timeout, and stops when unmounted',async()=>{
  vi.useFakeTimers();
  const win=Object.assign(new EventTarget(),{setInterval,clearInterval,setTimeout,clearTimeout});
  const doc=Object.assign(new EventTarget(),{visibilityState:'visible'});
  vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
  const fetcher=vi.fn().mockImplementationOnce((_url:URL,{signal}:{signal:AbortSignal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('timeout'))))).mockResolvedValue({ok:true,json:async()=>({version:'2026.10.07.4-200'})});
  vi.stubGlobal('fetch',fetcher);const update=vi.fn();
  const stop=watchRelease('2026.10.07.3-100',new URL('https://example.com/admin/'),update);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10001);
  win.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledWith('2026.10.07.4-200');
  expect(String(fetcher.mock.calls[1][0])).toContain('/admin/version.json?t=');
  expect(fetcher.mock.calls[1][1].cache).toBe('no-store');
  doc.visibilityState='hidden';await vi.advanceTimersByTimeAsync(15000);expect(fetcher).toHaveBeenCalledTimes(2);
  doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(3);
  win.dispatchEvent(new Event('pageshow'));await vi.advanceTimersByTimeAsync(0);
  win.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(5);
  stop();await vi.advanceTimersByTimeAsync(30000);win.dispatchEvent(new Event('focus'));expect(fetcher).toHaveBeenCalledTimes(5);
 });
});
