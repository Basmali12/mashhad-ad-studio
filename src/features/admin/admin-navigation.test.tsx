import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AdminAreas,EngineNavigation,ScheduleNavigation} from './admin-navigation';
it('two independent systems have separate compact navigation, without dispatch on render',()=>{
 const noAction=()=>{throw Error('NO_ACTION_ON_RENDER');};
 const top=renderToStaticMarkup(<AdminAreas value="engines" onChange={noAction}/>);
 expect(top.match(/<button/g)).toHaveLength(2);expect(top).toContain('محركات الأفلام');expect(top).toContain('جدول الفيديوهات');
 const engines=renderToStaticMarkup(<EngineNavigation value="accounts" onChange={noAction}/>),schedule=renderToStaticMarkup(<ScheduleNavigation value="activation" onChange={noAction}/>);
 expect(engines.match(/<button/g)).toHaveLength(5);expect(engines).toContain('الحسابات');expect(engines).not.toContain('الإعلان');
 expect(schedule.match(/<button/g)).toHaveLength(4);expect(schedule).not.toContain('الحسابات');
});
