//  **앱이 꺼져 있을 때 알림을 받는 곳.**
//
//  워크박스가 만든 서비스워커(sw.js)와 **따로** 돈다 — 파이어베이스가 이 파일 이름을
//  정해 놓았고(`firebase-messaging-sw.js`), 자기 범위에 따로 등록한다. 둘은 안 부딪힌다.
//
//  여기서는 앱 코드를 못 가져다 쓴다(서비스워커는 모듈을 못 읽는다). 그래서 설정값을
//  **적어 둔다** — 빌드할 때 .env 에서 만들어 넣는다(scripts/gen-fcm-sw.mjs).
//  이 값들은 다 공개키라 드러나도 된다.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  "apiKey": "AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE",
  "authDomain": "taebaek-3abe4.firebaseapp.com",
  "projectId": "taebaek-3abe4",
  "storageBucket": "taebaek-3abe4.firebasestorage.app",
  "messagingSenderId": "426912093935",
  "appId": "1:426912093935:web:2bd399b729b553edf82d1a"
});

const messaging = firebase.messaging();

//  앱이 꺼져 있거나 뒤에 있을 때 오는 알림.
//  **화면이 살아 있을 때는 여기로 안 온다** — 그때는 앱이 직접 띄운다(shared/notify).
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || '태백식품', {
    body: d.body || '',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: d.tag || 'fcm',
    data: { view: d.view || '' },
  });
});

//  누르면 앱을 띄운다 — notif-sw.js 와 같은 규칙이다.
//  (그쪽은 워크박스 서비스워커에 얹혀 있고, 이건 이 파일 것이다)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const view = event.notification.data && event.notification.data.view;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.indexOf(self.registration.scope) === 0) {
        await c.focus();
        if (view) c.postMessage({ type: 'notif-open', view: view });
        return;
      }
    }
    await self.clients.openWindow(view ? './?notif=' + encodeURIComponent(view) : './');
  })());
});
