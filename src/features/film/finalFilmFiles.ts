import type {FilmFile} from '../../../shared/film-contracts';

// Scene artifacts stay private to generation; the library shows completed exports.
export function finalFilmFiles(files:FilmFile[]):FilmFile[]{
 return files.filter(file=>file.kind==='film'&&file.index==='merged');
}
