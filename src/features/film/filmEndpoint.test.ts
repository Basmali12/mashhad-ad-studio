import {expect,it} from 'vitest';
import {filmEndpoint} from './filmEndpoint';
it('supports same-origin hosting and the explicitly configured HTTPS gateway only',()=>{
 expect(filmEndpoint('/api/mashhad-film','')).toBe('/api/mashhad-film');
 expect(filmEndpoint('/api/mashhad-film','https://scan.iraqaistudio.com')).toBe('https://scan.iraqaistudio.com/api/mashhad-film');
 expect(filmEndpoint('/api/mashhad-film/access','https://scan.iraqaistudio.com')).toBe('https://scan.iraqaistudio.com/api/mashhad-film/access');
 for(const origin of ['http://scan.iraqaistudio.com','https://evil.test','https://scan.iraqaistudio.com/path','https://user@scan.iraqaistudio.com'])expect(()=>filmEndpoint('/api/mashhad-film',origin)).toThrow();
});
