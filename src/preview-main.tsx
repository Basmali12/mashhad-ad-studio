import React from 'react';
import {createRoot} from 'react-dom/client';
import {PreviewApp} from './features/scheduler/preview-app';
import './style.css';
import './redesign.css';
import './reels.css';
import './reels-theme.css';
import './features/scheduler/preview.css';
if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<React.StrictMode><PreviewApp/></React.StrictMode>);
