import {expect,it} from 'vitest';
import type {FilmFile} from '../../../shared/film-contracts';
import {finalFilmFiles} from './finalFilmFiles';

it('shows final merged films only, never individual generation segments',()=>{
 const base={projectId:'p',name:'A film',createdAt:1,expiresAt:2,bytes:100};
 const files:FilmFile[]=[
  {...base,id:'segment',kind:'scene',index:0},
  {...base,id:'final',kind:'film',index:'merged'},
  {...base,id:'inconsistent-scene',kind:'scene',index:'merged'},
  {...base,id:'inconsistent-film',kind:'film',index:1},
 ];
 expect(finalFilmFiles(files).map(file=>file.id)).toEqual(['final']);
 expect(files).toHaveLength(4);
});
