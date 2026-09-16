// **모든 업무 문서에 회사(`companyId`)를 채운다.**
//   2차 미리보기  npx tsx scripts/fix-company-backfill.mts --phase=remaining
//   2차 적용      … --phase=remaining --apply
//   2차 되돌리기  … --phase=remaining --undo
//   1차 되돌리기  … --phase=initial --undo
//
// 왜 (2026-09-16 코덱스 인수인계 · 사장님) — 회사별·메뉴별 권한을 **Firestore 규칙에서
// 강제**하려면 문서마다 자기 회사를 알아야 한다. 화면에서 메뉴만 숨기는 건 권한이 아니다.
// 사장님 정정: **공용 컬렉션은 없다. 모든 자료를 회사별로 나눈다.**
//
// ---
// **판정 차례가 곧 의존 차례다.** 직원 → 거래처 → 주문 → 나머지.
// 앞 단계가 회사를 알아야 뒷 단계가 그걸 따라갈 수 있다(연차는 신청한 직원을 따라가고,
// 주문 감사는 주문을 따라간다). 그래서 한 번에 다 읽고 **차례대로 풀어** 나간다.
//
// **원본 ID 로 판정한다**(코덱스 지침) — 이름이나 짐작이 아니다. 판정이 갈리면(충돌)
// **찍지 않고 남긴다.** 진단에서 충돌은 0건이었지만 그래도 검사한다.
//
// **판정 못 한 것은 태백으로 찍는다**(2026-09-16 사장님: "우용만 풍회유통 나머진 다
// 태백으로 거래처도 태백으로"). 풍회는 품목 4 · 거래처 11 · 전표 23 뿐이라 남는 것은
// 사실상 다 태백이다. 다만 **몇 건이 그렇게 찍혔는지 반드시 보여 준다** — 조용히 몰아
// 찍으면 나중에 무엇이 판정된 것이고 무엇이 기본값인지 구별할 길이 없다.
//
// **이미 회사가 있는 문서는 절대 안 건드린다.** 이 스크립트는 **채우기만** 한다.
// 그래서 되돌리기가 간단하다 — 우리가 찍은 자리의 `companyId` 를 지우면 원래대로다.
// (문서 전체를 백업하지 않는 까닭이기도 하다. 4천 건을 통째로 떠 두면 그 파일이
//  오히려 위험한 물건이 된다.)
import { adminDb } from './_admin.mts';
import { companyBackfillBackupPath, parseCompanyBackfillOptions } from './company-backfill-options';
import { FieldValue } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let options;
try {
  options = parseCompanyBackfillOptions(process.argv.slice(2));
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
const APPLY = options.mode === 'apply';
const UNDO = options.mode === 'undo';
const VERBOSE = options.verbose;
//  **백업은 저장소 밖에 둔다**(gitignore `로컬전용/`). 문서 경로 목록이라 코드 저장소에
//  묻어 두면 안 된다. 옛 경로 `scripts/fix-company-backfill-backup.json` 은 여기로 옮겨졌다.
const BACKUP = companyBackfillBackupPath(options.phase);
const 태백 = 'taebaek';
const 회사들 = new Set([태백, 'punghoe']);
const db = adminDb();

if (UNDO) {
  if (!existsSync(BACKUP)) { console.error(`\n백업이 없다(${BACKUP}).\n`); process.exit(1); }
  const 찍은것 = JSON.parse(readFileSync(BACKUP, 'utf-8')) as string[];
  let n = 0;
  for (let i = 0; i < 찍은것.length; i += 400) {
    const b = db.batch();
    for (const 경로 of 찍은것.slice(i, i + 400)) { b.update(db.doc(경로), { companyId: FieldValue.delete() }); n++; }
    await b.commit();
  }
  console.log(`\n${options.phase} 단계 ${n}건에서 companyId 를 지웠다(원래 없던 자리).\n`);
  process.exit(0);
}

type Doc = { id: string; d: Record<string, unknown> };
const 읽기 = async (col: string): Promise<Doc[]> => {
  try { return (await db.collection(col).get()).docs.map(x => ({ id: x.id, d: x.data() as Record<string, unknown> })); }
  catch { return []; }
};
const 회사 = (d: Record<string, unknown>): string | undefined => {
  const c = String(d.companyId ?? '').trim();
  return 회사들.has(c) ? c : undefined;
};
const 하나로 = (후보: (string | undefined)[]): { 답?: string; 충돌?: string[] } => {
  const 값 = [...new Set(후보.filter((v): v is string => !!v))];
  if (값.length === 1) return { 답: 값[0] };
  if (값.length > 1) return { 충돌: 값 };
  return {};
};

console.log('\n운영 DB 를 읽는다…');

/**
 * **업무자료가 아닌 것** — 회사 개념이 없다. 인증(로그인 시도·아이디 매핑)과 앱 메타다.
 * 여기 적은 것만 빼고 **나머지 전부**가 회사를 가져야 한다.
 */
const 대상아님 = new Set(['usernames', 'authLoginAttempts', '_meta', 'appMeta', 'schemaVersions']);

/**
 * **컬렉션 목록을 손으로 안 적는다**(2026-09-16 코덱스 검수 1번).
 *
 * 처음엔 23개를 적어 두고 돌렸는데, 그 안에서 "누락 0" 이 나왔을 뿐 **DB 전체는 아니었다** —
 * 실제로는 33개 컬렉션 571건이 비어 있었다. 손으로 적은 목록은 새 컬렉션이 생기면
 * 조용히 빠지고, 그 빠진 자리는 규칙을 잠그는 순간 아무도 못 읽는 자료가 된다.
 */
const 컬렉션들 = (await db.listCollections()).map(c => c.id).filter(c => !대상아님.has(c)).sort();

const 자료 = new Map<string, Doc[]>();
for (const c of 컬렉션들) 자료.set(c, await 읽기(c));

//  ── 풀린 회사를 여기 쌓아 간다(이미 있던 것 + 우리가 정한 것) ──────
const 정해짐 = new Map<string, Map<string, string>>();
for (const c of 컬렉션들) {
  정해짐.set(c, new Map((자료.get(c) ?? []).flatMap(x => { const v = 회사(x.d); return v ? [[x.id, v] as [string, string]] : []; })));
}
const 보기 = (col: string, id: unknown): string | undefined => 정해짐.get(col)?.get(String(id ?? ''));

/**
 * **사람 이름 → 회사.** 옛 문서가 `createdBy: '박은지'` 처럼 **이름**을 남겼다(직원 id 가 아니다).
 * 두 회사에 같은 이름이 있으면(이은경) 값이 갈려 충돌로 잡힌다 — 그게 맞다, 찍지 않는다.
 */
const 이름회사 = new Map<string, string>();
for (const x of 자료.get('employees') ?? []) {
  const n = String(x.d.name ?? '').trim(); const c = 회사(x.d);
  if (!n || !c) continue;
  이름회사.set(n, 이름회사.has(n) && 이름회사.get(n) !== c ? '__충돌__' : c);
}
const 사람 = (v: unknown): string | undefined => {
  const c = 이름회사.get(String(v ?? '').trim());
  return c === '__충돌__' ? undefined : c;
};

/** 이 문서의 회사를 무엇으로 볼 것인가 — 컬렉션마다 실마리가 다르다. */
const 실마리: Record<string, (d: Record<string, unknown>, id: string) => (string | undefined)[]> = {
  employees: () => [],
  partners: () => [],          // 아래에서 거래 기록을 모아 따로 채운다
  orders: d => [보기('partners', d.partnerId), ...((d.items as { itemId?: string }[] ?? []).map(i => 보기('items', i.itemId)))],
  issuedStatements: d => [보기('partners', d.partnerId)],
  cashEntries: d => [보기('partners', d.partnerId)],
  cashAccounts: () => [],
  item_bom: d => [보기('items', d.parent_id), 보기('items', d.child_id)],
  /**
   * **거래처–품목 단가는 품목 회사를 따른다**(2026-09-16 사장님: "품목회사를 따라봐").
   *
   * 둘을 같이 보다가 3건이 충돌했다 — 풍회 품목(참깨·깨분)을 태백 거래처와 엮은 줄이다.
   * 회사 간 거래라 어느 쪽도 틀리지 않는데, **단가는 그 품목을 파는 회사 것**이라
   * 품목을 근거로 삼는다. 품목 회사를 모르면 그때만 거래처를 본다.
   */
  partner_item: d => [보기('items', d.itemId) ?? 보기('partners', d.partnerId)],
  rawMaterialLedger: d => [보기('items', d.rawItemId), 보기('orders', d.orderId)],
  productionRecords: d => [보기('items', d.itemId), 보기('orders', d.orderId)],
  returnRequests: d => [보기('orders', d.orderId), 보기('partners', d.partnerId)],
  orderStatusAudits: d => [보기('orders', d.orderId)],
  pendingStatementEdits: d => [보기('issuedStatements', d.statementId), 보기('partners', d.partnerId)],
  settlements: d => [보기('issuedStatements', d.statementId), 보기('partners', d.partnerId), 보기('cashEntries', d.cashEntryId)],
  //  아래는 **사람을 따라간다** — 직원 회사가 정해진 뒤라야 풀린다.
  notices: d => [보기('employees', d.authorId ?? d.createdBy ?? d.writerId)],
  chatRooms: d => [...((d.members as string[] ?? []).map(m => 보기('employees', m))), 보기('employees', d.createdBy)],
  /**
   * **메시지는 방을 따른다**(2026-09-16 사장님: "방회사를 따라야지").
   *
   * 보낸 사람도 같이 보다가 71건이 충돌했다 — 두 회사에 계정이 있는 사람(이은경 상무)이
   * 섞여 대화한 자리다. **메시지는 방에 속한 것**이라 방 회사가 근거다. 보낸 사람 회사로
   * 가르면 한 방 안에서 메시지가 두 회사로 갈려 대화가 반쪽만 보인다.
   */
  chatMessages: d => [보기('chatRooms', d.roomId)],
  leaveRequests: d => [보기('employees', d.employeeId ?? d.userId)],
  adjustmentRequests: d => [보기('items', d.itemId), 보기('employees', d.requestedBy)],
  purchaseOrders: d => [보기('partners', d.partnerId), ...((d.lines as { itemId?: string }[] ?? []).map(l => 보기('items', l.itemId)))],
  pallets: () => [],
  palletTransactions: d => [보기('partners', d.partnerId)],

  //  ── 2026-09-16 코덱스 검수 1번으로 늘린 것 ──────────────────────
  //  **만든 사람을 따라간다.** 옛 문서가 이름만 남겨서 `이름회사` 로 푼다.
  productionSalesLogs: d => [사람(d.createdBy)],
  stockClosings: d => [사람(d.closedBy ?? d.createdBy)],
  benzopyreneTests: d => [사람(d.addedBy ?? d.createdBy)],
  haccp_sanitation: d => [사람(d.createdBy ?? d.updatedBy)],
  haccp_closing_checklist: d => [사람(d.createdBy ?? d.updatedBy)],
  haccp_periodic_sanitation: d => [사람(d.createdBy ?? d.updatedBy)],
  haccp_personal_hygiene: d => [사람(d.createdBy ?? d.updatedBy)],
  haccp_temp: d => [사람(d.createdBy ?? d.updatedBy)],
  haccp_incoming: d => [사람(d.createdBy ?? d.updatedBy)],
  fileCabinetDocs: d => [사람(d.uploadedBy)],

  //  **품목·전표를 따라간다.**
  itemCostHistory: d => [보기('items', d.itemId), 보기('issuedStatements', d.sourceStatementId)],
  item_formula: d => [이름품목(d.parent_key)],
  item_pack: d => [보기('items', d.item_id ?? d.itemId)],
  deliveryScheduleAudits: d => [보기('orders', d.orderId)],
  //  거래처 포털 계정 — 어느 거래처에 붙었나로 안다.
  users: d => [보기('partners', d.linkedPartnerId)],
  /**
   * **기초이월은 문서 id 가 회사를 말한다** — `main`(태백) · `main-punghoe`(풍회).
   * 규칙은 `types.openingDocId()` 한 곳이 정한다. 여기서 다시 지어내지 않고 그 모양만 읽는다.
   */
  openingBalances: (_d, id) => [String(id).endsWith('-punghoe') ? 'punghoe' : 태백],
  inventorySnapshots: (_d, id) => [String(id).includes('-punghoe') ? 'punghoe' : 태백],
};

/**
 * **품목 이름 → 회사.** `item_formula.parent_key` 가 id 가 아니라 이름이다(`깨분참기름`).
 * 두 회사에 같은 이름이 있으면 갈려 충돌로 잡힌다.
 */
const 이름품목맵 = new Map<string, string>();
for (const x of 자료.get('items') ?? []) {
  const n = String(x.d.name ?? '').trim(); const c = 회사(x.d);
  if (!n || !c) continue;
  이름품목맵.set(n, 이름품목맵.has(n) && 이름품목맵.get(n) !== c ? '__충돌__' : c);
}
function 이름품목(v: unknown): string | undefined {
  const c = 이름품목맵.get(String(v ?? '').trim());
  return c === '__충돌__' ? undefined : c;
}

//  ── 거래처: 그 거래처와 오간 전표·자금·주문의 회사를 모은다 ──────────
const 거래처실마리 = new Map<string, (string | undefined)[]>();
for (const col of ['issuedStatements', 'cashEntries', 'orders'] as const) {
  for (const x of 자료.get(col) ?? []) {
    const k = String(x.d.partnerId ?? ''); const c = 회사(x.d);
    if (k && c) 거래처실마리.set(k, [...(거래처실마리.get(k) ?? []), c]);
  }
}
실마리.partners = () => [];

const 찍을것: { 경로: string; 값: string; 기본값: boolean }[] = [];
const 충돌목록: string[] = [];
const 집계: { 컬렉션: string; 있음: number; 판정: number; 기본: number; 충돌: number }[] = [];

/** 한 컬렉션을 푼다. 푼 결과를 `정해짐` 에 넣어 **다음 컬렉션이 따라갈 수 있게** 한다. */
const 풀기 = (col: string, 개별?: (x: Doc) => (string | undefined)[]) => {
  const docs = 자료.get(col) ?? [];
  let 있음 = 0, 판정 = 0, 기본 = 0, 충돌 = 0;
  for (const x of docs) {
    if (회사(x.d)) { 있음++; continue; }
    const r = 하나로(개별 ? 개별(x) : (실마리[col]?.(x.d, x.id) ?? []));
    if (r.충돌) { 충돌++; 충돌목록.push(`${col}/${x.id} (${r.충돌.join('/')})`); continue; }
    const 값 = r.답 ?? 태백;
    if (r.답) 판정++; else 기본++;
    찍을것.push({ 경로: `${col}/${x.id}`, 값, 기본값: !r.답 });
    정해짐.get(col)!.set(x.id, 값);
  }
  집계.push({ 컬렉션: col, 있음, 판정, 기본, 충돌 });
};

//  **차례가 중요하다** — 앞이 풀려야 뒤가 따라간다.
풀기('employees');
/**
 * **거래처는 '풍회에서만 거래한 곳'만 풍회다**(2026-09-16 사장님: "그 풍회에서 끊긴
 * 전표들만 풍회로 가면 되는데", "거래처도 거기 있는 거래처만 풍회로").
 *
 * 양쪽에서 다 거래한 거래처는 **태백으로 둔다** — 충돌로 남겨 두면 그 거래처가 회사값
 * 없이 남아 규칙이 거절한다. 태백이 본체고 풍회는 품목 4 · 거래처 11 규모라, 겹치는
 * 곳을 태백에 두는 쪽이 실제에 가깝다.
 */
풀기('partners', x => {
  const 실마리들 = (거래처실마리.get(x.id) ?? []).filter((v): v is string => !!v);
  const 풍회뿐 = 실마리들.length > 0 && 실마리들.every(v => v === 'punghoe');
  return 풍회뿐 ? ['punghoe'] : [];
});
풀기('items');
풀기('orders');
const 먼저푼것 = new Set(['employees', 'partners', 'items', 'orders', 'issuedStatements', 'cashEntries', 'cashAccounts']);
풀기('issuedStatements');
풀기('cashEntries');
풀기('cashAccounts');
//  나머지는 **있는 대로 전부** 푼다. 차례가 중요한 것(방 → 메시지)만 앞에 세운다.
for (const c of ['chatRooms', ...컬렉션들.filter(x => !먼저푼것.has(x) && x !== 'chatRooms')]) 풀기(c);

console.log(`\n═══ ${options.phase} 단계 · ${APPLY ? '🔴 실제 적용(--apply)' : '🟢 미리보기(dry) — 쓰기 없음'} ═══\n`);
console.log('컬렉션'.padEnd(24) + '이미있음'.padStart(10) + '원본으로판정'.padStart(14) + '태백기본값'.padStart(12) + '충돌'.padStart(7));
console.log('─'.repeat(70));
for (const r of 집계) {
  if (!r.있음 && !r.판정 && !r.기본 && !r.충돌) continue;
  console.log(`${(r.기본 ? '·' : ' ')} ${r.컬렉션.padEnd(22)}${String(r.있음).padStart(10)}${String(r.판정).padStart(14)}${String(r.기본).padStart(12)}${String(r.충돌).padStart(7)}`);
}
console.log('─'.repeat(70));
const 총판정 = 집계.reduce((s, r) => s + r.판정, 0);
const 총기본 = 집계.reduce((s, r) => s + r.기본, 0);
console.log(`\n찍을 것 ${찍을것.length}건 — 원본으로 판정 ${총판정} · 태백 기본값 ${총기본} · 충돌 ${충돌목록.length}`);
console.log('이미 회사가 있는 문서는 **하나도 안 건드린다.**');

if (충돌목록.length) {
  console.log(`\n⚠ 판정이 갈린 ${충돌목록.length}건 — 찍지 않고 남긴다:`);
  for (const c of 충돌목록.slice(0, VERBOSE ? 9999 : 15)) console.log(`   ${c}`);
}
if (VERBOSE) {
  console.log('\n── 태백 기본값으로 찍는 것 ──');
  for (const x of 찍을것.filter(v => v.기본값)) console.log(`   ${x.경로}`);
}

if (!APPLY) { console.log(`\n미리보기였다. 적용하려면 --phase=${options.phase} --apply. 자세히 보려면 --verbose.\n`); process.exit(0); }

if (existsSync(BACKUP)) { console.error(`\n이미 백업이 있다(${BACKUP}) — 옮기고 다시 실행한다.\n`); process.exit(1); }
//  **백업은 '우리가 찍은 자리' 목록이다.** 원래 비어 있던 칸이라, 되돌리기는 그 칸을 지우는 것이다.
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify(찍을것.map(x => x.경로), null, 1), 'utf-8');
console.log(`\n백업(찍은 자리 목록) ${찍을것.length}건 → ${BACKUP}`);

