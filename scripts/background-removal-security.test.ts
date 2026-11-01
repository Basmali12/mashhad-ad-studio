import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {z} from 'zod';
import {build} from 'vite';
import {patchBackgroundRemoval,backgroundRemovalSecurity} from './background-removal-security';
const require=createRequire(import.meta.url);
const original=readFileSync(resolve(dirname(require.resolve('@imgly/background-removal')),'index.mjs'),'utf8');
const patched=patchBackgroundRemoval(original);
const schemaSource=patched.slice(patched.indexOf('// src/schema.ts'),patched.indexOf('// src/inference.ts'));
// Execute the actual patched upstream schema, no ONNX/download/image inference.
const parse=new Function('z','package_default',schemaSource+';return validateConfig;')(z,{name:'@imgly/background-removal',version:'1.7.0'});
describe('background removal security migration',()=>{
 it('removes embedded vulnerable Zod and preserves all actual inference bytes',()=>{
  expect(patched).not.toContain('zod@3.24.2');expect(patched).not.toContain('class ZodArray');
  expect(patched.slice(patched.indexOf('// src/inference.ts'))).toBe(original.slice(original.indexOf('// src/inference.ts')));
  expect(patched).toContain('import {z} from "zod"');
 });
 it('fails closed on changed vendor code instead of applying an unsafe guess',()=>{expect(()=>patchBackgroundRemoval(original+'\n')).toThrow('review required');});
 it('preserves original CPU, model, output, URL and default semantics',()=>{
  expect(parse()).toMatchObject({device:'cpu',model:'isnet_fp16',output:{format:'image/png',quality:0.8},debug:false,rescale:true,proxyToWorker:false,fetchArgs:{}});
  expect(parse().publicPath).toContain('/1.7.0/dist/');
  expect(parse({device:'cpu',model:'isnet_quint8',output:{format:'image/png'},proxyToWorker:false})).toMatchObject({device:'cpu',model:'isnet_quint8',output:{format:'image/png',quality:0.8},proxyToWorker:false});
 });
 it('accepts progress functions and rejects malformed config including oversized collections',()=>{
  const progress=()=>{};expect(parse({progress}).progress).toBe(progress);
  for(const input of [{progress:[]},{model:new Array(10000).fill('x')},{device:'remote'},new Array(10000).fill({})])expect(()=>parse(input)).toThrow();
 });
 it('uses the real advisory patch: size rejection occurs before invalid element traversal',()=>{
  let visited=0;const schema=z.array(z.string().refine(()=>{visited++;return true;})).max(2);
  const result=schema.safeParse(new Array(10000).fill('x'));
  expect(result.success).toBe(false);expect(visited).toBe(0);expect(result.error?.issues).toHaveLength(1);
 });
 it('bundles the actual removal export through patched validation without embedding Zod3',async()=>{
  const result=await build({configFile:false,logLevel:'silent',plugins:[backgroundRemovalSecurity(),{name:'local-security-fixture',resolveId(id){if(id==='local-security-fixture')return '\0local-security-fixture';},load(id){if(id==='\0local-security-fixture')return "export {removeBackground} from '@imgly/background-removal';";}}],build:{write:false,minify:false,rollupOptions:{input:'local-security-fixture',preserveEntrySignatures:'strict',external:['onnxruntime-web','onnxruntime-web/webgpu'],output:{format:'es'}}}});
  const outputs=Array.isArray(result)?result:[result];const code=outputs.flatMap(output=>'output' in output?output.output:[]).filter(chunk=>chunk.type==='chunk').map(chunk=>chunk.code).join('\n');
  expect(code).toContain('removeBackground');expect(code).not.toContain('zod@3.24.2');expect(code).not.toContain('class ZodArray');expect(code).toContain('Invalid progress callback');
 });
 it('installs a dedicated loader and excludes the unpatched dependency optimizer path',()=>{
  const plugin=backgroundRemovalSecurity();expect(plugin.enforce).toBe('pre');
  expect(typeof plugin.resolveId).toBe('function');expect(typeof plugin.load).toBe('function');
 });
});
