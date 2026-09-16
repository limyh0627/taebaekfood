// **회사값이 빠진 문서를 진단한다 — 읽기만 한다. 아무것도 안 쓴다.**
//   npx tsx scripts/diagnose-company.mts
//   자세히  … --verbose
//
// 왜 (2026-09-16 코덱스 인수인계 · 사장님) — 회사별·메뉴별 권한을 **규칙에서 강제**하려면
// 먼저 모든 문서가 자기 회사를 알아야 한다.
//
// **컬렉션 목록을 손으로 적지 않는다**(2026-09-16 코덱스 검수 1번). 처음엔 23개를 적어
// 두고 돌렸는데, 그 안에서 "누락 0" 이 나왔을 뿐 **전체 DB 는 아니었다.** 손으로 적은
// 목록은 새 컬렉션이 생기면 조용히 빠진다. `listCollections()` 로 **실제로 있는 것 전부**를
// 훑는다 — 그래야 "누락 0" 이 DB 전체를 뜻한다.
//
// **누락을 태백으로 몰아 찍지 않는다.** 연결 문서는 **원본 ID 로 판정**하고, 판정할 수 없는
// 것은 **진단 목록으로 남겨** 사장님 판단을 받는다.
import { adminDb } from './_admin.mts';

const VERBOSE = process.argv.includes('--verbose');
const db = adminDb();
const 회사들 = new Set(['taebaek', 'punghoe']);

/**
 * **업무자료가 아닌 것** — 회사 개념이 없다.
 * 인증(로그인 시도·아이디 매핑)과 앱 메타(스키마 판본 따위)다.
 * 여기 적은 것만 빼고 나머지는 **전부** 회사를 가져야 한다.
 */
const 대상아님 = new Set(['usernames', 'authLoginAttempts', '_meta', 'appMeta', 'schemaVersions']);

const 회사 = (d: Record<string, unknown>): string | undefined => {
  const c = String(d.companyId ?? '').trim();
  return 회사들.has(c) ? c : undefined;
};

type Doc = { id: string; d: Record<string, unknown> };

console.log('\n운영 DB 를 읽는다(쓰기 없음)…\n');

//  **실제로 있는 컬렉션을 전부 가져온다** — 손으로 적은 목록을 쓰지 않는다.
const 컬렉션들 = (await db.listCollections()).map(c => c.id).sort();
const 자료 = new Map<string, Doc[]>();
for (const c of 컬렉션들) {
  자료.set(c, (await db.collection(c).get()).docs.map(x => ({ id: x.id, d: x.data() as Record<string, unknown> })));
}

const 보기맵 = (col: string) =>
  new Map((자료.get(col) ?? []).flatMap(x => { const v = 회사(x.d); return v ? [[x.id, v] as [string, string]] : []; }));
const 품목회사 = 보기맵('items');
const 거래처회사 = 보기맵('partners');
const 주문회사 = 보기맵('orders');
const 전표회사 = 보기맵('issuedStatements');
const 직원회사 = 보기맵('employees');
const 방회사 = 보기맵('chatRooms');
const 보기 = (m: Map<string, string>, id: unknown) => m.get(String(id ?? ''));

const 하나로 = (후보: (string | undefined)[]): { 답?: string; 충돌?: string[] } => {
  const 값 = [...new Set(후보.filter((v): v is string => !!v))];
  if (값.length === 1) return { 답: 값[0] };
  if (값.length > 1) return { 충돌: 값 };
  return {};
};

