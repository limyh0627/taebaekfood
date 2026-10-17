import React from 'react';
import {TH,TD,TDL} from './ChecklistFormParts';
import type {SlotTime,SanitationRecord} from '../domain/sanitationTypes';

export const sanSlotLabel = (slot: SlotTime) => slot === '08:30' ? '오전 08:30' : '오후 15:00';

export const sanRevLabel = (r: { revisionCount: number }) => r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;

export const SanitationPrintable: React.FC<{ record: SanitationRecord; templateItems: { item: string; standard: string }[] }> = ({ record, templateItems }) => (
  <div style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
    <h2 className="text-lg font-black text-center mb-1">HACCP 작업장 위생점검표</h2>
    <div className="text-center mb-3">
      {record.confirmedBy
        ? <span className="inline-block text-[11px] font-bold text-emerald-700 border border-emerald-500 rounded px-2 py-0.5">✔ 관리자 확인완료 · {record.confirmedBy} ({record.confirmedAt?.slice(0, 10)})</span>
        : <span className="inline-block text-[11px] font-bold text-amber-700 border border-amber-500 rounded px-2 py-0.5">미확인</span>}
    </div>

    <table className="w-full border-collapse text-xs mb-3">
      <tbody>
        <tr>
          <td className={TH} style={{ width: 84 }}>회사명</td><td className={TD}>태백식품</td>
          <td className={TH} style={{ width: 84 }}>문서번호</td><td className={TD}>HACCP-PRP-001</td>
        </tr>
        <tr>
          <td className={TH}>점검일자</td><td className={TD}>{record.checkDate}</td>
          <td className={TH}>점검시간</td><td className={TD}>{sanSlotLabel(record.checkTime)}</td>
        </tr>
        <tr>
          <td className={TH}>작성자</td><td className={TD}>{record.createdBy || '-'}</td>
          <td className={TH}>개정번호</td><td className={TD}>{sanRevLabel(record)}</td>
        </tr>
        <tr>
          <td className={TH}>점검구역</td><td className={TDL} colSpan={3}>{record.checkZone || '-'}</td>
        </tr>
      </tbody>
    </table>

    <table className="w-full border-collapse text-xs mb-3">
      <thead>
        <tr>
          <th className={TH} style={{ width: 28 }}>No</th>
          <th className={TH}>점검항목</th>
          <th className={TH}>점검기준</th>
          <th className={TH} style={{ width: 40 }}>적합</th>
          <th className={TH} style={{ width: 40 }}>부적합</th>
          <th className={TH} style={{ width: 72 }}>점검자</th>
          <th className={TH}>비고사항(조치)</th>
        </tr>
      </thead>
      <tbody>
        {templateItems.map((item, idx) => {
          const row = record.rows[idx] ?? { result: '', note: '', inspector: '' };
          return (
            <tr key={idx} className={row.result === 'fail' ? 'bg-rose-50' : ''}>
              <td className={TD}>{idx + 1}</td>
              <td className={TDL}>{item.item}</td>
              <td className={TDL}>{item.standard}</td>
              <td className={TD} style={{ color: '#059669', fontWeight: 700 }}>{row.result === 'pass' ? '●' : ''}</td>
              <td className={TD} style={{ color: '#e11d48', fontWeight: 700 }}>{row.result === 'fail' ? '●' : ''}</td>
              <td className={TDL}>{row.inspector || ''}</td>
              <td className={TDL}>{row.note || ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>

    <div className="text-xs font-bold mb-1">■ 특이사항 및 개선조치</div>
    <div className="border border-slate-400 p-2 text-xs mb-3" style={{ minHeight: 44 }}>{record.specialNotes || '-'}</div>

    <div className="flex justify-end gap-3 text-xs">
      <div className="border border-slate-400 text-center" style={{ width: 110 }}>
        <div className="bg-slate-100 font-bold py-1 border-b border-slate-400">작성자</div>
        <div className="flex items-center justify-center font-semibold" style={{ height: 36 }}>{record.createdBy || '-'}</div>
      </div>
      {record.updatedBy && record.updatedBy !== record.createdBy && (
        <div className="border border-slate-400 text-center" style={{ width: 110 }}>
          <div className="bg-slate-100 font-bold py-1 border-b border-slate-400">수정자</div>
          <div className="flex items-center justify-center font-semibold" style={{ height: 36 }}>{record.updatedBy}</div>
        </div>
      )}
      <div className="border border-slate-400 text-center" style={{ width: 110 }}>
        <div className="bg-slate-100 font-bold py-1 border-b border-slate-400">확인자</div>
        <div className="flex items-center justify-center font-semibold" style={{ height: 36 }}>{record.confirmedBy || '미확인'}</div>
      </div>
    </div>
  </div>
);

export const SanitationMonthlyCover: React.FC<{ ym: string; monthRecords: SanitationRecord[] }> = ({ ym, monthRecords }) => {
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const total = monthRecords.length;
  const confirmed = monthRecords.filter(r => r.confirmedBy).length;
  const failCount = monthRecords.filter(r => r.rows.some(row => row.result === 'fail')).length;
  const plannedSlots = daysInMonth * 2;

  const cell = (day: number, slot: SlotTime) => {
    const ds = `${ym}-${String(day).padStart(2, '0')}`;
    const rec = monthRecords.find(r => r.checkDate === ds && r.checkTime === slot);
    if (!rec) return <span style={{ color: '#cbd5e1' }}>미점검</span>;
    const hasFail = rec.rows.some(r => r.result === 'fail');
    if (rec.confirmedBy) return <span style={{ color: '#059669', fontWeight: 700 }}>확인{hasFail ? '·부적합' : ''}</span>;
    return <span style={{ color: '#d97706', fontWeight: 700 }}>점검{hasFail ? '·부적합' : ''}</span>;
  };

  const box = (label: string, value: string, sub?: string) => (
    <div className="border border-slate-400 rounded-lg p-2 text-center">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-base font-black text-slate-800">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );

  return (
    <div style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
      <h1 className="text-xl font-black text-center mb-1">작업장 위생점검 실시 현황</h1>
      <div className="text-center text-sm text-slate-600 mb-4">{y}년 {String(m).padStart(2, '0')}월 · 태백식품 · HACCP-PRP-001</div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        {box('총 점검', `${total}회`, `계획 ${plannedSlots}회`)}
        {box('확인완료', `${confirmed}회`)}
        {box('미확인', `${total - confirmed}회`)}
        {box('부적합 발생', `${failCount}회`)}
      </div>

      <div className="text-xs font-bold mb-1">■ 일자별 점검 현황</div>
      <table className="w-full border-collapse text-xs mb-3">
        <thead>
          <tr>
            <th className={TH} style={{ width: 110 }}>일자</th>
            <th className={TH}>오전 08:30</th>
            <th className={TH}>오후 15:00</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
            <tr key={day}>
              <td className={TD}>{ym}-{String(day).padStart(2, '0')}</td>
              <td className={TD}>{cell(day, '08:30')}</td>
              <td className={TD}>{cell(day, '15:00')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[11px] text-slate-500">※ 점검주기 1일 2회(오전 08:30 / 오후 15:00) · '미점검' = 해당 시간대 기록 없음 · '확인' = 관리자 확인완료 · 개별 점검표는 다음 장부터 날짜순 첨부</div>
    </div>
  );
};
