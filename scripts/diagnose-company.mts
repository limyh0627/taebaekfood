// **회사값이 빠진 문서를 진단한다 — 읽기만 한다. 아무것도 안 쓴다.**
//   npx tsx scripts/diagnose-company.mts
//   자세히  … --verbose
//
// 왜 (2026-09-16 코덱스 인수인계 · 사장님) — 회사별·메뉴별 권한을 **규칙에서 강제**하려면
// 먼저 모든 문서가 자기 회사를 알아야 한다. 지금은 `companyId` 가 빠진 문서가 많다.
//
// **누락을 태백으로 몰아 찍지 않는다**(코덱스 지침). 연결 문서는 **원본 ID로 판정**하고,
// 판정할 수 없는 것은 **진단 목록으로 남겨** 사장님 판단을 받는다. 자동으로 찍으면
// 풍회 자료가 태백으로 넘어가 버리고, 그 뒤엔 어느 게 잘못 찍힌 건지 구별할 길이 없다.
//
// 이 파일은 **무엇을 판정할 수 있나**만 센다. 실제 쓰기는 다음 스크립트가 한다.
import { adminDb } from './_admin.mts';

const VERBOSE = process.argv.includes('--verbose');
const db = adminDb();
const 태백 = 'taebaek';
const 회사들 = new Set([태백, 'punghoe']);

const 회사 = (d: Record<string, unknown>): string | undefined => {
  const c = String(d.companyId ?? '').trim();
  return 회사들.has(c) ? c : undefined;
};

type Doc = { id: string; d: Record<string, unknown> };
const 읽기 = async (col: string): Promise<Doc[]> =>
  (await db.collection(col).get()).docs.map(x => ({ id: x.id, d: x.data() as Record<string, unknown> }));

console.log('\n운영 DB 를 읽는다(쓰기 없음)…\n');

//  ── 먼저 기준이 되는 것들을 읽는다 ──────────────────────────────
const items = await 읽기('items');
const partners = await 읽기('partners');
const orders = await 읽기('orders');
const stmts = await 읽기('issuedStatements');
const cash = await 읽기('cashEntries');

const 품목회사 = new Map(items.map(x => [x.id, 회사(x.d)]));
const 거래처회사 = new Map(partners.map(x => [x.id, 회사(x.d)]));
const 주문회사 = new Map(orders.map(x => [x.id, 회사(x.d)]));

/** 여러 실마리에서 회사를 모은다. 하나로 모이면 그게 답, 갈리면 '충돌'. */
const 모으기 = (후보: (string | undefined)[]): { 답?: string; 충돌?: string[] } => {
  const 값 = [...new Set(후보.filter((v): v is string => !!v))];
  if (값.length === 1) return { 답: 값[0] };
  if (값.length > 1) return { 충돌: 값 };
  return {};
};

//  ── 거래처: 그 거래처와 오간 전표·자금·주문의 회사로 판정 ──────────
const 거래처실마리 = new Map<string, (string | undefined)[]>();
const 담기 = (pid: unknown, c: string | undefined) => {
  const k = String(pid ?? '');
  if (!k || !c) return;
  거래처실마리.set(k, [...(거래처실마리.get(k) ?? []), c]);
};
for (const s of stmts) 담기(s.d.partnerId, 회사(s.d));
for (const e of cash) 담기(e.d.partnerId, 회사(e.d));
for (const o of orders) 담기(o.d.partnerId, 회사(o.d));

//  ── 주문: 거래처 → 품목 차례로 본다 ─────────────────────────────
const 주문판정 = (o: Doc) => 모으기([
  거래처회사.get(String(o.d.partnerId ?? '')),
  ...((o.d.items as { itemId?: string }[] ?? []).map(i => 품목회사.get(String(i.itemId ?? '')))),
]);

const 결과: { 컬렉션: string; 전체: number; 있음: number; 판정됨: number; 못함: number; 충돌: number; 못한것: string[] }[] = [];

const 진단 = (컬렉션: string, docs: Doc[], 판정: (x: Doc) => { 답?: string; 충돌?: string[] }) => {
  let 있음 = 0, 판정됨 = 0, 못함 = 0, 충돌 = 0;
  const 못한것: string[] = [];
  for (const x of docs) {
    if (회사(x.d)) { 있음++; continue; }
    const r = 판정(x);
    if (r.충돌) { 충돌++; 못한것.push(`${x.id} (충돌: ${r.충돌.join('/')})`); continue; }
    if (r.답) { 판정됨++; continue; }
    못함++;
    못한것.push(`${x.id} ${String(x.d.name ?? x.d.partnerName ?? x.d.material ?? '').slice(0, 24)}`);
  }
  결과.push({ 컬렉션, 전체: docs.length, 있음, 판정됨, 못함, 충돌, 못한것 });
};

