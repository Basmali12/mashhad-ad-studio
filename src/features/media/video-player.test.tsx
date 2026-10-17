import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Player} from './video-player';
it('keeps a local video download URL intact even when the saved clip also has a Bunny identity',()=>{
 const html=renderToStaticMarkup(<Player video={{id:'v',title:'Clip',publishAt:'',createdAt:1,file:new File(['fixture'],'clip.mp4',{type:'video/mp4'}),url:'blob:local-clip',bunnyAssetId:'fixture'}}/>);
 expect(html).toContain('href="blob:local-clip"');expect(html).not.toContain('blob:local-clip&amp;download');expect(html).toContain('controls=""');
});
