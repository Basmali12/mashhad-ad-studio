import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import type {Plugin} from 'vite';

// IMG.LY 1.7.0 bundles Zod 3.24.2. Merely overriding its declared dependency
// does not remove that embedded vulnerable code. Keep its inference unchanged,
// replace only the pinned validation block with patched Zod 4, and migrate the
// three v3 schema idioms. An upstream change must be reviewed, not guessed.
const expectedHash='1bac0a7afd5d6a32bca8032f5e14f292e9b800fee3f2e9931fe79ee70bd9a7fd';
const zodStart='// ../../node_modules/.pnpm/zod@3.24.2/node_modules/zod/lib/index.mjs';
const schemaStart='// src/schema.ts';
const inferenceStart='// src/inference.ts';
const functionSchema='z.function().args(z.string(), z.number(), z.number()).returns(z.void())';
export function patchBackgroundRemoval(source:string):string{
 if(createHash('sha256').update(source).digest('hex')!==expectedHash)throw new Error('IMG.LY security patch: unsupported upstream bundle; review required.');
 const start=source.indexOf(zodStart),end=source.indexOf(schemaStart),inference=source.indexOf(inferenceStart);
 if(start<0||end<=start||inference<=end)throw new Error('IMG.LY security patch: validation boundary missing.');
 const schema=source.slice(end,inference);
 if(schema.split(functionSchema).length!==2||schema.split('.default({})').length!==4||schema.split('.default("medium")').length!==2)throw new Error('IMG.LY security patch: unsupported schema.');
 const migrated=schema.replace(functionSchema,'z.custom((value) => typeof value === "function", {message: "Invalid progress callback"})').replaceAll('.default({})','.prefault({})').replace('.default("medium")','.prefault("medium")');
 // Keep package notices and every byte of image loading/ONNX/inference/export code.
 return source.slice(0,start)+'import {z} from "zod";\n'+migrated+source.slice(inference);
}
export function backgroundRemovalSecurity():Plugin{
 const id='\0mashhad:background-removal-secure';
 return {name:'mashhad-background-removal-security',enforce:'pre',
  config(){return {optimizeDeps:{exclude:['@imgly/background-removal']}};},
  resolveId(source){if(source==='@imgly/background-removal')return id;},
  load(source){if(source!==id)return;const require=createRequire(import.meta.url);const file=resolve(dirname(require.resolve('@imgly/background-removal')),'index.mjs');return patchBackgroundRemoval(readFileSync(file,'utf8'));}
 };
}
