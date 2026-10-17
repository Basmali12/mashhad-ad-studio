import React from 'react';
import {createRoot} from 'react-dom/client';
import {PublishingRoot} from './features/auth/publishing-root';
import {AdminApp} from './features/admin/admin-app';
import './style.css';
import './redesign.css';
import './reels.css';
import './reels-theme.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><PublishingRoot administratorOnly><AdminApp/></PublishingRoot></React.StrictMode>);
