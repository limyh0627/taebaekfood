const CACHE = 'tb-share-inbox-v1';
const MAX = 20 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
let receiveQueue = Promise.resolve();
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share-target') return;
  const response = receiveQueue.then(async () => {
    try {
      const data = await event.request.formData();
      const files = data.getAll('files');
      const cache = await caches.open(CACHE);
      // 미처리 파일이 있으면 텍스트 공유도 기존 파일 화면으로 되돌린다.
      const pending = await cache.keys();
      if (pending.length) {
        const previousId = new URL(pending[0].url).pathname.split('/').pop();
        return Response.redirect(new URL(`/?share=${previousId}&shareRejected=1`, self.location.origin), 303);
      }
      if (files.length === 0) {
        const query = new URLSearchParams();
        for (const field of ['title', 'text', 'url']) {
          const value = String(data.get(field) || '').trim();
          if (value) query.set(field, value);
        }
        if (query.size) return Response.redirect(new URL(`/?${query}`, self.location.origin), 303);
      }
      if (files.length !== 1 || !(files[0] instanceof File) || !files[0].size || files[0].size > MAX || !TYPES.has(files[0].type)) {
        return new Response('지원하지 않는 공유 파일입니다. 파일 1개, 20MB 이하 PNG/JPEG/WebP/PDF만 가능합니다.', { status: 400 });
      }
      const id = crypto.randomUUID();
      const body = new FormData();
      for (const field of ['title', 'text', 'url']) body.set(field, String(data.get(field) || ''));
      body.set('files', files[0]);
      await cache.put(new Request(new URL(`/__share-inbox/${id}`, self.location.origin)), new Response(body));
      return Response.redirect(new URL(`/?share=${id}`, self.location.origin), 303);
    } catch (error) {
      console.error('공유 파일 보관 실패:', error);
      return new Response('공유 파일을 보관하지 못했습니다. 다시 시도해 주세요.', { status: 500 });
    }
  });
  receiveQueue = response.then(() => undefined, () => undefined);
  event.respondWith(response);
});
