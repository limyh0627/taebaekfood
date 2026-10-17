import {PeriodicSanitationForm} from '../src/features/haccp/ui/PeriodicSanitationForm';
import {ClosingChecklistForm} from '../src/features/haccp/ui/ClosingChecklistForm';
import {DRAG_HANDLE_CLASS,PersonalHygieneTemplateEditor,TempZoneTemplateEditor,SanitationTemplateEditor,PeriodicSanitationTemplateEditor,ClosingChecklistTemplateEditor} from '../src/features/haccp/ui/ChecklistTemplateEditors';
export {PersonalHygieneTemplateEditor,TempZoneTemplateEditor,SanitationTemplateEditor} from '../src/features/haccp/ui/ChecklistTemplateEditors';
import {useChecklistDraftControl} from '../src/features/haccp/hooks/useChecklistDraftControl';
import {WEEKLY_ITEMS_DEFAULT,MONTHLY_ITEMS_DEFAULT,type PeriodCycle,type PeriodRow,type PeriodRecord} from '../src/features/haccp/domain/periodicSanitation';
import {CLOSING_ITEMS_DEFAULT,type ClosingRecord} from '../src/features/haccp/domain/closingChecklist';
import {CleaningForm} from '../src/features/haccp/ui/CleaningForm';
import {PersonalHygieneForm} from '../src/features/haccp/ui/PersonalHygieneForm';
export {PersonalHygieneForm} from '../src/features/haccp/ui/PersonalHygieneForm';
import {SanitationForm} from '../src/features/haccp/ui/SanitationForm';
export {SanitationForm} from '../src/features/haccp/ui/SanitationForm';
import {SANITATION_ITEMS} from '../src/features/haccp/domain/sanitationItems';
import {PERSONAL_HYGIENE_COLS} from '../src/features/haccp/domain/personalHygieneColumns';
import {IncomingForm} from '../src/features/haccp/ui/IncomingForm';
import {PestForm} from '../src/features/haccp/ui/PestForm';
import {TempForm} from '../src/features/haccp/ui/TempForm';
export {TempForm} from '../src/features/haccp/ui/TempForm';
import {HaccpCompanyContext,useHaccpCompany} from '../src/features/haccp/context/HaccpCompanyContext';
import {todayStr} from '../src/features/haccp/domain/haccpDate';
import {STORAGE_ZONES,type StorageZone} from '../src/features/haccp/domain/tempZones';
import CCPHeatForm from '../src/features/haccp/ui/CCPHeatForm';
import CCPMetalForm from '../src/features/haccp/ui/CCPMetalForm';
import {TH,TD,TDL,FormHeader,SignBox} from '../src/features/haccp/ui/ChecklistFormParts';
import type {SlotTime,SanitationRow,SanitationRecord} from '../src/features/haccp/domain/sanitationTypes';
import {sanSlotLabel,sanRevLabel,SanitationPrintable,SanitationMonthlyCover} from '../src/features/haccp/ui/SanitationPrint';
import { downloadAsPDF } from '../src/features/haccp/infrastructure/downloadAsPDF';
import { useDragReorder, arrayMove } from '../src/features/haccp/hooks/useDragReorder';
import React, { useState, useRef, useEffect } from 'react';
import { appConfirm } from '../src/shared/components/appDialog';
import { today } from '../src/shared/day';
import { FileDown, ClipboardList, Thermometer, Bug, CheckSquare, Scan, ShoppingCart, Wrench, ShieldAlert, Save, Trash2, BadgeCheck, User, Plus, GripVertical } from 'lucide-react';
import { db } from '../src/shared/firebase';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { addItem, setDocument, updateItem, deleteItem } from '../src/shared/services/firebaseService';
import { haccpTemplateDocId } from '../src/shared/haccpTemplateId';
import type { CompanyId } from '../src/shared/types';



// ── 공통 스타일 ────────────────────────────────────────────────────────────────




// ── PDF 다운로드 유틸 ──────────────────────────────────────────────────────────


// ── 공통 헬퍼 컴포넌트 ────────────────────────────────────────────────────────




