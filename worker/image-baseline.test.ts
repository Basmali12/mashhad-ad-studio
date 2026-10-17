import {it,expect} from 'vitest';
import type {Page} from 'playwright';
import {imageAssets,imageAssetIds,assertImageReferencesAttached} from './image-flow';
it('excludes uploaded references from results even before their preview finishes loading',async()=>{
 const reference={getAttribute:()=> 'reference-123456789',complete:false,naturalWidth:0,naturalHeight:0,src:'https://example.test/reference-123456789'};
 const page={locator:()=>({evaluateAll:(fn:(nodes:unknown[])=>unknown)=>fn([reference])})} as unknown as Page;
 expect(await imageAssets(page)).toEqual([]);
 expect(await imageAssetIds(page)).toEqual(['reference-123456789']);
});
it('stops before generation if the reference is absent from the prompt composer',async()=>{
 const page={getByRole:()=>({count:async()=>0})} as unknown as Page;
 await expect(assertImageReferencesAttached(page,1)).rejects.toThrow('IMAGE_REFERENCES_DETACHED');
 await expect(assertImageReferencesAttached(page,0)).resolves.toBeUndefined();
});
