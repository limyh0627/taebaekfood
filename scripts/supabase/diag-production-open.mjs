// 읽기 전용 진단: 아직 안 나간 주문이 '생산 처리'(orderProductionBatch open)에서 막히는 이유를 찾는다.
// Firestore는 읽기만 한다. 공개 저장소 로그에 남으므로 거래처 이름은 가리고, 금액·연락처·주소는 찍지 않는다.
// 서버 검사(functions/src/shared/orderProductionBatchEvidence.ts readBatchOpening/deriveBatchOpeningFromEvidence)의 조건을 그대로 옮겨 본다.
// 환경 변수: GOOGLE_APPLICATION_CREDENTIALS(읽기 권한), DAYS(최근 며칠 배송일, 기본 14)
import admin from 'firebase-admin';

admin.initializeApp({ projectId: 'taebaek-3abe4' });
const db = admin.firestore();
const DAYS = Number(process.env.DAYS || 14);
const OPEN = ['PENDING', 'PROCESSING', 'ON_HOLD'];
const mask = s => (typeof s === 'string' && s ? s[0] + '*'.repeat(Math.max(1, [...s].length - 1)) : '(없음)');
const t = v => (v === undefined ? 'undef' : v === null ? 'null' : Array.isArray(v) ? `array(${v.length})` : typeof v);
const opaque = v => typeof v === 'string' && v.length > 0 && v.trim() === v;

const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
const snap = await db.collection('orders').where('status', 'in', OPEN).get();
const orders = snap.docs.filter(d => (d.data().deliveryDate ?? '9999') >= since);
console.log(`## 안 나간 주문 ${orders.length}건 (배송일 ${since} 이후)\n`);

const itemCache = new Map();
async function item(id) {
  if (!itemCache.has(id)) {
    const [it, bom, pack] = await Promise.all([
      db.doc('items/' + id).get(),
      db.collection('item_bom').where('parent_id', '==', id).get(),
      db.collection('item_pack').where('item_id', '==', id).get(),
    ]);
    itemCache.set(id, { it, bom: bom.docs, pack: pack.docs });
  }
  return itemCache.get(id);
}