for (let i = 0; i < 찍을것.length; i += 400) {
  const b = db.batch();
  for (const x of 찍을것.slice(i, i + 400)) b.update(db.doc(x.경로), { companyId: x.값 });
  await b.commit();
  console.log(`  ${Math.min(i + 400, 찍을것.length)} / ${찍을것.length}`);
}

// 전체 누락 수만 보면 다른 작업의 문서와 섞인다. 이번 단계에서 쓴 각 경로가 의도한
// 회사값을 실제로 가졌는지 따로 확인해야 이 단계의 성공 여부를 확정할 수 있다.
const 검증실패: string[] = [];
for (let i = 0; i < 찍을것.length; i += 400) {
  const 묶음 = 찍을것.slice(i, i + 400);
  const snapshots = await db.getAll(...묶음.map(x => db.doc(x.경로)));
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists || 회사(snapshot.data() as Record<string, unknown>) !== 묶음[index].값) {
      검증실패.push(묶음[index].경로);
    }
  });
}
if (검증실패.length) {
  console.error(`\n적용 후 검증 실패 ${검증실패.length}건. 백업은 보존했다: ${BACKUP}`);
  for (const path of 검증실패.slice(0, 20)) console.error(`  ${path}`);
  process.exit(1);
}
console.log(`\n✅ 이번 ${options.phase} 단계 적용값 ${찍을것.length}건을 다시 읽어 확인했다.`);

//  **다시 읽어 확인한다** — 썼다고 믿지 않는다.
console.log('\n═══ 다시 읽어 확인 ═══');
let 남은곳 = 0;
for (const c of 컬렉션들) {
  const docs = await 읽기(c);
  const 빈것 = docs.filter(x => !회사(x.d)).length;
  남은곳 += 빈것;
  if (docs.length) console.log(`  ${빈것 === 0 ? '✅' : '⚠'} ${c.padEnd(22)} ${docs.length}건 중 회사 없는 것 ${빈것}`);
}
console.log(`\n회사값이 아직 빈 문서 ${남은곳}건. 되돌리려면 --undo.\n`);
process.exit(0);
