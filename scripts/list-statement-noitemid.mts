// [읽기 전용] 아직 `itemId` 가 없는 전표 줄 **전부**를 낸다.
//   실행: npx tsx scripts/list-statement-noitemid.mts
//   결과: scripts/전표-품목미연결.csv  (엑셀)
//
// 왜 못 채웠는지도 줄마다 적는다 —
//   · **품목 없음** — 그 이름의 품목이 아예 없다. 비용 줄(상차비·택배비…)이면 정상이다.
//   · **후보 여럿** — 이름·회사·거래처연결·단가로 좁혀도 하나로 안 줄었다. 후보 id 를 같이 낸다.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync } from 'node:fs';

const OUT = 'scripts/전표-품목미연결.csv';
const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));
const [st, items, boms, partnerItems] = await Promise.all(
  [load('issuedStatements'), load('items'), load('item_bom'), load('partner_item')]);

const 자식 = new Map<string, { childId: string; qty: number }[]>();
for (const b of boms) {
  if (!b?.parent_id || !b?.child_id) continue;
  const a = 자식.get(b.parent_id) ?? [];
  a.push({ childId: b.child_id, qty: typeof b.quantity === 'number' ? b.quantity : 1 });
  자식.set(b.parent_id, a);
}
const byId = new Map(items.map((i: any) => [i.id, i]));
const 박스 = (p: any) => {
  const c = (자식.get(p.id) ?? []).filter(l => {
    const x = byId.get(l.childId);
    return x && (x.type === 'product' || x.type === '완제품');
  });
  return c.length === 1 && c[0].qty > 1;
};
const 정규 = (n: string) => String(n ?? '').replace(/\s+/g, '');
const 회사of = (x: any) => x?.companyId ?? 'taebaek';

const 이름별 = new Map<string, any[]>();
for (const i of items) {
  if (i.archived || 박스(i)) continue;
  const k = 정규(i.name);
  if (!k) continue;
  if (!이름별.has(k)) 이름별.set(k, []);
  이름별.get(k)!.push(i);
}

type Row = {
  날짜: string; 전표: string; 갈래: string; 거래처: string;
  품목명: string; 규격: string; 수량: string; 단가: string; 계정: string;
  왜: string; 후보: string;
};
const rows: Row[] = [];

for (const s of st) {
  if (s.type !== '매출' && s.type !== '매입') continue;
  const 회사 = 회사of(s);
  const dir: 'in' | 'out' = s.type === '매입' ? 'in' : 'out';
  for (const l of (s.items ?? [])) {
    if (l.itemId) continue;
    let hit = 이름별.get(정규(l.name)) ?? [];
    const 처음후보 = hit.length;
    if (hit.length > 1) {
      const 회사것 = hit.filter((x: any) => 회사of(x) === 회사);
      if (회사것.length >= 1) hit = 회사것;
    }
    if (hit.length > 1) {
      const 연결된 = hit.filter((c: any) => partnerItems.some(
        (pc: any) => pc.itemId === c.id && pc.partnerId === s.partnerId && (pc.Direction ?? 'out') === dir));
      if (연결된.length >= 1) hit = 연결된;
    }
    rows.push({
      날짜: String(s.tradeDate ?? ''),
      전표: String(s.docNo ?? ''),
      갈래: String(s.type),
      거래처: String(s.partnerName ?? ''),
      품목명: String(l.name ?? ''),
      규격: String(l.spec ?? ''),
      수량: String(l.qty ?? ''),
      단가: String(l.price ?? ''),
      계정: String(l.accountCode ?? ''),
      왜: 처음후보 === 0 ? '그 이름의 품목이 없음' : `후보 ${hit.length}개로 안 좁혀짐`,
      후보: hit.map((c: any) => `${c.id}(재고 ${c.stock ?? 0})`).join(' | '),
    });
  }
}

rows.sort((a, b) => a.왜.localeCompare(b.왜) || a.품목명.localeCompare(b.품목명) || a.날짜.localeCompare(b.날짜));

const 머리 = ['날짜', '전표', '갈래', '거래처', '품목명', '규격', '수량', '단가', '계정', '왜 못 채웠나', '후보 품목'];
const csv = [머리.join(','), ...rows.map(r => [
  r.날짜, r.전표, r.갈래, r.거래처, r.품목명, r.규격, r.수량, r.단가, r.계정, r.왜, r.후보,
].map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\r\n');
writeFileSync(OUT, '﻿' + csv, 'utf8');

console.log(`\nitemId 없는 전표 줄 ${rows.length}개 → ${OUT}\n`);
for (const r of rows) {
  console.log([
    r.날짜.padEnd(10), r.전표.padEnd(13), r.갈래, r.거래처.slice(0, 14).padEnd(14),
    r.품목명.slice(0, 28).padEnd(28), r.규격.slice(0, 10).padEnd(10),
    String(r.수량).padStart(6), String(r.단가).padStart(9), (r.계정 || '-').padEnd(5),
    r.왜, r.후보 ? ` [${r.후보}]` : '',
  ].join(' '));
}
process.exit(0);
