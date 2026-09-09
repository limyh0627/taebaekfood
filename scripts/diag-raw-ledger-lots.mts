// [읽기 전용] 원료 실제원장 ↔ 로트 갈림 조사 — 원자화 이관 1단계
//
//   docs/원료실제원장-로트-원자화-설계.md §15 의 1번. **아무것도 쓰지 않는다.**
//   회사·원료별로 원장잔량 / 벌크로트 / 제품로트 / items.stock / 마지막 실사 /
//   상태 문서 크기와, 회사·품목 열쇠가 없는 원장 줄 수를 센다.
//
//   왜 먼저 재나 — 새 구조(rawInventories)로 옮기기 전에 **지금 얼마나 벌어져 있는지**
//   모르면 이관 스크립트가 어느 숫자를 옮겨야 할지 정할 수 없다. 코드가 추측해서
//   맞추면 안 된다(설계 §15 끝줄).
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { writeFileSync } from 'node:fs';
import { baseRawName, DENSITY } from '../src/constants/formula';
import { ledgerBalanceKg, latestAnchorDate } from '../src/shared/rawLedgerBalance';
import type { RawMaterialEntry, RawMaterialLot } from '../src/shared/types';

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));
const load = async (c: string) => (await getDocs(collection(db, c))).docs.map(d => ({ id: d.id, ...d.data() } as any));

const [items, ledger] = await Promise.all([load('items'), load('rawMaterialLedger')]);

//  회사 판정은 앱과 같은 규칙 — 없으면 태백(옛 기록 전부).
const companyOf = (x: any): string => x?.companyId ?? 'taebaek';
//  원료 홀더 판정도 앱과 같다(rawReceipt.rawLotTarget).
const isHolder = (i: any) => (i.type === 'raw' || (i.type === 'wip' && i.unit !== '개')) && !i.phantom && !i.archived;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const lotKg = (lots: RawMaterialLot[] | undefined) => r3((lots ?? []).reduce((a, l) => a + Number(l.kgRemaining ?? 0), 0));

const holders = items.filter(isHolder);

//  제품 로트 — 홀더가 아닌 품목이 들고 있는 같은 물질 로트(박스·포장품).
//  설계 §2 는 원료 상태에 **벌크만** 두기로 했으니, 지금 섞여 있는 양을 따로 센다.
const productLotByMaterial = new Map<string, { kg: number; items: string[] }>();
for (const it of items) {
  if (isHolder(it) || it.archived) continue;
  for (const l of (it.lots ?? []) as RawMaterialLot[]) {
    const m = l.material ?? baseRawName(it.name ?? '');
    if (!m) continue;
    const key = `${companyOf(it)}\u0000${m}`;
    const cur = productLotByMaterial.get(key) ?? { kg: 0, items: [] };
    cur.kg = r3(cur.kg + Number(l.kgRemaining ?? 0));
    if (!cur.items.includes(it.name)) cur.items.push(it.name);
    productLotByMaterial.set(key, cur);
  }
}

//  원장 줄을 회사·원료명으로 모은다. 열쇠가 없는 줄이 몇인지도 같이 센다.
const rowsByKey = new Map<string, RawMaterialEntry[]>();
const rowsByMaterial = new Map<string, RawMaterialEntry[]>();
let noCompany = 0;
for (const e of ledger as RawMaterialEntry[]) {
  if (e.companyId == null) noCompany++;
  const m = String(e.material ?? '');
  //  **열쇠로 묶는다.** 이름으로 묶던 시절엔 이름이 어긋난 줄이 통째로 빠졌다 —
  //  검정참깨 홀더의 줄이 원장엔 '검정깨' 로 적혀 있어 −80kg 이 갈려 보였다.
  const key = e.rawItemId ? `id\u0000${e.rawItemId}` : `${companyOf(e)}\u0000${m}`;
  (rowsByKey.get(key) ?? rowsByKey.set(key, []).get(key)!).push(e);
  (rowsByMaterial.get(m) ?? rowsByMaterial.set(m, []).get(m)!).push(e);
}