// ── 드래그 순서 변경 훅 (템플릿 에디터 공용) ──────────────────────────────────
// 핸들(GripVertical)만 draggable로 두어 행 안 input의 텍스트 선택과 충돌하지 않게 함.
// 드래그 중 다른 행 위로 진입하면 즉시 순서를 바꿔 실시간 미리보기.
// 터치 기기는 HTML5 드래그가 동작하지 않으므로 ↑↓ 버튼을 유지한다.






// ── 탭 ID 타입 ─────────────────────────────────────────────────────────────────
type TabId = 'overview' | 'daily' | 'pest' | 'temp' | 'ccp-heat' | 'ccp-metal' | 'incoming' | 'cleaning' | 'sanitation' | 'personal' | 'weekly-sanitation' | 'closing';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 소규모 HACCP 사후평가 점검표 (20항목)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface OverviewRow {
  no: string;
  category: string;
  item: string;
  isOneStrike: boolean;
  result: '' | 'O' | 'X';
  note: string;
}

const OVERVIEW_ITEMS: Omit<OverviewRow, 'result' | 'note'>[] = [
  // ── 선행요건관리 (15항목) ──
  { no: '1', category: '영업장 관리', item: '영업장(작업장)의 청결 및 정돈 상태 관리', isOneStrike: false },
  { no: '2', category: '위생관리', item: '작업자의 개인위생(위생복, 장갑, 마스크, 두발관리 등) 준수', isOneStrike: true },
  { no: '3', category: '위생관리', item: '작업자의 건강진단(보건증) 실시 및 기록 유지', isOneStrike: false },
  { no: '4', category: '위생관리', item: '세척·소독제의 적정 사용 및 보관', isOneStrike: false },
  { no: '5', category: '제조·가공시설 및 설비 관리', item: '제조설비·기구 등의 위생적 관리', isOneStrike: false },
  { no: '6', category: '제조·가공시설 및 설비 관리', item: '온도계, 압력계 등 계측기의 정기적 교정 실시', isOneStrike: false },
  { no: '7', category: '냉장·냉동시설 관리', item: '냉장·냉동시설의 온도 관리 및 기록', isOneStrike: false },
  { no: '8', category: '용수 관리', item: '용수의 수질검사 실시 및 기록', isOneStrike: false },
  { no: '9', category: '보관·운송 관리', item: '원료·완제품의 위생적 보관 관리', isOneStrike: false },
  { no: '10', category: '보관·운송 관리', item: '선입선출(FIFO) 원칙 준수 및 유통기한 관리', isOneStrike: false },
  { no: '11', category: '검사 관리', item: '자체검사 계획 수립 및 실시', isOneStrike: false },
  { no: '12', category: '검사 관리', item: '원료·완제품 규격 확인 및 성적서 보관', isOneStrike: false },
  { no: '13', category: '회수 프로그램 관리', item: '부적합 제품 처리 및 회수 절차 운영', isOneStrike: false },
  { no: '14', category: '방충·방서 관리', item: '방충·방서 시설 설치 및 정기적 점검', isOneStrike: false },
  { no: '15', category: '교육·훈련 관리', item: '종사자 대상 HACCP 교육·훈련 실시 및 기록', isOneStrike: false },
  // ── HACCP관리 (5항목) ──
  { no: '16', category: 'HACCP 관리', item: 'CCP 모니터링 기록(가열·살균공정 온도·시간) 작성 및 유지', isOneStrike: true },
  { no: '17', category: 'HACCP 관리', item: 'CCP 모니터링 기록(금속검출공정) 작성 및 유지', isOneStrike: true },
  { no: '18', category: 'HACCP 관리', item: '모니터링 한계기준 이탈 시 개선조치 실시 및 기록', isOneStrike: false },
  { no: '19', category: 'HACCP 관리', item: '검증 활동(내부감사) 실시 및 기록 유지', isOneStrike: false },
  { no: '20', category: 'HACCP 관리', item: 'HACCP 관련 기록물 5년 이상 보존', isOneStrike: false },
];

