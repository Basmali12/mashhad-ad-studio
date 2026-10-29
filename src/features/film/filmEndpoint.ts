// Public deployment setting only. Never send a session bearer to arbitrary URLs.
export function filmEndpoint(path:'/api/mashhad-film'|'/api/mashhad-film/access',origin:string=import.meta.env.VITE_FILM_API_ORIGIN||''){
 if(!origin)return path;
 if(origin!=='https://scan.iraqaistudio.com')throw Error('عنوان خدمة الأفلام غير صالح.');
 return origin+path;
}