const rows: any[] = [];
for (const h of holders) {
  const company = companyOf(h);
  const base = baseRawName(h.name ?? '');
  //  홀더의 **id** 로 먼저 찾고, 아직 열쇠가 없는 옛 줄만 이름으로 줍는다.
  const mine = rowsByKey.get(`id\u0000${h.id}`) ?? rowsByKey.get(`${company}\u0000${base}`) ?? [];
  const density = DENSITY[base] ?? 1;
  const bulk = lotKg(h.lots);
  const prod = productLotByMaterial.get(`${company}\u0000${base}`);
  const ledgerKg = r3(ledgerBalanceKg(mine, density));
  const stateDoc = JSON.stringify({ activeLots: (h.lots ?? []).filter((l: any) => l.status !== 'depleted') });
  rows.push({
    company, rawItemId: h.id, material: base, itemName: h.name,
    lotsAreTotal: h.lotsAreTotal ?? false,
    원장잔량: ledgerKg,
    벌크로트: bulk,
    제품로트: prod?.kg ?? 0,
    제품로트품목: prod?.items ?? [],
    'items.stock': Number(h.stock ?? 0),
    갈림_원장_벌크: r3(ledgerKg - bulk),
    갈림_원장_stock: r3(ledgerKg - Number(h.stock ?? 0)),
    마지막실사: latestAnchorDate(mine),
    원장줄수: mine.length,
    활성로트수: (h.lots ?? []).filter((l: any) => l.status !== 'depleted').length,
    전체로트수: (h.lots ?? []).length,
    상태문서바이트: stateDoc.length,
  });
}

//  홀더가 없는 원장 원료명 — 이관 때 어디로 넣을지 사람이 정해야 하는 줄.
const holderNames = new Set(holders.map(h => `${companyOf(h)}\u0000${baseRawName(h.name ?? '')}`));
const holderIds = new Set(holders.map(h => `id\u0000${h.id}`));
const orphanKeys = [...rowsByKey.keys()].filter(k => !holderNames.has(k) && !holderIds.has(k))
  .map(k => { const [c, m] = k.split('\u0000'); return { company: c, material: m, 줄수: rowsByKey.get(k)!.length }; })
  .sort((a, b) => b.줄수 - a.줄수);

//  같은 원료명을 두 회사가 각자 들고 있는가 — 이름으로 홀더를 고르는 지금 코드가 헛짚는 자리.
const byName = new Map<string, string[]>();
for (const h of holders) {
  const b = baseRawName(h.name ?? '');
  (byName.get(b) ?? byName.set(b, []).get(b)!).push(companyOf(h));
}
const shared = [...byName.entries()].filter(([, cs]) => new Set(cs).size > 1)
  .map(([m, cs]) => ({ material: m, companies: [...new Set(cs)] }));

const TOL = 1;
const out = {
  조사시각: new Date().toISOString(),
  요약: {
    원료홀더수: holders.length,
    원장줄수: ledger.length,
    회사없는_원장줄: noCompany,
    rawItemId있는_원장줄: 0,   // 스키마에 아예 없다 — 이관 9단계에서 채운다
    홀더못찾은_원장키: orphanKeys.length,
    두회사공유_원료명: shared.length,
    갈린_홀더수: rows.filter(r => Math.abs(r.갈림_원장_벌크) > TOL).length,
    갈림_절대값합: r3(rows.reduce((a, r) => a + Math.abs(r.갈림_원장_벌크), 0)),
    제품로트_섞인_홀더수: rows.filter(r => r.제품로트 > 0).length,
    최대_상태문서바이트: Math.max(0, ...rows.map(r => r.상태문서바이트)),
    최대_활성로트수: Math.max(0, ...rows.map(r => r.활성로트수)),
  },
  두회사공유_원료명: shared,
  홀더못찾은_원장키: orphanKeys,
  홀더별: rows.sort((a, b) => Math.abs(b.갈림_원장_벌크) - Math.abs(a.갈림_원장_벌크)),
};

const path = process.argv[2] ?? 'scripts/diag-raw-ledger-lots.json';
writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out.요약, null, 2));
console.log(`\n갈림 상위 12건`);
for (const r of out.홀더별.slice(0, 12)) {
  console.log(`  ${r.company} ${r.material.padEnd(12)} 원장 ${String(r.원장잔량).padStart(10)} / 벌크 ${String(r.벌크로트).padStart(10)} / stock ${String(r['items.stock']).padStart(10)} → 갈림 ${r.갈림_원장_벌크}${r.제품로트 ? `  (제품로트 ${r.제품로트})` : ''}${r.마지막실사 ? `  실사 ${r.마지막실사}` : ''}`);
}
console.log(`\n→ ${path}`);
process.exit(0);
