import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const sw = await readFile(new URL('../../public/share-target-sw.js', import.meta.url));
const html = '<!doctype html><meta charset="utf-8"><form method="post" action="/share-target" enctype="multipart/form-data"><input name="title" value="견적"><input type="file" name="files"><button>공유</button></form><script>navigator.serviceWorker.register("/share-target-sw.js")</script>';
const server = createServer((req, res) => {
  if (req.url === '/share-target-sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' });
    res.end(sw);
  } else if (req.method === 'GET' && req.url.startsWith('/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(599);
    res.end('POST missed service worker');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ serviceWorkers: 'allow' });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  async function share(name) {
    await page.locator('input[type=file]').setInputFiles(name ? { name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\ntrial\n') } : []);
    await page.getByRole('button', { name: '공유' }).click();
    await page.waitForURL(/\?share=[0-9a-f-]+/);
    return new URL(page.url());
  }
  async function entries() {
    return page.evaluate(async () => {
      const cache = await caches.open('tb-share-inbox-v1');
      return Promise.all((await cache.keys()).map(async key => (await (await cache.match(key)).formData()).get('files').name));
    });
  }

  const first = await share('first.pdf');
  const firstId = first.searchParams.get('share');
  const second = await share('second.pdf');
  if (second.searchParams.get('share') !== firstId || second.searchParams.get('shareRejected') !== '1') throw new Error(`Second share was not rejected: ${second}`);
  if (JSON.stringify(await entries()) !== JSON.stringify(['first.pdf'])) throw new Error('Second share hid or replaced the first file');
  const textShare = await share(null);
  if (textShare.searchParams.get('share') !== firstId || textShare.searchParams.get('shareRejected') !== '1') throw new Error(`Text share hid the first file: ${textShare}`);
  if (JSON.stringify(await entries()) !== JSON.stringify(['first.pdf'])) throw new Error('Text share replaced the first file');

  await page.evaluate(async id => (await caches.open('tb-share-inbox-v1')).delete(`/__share-inbox/${id}`), firstId);
  const third = await share('third.pdf');
  if (third.searchParams.has('shareRejected') || third.searchParams.get('share') === firstId) throw new Error('New share was not accepted after discard');
  if (JSON.stringify(await entries()) !== JSON.stringify(['third.pdf'])) throw new Error('Unexpected cache after discard and new share');
  console.log('PASS: second share returns to first pending file; explicit discard permits a new share');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
