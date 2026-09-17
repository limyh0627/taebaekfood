// 해피유통 세 거래처를 한 거래처 + 배송지 셋으로 이관한다.
// 기본 dry / --apply / --undo. 자금·분개까지 옮겨 중간 선수금이 빠지지 않게 한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';

const { APPLY, UNDO } = 실행모드();
const db = adminDb();
const PARENT = 'C080';
const NAME = '해피유통';
const SHIP_TOS = [
  { id: 'C080', name: '포천' },
  { id: 'C081', name: '쿠팡' },
  { id: 'c-1784010198853', name: '네이버커머스' },
];
const OLD = new Set(SHIP_TOS.map(x => x.id));
const BACKUP = '로컬전용/백업/merge-happy-shiptos-v2.json';
const load = async (name: string) => (await db.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() } as any));
type Change = { collection: string; id: string; before: any | null; after: any | null };

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const changes = JSON.parse(readFileSync(BACKUP, 'utf8')).changes as Change[];
  for (let i = 0; i < changes.length; i += 400) {
    const batch = db.batch();
    for (const ch of changes.slice(i, i + 400)) {
      const ref = db.collection(ch.collection).doc(ch.id);
      if (ch.before == null) batch.delete(ref); else batch.set(ref, ch.before);
    }
    await batch.commit();
  }
  console.log(`${changes.length}건을 적용 전 상태로 복구했습니다.`);
  process.exit(0);
}

const [partners, links, orders, statements, cash, settlements, journals] = await Promise.all([
  load('partners'), load('partner_item'), load('orders'), load('issuedStatements'),
  load('cashEntries'), load('settlements'), load('journalEntries'),
]);
for (const ship of SHIP_TOS) if (!partners.some(p => p.id === ship.id)) throw new Error(`거래처가 없습니다: ${ship.id}`);
const changes: Change[] = [];
const plan = (collection: string, row: any, after: any | null) => {
  const { id, ...before } = row;
  changes.push({ collection, id, before, after });
};

for (const p of partners.filter(p => OLD.has(p.id))) {
  const { id, ...rest } = p;
  plan('partners', p, id === PARENT
    ? { ...rest, name: NAME, archived: false, shipTos: SHIP_TOS, defaultShipToId: PARENT }
    : { ...rest, archived: true });
}

const selectedLinks = links.filter(l => OLD.has(l.partnerId));
const groups = new Map<string, any[]>();
for (const row of selectedLinks) {
  const key = `${row.itemId}|${row.Direction ?? row.direction ?? ''}`;
  groups.set(key, [...(groups.get(key) ?? []), row]);
}
const compareFields = ['price','taxType','labelId','boxTypeId','qtyPerBox','qty_per_box','displaySize','packageType','containerTypeId','tapeTypeId','Account_Code','isSmartStore'];
const conflicts: string[] = [];
for (const [key, rows] of groups) {
  const keep = rows.find(r => r.partnerId === PARENT) ?? rows[0];
  let after = { ...keep, partnerId: PARENT, partnerName: NAME, shipToIds: [...new Set(rows.map(r => r.partnerId))] };
  delete after.id;
  for (const row of rows) for (const field of compareFields) {
    const a = after[field], b = row[field];
    const empty = (v: any) => v == null || v === '' || v === 0;
    if (empty(a) && !empty(b)) after[field] = b;
    else if (!empty(a) && !empty(b) && a !== b) conflicts.push(`${key} ${field}: ${a} / ${b}`);
  }
  plan('partner_item', keep, after);
  for (const row of rows) if (row.id !== keep.id) plan('partner_item', row, null);
}
if (conflicts.length) throw new Error(`단가·과세 충돌 ${conflicts.length}건:\n${conflicts.slice(0, 20).join('\n')}`);

for (const row of orders.filter(r => OLD.has(r.partnerId))) {
  const { id, ...rest } = row; plan('orders', row, { ...rest, partnerId: PARENT, partnerName: NAME, shipToId: row.partnerId });
}
for (const row of statements.filter(r => OLD.has(r.partnerId))) {
  const { id, ...rest } = row; plan('issuedStatements', row, { ...rest, partnerId: PARENT, partnerName: NAME });
}
for (const row of cash.filter(r => OLD.has(r.partnerId))) {
  const { id, ...rest } = row; plan('cashEntries', row, { ...rest, partnerId: PARENT, partnerName: NAME });
}
for (const row of settlements.filter(r => OLD.has(r.partnerId))) {
  const { id, ...rest } = row; plan('settlements', row, { ...rest, partnerId: PARENT });
}
for (const row of journals) {
  const lines = (row.lines ?? []).map((line: any) => OLD.has(line.partnerId) ? { ...line, partnerId: PARENT } : line);
  const top = OLD.has(row.partnerId) ? { partnerId: PARENT, partnerName: NAME } : {};
  if (lines.some((line: any, i: number) => line !== (row.lines ?? [])[i]) || Object.keys(top).length) {
    const { id, ...rest } = row; plan('journalEntries', row, { ...rest, ...top, lines });
  }
}

const count = (collection: string) => changes.filter(c => c.collection === collection).length;
console.log(`해피유통 부모 ${PARENT} / 배송지: ${SHIP_TOS.map(x => x.name).join(' · ')}`);
console.log(`거래처 ${count('partners')} · 품목연결 ${count('partner_item')} · 주문 ${count('orders')} · 전표 ${count('issuedStatements')} · 자금 ${count('cashEntries')} · 매칭 ${count('settlements')} · 분개 ${count('journalEntries')}`);
console.log(APPLY ? '실제 적용' : '미리보기(dry) — 쓰기 없음');
if (!APPLY) process.exit(0);
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), changes }, null, 2), 'utf8');
for (let i = 0; i < changes.length; i += 400) {
  const batch = db.batch();
  for (const ch of changes.slice(i, i + 400)) {
    const ref = db.collection(ch.collection).doc(ch.id);
    if (ch.after == null) batch.delete(ref); else batch.set(ref, ch.after);
  }
  await batch.commit();
}
const [vp, vo, vs, vc, vj] = await Promise.all([load('partners'), load('orders'), load('issuedStatements'), load('cashEntries'), load('journalEntries')]);
const leftovers = [
  ...vo.filter(x => OLD.has(x.partnerId) && x.partnerId !== PARENT),
  ...vs.filter(x => OLD.has(x.partnerId) && x.partnerId !== PARENT),
  ...vc.filter(x => OLD.has(x.partnerId) && x.partnerId !== PARENT),
  ...vj.filter(x => (x.lines ?? []).some((line: any) => OLD.has(line.partnerId) && line.partnerId !== PARENT)),
];
const parent = vp.find(x => x.id === PARENT);
if (!parent || parent.name !== NAME || (parent.shipTos ?? []).length !== 3 || leftovers.length) {
  throw new Error(`적용 후 검증 실패: 남은 옛 연결 ${leftovers.length}건`);
}
console.log(`적용·재조회 완료: ${changes.length}건, 옛 금융·주문 연결 0건`);
console.log(`백업: ${BACKUP}`);
