
import { stampFor } from '../../shared/voucherStamp';
import { companyOf, type CompanyId, type Item, type IssuedStatement, type Partner, type PurchaseOrder, type RawMaterialLot } from '../../shared/types';
import { rawHolderByName, rawLedgerKeys } from '../../shared/rawHolder';
import { parsePackageKg, parseSpecCount } from '../../constants/formula';
import { itemKg } from '../../shared/orderUnits';
import { lineAmount } from '../../shared/lineAmount';
export { itemKg };
import { isBoxStockItem } from '../../shared/orderUnits';
import { buildProductLot } from '../../shared/lotUtils';
import { processingFee, sentKg } from './oem';
import type { CollectionName } from '../../shared/collections';
import { docName } from '../../shared/docName';
import type { OemReceiptInventoryInput } from './oemReceiptInventory';
import type { OemIssueInput } from './oemIssueJob';
import type { OemFeeStatementWrite } from './oemFeeStatement';

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
  companyId: CompanyId;
  items: Item[];
  partners: Partner[];
  issueOemBatchJob: (input: OemIssueInput) => Promise<{ poId: string }>;
  adjustRawLots: (opts: { companyId: CompanyId; material: string; rawItemId: string; deltaKg: number; date: string; note: string; addedBy?: string; ledgerType?: 'auto' | 'manual' | 'correction'; operationId?: string }) => Promise<void>;
  updateItem: (collection: CollectionName, id: string, data: Record<string, any>) => Promise<any>;
  addItem: (collection: CollectionName, data: Record<string, any>) => Promise<any>;
  /** 완제품 재고·로트와 OEM 배치 완료 표시를 한 transaction으로 반영한다. */
  applyOemReceiptInventory: (input: OemReceiptInventoryInput) => Promise<{
    status: 'applied' | 'duplicate'; receivedKg: number; loss: number; lotNos: Record<string, string>;
  }>;
  applyOemFeeStatement: (input: OemFeeStatementWrite) => Promise<string>;
  /** 원료식(BOM) — 가공입고분을 어느 원료 그룹에 kg으로 올릴지 결정 */
  buildFormula: (prodKey: string) => { raw: string; ratio: number }[];
  processingFeeCode?: string; // 기본 OEM_PROCESSING_FEE_CODE
}

/**
 * 원료명 → 홀더. 고르는 규칙은 [rawHolder](../../shared/rawHolder.ts) 하나가 안다 —
 * 여기서 따로 `find(name===...)` 하던 걸 없앴다(이름으로 첫 항목 집기).
 */
const findRawHolder = (items: Item[], material: string, companyId: CompanyId): Item | undefined =>
  rawHolderByName(items, material, companyId);