/** 원본 ID 로 회사를 푸는 길. 여기 없는 컬렉션은 실마리가 없다는 뜻이다. */
const 실마리: Record<string, (d: Record<string, unknown>) => (string | undefined)[]> = {
  orders: d => [보기(거래처회사, d.partnerId), ...((d.items as { itemId?: string }[] ?? []).map(i => 보기(품목회사, i.itemId)))],
  issuedStatements: d => [보기(거래처회사, d.partnerId)],
  cashEntries: d => [보기(거래처회사, d.partnerId)],
  item_bom: d => [보기(품목회사, d.parent_id), 보기(품목회사, d.child_id)],
  item_formula: d => [보기(품목회사, d.parent_id ?? d.parent_key)],
  item_pack: d => [보기(품목회사, d.itemId ?? d.parent_id)],
  partner_item: d => [보기(품목회사, d.itemId) ?? 보기(거래처회사, d.partnerId)],
  rawMaterialLedger: d => [보기(품목회사, d.rawItemId), 보기(주문회사, d.orderId)],
  rawInventories: d => [보기(품목회사, d.rawItemId)],
  productionRecords: d => [보기(품목회사, d.itemId), 보기(주문회사, d.orderId)],
  productionSalesLogs: d => [보기(품목회사, d.itemId), 보기(주문회사, d.orderId)],
  returnRequests: d => [보기(주문회사, d.orderId), 보기(거래처회사, d.partnerId)],
  orderStatusAudits: d => [보기(주문회사, d.orderId)],
  orderItemEdits: d => [보기(주문회사, d.orderId)],
  workOrderItems: d => [보기(주문회사, d.orderId), 보기(품목회사, d.itemId)],
  pendingStatementEdits: d => [보기(전표회사, d.statementId), 보기(거래처회사, d.partnerId)],
  settlements: d => [보기(전표회사, d.statementId), 보기(거래처회사, d.partnerId)],
  purchaseOrders: d => [보기(거래처회사, d.partnerId), ...((d.lines as { itemId?: string }[] ?? []).map(l => 보기(품목회사, l.itemId)))],
  palletTransactions: d => [보기(거래처회사, d.partnerId)],
  itemReceipts: d => [보기(품목회사, d.itemId)],
  adjustmentRequests: d => [보기(품목회사, d.itemId), 보기(직원회사, d.requestedBy)],
  leaveRequests: d => [보기(직원회사, d.employeeId ?? d.userId)],
  notices: d => [보기(직원회사, d.authorId ?? d.createdBy ?? d.writerId)],
  chatRooms: d => [...((d.members as string[] ?? []).map(m => 보기(직원회사, m))), 보기(직원회사, d.createdBy)],
  chatMessages: d => [보기(방회사, d.roomId)],
  notifications: d => [보기(직원회사, d.employeeId ?? d.recipientId ?? d.userId), 보기(주문회사, d.orderId)],
};

const 결과: { 컬렉션: string; 전체: number; 있음: number; 판정: number; 못함: number; 충돌: number; 못한것: string[] }[] = [];

for (const col of 컬렉션들) {
  if (대상아님.has(col)) continue;
  const docs = 자료.get(col) ?? [];
  let 있음 = 0, 판정 = 0, 못함 = 0, 충돌 = 0;
  const 못한것: string[] = [];
  for (const x of docs) {
    if (회사(x.d)) { 있음++; continue; }
    const r = 하나로(실마리[col]?.(x.d) ?? []);
    if (r.충돌) { 충돌++; 못한것.push(`${x.id} (충돌 ${r.충돌.join('/')})`); continue; }
    if (r.답) { 판정++; continue; }
    못함++;
    못한것.push(`${x.id} ${String(x.d.name ?? x.d.partnerName ?? x.d.material ?? x.d.title ?? '').slice(0, 28)}`);
  }
  결과.push({ 컬렉션: col, 전체: docs.length, 있음, 판정, 못함, 충돌, 못한것 });
}

console.log(`컬렉션 ${컬렉션들.length}개 (업무자료 아님 ${[...대상아님].filter(c => 컬렉션들.includes(c)).length}개 제외)\n`);
console.log('컬렉션'.padEnd(28) + '전체'.padStart(7) + '회사있음'.padStart(10) + '판정가능'.padStart(10) + '판정불가'.padStart(10) + '충돌'.padStart(7));
console.log('─'.repeat(72));
let 총누락 = 0, 총판정 = 0, 총못함 = 0, 총충돌 = 0;
for (const r of 결과.sort((a, b) => (b.못함 + b.판정 + b.충돌) - (a.못함 + a.판정 + a.충돌))) {
  if (!r.전체) continue;
  const 누락 = r.판정 + r.못함 + r.충돌;
  총누락 += 누락; 총판정 += r.판정; 총못함 += r.못함; 총충돌 += r.충돌;
  if (!누락 && !VERBOSE) continue;
  console.log(`${누락 ? '⚠' : ' '} ${r.컬렉션.padEnd(26)}${String(r.전체).padStart(7)}${String(r.있음).padStart(10)}${String(r.판정).padStart(10)}${String(r.못함).padStart(10)}${String(r.충돌).padStart(7)}`);
}
console.log('─'.repeat(72));
console.log(`\n회사값 없는 문서 ${총누락}건 — 원본으로 판정 가능 ${총판정} · 판정 불가 ${총못함} · 충돌 ${총충돌}\n`);

for (const r of 결과) {
  if (!r.못한것.length) continue;
  console.log(`── ${r.컬렉션} — 판정 못 한 ${r.못한것.length}건 ──`);
  for (const x of r.못한것.slice(0, VERBOSE ? 9999 : 8)) console.log(`   ${x}`);
  if (!VERBOSE && r.못한것.length > 8) console.log(`   … ${r.못한것.length - 8}건 더 (--verbose)`);
  console.log('');
}
process.exit(0);
