import React from 'react';
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import ServerCard from './ServerCard';
import type {FilmServer} from '../../../shared/film-contracts';
const server:FilmServer={id:'slot',name:'محرك الإبداع',gpu:'PRIVATE_GPU',ram:96,cpu:4,pricePerHourUSD:3,state:'available',availability:'INTERNAL_CAPACITY'};
it('compact server card shows only name, hourly price and one rent action, without dispatch on render',()=>{
 let calls=0;const html=renderToStaticMarkup(<ServerCard server={server} disabled={false} onRent={()=>calls++}/>);
 expect(calls).toBe(0);expect(html).toContain('محرك الإبداع');expect(html).toContain('$3.00');expect(html).toContain('/ ساعة');expect(html).toContain('استئجار');expect(html.match(/<button/g)).toHaveLength(1);expect(html).not.toContain('PRIVATE_GPU');expect(html).not.toContain('INTERNAL_CAPACITY');expect(html).not.toContain('GB');expect(html).not.toContain('CPU');expect(html).not.toContain('disabled');
});
it('busy, locked and account-disabled cards cannot rent',()=>{
 for(const state of ['busy','locked','available'] as const){const html=renderToStaticMarkup(<ServerCard server={{...server,state}} disabled={state==='available'} onRent={()=>{throw Error('NO_GPU');}}/>);expect(html).toContain('disabled');expect(html).toContain(state==='busy'?'مشغول':state==='locked'?'غير متاح':'استئجار');}
});
