import { chromium } from 'playwright';

// demo emulators and localtest Vite only; never point this test at a deployed app.
const appUrl = process.env.SHARE_TEST_URL || 'http://localhost:8099/';
const emulatorProject = 'demo-taebaekfood-local';
const marker = `share-qa-${Date.now()}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.evaluate(() => navigator.serviceWorker.register('/share-target-sw.js'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await page.getByRole('textbox', { name: '아이디' }).fill('testadmin');
  await page.getByRole('textbox', { name: /비밀번호/ }).fill('localtest');
  await page.getByRole('button', { name: '시스템 접속하기' }).click();
  await page.getByRole('button', { name: /오피스톡/ }).first().waitFor();

  await page.evaluate(title => {
    const form = document.createElement('form');
    form.method = 'POST'; form.action = '/share-target'; form.enctype = 'multipart/form-data';
    const titleInput = document.createElement('input'); titleInput.name = 'title'; titleInput.value = title;
    const fileInput = document.createElement('input'); fileInput.name = 'files'; fileInput.type = 'file';
    form.append(titleInput, fileInput); document.body.append(form);
  }, marker);
  await page.locator('form[action="/share-target"] input[type=file]').setInputFiles({
    name: `${marker}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nlocal test\n'),
  });
  await page.locator('form[action="/share-target"]').evaluate(form => form.requestSubmit());
  await page.waitForURL(/\?share=[0-9a-f-]+/);
  await page.getByText(`${marker}.pdf`).waitFor();
  await page.getByRole('button', { name: /로컬 검수방/ }).first().click();
  const send = page.getByRole('button', { name: /공유.*전송|전송/ });
  await send.last().click();
  await page.getByText('공유 파일 미리보기').waitFor({ state: 'hidden' });
  await page.getByText(marker, { exact: true }).last().waitFor();
  const remaining = await page.evaluate(async () => (await (await caches.open('tb-share-inbox-v1')).keys()).length);
  if (remaining !== 0) throw new Error(`Shared file stayed cached after send: ${remaining}`);
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8082';
  const [{ initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore'),
  ]);
  const adminApp = initializeApp({ projectId: emulatorProject }, marker);
  const saved = await getFirestore(adminApp).collection('chatMessages').where('text', '==', marker).get();
  if (saved.size !== 1 || !saved.docs[0].data().fileUrl) throw new Error('Attachment message not found in demo Firestore');
  const storedFile = await fetch(saved.docs[0].data().fileUrl);
  if (!storedFile.ok || !(await storedFile.text()).startsWith('%PDF-1.4')) throw new Error('Shared file not found in demo Storage');
  console.log('PASS: Auth → shared file → Storage/OfficeTalk → Firestore → CacheStorage cleanup');
} finally {
  await browser.close();
}
