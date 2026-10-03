import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { rollupOptions: { output: { manualChunks(id) {
  if(id.includes('node_modules/@clerk/localizations')) return 'auth-arabic';
  if(id.includes('node_modules/@clerk/')) return 'auth';
  if(id.includes('node_modules/convex/')) return 'convex';
} } } } });
