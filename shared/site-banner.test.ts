import {it,expect} from 'vitest';
import {validBannerFile,assertBannerDimensions} from './site-banner';
it('permits bounded landscape raster images and rejects executable or oversized formats',()=>{
 for(const type of ['image/jpeg','image/png','image/webp'])expect(validBannerFile(type,2097152)).toBe(true);
 for(const [type,size] of [['image/svg+xml',100],['text/html',100],['image/png',2097153],['image/jpeg',0],['image/png',NaN]] as const)expect(validBannerFile(type,size)).toBe(false);
 expect(()=>assertBannerDimensions(1600,500)).not.toThrow();for(const [width,height] of [[500,1600],[6001,500],[1600,3001],[0,0]])expect(()=>assertBannerDimensions(width,height)).toThrow();
});
