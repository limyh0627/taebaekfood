/**
 * 하루치 운영 기록을 읽어 일일 점검 보고서를 만든다.
 * 데이터는 고치지 않는다. 결과는 git에 올라가지 않는 로컬전용/일일점검에 남긴다.
 *
 * 실행: npx tsx scripts/diag-daily-integrity.mts [YYYY-MM-DD]
 */
import { access, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applicationDefault, cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { auditDataIntegrity, type IntegrityIssue } from '../src/features/admin/dataIntegrityAudit';
import type { ItemReceipt } from '../src/shared/receipt';
import type { RawInventoryState } from '../src/shared/rawInventoryCore';
import type { CompanyId, IssuedStatement, Item, ItemBom, Order, OrderStatusAudit, ProductionSalesLog, PurchaseOrder, RawMaterialEntry } from '../src/shared/types';
import { companyOf } from '../src/shared/types';
import { dateOfLocal } from '../src/shared/day';
import { buildBomIndex, setBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex, setPackIndex, type PackRow } from '../src/shared/packIndex';

const root = resolve(import.meta.dirname, '..');
const date = process.argv[2] || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`날짜 형식이 잘못됐습니다: ${date}`);

const defaultKeyPath = 'C:\\Users\\TAEBAEK\\.secrets\\taebaek-admin.json';
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || await access(defaultKeyPath).then(() => defaultKeyPath).catch(() => undefined);
const credential = keyPath ? cert(JSON.parse(await readFile(keyPath, 'utf8'))) : applicationDefault();
const app = getApps()[0] ?? initializeApp({ credential, projectId: 'taebaek-3abe4' });
const db = getFirestore(app);

const load = async <T>(name: string): Promise<T[]> => {
  const snap = await db.collection(name).get();
  return snap.docs.map(row => ({ id: row.id, ...row.data() } as T));
};