const OverviewForm: React.FC = () => {
  const [rows, setRows] = useState<OverviewRow[]>(
    OVERVIEW_ITEMS.map(i => ({ ...i, result: '', note: '' }))
  );
  const [evaluator, setEvaluator] = useState('');
  const [evalDate, setEvalDate] = useState(today());
  const ref = useRef<HTMLDivElement>(null);

  const setResult = (idx: number, val: '' | 'O' | 'X') =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, result: val } : r));
  const setNote = (idx: number, val: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, note: val } : r));

  const passCount = rows.filter(r => r.result === 'O').length;
  const failCount = rows.filter(r => r.result === 'X').length;
  const total = rows.length;
  const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;
  const isOneStrikeFail = rows.some(r => r.isOneStrike && r.result === 'X');
  const finalResult = isOneStrikeFail ? '부적합(원스트라이크아웃)' : passRate >= 85 ? '적합' : '부적합';

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          평가일: <input type="date" value={evalDate} onChange={e => setEvalDate(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <label className="text-xs text-slate-600 flex items-center gap-1">
          평가자: <input value={evaluator} onChange={e => setEvaluator(e.target.value)} placeholder="이름 입력" className="border border-slate-300 rounded px-1 py-0.5 text-xs w-24" />
        </label>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_사후평가점검표_${evalDate}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="소규모 HACCP업체 사후평가 점검표" date={evalDate} />
        <p className="text-xs text-slate-500 mb-3">
          ※ 판정기준: 20항목 중 17개(85%) 이상 적합 = 적합 / ★ 항목 X 시 즉시 부적합(원스트라이크아웃)
        </p>

        <table className="w-full border-collapse text-xs mb-4">
          <thead>
            <tr>
              <th className={TH} style={{ width: 28 }}>번호</th>
              <th className={TH} style={{ width: 90 }}>구분</th>
              <th className={TH}>점검항목</th>
              <th className={TH} style={{ width: 24 }}>★</th>
              <th className={TH} style={{ width: 30 }}>적합</th>
              <th className={TH} style={{ width: 30 }}>부적합</th>
              <th className={TH} style={{ width: 100 }}>비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.no} className={row.isOneStrike ? 'bg-rose-50' : ''}>
                <td className={TD}>{row.no}</td>
                <td className={TDL}>{row.category}</td>
                <td className={TDL}>{row.item}</td>
                <td className={TD}>{row.isOneStrike ? '★' : ''}</td>
                <td className={TD}>
                  <input type="checkbox" checked={row.result === 'O'} onChange={() => setResult(idx, row.result === 'O' ? '' : 'O')} />
                </td>
                <td className={TD}>
                  <input type="checkbox" checked={row.result === 'X'} onChange={() => setResult(idx, row.result === 'X' ? '' : 'X')} />
                </td>
                <td className={TDL}>
                  <input value={row.note} onChange={e => setNote(idx, e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" placeholder="비고" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border border-slate-400 p-3 mb-3 text-xs">
          <div className="font-bold mb-1">평가 결과 요약</div>
          <div className="flex gap-6">
            <span>적합: <strong>{passCount}</strong>항목</span>
            <span>부적합: <strong>{failCount}</strong>항목</span>
            <span>적합률: <strong>{passRate}%</strong></span>
            <span>최종판정: <strong className={finalResult === '적합' ? 'text-green-600' : 'text-rose-600'}>{finalResult}</strong></span>
          </div>
          {isOneStrikeFail && <p className="mt-1 text-rose-600">★ 원스트라이크아웃 항목 부적합 — 즉각 개선조치 필요</p>}
        </div>

        <div className="text-xs text-slate-500 mb-2">평가자: {evaluator}</div>
        <SignBox labels={['작성자', '확인자', '대표자']} />
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 일반위생관리 및 공정점검표
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

const DailyForm: React.FC = () => {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. 방충·방서 점검표
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━







// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. 냉장·냉동창고 온도관리 일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━











// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. CCP-B 가열·살균공정 모니터링일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━






// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. CCP-P 금속검출공정 모니터링일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━




// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. 입고검사일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━











// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. 세척·소독 일지 (기계·설비 + 작업구역)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


















// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. 작업장 위생점검표 (HACCP-PRP-001)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━












// ── 월별 심사자료(PDF) — 읽기전용 서식 재현 ───────────────────────────────



// 단일 점검표 1장(A4 1페이지) — 화면 서식과 동일하게 재현(읽기전용)


// 표지 — 월간 실시 현황 요약




// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. 개인위생점검표 (HACCP-PRP-002)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━









// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 개인위생 템플릿 에디터 (관리자 전용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 온도관리 보관장소 템플릿 에디터 (관리자 전용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 작업장 위생 템플릿 에디터 (관리자 전용 — HACCP 체크리스트 탭에서 사용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


// 직원용 위생점검 탭 뷰 (작업장 위생 + 개인위생)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const StaffChecklistForCompany: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; companyId: CompanyId }> = ({ currentUser, isAdmin, companyId }) => {
  const [activeTab, setActiveTab] = useState<'sanitation' | 'personal' | 'temp' | 'weekly-sanitation' | 'closing'>('sanitation');
  const STAFF_TABS = [
    { id: 'sanitation' as const,        label: '작업장 위생점검표',    desc: 'HACCP-PRP-001 · 작업장 위생 점검 (1일 2회)',   icon: <ShieldAlert size={13} />,   color: 'emerald' },
    { id: 'weekly-sanitation' as const, label: '위생점검표(주간/월간)', desc: '작업장 위생 점검 — 주간 · 월간 주기',           icon: <ClipboardList size={13} />, color: 'teal'    },
    { id: 'closing' as const,           label: '마감 체크리스트',       desc: '일별 마감 점검 — 오늘 날짜만 작성 가능',         icon: <CheckSquare size={13} />,   color: 'orange'  },
    { id: 'personal' as const,          label: '개인위생점검표',        desc: 'HACCP-PRP-002 · 작업자 개인위생 점검 (1일 1회)', icon: <User size={13} />,          color: 'blue'    },
    { id: 'temp' as const,              label: '온도관리 일지',         desc: '냉장·냉동창고 온도 기록 (월 단위)',              icon: <Thermometer size={13} />,   color: 'slate'   },
  ];
  const activeColor: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 font-bold',
    teal:    'bg-teal-50 text-teal-700 font-bold',
    orange:  'bg-orange-50 text-orange-700 font-bold',
    blue:    'bg-blue-50 text-blue-700 font-bold',
    slate:   'bg-slate-200 text-slate-700 font-bold',
  };

  // 탭 순서: 관리자가 드래그로 변경 → Firestore에 저장돼 모든 기기에서 동일하게 표시
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const pendingTabOrder = useRef<string[] | null>(null);
  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'staff_tab_order')), snap => {
      const data = snap.exists() ? snap.data().order : null;
      if (Array.isArray(data)) setTabOrder(data);
    });
  }, [companyId]);

  // 저장된 순서 우선, 저장에 없는(새로 생긴) 탭은 기본 순서로 뒤에 붙임
  const tabById = new Map(STAFF_TABS.map(t => [t.id as string, t]));
  const orderedTabs = [
    ...tabOrder.map(id => tabById.get(id)).filter((t): t is typeof STAFF_TABS[number] => !!t),
    ...STAFF_TABS.filter(t => !tabOrder.includes(t.id)),
  ];

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => {
      const next = arrayMove(orderedTabs.map(t => t.id as string), from, to);
      pendingTabOrder.current = next;
      setTabOrder(next);
    },
    () => {
      if (!pendingTabOrder.current) return;
      setDocument('haccp_templates', haccpTemplateDocId(companyId, 'staff_tab_order'), { order: pendingTabOrder.current });
      pendingTabOrder.current = null;
    }
  );

  return (
    <HaccpCompanyContext.Provider value={companyId}>
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
            <ShieldAlert size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-800 leading-tight">위생·온도 점검표</h1>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">HACCP-PRP · 작업장 위생, 개인위생, 온도 기록</p>
          </div>
        </div>
      </div>
      <div className="bg-white border-b border-slate-200 px-4">
        <div className="flex gap-0.5 py-2 overflow-x-auto">
          {orderedTabs.map((tab, idx) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              {...(isAdmin ? { ...handleProps(idx), ...rowProps(idx) } : {})}
              title={isAdmin ? '드래그로 탭 순서 변경' : undefined}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id ? activeColor[tab.color] : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              } ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}>
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 py-2 bg-slate-50 border-b border-slate-100">
        <p className="text-xs text-slate-500">{STAFF_TABS.find(t => t.id === activeTab)?.desc}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'sanitation' && (
          <div className="flex flex-col gap-4">
            {isAdmin && <SanitationTemplateEditor />}
            <SanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />
          </div>
        )}
        {activeTab === 'weekly-sanitation' && (
          <div className="flex flex-col gap-4">
            <PeriodicSanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />
          </div>
        )}
        {activeTab === 'closing' && (
          <div className="flex flex-col gap-4">
            <ClosingChecklistForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />
          </div>
        )}
        {activeTab === 'personal'   && <PersonalHygieneForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />}
        {activeTab === 'temp'       && <TempForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />}
      </div>
    </div>
    </HaccpCompanyContext.Provider>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. 작업장 위생 점검표 (주간/월간)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
















