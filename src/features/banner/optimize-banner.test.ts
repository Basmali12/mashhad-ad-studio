import {it,expect,vi,afterEach} from 'vitest';
import {optimizeBannerImage,BANNER_TARGET_BYTES} from './optimize-banner';
afterEach(()=>vi.unstubAllGlobals());
const source=()=>new File([new Uint8Array([255,216,255,...Array(200).fill(0)])],'image.jpg',{type:'image/jpeg'});
function fixture(type='image/webp',size=200){const close=vi.fn(),draw=vi.fn(),canvas={width:0,height:0,getContext:()=>({drawImage:draw}),toBlob:(cb:(b:Blob)=>void)=>cb(new Blob([new Uint8Array(size)],{type}))};vi.stubGlobal('createImageBitmap',async()=>({width:4000,height:2000,close}));vi.stubGlobal('document',{createElement:()=>canvas});return {canvas,close,draw};}
it('resizes large banners before encoding WebP and closes decoded image memory',async()=>{const f=fixture(),result=await optimizeBannerImage(source());expect([f.canvas.width,f.canvas.height]).toEqual([1600,800]);expect(result.type).toBe('image/webp');expect(result.size).toBeLessThanOrEqual(BANNER_TARGET_BYTES);expect(f.close).toHaveBeenCalledOnce();});
it('fails closed if the browser silently returns PNG instead of WebP',async()=>{const f=fixture('image/png');await expect(optimizeBannerImage(source())).rejects.toThrow('WebP');expect(f.close).toHaveBeenCalledOnce();});
it('bounds retries and refuses an image still exceeding the lightweight limit',async()=>{const f=fixture('image/webp',BANNER_TARGET_BYTES+1);await expect(optimizeBannerImage(source())).rejects.toThrow('أصغر');expect(f.draw).toHaveBeenCalledTimes(4);expect(f.close).toHaveBeenCalledOnce();});
it('rejects a forged image before decoding or creating an upload ticket',async()=>{const f=fixture();await expect(optimizeBannerImage(new File(['not-an-image'],'bad.jpg',{type:'image/jpeg'}))).rejects.toThrow();expect(f.draw).not.toHaveBeenCalled();});