export function createOemEngine(deps: OemEngineDeps) {
  const { companyId, items, partners, issueOemBatchJob, updateItem, buildFormula, applyOemReceiptInventory, applyOemFeeStatement } = deps;
  const feeCode = deps.processingFeeCode ?? OEM_PROCESSING_FEE_CODE;
  const oemPartner = (id: string | undefined): Partner => {
    const partner = partners.find(candidate => candidate.id === id);
    if (!partner || companyOf(partner) !== companyId) throw new Error('다른 회사이거나 없는 OEM 거래처입니다.');
    return partner;
  };
  const assertPoCompany = (po: PurchaseOrder): void => {
    if (companyOf(po) !== companyId) throw new Error('다른 회사의 OEM 배치는 처리할 수 없습니다.');
    oemPartner(po.oemPartnerId ?? po.partnerId);
  };

  /**
   * OEM 발주 — 우리 원료를 외주공장에 보낸다.
   * 본재고 FIFO 차감 + 열린 OEM 배치 카드 생성(전표 없음: 우리 것의 이동).
   */
  async function issueOemBatch(input: {
    jobId: string;
    oemPartnerId: string;
    partnerName: string;
    sent: { material: string; kg: number }[];
    date: string;   // YYYY-MM-DD
    addedBy?: string;
    note?: string;
  }): Promise<{ poId: string }> {
    const clean = input.sent.filter(s => s.material && s.kg > 0);
    if (clean.length === 0) throw new Error('내보낼 원료가 없습니다.');
    const partner = oemPartner(input.oemPartnerId);
    // 한 원료를 먼저 차감한 뒤 다음 원료의 회사 오류를 발견하면 부분 출고가 된다.
    const holders = clean.map(s => {
      const holder = findRawHolder(items, s.material, companyId);
      if (!holder) throw new Error(`현재 회사의 원료 홀더를 찾을 수 없습니다: ${s.material}`);
      return holder;
    });

    // 동일 홀더가 입력에 두 번 나오면 하나의 원료 명령으로 합쳐 작업번호 충돌을 막는다.
    const sent = new Map<string, OemIssueInput['sent'][number]>();
    clean.forEach((row, index) => {
      const holder = holders[index]!;
      const previous = sent.get(holder.id);
      sent.set(holder.id, { material: row.material, rawItemId: holder.id, kg: (previous?.kg ?? 0) + row.kg });
    });
    return issueOemBatchJob({
      jobId: input.jobId, companyId, partnerId: partner.id, partnerName: partner.name,
      sent: [...sent.values()], date: input.date, note: input.note, addedBy: input.addedBy,
    });
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
  }): Promise<{ receivedKg: number; loss: number; lotNos: Record<string, string> }> {
    const { po } = input;
    if (po.poType !== 'oem') throw new Error('OEM 배치가 아닙니다.');
    assertPoCompany(po);
    // The legacy bulk path commits raw stock before the finished-goods transaction.
    if (input.bulk?.length) throw new Error('벌크 OEM 입고는 단일 거래 명령이 준비될 때까지 처리할 수 없습니다.');
    if (po.status === 'received' && po.oemReceiptOperationId !== `oem-receive:${po.id}`)
      throw new Error('이미 가공입고된 배치입니다.');

    const quantityByItem = new Map<string, number>();
    for (const row of input.returns.filter(r => r.itemId && r.qty > 0)) {
      quantityByItem.set(row.itemId, (quantityByItem.get(row.itemId) ?? 0) + row.qty);
    }
    const lines = [...quantityByItem].map(([itemId, qty]) => ({ itemId, qty }));
    const bulkByHolder = new Map<string, { material: string; kg: number }>();
    for (const row of (input.bulk ?? []).filter(b => b.material && b.kg > 0)) {
      const holder = findRawHolder(items, row.material, companyId);
      if (!holder) throw new Error(`현재 회사의 벌크 원료 홀더를 찾을 수 없습니다: ${row.material}`);
      const previous = bulkByHolder.get(holder.id);
      bulkByHolder.set(holder.id, { material: row.material, kg: (previous?.kg ?? 0) + row.kg });
    }
    const bulkLines = [...bulkByHolder.values()];
    if (lines.length === 0 && bulkLines.length === 0) throw new Error('입고할 품목이 없습니다.');
    for (const row of lines) {
      const product = items.find(item => item.id === row.itemId);
      if (!product || companyOf(product) !== companyId) throw new Error(`현재 회사의 OEM 입고 품목을 찾을 수 없습니다: ${row.itemId}`);
    }
    for (const row of bulkLines) {
      if (!findRawHolder(items, row.material, companyId)) throw new Error(`현재 회사의 벌크 원료 홀더를 찾을 수 없습니다: ${row.material}`);
    }

    let receivedKg = 0;
    const poItems: PurchaseOrder['items'] = [];
    const receiptItems: OemReceiptInventoryInput['items'] = [];
    const receivedByRaw: Record<string, number> = {};   // 원료수불부에 남길 kg (재고는 안 건드림)
    // 번호는 화면 목록 대신 입고 transaction의 검증된 counter에서 발급한다.

    for (const r of lines) {
      const item = items.find(i => i.id === r.itemId);
      if (!item) throw new Error(`품목을 찾을 수 없습니다: ${r.itemId}`);
      const unitKg = itemKg(item);
      const kg = unitKg * r.qty;
      receivedKg += kg;
      poItems.push({ itemId: item.id, name: item.name, quantity: r.qty, unit: item.unit ?? '개' });

      // 원료수불부는 BOM(원료식)으로 집계 — 볶음참깨 그룹에 kg 입고로 잡힌다.
      const formula = buildFormula(docName(item));
      for (const f of formula) {
        if (kg * f.ratio > 0) receivedByRaw[f.raw] = (receivedByRaw[f.raw] ?? 0) + kg * f.ratio;
      }

      // 돌아온 완제품(박스/낱개) → 자기 재고 +N. 다른 품목 재고는 건드리지 않는다.
      //  로트도 여기 붙는다. **벌크 홀더에 몰아넣지 않는 이유**: 그러면 같은 볶음참깨를
      //  홀더와 박스 품목이 각각 세고(재고 이중계상), FIFO도 kg·개수가 섞여 엉킨다.
      //  저장은 품목별로 나누고, 이력은 lot.material로 가로질러 묶는다.
      // 물질 축 — 배합이 여럿이면 비중이 가장 큰 원료로 건다(볶음참깨는 1.0 하나뿐).
      const material = formula.slice().sort((a, b) => b.ratio - a.ratio)[0]?.raw;
      let productLot: RawMaterialLot | undefined;
      if (material && unitKg > 0) {
        productLot = buildProductLot({
          material, itemId: item.id,
          supplierName: po.partnerName ?? '외주', supplierId: po.oemPartnerId ?? po.partnerId,
          qtyIn: r.qty, unitKg, receivedDate: input.date, poId: po.id,
        });
        productLot.id = `lot-oem-${po.id}-${item.id}`;
      }
      receiptItems.push({ itemId: item.id, qty: r.qty, ...(productLot && material ? { lot: productLot, material, unitKg } : {}) });
    }

    receivedKg = Math.round(receivedKg * 1000) / 1000;

    //  **완포장 서류용 원장 줄(`rm-oem-...`)은 더 이상 만들지 않는다**(2026-09-10 원자화 5단계).
    //   `rawMaterialLedger` 는 실제 원료 재고가 움직인 자리만 남긴다. 완포장은 원료 홀더가
    //   아니라 완제품 로트로 들어오므로 실제 원장에는 근거가 없다 — 실제 재고 없이 서류용으로만
    //   쌓아 두면 나중에 재고 코어가 그 줄을 원료 이동으로 오해한다(설계 §11·§12).
    //   서류(원료수불부)는 판매 자료와 실제 원장을 후처리해서 만드는 쪽으로 옮긴다.
    void receivedByRaw;
    // 전표는 끊지 않는다 — linkedStatementId 없이 두면 '가공비 전표 작성 대기'가 된다.
    const operationId = `oem-receive:${po.id}`;
    const perKg = input.unitPricePerKg ?? OEM_DEFAULT_FEE_PER_KG;
    const total = Math.round(receivedKg * perKg);
    const feeRequest: OemReceiptInventoryInput['feeRequest'] = {
      id: `OEMFEE-${po.id}`, companyId, itemId: po.id,
      itemName: `외주가공비 — ${po.partnerName ?? ''}`,
      originalQuantity: receivedKg, requestedQuantity: receivedKg,
      type: 'oem_fee', unit: 'kg', oemPoId: po.id,
      oemFeePerKg: perKg, oemTotal: total,
      reason: `${po.partnerName ?? ''} 가공비 ${receivedKg}kg × ${perKg}원 = ${total.toLocaleString()}원 — 전표 발행 필요`,
      status: 'pending', requestedAt: new Date().toISOString(),
    };
    const receipt = await applyOemReceiptInventory({
      companyId,
      poId: po.id,
      operationId,
      date: input.date,
      items: receiptItems,
      feeRequest,
      poPatch: {
        status: 'received', receivedAt: new Date().toISOString(),
        oemReceivedKg: receivedKg, items: poItems,
        ...(bulkLines.length ? { oemReceivedBulk: bulkLines } : {}),
        oemFeePerKg: perKg,
      },
    });

    return { receivedKg: receipt.receivedKg, loss: receipt.loss, lotNos: receipt.lotNos };
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
    assertPoCompany(po);
    if (po.status !== 'received') throw new Error('가공입고 전에는 전표를 끊을 수 없습니다.');
    const statementId = `OEMFEE-${po.id}`;
    // 전표 저장 뒤 확인요청 완료 표시만 실패할 수 있다. 같은 ID의 재확인은 거래에서 판정한다.
    if (po.linkedStatementId && po.linkedStatementId !== statementId) throw new Error('이미 가공비 전표가 발행된 배치입니다.');

    const receivedKg = po.oemReceivedKg ?? 0;
    const perKg = input.unitPricePerKg ?? po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG;
    const fee = processingFee(receivedKg, perKg, input.taxable ?? true);

    const taxable = input.taxable ?? true;
    // 돌아온 완제품을 품목별 가공비 라인으로 — 수량=받은 개수, 규격=품목 spec.
    //  가공단가(perKg)는 세금포함 기준(processingFee와 동일): 1개 세포함가 = 개당kg × perKg → 공급가 = ÷1.1.
    const productFeeLines = (po.items ?? []).map(pi => {
      const it = items.find(i => i.id === pi.itemId);
      if (!it || companyOf(it) !== companyId) throw new Error(`현재 회사의 OEM 전표 품목을 찾을 수 없습니다: ${pi.itemId}`);
      const unitTotal = Math.round((it ? itemKg(it) : 0) * perKg);       // 1개당 가공비(세포함)
      const q = pi.quantity ?? 0;
      //  줄의 공급가·세액은 **합계에서** 푼다 — 개당으로 풀어 곱하면 개수만큼 오차가 쌓인다
      const { supply: lineSupply, tax: lineTax, gross: lineGross } = lineAmount(q, unitTotal, !taxable);
      //  단가 칸에는 개당 공급가를 적는다(이 화면의 표기 규약)
      const unitSupply = lineAmount(1, unitTotal, !taxable).supply;
      return {
        name: pi.name, spec: it?.spec ?? pi.unit ?? '', qty: q,
        price: unitSupply, supply: lineSupply, tax: lineTax, total: lineGross,
        isTaxExempt: !taxable, accountCode: feeCode,
      };
    }).filter(l => l.qty > 0 && l.total > 0);
    // 받은 총중량에는 벌크도 들어간다. 완제품 줄만 전표로 쓰면 벌크 가공비가 빠진다.
    const bulkFeeLines = (po.oemReceivedBulk ?? []).filter(b => b.kg > 0).map(b => {
      const { supply, tax, gross } = lineAmount(b.kg, perKg, !taxable);
      return {
        name: `${b.material} 벌크 가공비`, spec: 'kg', qty: b.kg,
        price: lineAmount(1, perKg, !taxable).supply,
        supply, tax, total: gross, isTaxExempt: !taxable, accountCode: feeCode,
      };
    });
    const feeLines = [...productFeeLines, ...bulkFeeLines];
    // 품목 라인이 없으면(옛 배치 등) 종전처럼 한 줄로 폴백.
    const lines: IssuedStatement['items'] = feeLines.length > 0 ? feeLines : [{
      name: `외주가공비 (${sentKg(po.oemSent)}kg→${receivedKg}kg)`, spec: '', qty: 1,
      price: fee.supply, supply: fee.supply, tax: fee.tax, total: fee.total,
      isTaxExempt: !taxable, accountCode: feeCode,
    }];
    // 품목별 반올림 합과 총 받은 kg 기준 합계가 다를 수 있어 마지막 줄에서 원단위를 맞춘다.
    const grossGap = fee.total - lines.reduce((sum, line) => sum + line.total, 0);
    if (grossGap !== 0) {
      const last = lines[lines.length - 1]!;
      const corrected = lineAmount(last.total + grossGap, 1, !taxable);
      if (corrected.gross < 0) throw new Error('받은 중량과 가공비 전표 줄이 일치하지 않습니다.');
      lines[lines.length - 1] = {
        ...last, supply: corrected.supply, tax: corrected.tax, total: corrected.gross,
        price: Math.round(corrected.supply / last.qty),
      };
    }
    const totalSupply = lines.reduce((s, l) => s + l.supply, 0);
    const totalTax = lines.reduce((s, l) => s + l.tax, 0);

    const statement: IssuedStatement = {
      id: statementId,
      companyId,
      issuedAt: stampFor(input.date), tradeDate: input.date, type: '매입',
      partnerId: po.oemPartnerId ?? po.partnerId ?? '', partnerName: po.partnerName ?? '',
      orderId: po.id,
      docNo: '', // 서버가 공통 가공 번호통에서 확정한다.
      totalSupply, totalTax, totalAmount: totalSupply + totalTax,
      items: lines,
    };

    await applyOemFeeStatement({ companyId, poId: po.id, perKg, statement });
    return { statementId, supply: totalSupply, tax: totalTax, total: totalSupply + totalTax };
  }

  return { issueOemBatch, receiveOemBatch, issueOemFeeStatement };
}
