import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SubscriptionActivation} from './subscription-activation';
vi.mock('convex/react',()=>({useMutation:()=>vi.fn(),useConvex:()=>({query:vi.fn()})}));
it('shows all three real catalog choices but requires a searched account before activation',()=>{
 const html=renderToStaticMarkup(<SubscriptionActivation/>);
 expect(html).toContain('البحث عبر الإيميل');expect(html.match(/type="radio"/g)).toHaveLength(3);
 expect(html).toContain('$5');expect(html).toContain('$10');expect(html).toContain('$15');
 expect(html).toContain('يوتيوب');expect(html).toContain('<fieldset disabled=""');expect(html).toContain('مراجعة وتفعيل الاشتراك');
 expect(html).not.toContain('wa.me');
});
