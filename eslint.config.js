import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
 // The preserved Node film engine has its own test suite and verification gate.
 {ignores:['dist/**','dist-admin/**','worker/dist/**','node_modules/**','convex/_generated/**','services/film-engine/**']},
 js.configs.recommended,...tseslint.configs.recommended,
 {files:['services/film-gateway/**/*.mjs'],languageOptions:{globals:{process:'readonly',Buffer:'readonly',URL:'readonly',Response:'readonly',AbortSignal:'readonly',AbortController:'readonly',setTimeout:'readonly',clearTimeout:'readonly',fetch:'readonly',console:'readonly'}}},
 {files:['**/*.{ts,tsx}'],languageOptions:{globals:{process:'readonly',console:'readonly',URL:'readonly',Request:'readonly',Response:'readonly',Headers:'readonly',crypto:'readonly',File:'readonly',indexedDB:'readonly',Image:'readonly',document:'readonly',XMLHttpRequest:'readonly',setTimeout:'readonly',clearTimeout:'readonly',window:'readonly',Blob:'readonly'}},plugins:{'react-hooks':hooks},rules:{'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'error'}}
);
