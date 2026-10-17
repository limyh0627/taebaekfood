import { useState } from 'react';
import { today } from '../../../shared/day';
import ModalShell from '../../../shared/components/ModalShell';
import { Item, PurchaseOrder, type CompanyId } from '../../../shared/types';
import { sentKg, processingFee } from '../../admin/oem';
import { OEM_DEFAULT_FEE_PER_KG } from '../../admin/oemEngine';
import { inspectStoredOemCostDisplay, reconcileOemBatch } from '../../admin/oemReconciliation';
import { type OrderUnitInputs } from '../../../shared/orderUnits';
import { formatNumberKo as fmt } from '../../../shared/numberDisplay';

export function FeeModal({ po, items, companyId, busy, onClose, onSubmit, orderUnitInputs }: {
  orderUnitInputs?: OrderUnitInputs;
  po: PurchaseOrder; items: Item[]; companyId: CompanyId; busy: boolean;
  onClose: () => void;
  onSubmit: (v: { unitPricePerKg: number; date: string }) => void;
}) {
  const [date, setDate] = useState(today());
  const [fee, setFee] = useState(String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG));
  const kg = po.oemReceivedKg ?? 0;
  const money = processingFee(kg, Number(fee) || 0);
  const reconciliation = reconcileOemBatch(po, items, companyId, orderUnitInputs);

  return (
    <ModalShell title="가공비 전표 발행" onClose={onClose} bodyClassName="space-y-4">
        <p className="text-[11px] text-slate-400 leading-snug">
          입고 내역을 확인하고 발행하세요. <b>가공비만</b> 매입전표로 끊깁니다 — 원료는 우리 것이라 금액에 없습니다.
        </p>

        <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-400 font-bold">외주공장</span><span className="font-black">{po.partnerName}</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">보낸 원료</span><span className="font-black tabular-nums">{fmt(sentKg(po.oemSent))} kg</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">총회수 중량 (저장값)</span><span className="font-black tabular-nums">{po.oemReceivedKg === undefined ? '자료 없음' : `${fmt(po.oemReceivedKg)} kg`}</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">{reconciliation?.productWeightBasis === 'saved-receipt' ? '제품 중량 (저장된 원입고 기준)' : reconciliation?.productWeightBasis === 'unconfirmed' ? '제품 중량 (입고 근거 미확인)' : '제품 중량 (현재 품목 기준 환산)'}</span><span className="font-black tabular-nums">{reconciliation?.unallocatedProductKg === undefined ? '자료 없음' : `${fmt(reconciliation.unallocatedProductKg)} kg`}</span></div>
          {reconciliation?.materials.map(material => <div key={material.material} className="flex justify-between"><span className="text-slate-400 font-bold">{material.material} 벌크 회수</span><span className="font-black tabular-nums">{material.returnedBulkKg === undefined ? '자료 없음' : `${fmt(material.returnedBulkKg)} kg`}</span></div>)}
          <div className="flex justify-between"><span className="text-slate-400 font-bold">산술 차이 · 손실 미확정</span><span className="font-black tabular-nums text-rose-600">{reconciliation?.unresolvedBatchKg === undefined ? '미확정' : `${fmt(reconciliation.unresolvedBatchKg)} kg`}</span></div>
          {reconciliation?.issues.map(issue => <p key={issue} className="text-amber-700">{issue}</p>)}
        </div>

        <OemCostSummary po={po} companyId={companyId}/>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">
              가공단가 (원/kg) <span className="text-slate-300 normal-case font-bold">· 부가세 포함</span>
            </label>
            <input inputMode="numeric" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d]/g, ''))}
              className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-amber-300" />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">전표일자</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300" />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400">공급가 {fmt(money.supply)} + 세액 {fmt(money.tax)}</span>
          <span className="text-base font-black text-slate-800">{fmt(money.total)}원</span>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => onSubmit({ unitPricePerKg: Number(fee) || 0, date })} disabled={busy || kg <= 0}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 disabled:opacity-30">
            {busy ? '발행 중…' : '전표 발행'}
          </button>
        </div>
    </ModalShell>
  );
}

function OemCostSummary({po,companyId}:{po:PurchaseOrder;companyId:CompanyId}) {
 const display=inspectStoredOemCostDisplay(po,companyId);
 if(display.status==='unconfirmed') return <p className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">OEM 원가 미확인 · {display.message}</p>;
 const cost=display.cost;
 return <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
   <strong>OEM 원가 {cost.status==='confirmed' ? '확정' : '가공비 공급가액 확인 대기'}</strong>
   <p>원료 공급가액 {fmt(cost.rawSupplyAmount)}원 · 부자재 공급가액 {fmt(cost.packagingSupplyAmount)}원</p>
   <p>회수 중량 {fmt(cost.receivedKg)}kg · 손실 {fmt(cost.lossKg)}kg</p>
   {cost.status==='confirmed' && <><p>가공비 공급가액 {fmt(cost.feeSupplyAmount)}원 · 총 공급원가 {fmt(cost.totalSupplyAmount)}원</p><p>확정 원가 {fmt(cost.costPerKg)}원/kg</p></>}
 </div>;
}
