import { Item, IssuedStatement, PurchaseOrder } from '../../shared/types';
import { parsePackageKg, baseRawName } from '../../constants/formula';
import { batchLoss, processingFee, sentKg } from './oem';

/**
 * OEM(임가공) 실행 엔진 — 재고·전표 쓰기. 의존성 주입으로 부수효과를 분리해 단위 테스트 가능.
 * orderStockEngine과 같은 패턴(순수 로직 + 주입된 쓰기 함수).
 *
 *  발주(issueOemBatch): 내보낸 원료를 본재고에서 FIFO 차감(adjustRawLots) + OEM 배치 카드 생성.
 *                        외주재고는 열린 배치(oemSent)로 표현 — 별도 홀더 품목 없음.
 *  가공입고(receiveOemBatch): 돌아온 완제품/벌크 재고 +N + 배치 닫기 + 가공비 매입전표(과세).
 *                        로스 = 보낸 − 받은(kg) 자동.
 */

export const OEM_PROCESSING_FEE_CODE = '540'; // 외주가공비 (제조원가) — DB에 신설 필요
export const OEM_DEFAULT_FEE_PER_KG = 500;    // 가공단가 기본값(원/kg) — 푸미푸드 볶음. 입고 시 변경 가능

export interface OemEngineDeps {
  items: Item[];
  adjustRawLots: (opts: { material: string; rawItemId: string; deltaKg: number; date: string; note: string; addedBy?: string }) => Promise<void>;
  updateItem: (collection: string, id: string, data: Record<string, any>) => Promise<any>;
  addItem: (collection: string, data: Record<string, any>) => Promise<any>;
  processingFeeCode?: string; // 기본 OEM_PROCESSING_FEE_CODE
}

/** 원료명 → raw 홀더 품목 (category raw, 또는 wip 벌크(unit≠개)). phantom 제외. */
function findRawHolder(items: Item[], material: string): Item | undefined {
  return items.find(i => !i.phantom && !i.archived
    && (i.category === 'raw' || (i.category === 'wip' && i.unit !== '개'))
    && baseRawName(i.name) === material);
}

/** 완제품/벌크 품목 1개가 볶음참깨 몇 kg인지 — spec("10kg"/"1kg") 또는 packageKg. 못 구하면 0. */
export function itemKg(item: Item): number {
  return item.packageKg ?? parsePackageKg(item.spec) ?? parsePackageKg(item.name) ?? 0;
}

