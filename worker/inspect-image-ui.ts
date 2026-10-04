import {browser,workspace} from './browser';
import {exclusive} from './runtime';
import {imageCapabilities} from './image-flow';
const unlock=await exclusive();
try{const b=await browser();await b.page.keyboard.press('Escape');await b.page.keyboard.press('Escape');const p=new URL(b.page.url());if(p.pathname.includes('/edit/')){await b.page.goto(p.origin+p.pathname.split('/edit/')[0]);await b.page.locator('textarea:visible, [contenteditable="true"]:visible').waitFor({timeout:15000});}await workspace(b.page);console.log(JSON.stringify(await imageCapabilities(b.page),null,2));}finally{await unlock();}process.exit(0);
