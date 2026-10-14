// Service worker: makes Undertone installable, works offline, and receives reminders.
importScripts('/config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const CACHE = 'undertone-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/bible.js', '/logic.js', '/tree.js', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png'];

// Keep in step with the version in app.js imports.
const FIREBASE = ['app', 'auth', 'firestore', 'messaging'].map((m) => `https://www.gstatic.com/firebasejs/10.12.2/firebase-${m}.js`);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all([
    c.addAll(SHELL),
    c.addAll(FIREBASE).catch(() => {}), // also cached on first use, so a failure here isn't fatal
  ])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Firebase's code is loaded from gstatic and fonts from Google. Their addresses carry a version
// and never change, so they're kept cached and served from the cache first. Without this the
// app can't start offline, and readings can't be saved offline.
const LIBRARY = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (LIBRARY.test(e.request.url)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }))
    );
    return;
  }

  // The app's own files: network first, so updates show up right away; cached copy when offline.
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// Reminder notifications are sent with a notification payload, so Firebase shows them automatically.
const cfg = self.UNDERTONE_CONFIG;
if (cfg && cfg.firebase && !String(cfg.firebase.apiKey).startsWith('PASTE')) {
  firebase.initializeApp(cfg.firebase);
  firebase.messaging();
}
