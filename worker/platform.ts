import {isAbsolute,resolve} from 'node:path';

// Configuration only: no secrets, shell evaluation or browser flag overrides.
export function platformConfig(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform){
 const runtime=env.MASHHAD_RUNTIME_DIR;
 if(runtime&&!isAbsolute(runtime))throw new Error('MASHHAD_RUNTIME_DIR must be an absolute private directory.');
 const font=env.MASHHAD_ARABIC_FONT??(platform==='linux'?'Noto Sans Arabic':'Arial');
 if(!font.trim()||/[\r\n,]/.test(font))throw new Error('Invalid Arabic font name.');
 return {
  root:runtime??resolve(import.meta.dirname,'../../../work/mashhad-worker'),
  chrome:env.MASHHAD_CHROME_PATH??(platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/google-chrome-stable'),
  font,
 };
}
