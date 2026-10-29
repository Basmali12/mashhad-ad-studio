import {defineConfig,configDefaults} from 'vitest/config';
// Cold Convex lazy-module initialization exceeded the old 5s test guard on
// the unchanged baseline too. Individual production deadlines remain unchanged.
export default defineConfig({test:{exclude:[...configDefaults.exclude,'services/**'],testTimeout:15000}});
