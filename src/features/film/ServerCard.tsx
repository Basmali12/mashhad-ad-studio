import React from 'react';
import type {FilmServer} from '../../../shared/film-contracts';

export default function ServerCard({server,disabled,onRent}:{server:FilmServer;disabled:boolean;onRent:()=>void}){
 const label=server.state==='busy'?'مشغول':server.state==='locked'?'غير متاح':'استئجار';
 return <article className="film-server-tile" data-state={server.state}>
  <div className="film-server-sculpture" aria-hidden="true"><i/><i/><i/></div>
  <h3>{server.name}</h3>
  <p className="film-server-price"><strong dir="ltr">${server.pricePerHourUSD.toFixed(2)}</strong><span>/ ساعة</span></p>
  <button disabled={disabled||server.state!=='available'} onClick={onRent} aria-label={label+' — '+server.name}>{label}<span aria-hidden="true">↗</span></button>
 </article>;
}
