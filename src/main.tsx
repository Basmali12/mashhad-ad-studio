import {AppInstall} from './app-install';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CloudRoot} from './cloud';
import {Studio} from './studio';
import './style.css';
import {AppUpdate} from './app-update';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppInstall/><AppUpdate/><CloudRoot><Studio/></CloudRoot></React.StrictMode>);
