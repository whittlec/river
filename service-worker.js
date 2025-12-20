/* eslint-disable no-restricted-globals */

// This service worker can be customized to cache specific assets.
// For now, it includes a fetch listener to satisfy PWA installation criteria.

const CACHE_NAME = 'river-levels-v1';

self.addEventListener('install', (event) => {
  // Perform install steps
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Respond with cached resources if available, else fetch from network.
  // This is a basic pass-through for now.
  event.respondWith(fetch(event.request));
});