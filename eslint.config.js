import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config({ignores:['dist/**','node_modules/**','convex/_generated/**']},js.configs.recommended,...tseslint.configs.recommended,{files:['**/*.{ts,tsx}'],languageOptions:{globals:{process:'readonly',console:'readonly',URL:'readonly',Request:'readonly',Response:'readonly',Headers:'readonly',crypto:'readonly',File:'readonly',indexedDB:'readonly',Image:'readonly',document:'readonly',XMLHttpRequest:'readonly',setTimeout:'readonly',clearTimeout:'readonly',window:'readonly',Blob:'readonly'}},plugins:{'react-hooks':hooks},rules:{'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'error'}});
