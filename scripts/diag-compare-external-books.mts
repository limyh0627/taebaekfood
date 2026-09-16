// [읽기 전용] **밖에서 받은 장부와 우리 앱을 맞대 본다.** 아무것도 쓰지 않는다.
//
//   npx tsx scripts/diag-compare-external-books.mts
//   결과: scripts/diag-외부장부-차이.csv  (엑셀로 열어 보기)
//
// 왜 (2026-09-14 사장님) — "docs에 7월 31일 미수 8월 31일 미수 8월 전표 넣어뒀는데
//   우리어플이랑 매칭해보고 이상한 거래처 목록으로 뽑아봐", "8월 전표 이용해서는 세금금액
//   다른것도 찾아".
//
// 무엇을 맞대나 — 둘이다.
//   ① **8월 전표의 세액** ↔ 우리 전표의 세액. 같은 거래처·같은 날·같은 금액인 전표를 찾아
//      세액만 견준다. 한쪽이 과세인데 다른 쪽이 면세면 여기서 드러난다.
//   ② **8월 31일 미수** ↔ 우리 전표에서 센 외상 잔액.
//
// **이름으로 맞출 수밖에 없다** — 밖 장부에는 우리 거래처 id 가 없다. 그래서 못 찾은 이름도
// 같이 낸다. 억지로 비슷한 것에 붙이지 않는다(인수인계: 연결은 이름이 아니라 열쇠로).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync } from 'node:fs';
import XLSX from 'xlsx';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

const [statements, partners] = await Promise.all([load('issuedStatements'), load('partners')]);
const 시트 = (f: string) => XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets[XLSX.readFile(f).SheetNames[0]], { defval: null }) as any[];

/** 이름 맞추기 — 공백·괄호만 지운다. 그 밖의 글자는 손대지 않는다. */
const 키 = (v: unknown) => String(v ?? '').replace(/[\s()（）]/g, '').toLocaleLowerCase('ko-KR');
const 반 = (n: unknown) => Math.round(Number(n ?? 0));

const 우리거래처 = new Map<string, any>();
for (const p of partners) 우리거래처.set(키(p.name), p);

const 줄: string[] = ['갈래,거래처,날짜,무엇,밖 장부,우리 앱,차이,비고'];
const 적기 = (a: string, b: string, c: string, d: string, e: unknown, f: unknown, g: unknown, h = '') =>
  줄.push([a, b, c, d, e, f, g, h].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

// ── ① 세액 맞대기 ──────────────────────────────────────────────────────
const 전표시트 = 시트('로컬전용/docs/8월전표.xlsx').filter(r => r['전표구분'] === '매출' && 반(r['매출금액']) > 0);
console.log(`8월 전표(매출 발행) ${전표시트.length}줄`);

const 우리팔월 = statements.filter(s => String(s.tradeDate ?? '').startsWith('2026-08'));
console.log(`우리 8월 전표 ${우리팔월.length}건`);

let 세액다름 = 0, 못찾음 = 0;
for (const r of 전표시트) {
  const 날 = String(r['전표일자'] ?? '').slice(0, 10);
  const 금액 = 반(r['매출금액']);
  const 이름 = String(r['업체명'] ?? '');
  //  같은 날 · 같은 합계인 우리 전표를 찾는다. 거래처 이름까지 맞으면 더 확실하다.
  const 후보 = 우리팔월.filter(s => s.tradeDate === 날 && 반(s.totalAmount) === 금액);
  const 맞는것 = 후보.find(s => 키(s.partnerName) === 키(이름)) ?? (후보.length === 1 ? 후보[0] : undefined);
  if (!맞는것) { 못찾음++; continue; }
  const 밖세액 = 반(r['세액']);
  const 우리세액 = 반(맞는것.totalTax);
  if (밖세액 !== 우리세액) {
    세액다름++;
    적기('세액', 이름, 날, `합계 ${금액.toLocaleString()}`, 밖세액, 우리세액, 우리세액 - 밖세액,
      `${밖세액 === 0 ? '밖=면세' : ''}${우리세액 === 0 ? ' 우리=면세' : ''} ${맞는것.docNo ?? ''}`.trim());
  }
}
console.log(`  세액 다른 전표 ${세액다름}건 · 짝을 못 찾은 줄 ${못찾음}건`);

// ── ② 미수 맞대기 ──────────────────────────────────────────────────────
//  우리 쪽 외상 잔액 = 그 거래처 **매출 전표 합 − 수금 합**. 8/31 까지만 센다.
const 수금 = await load('cashEntries');
const 팔월끝 = '2026-08-31';
const 우리미수 = new Map<string, number>();
for (const s of statements) {
  if (String(s.tradeDate ?? '') > 팔월끝 || s.type !== '매출') continue;
  우리미수.set(s.partnerId, (우리미수.get(s.partnerId) ?? 0) + 반(s.totalAmount));
}
for (const c of 수금) {
  const 날 = String(c.date ?? c.tradeDate ?? '').slice(0, 10);
  if (!날 || 날 > 팔월끝 || !c.partnerId) continue;
  //  수금(들어온 돈)만 외상을 줄인다. 지불은 매입 쪽이라 여기 안 센다.
  const 금액 = 반(c.amount);
  if (c.direction === 'in' || c.type === '수금' || 금액 > 0) 우리미수.set(c.partnerId, (우리미수.get(c.partnerId) ?? 0) - Math.abs(금액));
}

const 미수시트 = 시트('로컬전용/docs/8월 31일 미수.xlsx').filter(r => String(r['업체구분'] ?? '') === '매출처');
console.log(`\n8월 31일 미수 시트 매출처 ${미수시트.length}줄`);
let 미수다름 = 0, 이름없음 = 0;
for (const r of 미수시트) {
  const 이름 = String(r['업체명'] ?? '');
  const 밖미수 = 반(r['마감시점미수']);
  const p = 우리거래처.get(키(이름));
  if (!p) { if (밖미수 !== 0) { 이름없음++; 적기('미수', 이름, 팔월끝, '마감시점미수', 밖미수, '(우리 앱에 없는 거래처)', '', ''); } continue; }
  const 우리 = 반(우리미수.get(p.id) ?? 0);
  if (Math.abs(우리 - 밖미수) >= 1) { 미수다름++; 적기('미수', 이름, 팔월끝, '마감시점미수', 밖미수, 우리, 우리 - 밖미수, p.id); }
}
console.log(`  미수 다른 거래처 ${미수다름}곳 · 우리 앱에 없는 이름 ${이름없음}곳`);

writeFileSync('scripts/diag-외부장부-차이.csv', '﻿' + 줄.join('\n'), 'utf-8');
console.log(`\n→ scripts/diag-외부장부-차이.csv (${줄.length - 1}줄)`);
process.exit(0);