const causeOf = (issue: IntegrityIssue): string => {
  if (issue.id.startsWith('checked-no-state:')) return '완료 체크 저장과 재고 트랜잭션이 갈렸거나 예전 완료 기록입니다.';
  if (issue.id.startsWith('empty-snapshot:')) return '재고 처리 대상이 계산되지 않았거나 완료 증거 저장이 빠졌을 수 있습니다.';
  if (issue.id.startsWith('snapshot-arith:')) return '저장된 producedUnits·autoBuilt·bomLines 로 다시 계산한 재고 증감이 스냅샷과 어긋납니다. 그 시점의 저장 자체가 어긋난 상태입니다.';
  if (issue.id.startsWith('raw-ledger-mismatch:')) return '주문 원료 trace 와 실제 원료 원장 문서 사이의 kg·로트·품목·주문 값이 서로 다릅니다.';
  if (issue.id.startsWith('raw-ledger-missing:') || issue.id.startsWith('raw-no-ledger:')) return '원료 차감과 수불부 기록이 함께 확정되지 않았을 가능성이 있습니다.';
  if (issue.id.startsWith('raw-lot-gap:')) return '현재고와 로트 중 한쪽만 변경됐거나 과거 이관값이 남았을 수 있습니다.';
  if (issue.id.startsWith('raw-item-state-gap:')) return '재고관리 품목값과 원자화 상태 중 한쪽만 변경된 기록이 있습니다.';
  if (issue.id.startsWith('item-lot-gap:')) return '완제품·박스 실사정정 또는 출고가 stock과 제품 로트 중 한쪽에만 반영됐을 수 있습니다.';
  if (issue.id.startsWith('raw-ledger-state-gap:')) return '실제 원장 기록의 시각 순서가 뒤집혔거나 원장·현재고 중 한쪽만 움직인 기록이 있습니다.';
  if (issue.id.startsWith('raw-stock-negative:')) return '입고량보다 사용량이 많아 아직 상계되지 않은 원료 부족분이 남아 있습니다.';
  if (issue.id.startsWith('raw-carry-shortage:')) return '생산 당시 원료 입고가 부족해 시스템이 음수 이월 로트로 부족분을 기록했습니다.';
  if (issue.id.startsWith('po-no-receipt:') || issue.id.startsWith('po-no-raw:')) return '입고 처리 실패 뒤 발주 상태만 입고완료로 저장됐을 가능성이 있습니다.';
  if (issue.id.startsWith('po-receipt-qty:') || issue.id.startsWith('po-raw-qty:')) return '입고 수량이 발주 수량과 다릅니다. 부분 입고·중복 저장·단위 환산 오류 후보입니다.';
  if (issue.id.startsWith('po-receipt-dup:')) return '같은 발주·같은 품목에 입고 기록이 여러 건 붙어 있습니다.';
  if (issue.id.startsWith('po-raw-item-mismatch:')) return '원료 발주와 원장이 서로 다른 원료 품목(rawItemId)을 가리킵니다.';
  if (issue.id.startsWith('doc-empty:')) return '품목의 서류용 품목명이 비었거나 묶음 구성이 끊겼을 수 있습니다.';
  if (issue.id.startsWith('doc-fallback:')) return '품목의 서류용 품목명이 비어 생산판매일지가 상품명을 대신 사용했습니다.';
  if (issue.id.startsWith('sales-log-missing:')) return '배송완료 주문은 확정됐지만 생산판매일지 저장이 실행되지 않았거나 저장이 실패했습니다.';
  if (issue.id.startsWith('sales-log-duplicate:')) return '같은 서류일을 두 번 저장했거나 첫 저장의 성공 여부를 확인하지 못하고 재시도했을 수 있습니다.';
  if (issue.id.startsWith('sales-log-qty:') || issue.id.startsWith('sales-log-order-count:')) return '일지를 저장한 뒤 주문 수량·상태·서류일이 변경됐거나 일부 주문이 저장 대상에서 빠졌을 수 있습니다.';
  if (issue.id.startsWith('sales-log-orphan:')) return '판매일지는 남았지만 연결된 주문의 회사·상태·서류일이 변경됐거나 주문이 삭제됐을 수 있습니다.';
  if (issue.id.startsWith('doc-raw-ratio:')) return '서류용 품목의 배합비가 없거나 비율 합계·반올림 결과가 판매량과 맞지 않습니다.';
  if (issue.id.includes('capacity')) return '서류용 규격·용량이 없거나 공용 용량 파서가 읽지 못하는 형식입니다.';
  if (issue.id.startsWith('stmt-')) return '전표 발행 때 품목 ID 또는 출력용 스냅샷이 빠졌을 수 있습니다.';
  if (issue.id.startsWith('op-')) return '재고 작업이 실패했거나 작업 잠금이 정상 종료되지 않았습니다.';
  return '연결된 기준정보가 삭제·변경됐거나 저장 단계 일부가 누락됐을 수 있습니다.';
};

