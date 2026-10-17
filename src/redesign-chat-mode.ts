import type {SeriesProject} from './redesign-data';
export function selectedChat(mode:'general'|'story',general:SeriesProject,story:SeriesProject|undefined){return mode==='general'?general:story;}