진단('partners', partners, x => 모으기(거래처실마리.get(x.id) ?? []));
진단('orders', orders, 주문판정);
진단('items', items, () => ({}));
진단('issuedStatements', stmts, x => 모으기([거래처회사.get(String(x.d.partnerId ?? ''))]));
진단('cashEntries', cash, x => 모으기([거래처회사.get(String(x.d.partnerId ?? ''))]));

//  ── 연결 문서들 — 원본 ID 로 판정 ──────────────────────────────
const 연결 = [
  { col: 'item_bom', 부모: (d: Record<string, unknown>) => 품목회사.get(String(d.parent_id ?? '')) },
  { col: 'partner_item', 부모: (d: Record<string, unknown>) => 거래처회사.get(String(d.partnerId ?? '')) ?? 품목회사.get(String(d.itemId ?? '')) },
  { col: 'rawMaterialLedger', 부모: (d: Record<string, unknown>) => 품목회사.get(String(d.rawItemId ?? '')) ?? 주문회사.get(String(d.orderId ?? '')) },
  { col: 'productionRecords', 부모: (d: Record<string, unknown>) => 품목회사.get(String(d.itemId ?? '')) },
  { col: 'returnRequests', 부모: (d: Record<string, unknown>) => 주문회사.get(String(d.orderId ?? '')) ?? 거래처회사.get(String(d.partnerId ?? '')) },
  { col: 'orderStatusAudits', 부모: (d: Record<string, unknown>) => 주문회사.get(String(d.orderId ?? '')) },
  { col: 'pendingStatementEdits', 부모: (d: Record<string, unknown>) => 거래처회사.get(String(d.partnerId ?? '')) },
  { col: 'settlements', 부모: (d: Record<string, unknown>) => 거래처회사.get(String(d.partnerId ?? '')) },
  { col: 'notices', 부모: () => undefined },
  { col: 'chatRooms', 부모: () => undefined },
  { col: 'notifications', 부모: () => undefined },
  { col: 'employees', 부모: () => undefined },
  { col: 'leaveRequests', 부모: () => undefined },
];

for (const { col, 부모 } of 연결) {
  try {
    진단(col, await 읽기(col), x => 모으기([부모(x.d)]));
  } catch {
    결과.push({ 컬렉션: `${col} (없음)`, 전체: 0, 있음: 0, 판정됨: 0, 못함: 0, 충돌: 0, 못한것: [] });
  }
}

//  ── 보고 ────────────────────────────────────────────────────
console.log('컬렉션'.padEnd(24) + '전체'.padStart(7) + '회사있음'.padStart(10) + '판정가능'.padStart(10) + '판정불가'.padStart(10) + '충돌'.padStart(7));
console.log('─'.repeat(68));
let 총못함 = 0, 총충돌 = 0;
for (const r of 결과) {
  if (!r.전체) continue;
  const 표시 = r.못함 || r.충돌 ? '⚠' : r.판정됨 ? '·' : ' ';
  console.log(`${표시} ${r.컬렉션.padEnd(22)}${String(r.전체).padStart(7)}${String(r.있음).padStart(10)}${String(r.판정됨).padStart(10)}${String(r.못함).padStart(10)}${String(r.충돌).padStart(7)}`);
  총못함 += r.못함; 총충돌 += r.충돌;
}
console.log('─'.repeat(68));
console.log(`\n판정 불가 ${총못함}건 · 충돌 ${총충돌}건 — 이것만 사장님 판단이 필요하다.\n`);

for (const r of 결과) {
  if (!r.못한것.length) continue;
  console.log(`── ${r.컬렉션} — 판정 못 한 ${r.못한것.length}건 ──`);
  for (const x of r.못한것.slice(0, VERBOSE ? 9999 : 12)) console.log(`   ${x}`);
  if (!VERBOSE && r.못한것.length > 12) console.log(`   … ${r.못한것.length - 12}건 더 (--verbose)`);
  console.log('');
}
process.exit(0);