/** 늦은 조회와 저장 응답이 사용자가 쓰는 초안 또는 다른 기간을 덮지 않게 한다. */




// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. 마감 체크리스트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━










// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 HaccpChecklist 컴포넌트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TABS: { id: TabId; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'overview',    label: '사후평가 점검표',    icon: <ClipboardList size={14} />, desc: '소규모 HACCP 20항목 사후평가' },
  { id: 'daily',      label: '일반위생관리',        icon: <CheckSquare size={14} />,   desc: '일일/주간/월간/반기/연간 위생점검' },
  { id: 'cleaning',   label: '세척·소독 일지',      icon: <Wrench size={14} />,        desc: '기계·설비(착유기·볶음기·필터프레스) 및 작업구역 청소소독 기록' },
  { id: 'pest',       label: '방충·방서 점검',      icon: <Bug size={14} />,           desc: '하절기 주 1회 / 동절기 월 1회' },
  { id: 'temp',       label: '온도관리 일지',        icon: <Thermometer size={14} />,   desc: '냉장·냉동창고 온도 기록' },
  { id: 'ccp-heat',   label: 'CCP-B 가열·살균',    icon: <Scan size={14} />,          desc: '가열공정 온도·시간 모니터링' },
  { id: 'ccp-metal',  label: 'CCP-P 금속검출',     icon: <Scan size={14} />,          desc: 'Fe 2.0㎜ / Sus 2.5㎜ 불검출' },
  { id: 'incoming',   label: '입고검사일지',         icon: <ShoppingCart size={14} />,  desc: '원료·부자재 입고검사' },
  { id: 'sanitation',        label: '작업장 위생점검표',        icon: <ShieldAlert size={14} />,   desc: 'HACCP-PRP-001 · 작업장 위생 8개 항목 점검 (Firestore 저장)' },
  { id: 'weekly-sanitation', label: '위생점검표(주간/월간)',    icon: <ClipboardList size={14} />, desc: '작업장 위생 점검표 — 주간 · 월간 주기 점검 (Firestore 저장)' },
  { id: 'closing',           label: '마감 체크리스트',          icon: <CheckSquare size={14} />,   desc: '일별 마감 점검 — 오늘 날짜만 작성 가능 (Firestore 저장)' },
  { id: 'personal',          label: '개인위생점검표',          icon: <User size={14} />,           desc: 'HACCP-PRP-002 · 작업자 개인위생 점검 (1일 1회)' },
];

