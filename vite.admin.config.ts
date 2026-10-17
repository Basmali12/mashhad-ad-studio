import {defineConfig,mergeConfig} from 'vite';
import customerConfig from './vite.config';

export default defineConfig(env=>mergeConfig(customerConfig(env),{
 build:{outDir:'dist-admin',rollupOptions:{input:'admin.html'}}
}));
