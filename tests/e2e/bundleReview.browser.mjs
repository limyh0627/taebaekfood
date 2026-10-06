import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
const page = await context.newPage();
const db = getFirestore(getApps().find(app => app.name === '[DEFAULT]'));
const until = async test => {
  for (let n = 0; n < 50; n++) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Expected demo state did not arrive');
};
try {
  page.setDefaultTimeout(90000);
  await page.goto('http://localhost:8099', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('textbox', { name: '아이디' }).fill('testadmin');
  await page.getByRole('textbox', { name: /비밀번호/ }).fill('localtest');
  await page.getByRole('button', { name: '시스템 접속하기' }).click();
  await page.getByRole('button', { name: '품목 관리', exact: true }).first().click();
  const photoItem = db.collection('items').doc('oil-350');
  let priorUrl = '';
  for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByPlaceholder('품목명 검색', { exact: true }).fill('가상 참기름/350ml');
    const row = page.locator('tr').filter({ has: page.getByText('가상 참기름', { exact: true }) });
    await row.getByTitle('수정', { exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const bytes = await page.evaluate(mime => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#164f72'; ctx.fillRect(0, 0, 16, 16);
      return canvas.toDataURL(mime).split(',')[1];
    }, mime);
    await page.getByLabel('품목 사진 선택').setInputFiles({ name: `demo.${mime.split('/')[1]}`, mimeType: mime, buffer: Buffer.from(bytes, 'base64') });
    await page.getByRole('button', { name: '수정 완료', exact: true }).tap();
    await page.getByText('서류용 품목이 비어 있습니다.', { exact: false }).waitFor(); await page.getByRole('button', { name: '확인', exact: true }).tap();
    await page.getByLabel('품목 사진 선택').waitFor({ state: 'hidden' });
    let current;
    await until(async () => { current = (await photoItem.get()).data(); return current.image && current.image !== priorUrl; });
    if (!current.imagePath.startsWith('companies/taebaek/items/oil-350/')) throw new Error('Photo company path mismatch');
    if (!(await fetch(current.image)).ok) throw new Error('Saved image missing from Storage');
    if (priorUrl) await until(async () => (await fetch(priorUrl)).status === 404);
    priorUrl = current.image;
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('tr').filter({ has: page.getByText('가상 참기름', { exact: true }) }).getByTitle('수정', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '사진 삭제', exact: true }).tap();
  await page.getByRole('button', { name: '수정 완료', exact: true }).tap();
  await page.getByText('서류용 품목이 비어 있습니다.', { exact: false }).waitFor(); await page.getByRole('button', { name: '확인', exact: true }).tap();
  await until(async () => !(await photoItem.get()).data().image);
  await until(async () => (await fetch(priorUrl)).status === 404);
  console.log('PASS: mobile touch PNG/JPEG/WebP upload, replacement and deletion; company Storage path; saved file cleanup');
  await page.setViewportSize({ width: 1280, height: 900 });
  const beforeOrders = (await db.collection('orders').get()).size;
  await page.getByRole('button', { name: '주문·배송', exact: true }).first().click();
  await page.getByRole('button', { name: '주문 생성', exact: true }).click();
  await page.getByRole('button', { name: /직접 선택/ }).click();
  await page.setViewportSize({ width: 390, height: 480 });
  await page.getByPlaceholder(/거래처명 또는 초성 검색/).fill('가상');
  const partner = page.getByRole('button', { name: /가상온라인몰/ });
  await partner.waitFor();
  await until(async () => { const box = await partner.boundingBox(); return box && box.y >= 0 && box.y + box.height < 420; });
  await partner.tap();
  await page.getByText('가상온라인몰', { exact: true }).waitFor();
  if ((await db.collection('orders').get()).size !== beforeOrders) throw new Error('Selection unexpectedly created an order');
  console.log('PASS: 390x480 mobile touch partner selection stays visible; selection does not save an order');
} catch (error) {
  await mkdir('outputs', { recursive: true });
  await page.screenshot({ path: 'outputs/bundle-review-failure.png', fullPage: true });
  console.log((await page.locator('body').innerText()).slice(-3500));
  throw error;
} finally { await browser.close(); }
