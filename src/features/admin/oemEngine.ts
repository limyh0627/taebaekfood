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
  /** 원료식(BOM) — 가공입고분을 어느 원료 그룹에 kg으로 올릴지 결정 */
  buildFormula: (prodKey: string) => { raw: string; ratio: number }[];
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
  const { items, adjustRawLots, updateItem, addItem, buildFormula } = deps;
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
    returns: { itemId: string; qty: number }[];   // 완포장으로 돌아온 규격별 수량
    /** 벌크(포장 안 한 상태)로 돌아온 kg — 원료 홀더 로트에 그대로 쌓는다.
     *  우리가 소분·포장하는 몫이라 재고가 우리 로트에 있어야 한다. */
    bulk?: { material: string; kg: number }[];
    unitPricePerKg?: number;                       // 가공단가(원/kg) — 전표 발행 때 쓰려고 배치에 저장
    date: string;
    addedBy?: string;
  }): Promise<{ receivedKg: number; loss: number }> {
    const { po } = input;
    if (po.poType !== 'oem') throw new Error('OEM 배치가 아닙니다.');
    if (po.status === 'received') throw new Error('이미 가공입고된 배치입니다.');

    const lines = input.returns.filter(r => r.itemId && r.qty > 0);
    const bulkLines = (input.bulk ?? []).filter(b => b.material && b.kg > 0);
    if (lines.length === 0 && bulkLines.length === 0) throw new Error('입고할 품목이 없습니다.');

    let receivedKg = 0;
    const poItems: PurchaseOrder['items'] = [];
    const receivedByRaw: Record<string, number> = {};   // 원료수불부에 남길 kg (재고는 안 건드림)

    for (const r of lines) {
      const item = items.find(i => i.id === r.itemId);
      if (!item) throw new Error(`품목을 찾을 수 없습니다: ${r.itemId}`);
      const kg = itemKg(item) * r.qty;
      receivedKg += kg;
      poItems.push({ itemId: item.id, name: item.name, quantity: r.qty, unit: item.unit ?? '개' });
      // 돌아온 완제품(박스/낱개) → 자기 재고 +N. 다른 품목 재고는 건드리지 않는다.
      await updateItem('items', item.id, { stock: Math.round(((item.stock ?? 0) + r.qty) * 1000) / 1000 });
      // 원료수불부는 BOM(원료식)으로 집계 — 볶음참깨 그룹에 kg 입고로 잡힌다.
      for (const f of buildFormula(item.품목 || item.name)) {
        if (kg * f.ratio > 0) receivedByRaw[f.raw] = (receivedByRaw[f.raw] ?? 0) + kg * f.ratio;
      }
    }

    // 벌크로 돌아온 몫 — 완포장과 달리 **우리 로트에 쌓는다**. 여기서 소분 품목이 BOM으로 빼간다.
    //   (예전엔 벌크를 받을 방법이 없어, 소분 품목이 입고 없는 빈 홀더에서 빼가 로트가 음수로 갔다)
    //   adjustRawLots가 로트 생성·음수이월 상쇄·원장 기록까지 함께 처리한다.
    for (const b of bulkLines) {
      const holder = findRawHolder(items, b.material);
      if (!holder) throw new Error(`원료 홀더를 찾을 수 없습니다: ${b.material}`);
      await adjustRawLots({
        material: b.material, rawItemId: holder.id, deltaKg: b.kg,
        date: input.date, note: `OEM 가공입고 ← ${po.partnerName ?? ''}`, addedBy: input.addedBy,
      });
      receivedKg += b.kg;
    }

    receivedKg = Math.round(receivedKg * 1000) / 1000;

    // 완포장분 = 원료(볶음참깨)가 완제품 안에 들어온 것. 반제품 재고는 안 올리고 수불부에만 kg으로 남긴다.
    //   (벌크분은 위 adjustRawLots가 이미 원장에 입고를 남겼다 — 여기서 또 쓰면 두 번 잡힌다)
    for (const [raw, rawKg] of Object.entries(receivedByRaw)) {
      const id = `rm-oem-${po.id}-${raw.replace(/\s/g, '_')}`;
      await addItem('rawMaterialLedger', {
        id, material: raw, date: input.date,
        received: Math.round(rawKg * 1000) / 1000, used: 0,
        note: `OEM 가공입고 ← ${po.partnerName ?? ''}`,
        type: 'auto', unit: 'kg', createdAt: new Date().toISOString(),
        ...(input.addedBy ? { addedBy: input.addedBy } : {}),
      });
    }
    const loss = batchLoss(po.oemSent, receivedKg);

    // 전표는 끊지 않는다 — linkedStatementId 없이 두면 '가공비 전표 작성 대기'가 된다.
    await updateItem('purchaseOrders', po.id, {
      status: 'received', receivedAt: new Date().toISOString(),
      oemReceivedKg: receivedKg, items: poItems,
      ...(bulkLines.length ? { oemReceivedBulk: bulkLines } : {}),
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

    const taxable = input.taxable ?? true;
    // 돌아온 완제품을 품목별 가공비 라인으로 — 수량=받은 개수, 규격=품목 spec.
    //  가공단가(perKg)는 세금포함 기준(processingFee와 동일): 1개 세포함가 = 개당kg × perKg → 공급가 = ÷1.1.
    const feeLines = (po.items ?? []).map(pi => {
      const it = items.find(i => i.id === pi.itemId);
      const unitTotal = Math.round((it ? itemKg(it) : 0) * perKg);       // 1개당 가공비(세포함)
      const unitSupply = taxable ? Math.round(unitTotal / 1.1) : unitTotal;
      const unitTax = unitTotal - unitSupply;
      const q = pi.quantity ?? 0;
      return {
        name: pi.name, spec: it?.spec ?? pi.unit ?? '', qty: q,
        price: unitSupply, supply: unitSupply * q, tax: unitTax * q, total: unitTotal * q,
        isTaxExempt: !taxable, accountCode: feeCode,
      };
    }).filter(l => l.qty > 0 && l.total > 0);
    // 품목 라인이 없으면(옛 배치 등) 종전처럼 한 줄로 폴백.
    const lines: IssuedStatement['items'] = feeLines.length > 0 ? feeLines : [{
      name: `외주가공비 (${sentKg(po.oemSent)}kg→${receivedKg}kg)`, spec: '', qty: 1,
      price: fee.supply, supply: fee.supply, tax: fee.tax, total: fee.total,
      isTaxExempt: !taxable, accountCode: feeCode,
    }];
    const totalSupply = lines.reduce((s, l) => s + l.supply, 0);
    const totalTax = lines.reduce((s, l) => s + l.tax, 0);

    const statementId = `stmt-${Date.now()}`;
    const d = new Date(input.date + 'T00:00:00');
    await addItem('issuedStatements', {
      id: statementId,
      issuedAt: new Date().toISOString(), tradeDate: input.date, type: '매입',
      partnerId: po.oemPartnerId ?? po.partnerId ?? '', partnerName: po.partnerName ?? '',
      orderId: po.id,
      docNo: `가공${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      totalSupply, totalTax, totalAmount: totalSupply + totalTax,
      items: lines,
    } as Partial<IssuedStatement>);

    await updateItem('purchaseOrders', po.id, { linkedStatementId: statementId, oemFeePerKg: perKg });
    return { statementId, supply: totalSupply, tax: totalTax, total: totalSupply + totalTax };
  }

  return { issueOemBatch, receiveOemBatch, issueOemFeeStatement };
}
