import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SiteBannerView} from './site-banner';
it('renders an image-only advert with an accessible close button and no navigation target',()=>{
 const html=renderToStaticMarkup(<SiteBannerView revision="fixture" imageUrl="https://example.test/banner.png"/>);
 expect(html).toContain('role="dialog"');expect(html).toContain('إغلاق الإعلان');expect(html.match(/<button/g)).toHaveLength(1);expect(html).toContain('<img');expect(html).not.toContain('<a ');expect(html).not.toContain('target=');
});