const actionOf = (issue: IntegrityIssue): string => {
  if (issue.id.startsWith('snapshot-arith:')) return '해당 주문 품목의 저장된 producedUnits·autoBuilt·bomLines·stockDeltas 를 조회해 어느 값이 재계산과 다른지 확인합니다.';
  if (issue.id.startsWith('raw-ledger-mismatch:')) return '스냅샷의 trace 와 원장 문서를 함께 열어 회사·주문·품목·kg·로트 변화를 하나씩 대조합니다.';
  if (issue.id.startsWith('po-receipt-') || issue.id.startsWith('po-raw-')) return '발주 카드와 입고 기록·원료 원장을 라인별로 비교해 부분 입고인지 중복 저장인지 판단합니다.';
  if (issue.id.startsWith('raw-carry-shortage:')) return '현재 원료 현재고와 활성 로트 합계가 일치하고 0 이상인지 확인합니다. 이미 상계됐다면 데이터 수정은 하지 않고 생산 전 입고 시점을 점검합니다.';
  if (issue.id.startsWith('raw-stock-negative:')) return '누락된 입고가 있는지 확인하고, 실제 재고 실사 후 원자적 재고조정으로 현재고와 로트를 함께 맞춥니다.';
  if (issue.id.startsWith('raw-ledger-state-gap:')) return '마지막 실사 이후 원장을 recordedAt·sequence 순으로 재계산하고 현재고·활성 로트 합계와 대조합니다.';
  if (issue.id.startsWith('raw-item-state-gap:')) return '재고관리, 원자화 상태, 활성 로트 중 실제 실사값을 기준으로 네 값을 한 트랜잭션에서 맞춥니다.';
  if (issue.id.startsWith('item-lot-gap:')) return '완제품 실사값을 확인한 뒤 제품 로트에 실사보정 로트를 생성하거나 FIFO로 차감해 stock과 맞춥니다.';
  if (issue.id.startsWith('sales-log-')) return '대상 날짜의 배송완료 주문과 저장된 생산판매일지를 거래처·품목·용량·수량별로 대조하고 필요하면 일지를 다시 생성합니다.';
  if (issue.id.startsWith('doc-raw-ratio:')) return '표시된 서류용 품목의 PRODUCT_FORMULA 등록값과 비율 합계를 고친 뒤 원료수불부를 다시 생성합니다.';
  if (issue.id.startsWith('doc-fallback:')) return '품목관리에서 서류용 품목명과 서류용 용량을 확인해 명시적으로 등록합니다.';
  if (issue.area === '작업완료·BOM') return '주문 품목의 완료 시각, inventoryOperation, 품목별 production 스냅샷과 원료 이동 작업번호를 대조합니다.';
  if (issue.area === '입고·재고') return '발주번호의 입고 기록·원료 이동과 현재고/활성 로트 합계를 확인합니다.';
  if (issue.area === '전표·서류') return '전표 원본과 품목의 서류용 품목명·규격을 확인한 뒤 누락된 연결을 보완합니다.';
  return '판매일지 줄과 서류용 배합비를 대조합니다. 실제 BOM 비율과 직접 비교하지 않습니다.';
};

