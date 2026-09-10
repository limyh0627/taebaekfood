// [읽기 전용] 과세/면세를 **사람이 봐야 하는** 거래처 단가를 목록으로 뽑는다.
//   실행: npx tsx scripts/list-taxtype-review.mts
//   결과: scripts/과세면세-확인목록.csv  (엑셀로 열면 된다)
//
// 왜 (2026-09-10 사장님) — "나머진 다 직접봐야 알아 거래처마다 달라서".
//
//   과세 여부가 거래처마다 다르다면 코드가 규칙으로 채울 수 있는 건 여기까지다.
//   남은 건 **사장님이 보고 정해야** 하므로, 판단에 필요한 것만 한 줄에 모아 준다 —
//   지금 값 · 그 품목이 실제로 어떻게 끊겼나(전표 이력) · 다른 거래처는 어떻게 돼 있나.
//
// 무엇을 '봐야 하는 것' 으로 고르나 — 셋 중 하나라도 걸리면 담는다.
//   ① **전표와 어긋남** — 지금 값이, 그 품목이 실제로 끊긴 값과 다르다. 제일 급하다.
//   ② **거래처마다 섞임** — 같은 품목인데 과세인 곳도 면세인 곳도 있다.
//   ③ **약한 근거로 채움** — 다른 거래처 단가만 보고 채운 것(2026-09-10 1차 정리).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const OUT = 'scripts/과세면세-확인목록.csv';
const 약한근거파일 = 'scripts/fix-partner-item-taxtype-backup.json';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [pi, st, items, partners] = await Promise.all(
  [load('partner_item'), load('issuedStatements'), load('items'), load('partners')]);
const byId = new Map(items.map((i: any) => [i.id, i]));
const 거래처 = new Map(partners.map((p: any) => [p.id, p.name]));

//  약한 근거로 채운 것 — 1차 정리의 백업에서 읽는다
const 약한근거 = new Set<string>();
if (existsSync(약한근거파일)) {
  const b = JSON.parse(readFileSync(약한근거파일, 'utf8')) as { 채운것: any[] };
  for (const r of b.채운것) if (r.근거 === '다른 거래처 단가') 약한근거.add(r.id);
}

//  품목별 — 전표 이력 · 거래처 단가 분포
const 전표별 = new Map<string, { 과세: number; 면세: number }>();
for (const s of st) {
  for (const l of (s.items ?? [])) {
    if (!l.itemId) continue;
    const cur = 전표별.get(l.itemId) ?? { 과세: 0, 면세: 0 };
    if (l.isTaxExempt) cur.면세++; else cur.과세++;
    전표별.set(l.itemId, cur);
  }
}
const 단가별 = new Map<string, { 과세: number; 면세: number }>();
for (const p of pi) {
  if (!p.itemId || !p.taxType || !(Number(p.price ?? 0) > 0)) continue;
  const cur = 단가별.get(p.itemId) ?? { 과세: 0, 면세: 0 };
  if (p.taxType === '면세') cur.면세++; else cur.과세++;
  단가별.set(p.itemId, cur);
}

type Row = { 품목: string; 거래처: string; 방향: string; 단가: number; 지금: string; 왜: string; 전표: string; 다른거래처: string };
const rows: Row[] = [];
for (const p of pi) {
  if (!(Number(p.price ?? 0) > 0) || !p.itemId) continue;
  const 품목 = String(byId.get(p.itemId)?.name ?? p.itemId);
  const 지금 = p.taxType ?? '(빈칸)';
  const v = 전표별.get(p.itemId);
  const d = 단가별.get(p.itemId);

  const 이유: string[] = [];
  //  ① 전표와 어긋남 — 전표가 한쪽으로만 끊겼는데 지금 값이 그 반대다
  if (v && p.taxType) {
    const 전표한쪽 = v.과세 > 0 && v.면세 === 0 ? '과세' : v.면세 > 0 && v.과세 === 0 ? '면세' : null;
    if (전표한쪽 && 전표한쪽 !== p.taxType) 이유.push('전표와 어긋남');
  }
  //  ② 거래처마다 섞임
  if (d && d.과세 > 0 && d.면세 > 0) 이유.push('거래처마다 섞임');
  //  ③ 약한 근거로 채움
  if (약한근거.has(p.id)) 이유.push('약한 근거로 채움');
  if (이유.length === 0) continue;

  rows.push({
    품목, 거래처: String(거래처.get(p.partnerId) ?? p.partnerId),
    방향: p.Direction === 'in' ? '매입' : '매출',
    단가: Number(p.price), 지금, 왜: 이유.join(' · '),
    전표: v ? `과세 ${v.과세} / 면세 ${v.면세}` : '없음',
    다른거래처: d ? `과세 ${d.과세} / 면세 ${d.면세}` : '없음',
  });
}

rows.sort((a, b) => a.품목.localeCompare(b.품목) || a.거래처.localeCompare(b.거래처));

const 머리 = ['품목', '거래처', '방향', '단가', '지금', '왜 봐야 하나', '전표에서 끊긴 값', '다른 거래처는'];
const csv = [머리.join(','), ...rows.map(r => [
  r.품목, r.거래처, r.방향, r.단가, r.지금, r.왜, r.전표, r.다른거래처,
].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\r\n');
//  엑셀이 한글을 깨뜨리지 않게 BOM 을 붙인다
writeFileSync(OUT, '﻿' + csv, 'utf8');

console.log(`\n확인할 거래처 단가 ${rows.length}건 → ${OUT}\n`);
const 갈래: Record<string, number> = {};
for (const r of rows) 갈래[r.왜] = (갈래[r.왜] ?? 0) + 1;
console.log('── 왜 봐야 하나 ──');
for (const [k, v] of Object.entries(갈래).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(34)} ${v}건`);

const 품목별: Record<string, number> = {};
for (const r of rows) 품목별[r.품목] = (품목별[r.품목] ?? 0) + 1;
console.log(`\n── 품목 ${Object.keys(품목별).length}종 (많은 순 20) ──`);
for (const [k, v] of Object.entries(품목별).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`   ${k.slice(0, 34).padEnd(34)} ${v}건`);
}
process.exit(0);
