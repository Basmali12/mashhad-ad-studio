import type {Id} from '../convex/_generated/dataModel';
import {exclusive,connection} from './runtime';
import {executeFilm} from './film-service';
const id=process.argv[2];if(!id||!process.argv.includes('--existing-only'))throw new Error('Use film:existing JOB_ID --existing-only; this command cannot generate');
const unlock=await exclusive();try{const c=await connection();await executeFilm(id as Id<'filmProductions'>,c.workerId+'-film-test',()=>false,true);}finally{await unlock();}