let bad = 0;
for (const o of orders) {
  const d = o.data(), problems = [], notes = [];
  const company = d.companyId ?? 'taebaek';
  if (d.companyId === undefined) notes.push('주문에 companyId 없음(태백으로 봄)');
  if (d.inventoryOperation) problems.push(`inventoryOperation 진행 중 표시가 남아 있음(${t(d.inventoryOperation)})`);
  if ('archived' in d && d.archived !== false) problems.push('주문 archived');
  const hasPrior = Object.prototype.hasOwnProperty.call(d, 'orderProductionRefsV1');
  if (hasPrior) notes.push(`이미 생산 기록 있음(orderProductionRefsV1, protocol=${d.inventoryExecutionProtocol ?? 'undef'}, snapshots=${t(d.inventorySnapshots)})`);
  if (Object.prototype.hasOwnProperty.call(d, 'legacyRecoveryRetirementV1')) notes.push('legacyRecoveryRetirementV1 있음');
  const lines = Array.isArray(d.items) ? d.items : [];
  if (!lines.length) problems.push('품목 줄 없음');
  const ids = lines.map(l => l?.lineId);
  if (ids.some(x => x === undefined)) notes.push(`lineId 없는 줄 ${ids.filter(x => x === undefined).length}개(서버가 붙임)`);
  if (ids.some(x => x !== undefined && !opaque(x))) problems.push('lineId 모양이 이상함(앞뒤 공백·빈 문자열·문자 아님)');
  if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) problems.push('lineId 중복');

  const lineInfo = [];
  for (const [i, l] of lines.entries()) {
    const info = [`#${i + 1} item=${l?.itemId ?? '(없음)'} qty=${l?.quantity}(${t(l?.quantity)}) isBox=${l?.isBoxUnit ?? '-'} boxQ=${l?.boxQuantity ?? '-'} perBox=${l?.unitsPerBox ?? '-'} lineId=${l?.lineId === undefined ? '-' : 'O'}`];
    if (!l?.itemId) { problems.push(`#${i + 1} itemId 없음`); lineInfo.push(info[0]); continue; }
    if (typeof l.quantity !== 'number' || !(l.quantity > 0)) problems.push(`#${i + 1} 수량이 숫자가 아니거나 0 이하`);
    const { it, bom, pack } = await item(l.itemId);
    const p = it.exists ? it.data() : null;
    if (!p) { problems.push(`#${i + 1} 품목 문서 없음(${l.itemId})`); lineInfo.push(info[0]); continue; }
    info.push(`  품목 "${p.name}" unit=${JSON.stringify(p.unit)} type=${p.type ?? p.category ?? '-'} company=${p.companyId ?? 'undef'} archived=${p.archived ?? 'undef'} protoVer=${p.inventoryWriterProtocolVersion ?? '-'} rev=${p.inventoryWriteRevision ?? '-'} floor=${p.serverReservedStockFloorV1 ?? '-'} reservations=${t(p.inventoryReservations)}`);
    if (p.companyId !== company) problems.push(`#${i + 1} 품목 companyId(${p.companyId ?? 'undef'}) ≠ 주문 회사(${company})`);
    if ('archived' in p && p.archived !== false) problems.push(`#${i + 1} 품목이 숨김/보관(archived=${p.archived})`);
    if (typeof p.unit !== 'string' || !p.unit.trim()) problems.push(`#${i + 1} 품목 단위(unit) 없음`);
    if (p.inventoryWriterProtocolVersion !== undefined && (p.inventoryWriterProtocolVersion !== 1 || p.inventoryWriteRevision === undefined)) problems.push(`#${i + 1} 품목 재고 쓰기 버전 표시가 어긋남`);
    if (p.inventoryReservations !== undefined && !Array.isArray(p.inventoryReservations)) problems.push(`#${i + 1} 품목 inventoryReservations가 배열 아님`);
    const packs = pack.map(s => s.data());
    if (packs.length) info.push(`  item_pack: ${packs.map(r => `${r.units_per_box}(${r.companyId ?? 'undef'})`).join(', ')}`);
    if (packs.some(r => r.companyId !== company)) problems.push(`#${i + 1} item_pack companyId가 다름`);
    if (packs.some(r => !Number.isSafeInteger(r.units_per_box) || r.units_per_box <= 1)) problems.push(`#${i + 1} item_pack 박스당 개수가 정수>1 아님`);
    if (new Set(packs.map(r => r.units_per_box)).size > 1) problems.push(`#${i + 1} item_pack 박스당 개수가 여러 개(${[...new Set(packs.map(r => r.units_per_box))].join('/')})`);
    const boms = bom.map(s => s.data());
    if (boms.length) info.push(`  item_bom: ${boms.length}줄 ${boms.map(r => `${r.child_id}×${r.quantity}(${r.companyId ?? 'undef'})`).join(', ')}`);
    for (const r of boms) {
      if (r.companyId !== company) problems.push(`#${i + 1} BOM 줄 companyId가 다름(${r.companyId ?? 'undef'})`);
      if (typeof r.quantity !== 'number' || !Number.isFinite(r.quantity) || r.quantity < 0) problems.push(`#${i + 1} BOM 수량이 숫자 아님(${r.child_id})`);
      const c = r.child_id ? await db.doc('items/' + r.child_id).get() : null;
      const cd = c?.exists ? c.data() : null;
      if (!cd) problems.push(`#${i + 1} BOM 구성품 문서 없음(${r.child_id})`);
      else {
        if (cd.companyId !== company) problems.push(`#${i + 1} BOM 구성품 "${cd.name}" companyId(${cd.companyId ?? 'undef'}) 다름`);
        if ('archived' in cd && cd.archived !== false) problems.push(`#${i + 1} BOM 구성품 "${cd.name}" 숨김/보관`);
        if (typeof cd.unit !== 'string' || !cd.unit.trim()) problems.push(`#${i + 1} BOM 구성품 "${cd.name}" 단위 없음`);
      }
    }
    if (p.unit === '박스' && !boms.length) problems.push(`#${i + 1} 단위가 '박스'인데 BOM(낱개 구성)이 없음`);
    if (l.isBoxUnit === true && p.unit !== '박스') {
      const n = packs[0]?.units_per_box;
      if (!n || l.unitsPerBox !== n || typeof l.boxQuantity !== 'number' || l.quantity !== l.boxQuantity * n)
        problems.push(`#${i + 1} 박스 주문인데 박스당 개수가 안 맞음(주문 ${l.boxQuantity}박스×${l.unitsPerBox} = ${l.quantity}, 품목 박스당 ${n ?? '없음'})`);
    }
    if (hasPrior) {
      const done = d.orderProductionRefsV1?.lines?.find(x => x.lineId === l.lineId)?.completedQty;
      if (typeof done !== 'number') problems.push(`#${i + 1} 생산 기록에 이 줄 완료수량이 없음`);
    }
    lineInfo.push(info.join('\n'));
  }
  const flag = problems.length ? '❌' : '✅';
  if (problems.length) bad++;
  console.log(`### ${flag} ${o.id} ${mask(d.partnerName)} 배송 ${d.deliveryDate} 상태 ${d.status} source=${d.source ?? '-'} 줄 ${lines.length}`);
  for (const n of notes) console.log(`- 참고: ${n}`);
  for (const p of problems) console.log(`- 문제: ${p}`);
  if (problems.length || process.env.VERBOSE) console.log('```\n' + lineInfo.join('\n') + '\n```');
  console.log('');
}
console.log(`\n문제 보이는 주문 ${bad}건 / ${orders.length}건`);
