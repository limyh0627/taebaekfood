// 6/29~7/1 로트 소실 사고 복구 (2026-07-02)
// 근거: 6/29 실사 목표값(역산 확정) + 이후 수불부 흐름 롤포워드 → 원료별 현재 정상재고 산출 → 복구 로트 시드
// 실행: node scripts/restore-lots-260702.mjs --dry (미리보기) / 없이 실행 시 실제 적용
// 백업: scripts/lot-restore-backup-260702.json (수정 전 문서 상태)
// 되돌리기: node scripts/restore-lots-260702.mjs --undo
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const DRY = process.argv.includes('--dry');
const UNDO = process.argv.includes('--undo');
const BACKUP = new URL('./lot-restore-backup-260702.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const app = initializeApp({ apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE', authDomain: 'taebaek-3abe4.firebaseapp.com', projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
await signInAnonymously(getAuth(app));

if (UNDO) {
  if (!existsSync(BACKUP)) { console.log('백업 파일 없음:', BACKUP); process.exit(1); }
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  for (const [id, prev] of Object.entries(backup.items)) {
    await updateDoc(doc(db, 'items', id), { stock: prev.stock, lots: prev.lots ?? [] });
    console.log(`복원: ${id} stock=${prev.stock} lots=${prev.lots ? prev.lots.length : 0}건`);
  }
  console.log('undo 완료 (targetKg 백필은 무해하므로 유지)');
  process.exit(0);
}

const DENSITY = { 통깨참기름: 0.916, 깨분참기름: 0.916, 통들깨들기름: 0.924, 수입들기름: 0.924, 생들기름: 0.924 };
// 6/29 실사 앵커: 실사 목표값(kg) + 실사 기록 createdAt (역산 근거는 원료로트-작업현황.md 3차 섹션)
const ANCHORS = {
  '탈피들깨가루': { T: 3440,     at: '2026-06-29T05:35:20' },
  '볶음들깨':     { T: 3650,     at: '2026-06-29T05:32:31' },
  '볶음참깨':     { T: 1110,     at: '2026-06-29T05:33:19' },
  '볶음검정참깨': { T: 80,       at: '2026-06-29T06:23:34' },
  '검정깨':       { T: 80,       at: '2026-06-29T05:31:01', stockOnly: true }, // 로트(80kg) 생존 — stock만 정합화
  '통들깨들기름': { T: 99.792,   at: '2026-06-29T06:23:12' },
  '통깨참기름':   { T: 379.224,  at: '2026-06-29T06:25:15' }, // 실사값 414L 역산(6/24 로트0 앵커 + 압착입고 롤포워드)
  '깨분참기름':   { T: 1352.016, at: '2026-06-29T06:26:45' }, // 실사값 1476L 역산(이월시드 롤포워드로 실사1=0 확정)
  '생들기름':     { T: 698.544,  at: '2026-06-29T06:28:03' }, // 실사값 756L 역산(이월 36L + delta)
};
const round3 = (n) => Math.round(n * 1000) / 1000;

const [rawSnap, ledSnap] = await Promise.all([
  getDocs(query(collection(db, 'items'), where('category', '==', 'raw'))),
  getDocs(collection(db, 'rawMaterialLedger')),
]);
const rawDocs = new Map(rawSnap.docs.map(d => [(d.data().name ?? '').split('/')[0].trim(), { id: d.id, ...d.data() }]));
const entries = ledSnap.docs.map(d => ({ id: d.id, ...d.data() }));

const backup = { at: new Date().toISOString(), items: {} };
const plan = [];

for (const [mat, a] of Object.entries(ANCHORS)) {
  const item = rawDocs.get(mat);
  if (!item) { console.log(`⚠️ ${mat}: raw 품목 없음 — 건너뜀`); continue; }
  // a.at은 초 단위 — 실사 기록 자체(같은 초, ms 포함)가 흐름에 재포함되지 않도록 .999로 보정
  const flows = entries.filter(e => e.material === mat && (e.createdAt ?? '') > `${a.at}.999`);
  const net = flows.reduce((s, e) => s + (e.received ?? 0) - (e.used ?? 0), 0);
  const kg = round3(a.T + net);
  const density = DENSITY[mat] ?? 1.0;
  const stock = round3(kg / density);
  plan.push({ mat, item, kg, stock, stockOnly: !!a.stockOnly, flows: flows.length });
}
// 깨분: 실사 앵커 없음 — 현재 stock(2400kg)을 이월 로트로 시드(로트 없는 원료 보호)
const kaebun = rawDocs.get('깨분');
if (kaebun && (!Array.isArray(kaebun.lots) || kaebun.lots.length === 0) && (kaebun.stock ?? 0) > 0) {
  plan.push({ mat: '깨분', item: kaebun, kg: kaebun.stock, stock: kaebun.stock, seedCarry: true, flows: 0 });
}

console.log(`████ 복구 계획 ${DRY ? '(dry-run)' : ''} ████`);
for (const p of plan) {
  const cur = Array.isArray(p.item.lots) ? p.item.lots.filter(l => l.status === 'active').reduce((s, l) => s + (l.kgRemaining ?? 0), 0) : null;
  console.log(`  ${p.mat} [${p.item.id}] 현재 stock=${p.item.stock}${p.item.unit ?? ''}, 로트합계=${cur ?? '필드없음'}kg → 복구 ${p.kg}kg (stock=${p.stock}) ${p.stockOnly ? '[stock만]' : p.seedCarry ? '[이월시드]' : '[복구로트]'} (실사후 흐름 ${p.flows}건)`);
}

// 6/29 실사 기록에 targetKg 백필 → 새 수불부 앵커 표시가 실물 기준으로 리셋되도록
const auditFix = entries.filter(e => e.note === '재고실사정정' && (e.createdAt ?? '').startsWith('2026-06-29'))
  .map(e => {
    const known = {
      '탈피들깨가루': 3440, '볶음들깨': 3650, '볶음참깨': 1110, '볶음검정참깨': 80, '검정깨': 80,
      '통들깨들기름': 99.792, '통깨참기름': 379.224, '생들기름': 698.544, '수입들기름': 332.64,
    };
    // 깨분참기름은 같은 날 실사 2건: 06:25(0으로 리셋) / 06:26(1476L)
    let target = known[e.material];
    if (e.material === '깨분참기름') target = (e.createdAt ?? '') < '2026-06-29T06:26:00' ? 0 : 1352.016;
    return target != null ? { id: e.id, material: e.material, targetKg: target } : null;
  }).filter(Boolean);
// 수입들기름 6/30 실사 → 166.32kg
const imp630 = entries.find(e => e.material === '수입들기름' && e.note === '재고실사정정' && (e.createdAt ?? '').startsWith('2026-06-30'));
if (imp630) auditFix.push({ id: imp630.id, material: '수입들기름(6/30)', targetKg: 166.32 });
console.log(`\n████ 실사 기록 targetKg 백필 ${auditFix.length}건 ████`);
auditFix.forEach(f => console.log(`  ${f.id} (${f.material}) targetKg=${f.targetKg}`));

if (DRY) { console.log('\n(dry-run — 아무것도 쓰지 않음)'); process.exit(0); }

// ── 실제 적용 ──
for (const p of plan) backup.items[p.item.id] = { stock: p.item.stock ?? 0, lots: p.item.lots ?? null };
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
console.log(`\n백업 저장: ${BACKUP}`);

const now = new Date().toISOString();
for (const p of plan) {
  if (p.stockOnly) {
    await updateDoc(doc(db, 'items', p.item.id), { stock: p.stock });
  } else {
    const lot = {
      id: `lot-restore-${p.mat}-${Date.now()}`,
      supplierName: p.seedCarry ? '이월' : '복구(6/29실사 역산)',
      kgIn: p.kg, kgRemaining: p.kg,
      receivedDate: '2026-07-02', status: 'active', createdAt: now,
    };
    await updateDoc(doc(db, 'items', p.item.id), { lots: [lot], stock: p.stock });
  }
  console.log(`✅ ${p.mat} → ${p.kg}kg (stock=${p.stock})`);
}
for (const f of auditFix) {
  await updateDoc(doc(db, 'rawMaterialLedger', f.id), { targetKg: f.targetKg });
  console.log(`✅ targetKg 백필: ${f.id}`);
}
console.log('\n복구 완료. check-lot-integrity.mts로 검증하세요.');
process.exit(0);
