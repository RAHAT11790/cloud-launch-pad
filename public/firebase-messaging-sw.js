// Firebase Messaging Service Worker for background push notifications
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: "rs-anime.firebaseapp.com",
  databaseURL: "https://rs-anime-default-rtdb.firebaseio.com",
  projectId: "rs-anime",
  storageBucket: "rs-anime.firebasestorage.app",
  messagingSenderId: "843989457516",
  appId: "1:843989457516:web:57e0577d092183eedd9649",
});

const messaging = firebase.messaging();
const brandIcon = '/notification-badge.svg';
const MAIN_DOMAIN = 'https://rsanime03.lovable.app';

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || 'RS ANIME';
  const body = payload.notification?.body || payload.data?.body || '';
  const icon = payload.notification?.icon || payload.data?.icon || brandIcon;
  const clickUrl = payload.data?.url || MAIN_DOMAIN;
  self.registration.showNotification(title, {
    body,
    icon,
    badge: '/notification-badge.svg',
    data: { url: clickUrl },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || MAIN_DOMAIN;
  event.waitUntil(clients.openWindow(url));
});
