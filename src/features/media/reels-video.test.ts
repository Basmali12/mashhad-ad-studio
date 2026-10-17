import {it,expect,vi,afterEach} from 'vitest';
import {validateReelFile} from './reels-video';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function setup(duration:number){
 const video={duration,src:'',load:vi.fn(),removeAttribute:vi.fn(),onloadedmetadata:null as (()=>void)|null,onerror:null as (()=>void)|null};
 vi.stubGlobal('document',{createElement:()=>video});vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 return {video,revoke,file:new File(['fixture'],'clip.mp4',{type:'video/mp4'})};
}
it('reads local duration and releases its temporary URL at exactly three minutes',async()=>{const f=setup(180),result=validateReelFile(f.file);f.video.onloadedmetadata!();await expect(result).resolves.toBe(180);expect(f.revoke).toHaveBeenCalledWith('blob:fixture');expect(f.video.load).toHaveBeenCalled();});
it('rejects a longer or indeterminate video before any upload',async()=>{for(const duration of [180.01,NaN,Infinity,0]){const f=setup(duration),result=validateReelFile(f.file);f.video.onloadedmetadata!();await expect(result).rejects.toThrow();expect(f.revoke).toHaveBeenCalled();}});
it('fails closed and releases resources when metadata cannot load',async()=>{const f=setup(8),result=validateReelFile(f.file);f.video.onerror!();await expect(result).rejects.toThrow('مدة');expect(f.revoke).toHaveBeenCalled();});
it('bounds metadata loading to fifteen seconds',async()=>{vi.useFakeTimers();const f=setup(8),result=validateReelFile(f.file),check=expect(result).rejects.toThrow('مدة');await vi.advanceTimersByTimeAsync(15000);await check;expect(f.revoke).toHaveBeenCalled();});
