//  **알림을 눌렀을 때 앱을 띄우는 곳.**
//  안드로이드에서는 알림을 서비스워커가 띄운다(`reg.showNotification`). 그래서 누른 뒤
//  무엇을 할지도 서비스워커가 알아야 한다 — 페이지의 `onclick` 은 안 불린다.
//
//  이 파일은 vite-plugin-pwa 가 만든 서비스워커에 `workbox.importScripts` 로 붙는다
//  (vite.admin.config.ts). generateSW 모드를 유지하면서 코드를 얹는 유일한 길이다.

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const view = event.notification.data && event.notification.data.view;

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // 이미 열려 있는 창이 있으면 그걸 앞으로 — 새 창을 또 열면 로그인부터 다시 한다
    for (const client of clientList) {
      if (client.url.indexOf(self.registration.scope) === 0) {
        await client.focus();
        if (view) client.postMessage({ type: 'notif-open', view: view });
        return;
      }
    }

    // 꺼져 있었으면 새로 띄운다
    await self.clients.openWindow(view ? './?notif=' + encodeURIComponent(view) : './');
  })());
});
