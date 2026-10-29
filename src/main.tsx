import {startPublicUiWarmup} from './app/public-ui-warmup';
import {AppInstall} from './app/app-install';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PersonalRoot} from './features/auth/personal-root';
import './style.css';
import {AppUpdate} from './app/app-update';
import './redesign.css';
import './reels.css';
import './reels-theme.css';
import {Redesign} from './app/app-shell';
import {PublishingRoot} from './features/auth/publishing-root';
import {publishingSaasMode} from './shared/api/publishing-session';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{publishingSaasMode?<><AppInstall/><AppUpdate/><PublishingRoot><Redesign/></PublishingRoot></>:import.meta.env.DEV ? <Redesign/> : <><AppInstall/><AppUpdate/><PersonalRoot><Redesign/></PersonalRoot></>}</React.StrictMode>);

if(import.meta.env.PROD)startPublicUiWarmup();
