/** 세화식품 260812-02 표기 차이 1줄에 품목 ID를 연결한다. 기본 dry / --apply / --undo. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';

const { APPLY, UNDO } = 실행모드();
const db = adminDb();
const PATH = 'issuedStatements/stmt-1786496038113';
const BACKUP = '로컬전용/백업/sehwa-statement-item-link.json';
const ref = db.doc(PATH);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as { before: unknown[]; after: unknown[] };
  const current = (await ref.get()).data()?.items ?? [];
  if (JSON.stringify(current) !== JSON.stringify(backup.after)) throw new Error('적용 뒤 전표가 수정돼 복구를 중단합니다.');
  await ref.update({ items: backup.before });
  console.log('세화식품 260812-02 품목 연결을 복구했습니다.');
  process.exit(0);
}

const snap = await ref.get();
if (!snap.exists) throw new Error(`${PATH}가 없습니다.`);
const data = snap.data()!;
if (data.docNo !== '260812-02' || data.partnerName !== '세화식품') throw new Error('대상 전표가 예상과 다릅니다.');
const before = data.items ?? [];
if (before.length !== 1 || before[0]?.name !== '시골향 들깨가루(중간)/4kg' || Number(before[0]?.qty) !== 1) throw new Error('전표 줄이 예상과 다릅니다.');
const order = await db.doc('orders/ORD-1786507369829').get();
const orderLine = order.data()?.items?.[0];
if (!order.exists || orderLine?.itemId !== 'p-201' || Number(orderLine?.quantity) !== 1) throw new Error('연결 주문 줄이 예상과 다릅니다.');
const item = await db.doc('items/p-201').get();
if (!item.exists) throw new Error('품목 p-201이 없습니다.');
const normalizedItemName = String(item.data()?.name ?? '').replace(/[\s/()]/g, '');
if (normalizedItemName !== '시골향들깨가루중간4kg') throw new Error(`품목 p-201 이름이 예상과 다릅니다: ${item.data()?.name ?? '(없음)'}`);

const after = [{ ...before[0], itemId: 'p-201', lineKind: 'item' }];
console.log(`${APPLY ? '실제 적용' : '미리보기(dry)'}: ${PATH} 0번 줄 itemId ${before[0]?.itemId ?? '(없음)'} → p-201`);
if (!APPLY) { console.log('쓰기 없음. 적용하려면 --apply'); process.exit(0); }
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ savedAt: new Date().toISOString(), before, after }, null, 2), 'utf8');
await ref.update({ items: after });
const verified = (await ref.get()).data()?.items ?? [];
if (JSON.stringify(verified) !== JSON.stringify(after)) throw new Error('적용 뒤 재조회 검증 실패');
console.log('적용·재조회 검증 완료');