try {
  const [orders, items, itemBoms, itemPacks, purchaseOrders, itemReceipts, rawMaterialLedger, rawInventories, issuedStatements, productionSalesLogs, orderStatusAudits] = await Promise.all([
    load<Order>('orders'), load<Item>('items'), load<ItemBom>('item_bom'), load<PackRow>('item_pack'), load<PurchaseOrder>('purchaseOrders'),
    load<ItemReceipt>('itemReceipts'), load<RawMaterialEntry>('rawMaterialLedger'), load<RawInventoryState>('rawInventories'),
    load<IssuedStatement>('issuedStatements'), load<ProductionSalesLog>('productionSalesLogs'), load<OrderStatusAudit>('orderStatusAudits'),
  ]);
  // 생산판매일지 화면과 같은 박스·세트 해체표를 사용해야 수량이 두 번 곱해지거나 묶음이
  // 상품명 한 줄로 남는 오탐이 생기지 않는다.
  setBomIndex(buildBomIndex(items, itemBoms));
  setPackIndex(buildPackIndex(itemPacks));

  const reports = (['taebaek', 'punghoe'] as CompanyId[]).map(companyId => {
    const issues = auditDataIntegrity({ companyId, dateFrom: date, dateTo: date, orders, items, itemBoms, purchaseOrders, itemReceipts, rawMaterialLedger, rawInventories, issuedStatements, productionSalesLogs });
    return { companyId, issues };
  });
  const all = reports.flatMap(report => report.issues.map(issue => ({ ...issue, companyId: report.companyId })));
  const errors = all.filter(issue => issue.severity === 'error').length;
  const warnings = all.filter(issue => issue.severity === 'warning').length;
  const lines = [
    `# ${date} 데이터 점검 보고서`, '',
    `- 작성 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`, `- 오류: **${errors}건**`, `- 확인 필요: **${warnings}건**`,
    `- 판정: ${errors ? '즉시 확인할 오류가 있습니다.' : warnings ? '확인이 필요한 기록이 있습니다.' : '현재 자동 점검에서 발견된 문제가 없습니다.'}`, '',
  ];
  const orderById = new Map(orders.map(order => [order.id, order]));
  const todayStatusAudits = orderStatusAudits.filter(audit => dateOfLocal(audit.approvedAt) === date);
  lines.push('## 주문 상태 변경 확인', '');
  for (const companyId of ['taebaek', 'punghoe'] as CompanyId[]) {
    const companyAudits = todayStatusAudits.filter(audit => {
      const order = orderById.get(audit.orderId);
      return order ? companyOf(order) === companyId : companyId === 'taebaek';
    });
    const shipped = companyAudits.filter(audit => audit.state === 'completed' && audit.nextStatus === 'SHIPPED');
    const cancelled = companyAudits.filter(audit => audit.state === 'completed' && audit.previousStatus === 'SHIPPED' && audit.nextStatus !== 'SHIPPED' && audit.nextStatus !== 'DELIVERED');
    const failed = companyAudits.filter(audit => audit.state === 'failed' && (audit.nextStatus === 'SHIPPED' || audit.previousStatus === 'SHIPPED'));
    lines.push(`### ${companyId === 'taebaek' ? '태백식품' : '풍회유통'}`);
    lines.push(`- 출고완료 처리: **${shipped.length}건**`);
    lines.push(`- 출고취소·되돌리기: **${cancelled.length}건**`);
    lines.push(`- 출고 상태 변경 실패: **${failed.length}건**`);
    for (const audit of shipped) {
      const order = orderById.get(audit.orderId);
      const finalStatus = order?.status ?? '주문 없음';
      const included = finalStatus === 'SHIPPED' || finalStatus === 'DELIVERED';
      lines.push(`  - ${order?.cardNo || audit.orderId} · ${audit.partnerName} · ${included ? '현재 출고상태 유지(판매일지 대상)' : `현재 ${finalStatus}(판매일지 제외)`}`);
    }
    for (const audit of cancelled) {
      const order = orderById.get(audit.orderId);
      lines.push(`  - 취소: ${order?.cardNo || audit.orderId} · ${audit.partnerName} · ${audit.previousStatus} → ${audit.nextStatus}`);
    }
    for (const audit of failed) lines.push(`  - 실패: ${orderById.get(audit.orderId)?.cardNo || audit.orderId} · ${audit.partnerName} · ${audit.error || '원인 미기록'}`);
    lines.push('');
  }
  for (const report of reports) {
    lines.push(`## ${report.companyId === 'taebaek' ? '태백식품' : '풍회유통'}`, '');
    if (!report.issues.length) { lines.push('- 발견된 문제 없음', ''); continue; }
    report.issues.forEach((issue, index) => lines.push(
      `### ${index + 1}. [${issue.severity === 'error' ? '오류' : '확인 필요'}] ${issue.title}`,
      `- 대상: ${issue.reference || '연결번호 없음'}${issue.date ? ` / ${issue.date.slice(0, 10)}` : ''}`,
      `- 내용: ${issue.detail}`,
      `- 예상 원인: ${causeOf(issue)}`,
      `- 권장 조치: ${actionOf(issue)}`, '',
    ));
  }
  lines.push('## 해석 주의', '', '- 판매일지·서류수불부는 서류용 환산 비율로 검증하며 실제 생산 BOM 비율과 직접 비교하지 않습니다.', '- 과거 비원료 입고는 전후 재고 스냅샷이 없어 입고 기록 존재만으로 당시 재고 반영을 완전히 증명할 수 없습니다.', '');
  const dir = resolve(root, '로컬전용', '일일점검');
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(resolve(dir, `${date}.md`), lines.join('\n'), 'utf8'),
    writeFile(resolve(dir, `${date}.json`), JSON.stringify({ date, createdAt: new Date().toISOString(), reports }, null, 2), 'utf8'),
  ]);
  console.log(lines.join('\n'));
} finally {
  await deleteApp(app);
}
