import React, { useState, useRef } from 'react';
import { FileDown } from 'lucide-react';
import { TH, TD, TDL, FormHeader, SignBox } from './ChecklistFormParts';
import { downloadAsPDF } from '../infrastructure/downloadAsPDF';

type DailyCheckResult = 'O' | 'X' | '';

interface DailyCheckItem {
  id: string;
  cycle: '일일' | '주간' | '월간' | '반기' | '연간';
  category: string;
  item: string;
  standard: string;
}

const DAILY_ITEMS: DailyCheckItem[] = [
  // 일일
  { id: 'd1',   cycle: '일일', category: '작업자 위생',   item: '위생복·모자·마스크 착용 상태', standard: '전원 착용' },
  { id: 'd2',   cycle: '일일', category: '작업자 위생',   item: '작업 전·화장실 후 손세척·소독', standard: '준수' },
  { id: 'd_h1', cycle: '일일', category: '작업자 위생',   item: '건강이상자(감기·피부병·상처 등) 작업 배제', standard: '이상자 작업 배제' },
  { id: 'd_h2', cycle: '일일', category: '작업자 위생',   item: '장신구(반지·시계·귀걸이 등) 착용 금지', standard: '착용 금지' },
  { id: 'd3',   cycle: '일일', category: '작업장 청결',   item: '제조실·포장실 바닥·벽면 청소', standard: '청결 유지' },
  { id: 'd4',   cycle: '일일', category: '작업장 청결',   item: '작업대·기구 세척·소독', standard: '이물·오염 없음' },
  { id: 'd_f1', cycle: '일일', category: '이물 관리',     item: '작업 전 이물 혼입 방지 점검(유리·금속·플라스틱 등)', standard: '이물 없음' },
  { id: 'd5',   cycle: '일일', category: '원료·제품 관리', item: '원료 이상(변색·악취·이물 등) 유무 확인', standard: '이상 없음' },
  { id: 'd_r1', cycle: '일일', category: '원료·제품 관리', item: '원료 선입선출(FIFO) 확인', standard: '준수' },
  { id: 'd6',   cycle: '일일', category: '원료·제품 관리', item: '완제품 외관·라벨 확인', standard: '정상' },
  { id: 'd7',   cycle: '일일', category: '설비·기구',     item: '주요 설비(착유기·볶음기·필터프레스) 이상 유무 점검', standard: '이상 없음' },
  // 주간
  { id: 'w1',   cycle: '주간', category: '위생', item: '배수구·트렌치 청소', standard: '막힘·오염 없음' },
  { id: 'w2',   cycle: '주간', category: '위생', item: '환기시설(후드·덕트) 청소', standard: '이물 없음' },
  { id: 'w_t1', cycle: '주간', category: '위생', item: '작업 도구(체·바구니·용기 등) 세척소독', standard: '청결 유지' },
  { id: 'w3',   cycle: '주간', category: '방충', item: '방충망 파손 여부 확인', standard: '파손 없음' },
  { id: 'w4',   cycle: '주간', category: '보관', item: '냉장·냉동창고 청소 및 정돈', standard: '청결·정돈' },
  // 월간
  { id: 'm1',   cycle: '월간', category: '위생',    item: '벽·천장 곰팡이·이물 점검', standard: '이상 없음' },
  { id: 'm_l1', cycle: '월간', category: '위생',    item: '조명기구 파손·보호커버 상태 점검', standard: '파손 없음' },
  { id: 'm2',   cycle: '월간', category: '소독',    item: '소독제 농도 확인 및 교체', standard: '규정 농도 유지' },
  { id: 'm3',   cycle: '월간', category: '보관',    item: '세척·소독제 재고 및 유효기간 확인', standard: '유효기간 내' },
  { id: 'm4',   cycle: '월간', category: '방충·방서', item: '쥐덫·끈끈이 트랩 교체·확인', standard: '포획 유무 기록' },
  // 반기
  { id: 'h1', cycle: '반기', category: '수질',  item: '용수 수질검사 실시', standard: '먹는물 기준 적합' },
  { id: 'h2', cycle: '반기', category: '설비',  item: '주요 설비 분해 청소·점검', standard: '이상 없음' },
  { id: 'h3', cycle: '반기', category: '계측기', item: '온도계·타이머 교정', standard: '기준 오차 이내' },
  // 연간
  { id: 'y1', cycle: '연간', category: '교육', item: 'HACCP 교육·훈련 실시', standard: '전 직원 이수' },
  { id: 'y2', cycle: '연간', category: '검사', item: '자체 내부감사(검증) 실시', standard: '기록 유지' },
  { id: 'y3', cycle: '연간', category: '방역', item: '전문 방역업체 방역 실시', standard: '계약·성적서 보관' },
];

export const DailyForm: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [results, setResults] = useState<Record<string, DailyCheckResult>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);

  const setR = (id: string, v: DailyCheckResult) => setResults(prev => ({ ...prev, [id]: v }));
  const setN = (id: string, v: string) => setNotes(prev => ({ ...prev, [id]: v }));
  const cycleOrder: DailyCheckItem['cycle'][] = ['일일', '주간', '월간', '반기', '연간'];

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          점검월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_일반위생관리점검표_${month}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="일반위생관리 및 공정점검표" date={`${month} 기준`} />
        <p className="text-xs text-slate-500 mb-3">O: 적합 / X: 부적합 (부적합 시 비고에 개선조치 내용 기재)</p>

        {cycleOrder.map(cycle => {
          const items = DAILY_ITEMS.filter(i => i.cycle === cycle);
          return (
            <div key={cycle} className="mb-4">
              <div className="text-xs font-bold text-slate-700 bg-slate-200 px-2 py-1 mb-1">[{cycle} 점검]</div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={TH} style={{ width: 70 }}>구분</th>
                    <th className={TH}>점검항목</th>
                    <th className={TH} style={{ width: 120 }}>기준</th>
                    <th className={TH} style={{ width: 28 }}>O</th>
                    <th className={TH} style={{ width: 28 }}>X</th>
                    <th className={TH} style={{ width: 110 }}>비고(개선조치)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td className={TD}>{item.category}</td>
                      <td className={TDL}>{item.item}</td>
                      <td className={TD}>{item.standard}</td>
                      <td className={TD}><input type="checkbox" checked={results[item.id] === 'O'} onChange={() => setR(item.id, results[item.id] === 'O' ? '' : 'O')} /></td>
                      <td className={TD}><input type="checkbox" checked={results[item.id] === 'X'} onChange={() => setR(item.id, results[item.id] === 'X' ? '' : 'X')} /></td>
                      <td className={TDL}><input value={notes[item.id] ?? ''} onChange={e => setN(item.id, e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        <SignBox />
      </div>
    </div>
  );
};
