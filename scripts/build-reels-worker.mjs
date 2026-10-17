import {build} from 'esbuild';
import console from 'node:console';
await build({entryPoints:['scripts/reels-runner.ts','scripts/reels-media-server.ts','scripts/reels-storage-server.ts'],outdir:'worker/dist',bundle:true,platform:'node',format:'esm',target:'node24',sourcemap:false});console.log('Reels runner and streaming media bundles built; no service started');
