import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {DayEditor} from './day-editor';
const props={date:'2026-10-17',day:1,drafts:[{id:'v',title:'T',description:'D',time:'12:00',channelIds:['t']}],channels:[{id:'t',name:'T',service:'tiktok'}],accepted:[],working:false,busy:false,canAdd:true,error:'',progress:'',onEdit:()=>{},onAdd:()=>{},onRemove:()=>{},onClose:()=>{},onSave:()=>{}};
it('disables elapsed times and saving an invalid time, then permits a future time',()=>{
 const now=Date.parse('2026-10-17T13:00:30+03:00'),html=renderToStaticMarkup(<DayEditor {...props} now={now}/>);
 expect(html).toContain('اختَر وقتاً بعد الوقت الحالي');expect(html).toContain('<option disabled="" selected="">12</option>');expect(html).toMatch(/type="submit"[^>]*disabled=""/);
 const valid=renderToStaticMarkup(<DayEditor {...props} now={now} drafts={[{...props.drafts[0],time:'14:00'}]}/>);
 expect(valid).not.toMatch(/type="submit"[^>]*disabled=""/);
});
it('freezes an open day after Baghdad midnight while keeping its history visible',()=>{
 const html=renderToStaticMarkup(<DayEditor {...props} now={Date.parse('2026-10-18T00:00:00+03:00')}/>);
 expect(html).toContain('هذا اليوم انتهى');expect(html).toMatch(/<fieldset[^>]*disabled=""/);expect(html).toMatch(/type="submit"[^>]*disabled=""/);
});

it('opens a saved video as a player and actions rather than the upload form',()=>{
 const original={id:'saved',title:'Saved clip',createdAt:1,publishAt:'2026-10-18T11:00:00+03:00',url:'https://example.test/video.mp4'};
 const html=renderToStaticMarkup(<DayEditor {...props} date="2026-10-18" now={Date.parse('2026-10-17T13:00:00+03:00')} drafts={[{...props.drafts[0],id:'saved',original}]} onDelete={async()=>{}}/>);
 expect(html).toContain('<video');expect(html).toContain('controls=""');expect(html).toContain('تحميل الفيديو');expect(html).toContain('تعديل');expect(html).toContain('حذف');expect(html).not.toContain('type="file"');expect(html).not.toContain('عنوان الريلز');
});
