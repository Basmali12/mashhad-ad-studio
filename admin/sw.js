/* global self */
// Installation only. No fetch handler and no account, page or media caching.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