export function createOemEngine(deps: OemEngineDeps) {
  const { items, adjustRawLots, updateItem, addItem } = deps;
  const feeCode = deps.processingFeeCode ?? OEM_PROCESSING_FEE_CODE;

  /**
   * OEM 발주 — 우리 원료를 외주공장에 보낸다.
   * 본재고 FIFO 차감 + 열린 OEM 배치 카드 생성(전표 없음: 우리 것의 이동).
   */
  async function issueOemBatch(input: {
    oemPartnerId: string;
    partnerName: string;
    sent: { material: string; kg: number }[];
    date: string;   // YYYY-MM-DD
    addedBy?: string;
    note?: string;
  }): Promise<{ poId: string }> {
    const clean = input.sent.filter(s => s.material && s.kg > 0);
    if (clean.length === 0) throw new Error('내보낼 원료가 없습니다.');

    for (const s of clean) {
      const holder = findRawHolder(items, s.material);
      if (!holder) throw new Error(`원료 홀더를 찾을 수 없습니다: ${s.material}`);
      await adjustRawLots({
        material: s.material, rawItemId: holder.id, deltaKg: -s.kg,
        date: input.date, note: `OEM 외주출고 → ${input.partnerName}`, addedBy: input.addedBy,
      });
    }

    const poId = `oem-${Date.now()}`;
    const nowIso = new Date().toISOString();
    await addItem('purchaseOrders', {
      id: poId,
      poType: 'oem',
      partnerId: input.oemPartnerId, partnerName: input.partnerName,
      oemPartnerId: input.oemPartnerId,
      oemSent: clean,
      oemSentAt: nowIso,
      status: 'invoiced',       // 열린 배치(외주 나가 있음). received 되면 닫힘.
      itemId: '', itemName: '', quantity: 0, items: [],
      createdAt: nowIso,
      ...(input.note ? { note: input.note } : {}),
    });
    return { poId };
  }

  /**
   * OEM 가공입고 — 완제품이 돌아온다. **재고만 반영하고 전표는 끊지 않는다.**
   * 일반 매입과 같은 규칙: received + linkedStatementId 없음 = 가공비 전표 작성 대기.
   * 사용자가 확인 후 issueOemFeeStatement로 전표를 발행한다.
   * @returns { receivedKg, loss }
   */
  async function receiveOemBatch(input: {
    po: PurchaseOrder;
    returns: { itemId: string; qty: number }[];   // 돌아온 규격별 수량
    unitPricePerKg?: number;                       // 가공단가(원/kg) — 전표 발행 때 쓰려고 배치에 저장
    date: string;
    addedBy?: string;
  }): Promise<{ receivedKg: number; loss: number }> {
    const { po } = input;
    if (po.poType !== 'oem') throw new Error('OEM 배치가 아닙니다.');
    if (po.status === 'received') throw new Error('이미 가공입고된 배치입니다.');

    const lines = input.returns.filter(r => r.itemId && r.qty > 0);
    if (lines.length === 0) throw new Error('입고할 품목이 없습니다.');

    let receivedKg = 0;
    const poItems: PurchaseOrder['items'] = [];

    for (const r of lines) {
      const item = items.find(i => i.id === r.itemId);
      if (!item) throw new Error(`품목을 찾을 수 없습니다: ${r.itemId}`);
      receivedKg += itemKg(item) * r.qty;
      poItems.push({ itemId: item.id, name: item.name, quantity: r.qty, unit: item.unit ?? '개' });
      // 돌아온 완제품(박스/낱개) → 자기 재고 +N. (벌크 흡수는 미결 — 나중에.)
      await updateItem('items', item.id, { stock: Math.round(((item.stock ?? 0) + r.qty) * 1000) / 1000 });
    }

    receivedKg = Math.round(receivedKg * 1000) / 1000;
    const loss = batchLoss(po.oemSent, receivedKg);

    // 전표는 끊지 않는다 — linkedStatementId 없이 두면 '가공비 전표 작성 대기'가 된다.
    await updateItem('purchaseOrders', po.id, {
      status: 'received', receivedAt: new Date().toISOString(),
      oemReceivedKg: receivedKg, items: poItems,
      oemFeePerKg: input.unitPricePerKg ?? OEM_DEFAULT_FEE_PER_KG,
    });

    return { receivedKg, loss };
  }

  /**
   * 가공비 매입전표 발행 — 사용자가 가공입고 내역을 확인한 뒤 실행한다.
   * 원료비 아님(원료는 우리 것). 가공비만, 과세(세금계산서 수취).
   */
  async function issueOemFeeStatement(input: {
    po: PurchaseOrder;
    unitPricePerKg?: number;   // 없으면 배치에 저장된 값 → 기본값
    date: string;
    taxable?: boolean;         // 기본 과세
  }): Promise<{ statementId: string; supply: number; tax: number; total: number }> {
    const { po } = input;
    if (po.poType !== 'oem') throw new Error('OEM 배치가 아닙니다.');
    if (po.status !== 'received') throw new Error('가공입고 전에는 전표를 끊을 수 없습니다.');
    if (po.linkedStatementId) throw new Error('이미 가공비 전표가 발행된 배치입니다.');

    const receivedKg = po.oemReceivedKg ?? 0;
    const perKg = input.unitPricePerKg ?? po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG;
    const fee = processingFee(receivedKg, perKg, input.taxable ?? true);

    const statementId = `stmt-${Date.now()}`;
    const d = new Date(input.date + 'T00:00:00');
    await addItem('issuedStatements', {
      id: statementId,
      issuedAt: new Date().toISOString(), tradeDate: input.date, type: '매입',
      partnerId: po.oemPartnerId ?? po.partnerId ?? '', partnerName: po.partnerName ?? '',
      orderId: po.id,
      docNo: `가공${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      totalSupply: fee.supply, totalTax: fee.tax, totalAmount: fee.total,
      items: [{
        name: `외주가공비 (${sentKg(po.oemSent)}kg→${receivedKg}kg)`, spec: '', qty: 1,
        price: fee.supply, supply: fee.supply, tax: fee.tax, total: fee.total,
        isTaxExempt: !(input.taxable ?? true), accountCode: feeCode,
      }],
    } as Partial<IssuedStatement>);

    await updateItem('purchaseOrders', po.id, { linkedStatementId: statementId, oemFeePerKg: perKg });
    return { statementId, ...fee };
  }

  return { issueOemBatch, receiveOemBatch, issueOemFeeStatement };
}
