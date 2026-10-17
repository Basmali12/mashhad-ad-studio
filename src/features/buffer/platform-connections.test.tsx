import {expect,it,vi} from 'vitest';
import {Children,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PersonalChannels} from './personal-channels';
import {PlatformConnections} from './platform-connections';
import {channelConnected} from './platform-status';
import {CustomerHeader,type CustomerPage} from '../../app/customer-header';
const channels=[{id:'y',service:'youtube',name:'قناتي الأولى'},{id:'y2',service:'youtube',name:'قناتي الثانية'},{id:'t',service:'tiktok',name:'حساب تيكتوك'}];
it('shows actual connected platform names and slashes only the missing platforms',()=>{
 const html=renderToStaticMarkup(<PlatformConnections channels={channels}/>);
 expect(html).toContain('قناتي الأولى، قناتي الثانية');expect(html).toContain('حساب تيكتوك');
 expect(html.match(/aria-label="غير مربوط"/g)).toHaveLength(2);expect(html.match(/aria-label="مربوط"/g)).toHaveLength(2);
});
it('does not mislabel a loading connection as disconnected, or a broken connection as usable',()=>{
 expect(renderToStaticMarkup(<PlatformConnections channels={[]} loading/>)).not.toContain('aria-label="غير مربوط"');
 expect(channelConnected({...channels[0],isDisconnected:true})).toBe(false);expect(channelConnected(channels[0],true)).toBe(false);
});
it('groups personal-key channels into four cards, preserves multi-channel accounts and disables unapproved choices',()=>{
 const html=renderToStaticMarkup(<PersonalChannels channels={channels} selected={['y']} approved={['y']} blocked={false} busy={false} onSelect={()=>{}} onDryRun={()=>{}}/>);
 expect(html.match(/buffer-platform-card/g)).toHaveLength(4);expect(html).toContain('قناتي الأولى');expect(html).toContain('قناتي الثانية');expect(html).toContain('اختيار حساب تيكتوك');
 expect(html.match(/aria-label="غير مربوط"/g)).toHaveLength(2);expect(html).toMatch(/aria-label="اختيار قناتي الثانية"[^>]*disabled/);
});
it('shows all four absent platform states before any key is linked',()=>{
 const html=renderToStaticMarkup(<PersonalChannels channels={[]} selected={[]} approved={[]} blocked={false} busy={false} onSelect={()=>{}} onDryRun={()=>{}}/>);
 expect(html.match(/aria-label="غير مربوط"/g)).toHaveLength(4);
});
it('a second click on Settings returns to the thirty-day schedule',()=>{
 const change=vi.fn();
 const click=(page:CustomerPage)=>{const element=CustomerHeader({page,onPage:change}),children=Children.toArray(element.props.children) as ReactElement<{'aria-label'?:string;onClick?:()=>void}>[];children.find(c=>c.props['aria-label']==='الإعدادات')!.props.onClick!();};
 click('schedule');expect(change).toHaveBeenLastCalledWith('settings');click('settings');expect(change).toHaveBeenLastCalledWith('schedule');
});