const HaccpChecklistForCompany: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; companyId: CompanyId }> = ({ currentUser, isAdmin, companyId }) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // 탭 순서: 관리자가 드래그로 변경 → Firestore에 저장돼 모든 기기에서 동일하게 표시
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const pendingTabOrder = useRef<string[] | null>(null);
  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'haccp_tab_order')), snap => {
      const data = snap.exists() ? snap.data().order : null;
      if (Array.isArray(data)) setTabOrder(data);
    });
  }, [companyId]);

  // 저장된 순서 우선, 저장에 없는(새로 생긴) 탭은 기본 순서로 뒤에 붙임
  const tabById = new Map(TABS.map(t => [t.id as string, t]));
  const orderedTabs = [
    ...tabOrder.map(id => tabById.get(id)).filter((t): t is typeof TABS[number] => !!t),
    ...TABS.filter(t => !tabOrder.includes(t.id)),
  ];

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => {
      const next = arrayMove(orderedTabs.map(t => t.id as string), from, to);
      pendingTabOrder.current = next;
      setTabOrder(next);
    },
    () => {
      if (!pendingTabOrder.current) return;
      setDocument('haccp_templates', haccpTemplateDocId(companyId, 'haccp_tab_order'), { order: pendingTabOrder.current });
      pendingTabOrder.current = null;
    }
  );

  return (
    <HaccpCompanyContext.Provider value={companyId}>
    <div className="flex flex-col h-full bg-slate-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
            <ClipboardList size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-800">HACCP 관리 체크리스트</h1>
            <p className="text-xs text-slate-400">소규모 업체 기준 · 태백식품 신규공장 (향미유·고춧가루)</p>
          </div>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="bg-white border-b border-slate-200 px-4 overflow-x-auto">
        <div className="flex gap-0.5 py-2 min-w-max">
          {orderedTabs.map((tab, idx) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              {...(isAdmin ? { ...handleProps(idx), ...rowProps(idx) } : {})}
              title={isAdmin ? '드래그로 탭 순서 변경' : undefined}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-emerald-50 text-emerald-700 font-bold'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              } ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 설명 */}
      <div className="px-6 py-2 bg-slate-50 border-b border-slate-100">
        <p className="text-xs text-slate-500">{TABS.find(t => t.id === activeTab)?.desc}</p>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'overview'  && <OverviewForm />}
        {activeTab === 'daily'     && <DailyForm />}
        {activeTab === 'cleaning'  && <CleaningForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={false} />}
        {activeTab === 'pest'      && <PestForm />}
        {activeTab === 'temp'      && (
          <div className="flex flex-col gap-4">
            <TempZoneTemplateEditor />
            <TempForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'ccp-heat'  && <CCPHeatForm />}
        {activeTab === 'ccp-metal'   && <CCPMetalForm />}
        {activeTab === 'incoming'    && <IncomingForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={false} />}
        {activeTab === 'sanitation'  && (
          <div className="flex flex-col gap-4">
            <SanitationTemplateEditor />
            <SanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'weekly-sanitation' && (
          <div className="flex flex-col gap-4">
            {isAdmin && <PeriodicSanitationTemplateEditor cycle="weekly" />}
            {isAdmin && <PeriodicSanitationTemplateEditor cycle="monthly" />}
            <PeriodicSanitationForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'closing' && (
          <div className="flex flex-col gap-4">
            {isAdmin && <ClosingChecklistTemplateEditor />}
            <ClosingChecklistForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
        {activeTab === 'personal'    && (
          <div className="flex flex-col gap-4">
            <PersonalHygieneTemplateEditor />
            <PersonalHygieneForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin ?? false} />
          </div>
        )}
      </div>
    </div>
    </HaccpCompanyContext.Provider>
  );
};

// 회사가 바뀌면 이전 회사의 초안·템플릿·구독을 함께 비운다.
export const StaffChecklistView = (props: React.ComponentProps<typeof StaffChecklistForCompany>) =>
  <StaffChecklistForCompany key={props.companyId} {...props} />;
const HaccpChecklist = (props: React.ComponentProps<typeof HaccpChecklistForCompany>) =>
  <HaccpChecklistForCompany key={props.companyId} {...props} />;
export default HaccpChecklist;
