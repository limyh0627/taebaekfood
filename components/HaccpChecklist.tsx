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




const DRAG_HANDLE_CLASS = 'cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 shrink-0';

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
export const PersonalHygieneTemplateEditor: React.FC = () => {
  const companyId = useHaccpCompany();
  const [cols, setCols] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newCol, setNewCol] = useState('');

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'personal_hygiene')), snap => {
      if (snap.exists()) {
        const data = snap.data().cols;
        if (Array.isArray(data) && data.length > 0) { setCols(data); return; }
      }
      setCols([...PERSONAL_HYGIENE_COLS]);
    });
  }, [companyId]);

  const handleSave = async () => {
    const valid = cols.filter(c => c.trim());
    if (valid.length === 0) { alert('항목을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDocument('haccp_templates', haccpTemplateDocId(companyId, 'personal_hygiene'), { cols: valid });
      setEditing(false);
    } finally { setSaving(false); }
  };

  const addCol = () => {
    const v = newCol.trim();
    if (!v) return;
    if (cols.includes(v)) { alert('이미 있는 항목입니다.'); return; }
    setCols(prev => [...prev, v]);
    setNewCol('');
  };

  const removeCol = (idx: number) => setCols(prev => prev.filter((_, i) => i !== idx));

  const moveCol = (idx: number, dir: -1 | 1) => {
    const next = [...cols];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setCols(next);
  };

  const updateCol = (idx: number, val: string) =>
    setCols(prev => prev.map((c, i) => i === idx ? val : c));

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => setCols(prev => arrayMove(prev, from, to))
  );

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-bold text-slate-700">개인위생 점검 항목 템플릿</span>
            <span className="ml-2 text-xs text-slate-400">{cols.length}개 열</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100"
          >
            <Wrench size={11} /> 항목 편집
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cols.map((col, idx) => (
            <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">{col}</span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-indigo-700">개인위생 항목 편집 중</span>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">취소</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
            <Save size={11} /> {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-500 mb-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        ⚠️ 항목 변경 시 오늘부터 새로 작성하는 점검표에 적용됩니다. 기존 저장 기록에는 영향 없습니다.
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {cols.map((col, idx) => (
          <div key={idx} {...rowProps(idx)} className={`flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}>
            <span {...handleProps(idx)} className={DRAG_HANDLE_CLASS}><GripVertical size={14} /></span>
            <span className="text-xs text-slate-400 w-5 text-center shrink-0">{idx + 1}</span>
            <input
              value={col}
              onChange={e => updateCol(idx, e.target.value)}
              className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <button onClick={() => moveCol(idx, -1)} disabled={idx === 0} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs">↑</button>
            <button onClick={() => moveCol(idx, 1)} disabled={idx === cols.length - 1} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs">↓</button>
            <button onClick={() => removeCol(idx)} className="p-1 text-rose-400 hover:text-rose-600"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={newCol}
          onChange={e => setNewCol(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCol()}
          placeholder="새 항목명 입력 후 추가"
          className="flex-1 border border-dashed border-indigo-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button onClick={addCol} className="flex items-center gap-1 px-3 py-2 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100">
          <Plus size={12} /> 추가
        </button>
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 온도관리 보관장소 템플릿 에디터 (관리자 전용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const TempZoneTemplateEditor: React.FC = () => {
  const companyId = useHaccpCompany();
  const [zones, setZones] = useState<StorageZone[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'temp_zones')), snap => {
      if (snap.exists()) {
        const data = snap.data().zones;
        if (Array.isArray(data) && data.length > 0) { setZones(data); return; }
      }
      setZones([...STORAGE_ZONES]);
    });
  }, [companyId]);

  const handleSave = async () => {
    const valid = zones.filter(z => z.name.trim());
    if (valid.length === 0) { alert('보관장소를 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDocument('haccp_templates', haccpTemplateDocId(companyId, 'temp_zones'), { zones: valid });
      setEditing(false);
    } finally { setSaving(false); }
  };

  const addZone = () => setZones(prev => [...prev, { name: '', standard: '' }]);
  const removeZone = (idx: number) => setZones(prev => prev.filter((_, i) => i !== idx));
  const updateZone = (idx: number, field: 'name' | 'standard', val: string) =>
    setZones(prev => prev.map((z, i) => i === idx ? { ...z, [field]: val } : z));
  const moveZone = (idx: number, dir: -1 | 1) => {
    const next = [...zones];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setZones(next);
  };

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => setZones(prev => arrayMove(prev, from, to))
  );

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-bold text-slate-700">보관장소 템플릿</span>
            <span className="ml-2 text-xs text-slate-400">{zones.length}개 장소</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100"
          >
            <Wrench size={11} /> 장소 편집
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {zones.map((z, idx) => (
            <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
              {z.name}
              {z.standard && <span className="text-slate-400 ml-1">({z.standard})</span>}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-indigo-700">보관장소 편집 중</span>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">취소</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
            <Save size={11} /> {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-500 mb-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        ⚠️ 변경 시 새로 추가하는 행에 적용됩니다. 기존 저장 기록에는 영향 없습니다.
      </div>

      <div className="flex flex-col gap-2 mb-3">
        <div className="grid grid-cols-12 gap-1 px-1 text-[10px] font-bold text-slate-400 uppercase">
          <div className="col-span-1 text-center">순서</div>
          <div className="col-span-4">보관장소명</div>
          <div className="col-span-5">관리기준(온도)</div>
          <div className="col-span-2 text-center">관리</div>
        </div>
        {zones.map((z, idx) => (
          <div key={idx} {...rowProps(idx)} className={`grid grid-cols-12 gap-1 items-center bg-slate-50 rounded-lg p-2 ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}>
            <div className="col-span-1 flex items-center justify-center gap-0.5 text-xs text-slate-400 font-bold">
              <span {...handleProps(idx)} className={DRAG_HANDLE_CLASS}><GripVertical size={12} /></span>
              {idx + 1}
            </div>
            <div className="col-span-4">
              <input
                value={z.name}
                onChange={e => updateZone(idx, 'name', e.target.value)}
                placeholder="보관장소명"
                className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-5">
              <input
                value={z.standard}
                onChange={e => updateZone(idx, 'standard', e.target.value)}
                placeholder="예: 0~10℃"
                className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-2 flex items-center justify-center gap-1">
              <button onClick={() => moveZone(idx, -1)} disabled={idx === 0} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs">↑</button>
              <button onClick={() => moveZone(idx, 1)} disabled={idx === zones.length - 1} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs">↓</button>
              <button onClick={() => removeZone(idx)} className="p-1 text-rose-400 hover:text-rose-600"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addZone}
        className="flex items-center gap-1 px-3 py-2 border border-dashed border-indigo-300 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-50 w-full justify-center"
      >
        <Plus size={12} /> 보관장소 추가
      </button>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 작업장 위생 템플릿 에디터 (관리자 전용 — HACCP 체크리스트 탭에서 사용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const SanitationTemplateEditor: React.FC = () => {
  const companyId = useHaccpCompany();
  const [items, setItems] = useState<{ item: string; standard: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'sanitation')), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) { setItems(data); return; }
      }
      setItems([...SANITATION_ITEMS]);
    });
  }, [companyId]);

  const handleSave = async () => {
    const validItems = items.filter(it => it.item.trim());
    if (validItems.length === 0) { alert('항목명을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDocument('haccp_templates', haccpTemplateDocId(companyId, 'sanitation'), { items: validItems });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Firestore snapshot이 최신 상태를 유지하므로 그냥 닫기
    setEditing(false);
  };

  const updateItem = (idx: number, field: 'item' | 'standard', val: string) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));

  const addItem = () => setItems(prev => [...prev, { item: '', standard: '' }]);

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const moveItem = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
  };

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => setItems(prev => arrayMove(prev, from, to))
  );

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-bold text-slate-700">작업장 위생 점검 항목 템플릿</span>
            <span className="ml-2 text-xs text-slate-400">{items.length}개 항목</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100"
          >
            <Wrench size={11} /> 항목 편집
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((it, idx) => (
            <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
              {idx + 1}. {it.item}
              {it.standard && <span className="text-slate-400 ml-1">({it.standard})</span>}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-indigo-700">점검 항목 편집 중</span>
        <div className="flex gap-2">
          <button onClick={handleCancel} className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save size={11} /> {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-500 mb-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        ⚠️ 항목 변경 시 오늘부터 새로 작성하는 점검표에 적용됩니다. 기존 저장 기록에는 영향 없습니다.
      </div>

      <div className="flex flex-col gap-2 mb-3">
        <div className="grid grid-cols-12 gap-1 px-1 text-[10px] font-bold text-slate-400 uppercase">
          <div className="col-span-1 text-center">순서</div>
          <div className="col-span-4">항목명</div>
          <div className="col-span-5">기준</div>
          <div className="col-span-2 text-center">관리</div>
        </div>
        {items.map((it, idx) => (
          <div key={idx} {...rowProps(idx)} className={`grid grid-cols-12 gap-1 items-center bg-slate-50 rounded-lg p-2 ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}>
            <div className="col-span-1 flex items-center justify-center gap-0.5 text-xs text-slate-400 font-bold">
              <span {...handleProps(idx)} className={DRAG_HANDLE_CLASS}><GripVertical size={12} /></span>
              {idx + 1}
            </div>
            <div className="col-span-4">
              <input
                value={it.item}
                onChange={e => updateItem(idx, 'item', e.target.value)}
                placeholder="항목명"
                className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-5">
              <input
                value={it.standard}
                onChange={e => updateItem(idx, 'standard', e.target.value)}
                placeholder="점검 기준"
                className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div className="col-span-2 flex items-center justify-center gap-1">
              <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs">↑</button>
              <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs">↓</button>
              <button onClick={() => removeItem(idx)} className="p-1 text-rose-400 hover:text-rose-600"><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addItem}
        className="flex items-center gap-1 px-3 py-2 border border-dashed border-indigo-300 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-50 w-full justify-center"
      >
        <Plus size={12} /> 항목 추가
      </button>
    </div>
  );
};

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
const WEEKLY_ITEMS_DEFAULT: { item: string; standard: string }[] = [
  { item: '주간 항목 1', standard: '기준' },
  { item: '주간 항목 2', standard: '기준' },
  { item: '주간 항목 3', standard: '기준' },
  { item: '주간 항목 4', standard: '기준' },
  { item: '주간 항목 5', standard: '기준' },
];

const MONTHLY_ITEMS_DEFAULT: { item: string; standard: string }[] = [
  { item: '월간 항목 1', standard: '기준' },
  { item: '월간 항목 2', standard: '기준' },
  { item: '월간 항목 3', standard: '기준' },
  { item: '월간 항목 4', standard: '기준' },
  { item: '월간 항목 5', standard: '기준' },
];

type PeriodCycle = 'weekly' | 'monthly';

interface PeriodRow {
  result: 'pass' | 'fail' | '';
  note: string;
  inspector: string;
}

interface PeriodRecord {
  id?: string;
  cycle: PeriodCycle;
  period: string;
  checkZone: string;
  rows: PeriodRow[];
  specialNotes: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

const currentWeekStr = () => {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const weekNum = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
};

const emptyPeriodRecord = (cycle: PeriodCycle, period: string, items: { item: string; standard: string }[]): Omit<PeriodRecord, 'id'> => ({
  cycle, period,
  checkZone: '',
  rows: items.map(() => ({ result: '', note: '', inspector: '' })),
  specialNotes: '',
  createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
});

const PeriodicSanitationTemplateEditor: React.FC<{ cycle: PeriodCycle }> = ({ cycle }) => {
  const companyId = useHaccpCompany();
  const templateKey = cycle === 'weekly' ? 'weekly_sanitation' : 'monthly_sanitation';
  const defaultItems = cycle === 'weekly' ? WEEKLY_ITEMS_DEFAULT : MONTHLY_ITEMS_DEFAULT;
  const [items, setItems] = useState<{ item: string; standard: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, templateKey)), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) { setItems(data); return; }
      }
      setItems([...defaultItems]);
    });
  }, [companyId, templateKey, defaultItems]);

  const handleSave = async () => {
    const validItems = items.filter(it => it.item.trim());
    if (validItems.length === 0) { alert('항목명을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDocument('haccp_templates', haccpTemplateDocId(companyId, templateKey), { items: validItems });
      setEditing(false);
    } finally { setSaving(false); }
  };

  const updateItem = (idx: number, field: 'item' | 'standard', val: string) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const addItem = () => setItems(prev => [...prev, { item: '', standard: '' }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const moveItem = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
  };

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => setItems(prev => arrayMove(prev, from, to))
  );

  const cycleName = cycle === 'weekly' ? '주간' : '월간';

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-bold text-slate-700">{cycleName} 위생 점검 항목 템플릿</span>
            <span className="ml-2 text-xs text-slate-400">{items.length}개 항목</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100"
          >
            <Wrench size={11} /> 항목 편집
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((it, idx) => (
            <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
              {idx + 1}. {it.item}
              {it.standard && <span className="text-slate-400 ml-1">({it.standard})</span>}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-700">{cycleName} 점검 항목 편집</span>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">취소</button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 mb-3">
        {items.map((it, idx) => (
          <div key={idx} {...rowProps(idx)} className={`flex items-center gap-2 rounded ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}>
            <span {...handleProps(idx)} className={DRAG_HANDLE_CLASS}><GripVertical size={13} /></span>
            <span className="text-xs text-slate-400 w-5 text-right">{idx + 1}</span>
            <input value={it.item} onChange={e => updateItem(idx, 'item', e.target.value)} placeholder="점검항목" className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs" />
            <input value={it.standard} onChange={e => updateItem(idx, 'standard', e.target.value)} placeholder="기준" className="w-36 border border-slate-300 rounded px-2 py-1 text-xs" />
            <button onClick={() => moveItem(idx, -1)} className="text-slate-400 hover:text-slate-700 text-xs px-1">↑</button>
            <button onClick={() => moveItem(idx, 1)} className="text-slate-400 hover:text-slate-700 text-xs px-1">↓</button>
            <button onClick={() => removeItem(idx)} className="text-rose-400 hover:text-rose-600 text-xs px-1"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <button onClick={addItem} className="flex items-center gap-1 px-3 py-2 border border-dashed border-indigo-300 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-50 w-full justify-center">
        <Plus size={12} /> 항목 추가
      </button>
    </div>
  );
};

/** 늦은 조회와 저장 응답이 사용자가 쓰는 초안 또는 다른 기간을 덮지 않게 한다. */
function useChecklistDraftControl() {
  const active = useRef(false), generation = useRef(0), busy = useRef(false), dirty = useRef(false), changing = useRef(false);
  React.useLayoutEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const current = (token: number) => active.current && generation.current === token;
  const change = async (action: () => void) => {
    if (busy.current || changing.current) return;
    changing.current = true;
    const token = generation.current;
    try {
      if (dirty.current && !await appConfirm('작성 중인 초안을 버리고 선택한 기록을 여시겠습니까?')) return;
      if (!current(token) || busy.current) return;
      dirty.current = false; generation.current++; action();
    } finally { changing.current = false; }
  };
  return { active, generation, busy, dirty, current, change };
}

const PeriodicSanitationForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const [cycle, setCycle] = useState<PeriodCycle>('weekly');
  const [weekPeriod, setWeekPeriod] = useState(currentWeekStr());
  const [monthPeriod, setMonthPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [weekItems, setWeekItems] = useState<{ item: string; standard: string }[]>(WEEKLY_ITEMS_DEFAULT);
  const [monthItems, setMonthItems] = useState<{ item: string; standard: string }[]>(MONTHLY_ITEMS_DEFAULT);
  const [records, setRecords] = useState<PeriodRecord[]>([]);
  const [selected, setSelected] = useState<PeriodRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const printRef = useRef<HTMLDivElement>(null);
  const control = useChecklistDraftControl();
  const [recordsReady, setRecordsReady] = useState(false), [recordsError, setRecordsError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  const readRef = useRef({ ready: false, blocked: false, rows: [] as PeriodRecord[] });

  const period = cycle === 'weekly' ? weekPeriod : monthPeriod;
  const items = cycle === 'weekly' ? weekItems : monthItems;
  const cycleName = cycle === 'weekly' ? '주간' : '월간';

  useEffect(() => {
    let active = true, serverConfirmed = false;
    readRef.current.ready = false; readRef.current.blocked = false; setRecordsReady(false); setRecordsError('');
    const q = query(collection(db, 'haccp_periodic_sanitation'), where('companyId', '==', companyId));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      if (!active || !control.active.current) return;
      const rows = snap.docs.map(d => ({ ...d.data(), id: d.id } as PeriodRecord)).filter(row => typeof row.period === 'string').sort((a, b) => b.period.localeCompare(a.period));
      if (snap.metadata?.fromCache === false) serverConfirmed = true;
      const ready = serverConfirmed && !readRef.current.blocked;
      readRef.current = { ready, blocked: readRef.current.blocked, rows }; setRecords(rows); setRecordsReady(ready); if (ready) setRecordsError('');
    }, () => {
      if (!active || !control.active.current) return;
      active = false; serverConfirmed = false; readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false);
      setRecordsError('기존 기록을 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 저장해 주세요.');
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId, readAttempt]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'weekly_sanitation')), snap => {
      if (!active) return;
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setWeekItems(data);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'monthly_sanitation')), snap => {
      if (!active) return;
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setMonthItems(data);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId]);

  const currentRecord = records.find(r => r.cycle === cycle && r.period === period);

  useEffect(() => {
    control.generation.current++; control.dirty.current = false;
    const existing = readRef.current.ready ? readRef.current.rows.find(r => r.cycle === cycle && r.period === period) : undefined;
    setSelected(existing ?? ({ ...emptyPeriodRecord(cycle, period, items) } as PeriodRecord)); setSaveError('');
  }, [cycle, period]);
  useEffect(() => {
    const existing = records.find(r => r.cycle === cycle && r.period === period);
    if (readRef.current.ready && existing && !selected?.id && !control.dirty.current && !control.busy.current) setSelected(existing);
  }, [records, recordsReady, cycle, period, selected?.id]);

  const openHistory = (r: PeriodRecord) => { void control.change(() => {
    setCycle(r.cycle); if (r.cycle === 'weekly') setWeekPeriod(r.period); else setMonthPeriod(r.period);
    setSelected(r); setSaveError(''); setShowHistory(false);
  }); };

  // 실제 이번 주/이번 달만 작성 가능
  const actualCurrentPeriod = cycle === 'weekly' ? currentWeekStr() : new Date().toISOString().slice(0, 7);
  const isReadOnly = period !== actualCurrentPeriod;

  const editSelected = (update: React.SetStateAction<PeriodRecord | null>) => {
    if (isReadOnly || control.busy.current) return;
    control.dirty.current = true; setSelected(update);
  };
  // 템플릿 항목이 추가돼 rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: PeriodRow[]): PeriodRow[] =>
    rows.length >= items.length
      ? rows
      : [...rows, ...items.slice(rows.length).map((): PeriodRow => ({ result: '', note: '', inspector: '' }))];

  const toggleResult = (idx: number, val: 'pass' | 'fail') => {
    if (isReadOnly) return;
    const userName = currentUser?.name ?? '';
    editSelected(prev => {
      if (!prev) return prev;
      const rows = padRows(prev.rows);
      const row = rows[idx];
      const newResult = row.result === val ? '' : val;
      return {
        ...prev,
        rows: rows.map((r, i) => i === idx ? { ...r, result: newResult, inspector: r.inspector || (newResult ? userName : '') } : r),
      };
    });
  };

  const setRow = (idx: number, field: keyof PeriodRow, val: string) => {
    if (isReadOnly) return;
    editSelected(prev => prev ? { ...prev, rows: padRows(prev.rows).map((r, i) => i === idx ? { ...r, [field]: val } : r) } : prev);
  };

  const handleSave = async () => {
    if (!selected || isReadOnly || control.busy.current) return;
    if (!readRef.current.ready) { setSaveError('기존 기록 조회가 끝나야 저장할 수 있습니다. 입력을 유지한 채 다시 조회해 주세요.'); return; }
    if (!selected.id && readRef.current.rows.some(r => r.cycle === cycle && r.period === period)) { setSaveError('같은 기간에 저장된 기록이 있습니다. 저장된 기록을 열어 확인해 주세요.'); return; }
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (items[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) { setSaveError(`부적합 항목의 비고사항을 입력해주세요: ${missingNote.join(', ')}`); return; }
    setSaveError('');
    control.busy.current = true; const token = control.generation.current;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data: Omit<PeriodRecord, 'id'> = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now };
        const id = await addItem('haccp_periodic_sanitation', data);
        if (!control.current(token)) return;
        control.dirty.current = false; setSelected({ ...data, id });
      } else {
        const update = { ...selected, updatedBy: userName, updatedAt: now };
        await updateItem('haccp_periodic_sanitation', selected.id, update as any);
        if (!control.current(token)) return;
        control.dirty.current = false; setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('저장 결과를 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 기존 기록을 확인해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setSaving(false); } }
  };

  const handleConfirm = async () => {
    if (!canConfirm || control.busy.current || !readRef.current.ready) return;
    if (!selected?.id) { alert('점검표를 먼저 저장해주세요.'); return; }
    control.busy.current = true; const token = control.generation.current;
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateItem('haccp_periodic_sanitation', selected.id, update);
      if (!control.current(token)) return;
      const confirmed = { ...selected, ...update };
      setSelected(confirmed);
      if (await appConfirm('확인 처리되었습니다.\nPDF 파일을 만들겠습니까?')) {
        if (control.current(token) && printRef.current) await downloadAsPDF(printRef.current, `작업장위생점검표_${cycleName}_${selected.period}.pdf`);
      }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('확인 처리 결과를 확인하지 못했습니다. 입력을 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setConfirming(false); } }
  };

  const handleDelete = async (id: string) => {
    if (control.busy.current || !control.active.current) return;
    control.busy.current = true; const token = control.generation.current; setDeleting(true);
    try {
      if (!await appConfirm('이 점검표를 삭제하시겠습니까?')) return;
      if (!control.current(token)) return;
      await deleteItem('haccp_periodic_sanitation', id);
      if (control.current(token) && selected?.id === id) { control.dirty.current = false; setSelected(null); }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('삭제 결과를 확인하지 못했습니다. 초안은 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setDeleting(false); } }
  };

  const resultBadge = (result: PeriodRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  const pastRecords = records.filter(r => r.cycle === cycle && !(r.cycle === cycle && r.period === period));

  return (
    <fieldset disabled={saving || confirming || deleting} className="flex min-w-0 flex-col gap-4 border-0 p-0 m-0">
      {!recordsReady && !recordsError && <p role="status" className="text-xs text-slate-600">기존 기록을 조회 중입니다. 입력할 수 있으며 조회가 끝난 뒤 저장할 수 있습니다.</p>}
      {recordsError && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>{recordsError}</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={() => { readRef.current.ready = false; setRecordsReady(false); setReadAttempt(value => value + 1); }}>다시 조회</button></div>}
      {recordsReady && selected && !selected.id && currentRecord && control.dirty.current && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>작성 중 같은 기간의 저장된 기록이 확인되었습니다. 초안은 유지했으며 중복 저장은 막았습니다.</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={() => { void control.change(() => { const existing = readRef.current.rows.find(r => r.cycle === cycle && r.period === period); if (existing) { setSelected(existing); setSaveError(''); } }); }}>저장된 기록 열기</button></div>}
      {/* 주간/월간 서브 탭 + 기간 선택 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex gap-2 mb-4">
          {(['weekly', 'monthly'] as PeriodCycle[]).map(c => (
            <button
              key={c}
              onClick={() => { if (c !== cycle) void control.change(() => { setCycle(c); setSaveError(''); }); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                cycle === c ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c === 'weekly' ? '주간 점검표' : '월간 점검표'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{cycleName} 기간:</span>
          {cycle === 'weekly' ? (
            <input type="week" value={weekPeriod} onChange={e => { const value = e.target.value; if (value !== weekPeriod) void control.change(() => setWeekPeriod(value)); }} className="border border-slate-300 rounded px-2 py-1 text-xs" />
          ) : (
            <input type="month" value={monthPeriod} onChange={e => { const value = e.target.value; if (value !== monthPeriod) void control.change(() => setMonthPeriod(value)); }} className="border border-slate-300 rounded px-2 py-1 text-xs" />
          )}
          {currentRecord && (
            <span className="text-xs text-emerald-600 font-bold">✓ 저장된 기록</span>
          )}
        </div>
      </div>

      {/* 이전 기록 */}
      <button
        onClick={() => setShowHistory(v => !v)}
        className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <span>{cycleName} 이전 점검 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {pastRecords.map(r => (
            <button
              key={r.id}
              onClick={() => openHistory(r)}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 border rounded-lg text-xs font-medium transition-colors ${
                selected?.id === r.id ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="font-bold">{r.period}</span>
              <span className="text-slate-400">{r.confirmedBy ? `✓ ${r.confirmedBy}` : '미확인'}</span>
              {isAdmin && r.id && (
                <span
                  onClick={e => { e.stopPropagation(); handleDelete(r.id!); }}
                  className="mt-1 text-rose-400 hover:text-rose-600 text-xs cursor-pointer"
                >
                  삭제
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 점검표 폼 */}
      {selected && <div className="flex flex-col gap-3">
          {/* 액션 바 — 상단 고정 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${
              isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${selected.id ? '수정' : '신규'}`}
            </span>
            <span className="text-xs text-slate-500">{cycleName} · {selected.period}</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button
                onClick={() => printRef.current && downloadAsPDF(printRef.current, `작업장위생점검표_${cycleName}_${selected.period}.pdf`)}
                className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700"
              >
                <FileDown size={12} /> PDF
              </button>
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold">
                      <BadgeCheck size={13} /> {selected.confirmedBy} 확인완료
                    </span>
                  : <button
                      onClick={handleConfirm}
                      disabled={confirming || !selected.id}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40"
                    >
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving || !recordsReady || !!recordsError || (!selected.id && !!currentRecord)}
                  className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {saveError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-3 py-2">
              ⚠️ {saveError}
            </div>
          )}

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">HACCP 작업장 위생점검표 ({cycleName})</h2>

            {/* 헤더 정보 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
              {[
                { label: '회사명',   value: '태백식품' },
                { label: '문서번호', value: 'HACCP-PRP-001' },
                { label: '작성자',   value: selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '-') },
                { label: '개정번호', value: selected.id ? '최신' : '미저장' },
                { label: '점검주기', value: cycleName },
                { label: '점검기간', value: selected.period },
              ].map(f => (
                <div key={f.label} className="bg-white">
                  <div className="bg-slate-100 px-2 py-1 font-bold text-slate-600 border-b border-slate-300">{f.label}</div>
                  <div className="px-2 py-1.5 text-slate-800">{f.value}</div>
                </div>
              ))}
              <div className="bg-white col-span-2">
                <div className="bg-slate-100 px-2 py-1 font-bold text-slate-600 border-b border-slate-300">점검구역</div>
                <div className="px-1 py-1">
                  {isReadOnly
                    ? <div className="px-1 py-0.5 text-slate-800">{selected.checkZone || '-'}</div>
                    : <input value={selected.checkZone ?? ''} onChange={e => editSelected(p => p ? { ...p, checkZone: e.target.value } : p)}
                        placeholder="구역 입력" className="w-full text-xs outline-none bg-transparent" />
                  }
                </div>
              </div>
            </div>

            <div className="text-xs font-bold mb-2">■ 작업장 위생 점검 항목</div>

            {/* 모바일 카드 */}
            <div className="flex flex-col gap-1.5 md:hidden">
              {items.map((item, idx) => {
                const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
                const needNote = row.result === 'fail' && !row.note?.trim();
                return (
                  <div key={idx} className={`border rounded-lg text-xs ${
                    row.result === 'pass' ? 'border-emerald-200 bg-emerald-50' :
                    row.result === 'fail' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'
                  }`}>
                    <div className="flex items-start gap-2 p-2.5">
                      <span className="text-slate-400 font-bold shrink-0 pt-0.5">{idx + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 leading-snug">{item.item}</div>
                        <div className="text-slate-400 text-[11px] mt-0.5 leading-snug">{item.standard}</div>
                      </div>
                      {isReadOnly
                        ? <div className="shrink-0">{resultBadge(row.result)}</div>
                        : <div className="flex gap-1 shrink-0">
                            <button onClick={() => toggleResult(idx, 'pass')} className={`w-10 h-9 rounded font-bold border text-sm transition-colors ${
                              row.result === 'pass' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-emerald-600 border-emerald-300'
                            }`}>O</button>
                            <button onClick={() => toggleResult(idx, 'fail')} className={`w-10 h-9 rounded font-bold border text-sm transition-colors ${
                              row.result === 'fail' ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-rose-600 border-rose-300'
                            }`}>X</button>
                          </div>
                      }
                    </div>
                    {(row.result === 'fail' || (isReadOnly && row.note)) && (
                      <div className="px-2.5 pb-2.5">
                        <div className="border-t border-slate-200 pt-2">
                          {isReadOnly
                            ? <div className="text-slate-700">{row.note || '-'}</div>
                            : <input value={row.note} onChange={e => setRow(idx, 'note', e.target.value)}
                                placeholder="조치 내용 필수 입력"
                                className={`w-full border rounded px-2 py-1.5 text-xs bg-white ${needNote ? 'border-rose-400' : 'border-slate-200'}`} />
                          }
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 데스크탑 테이블 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse text-xs mb-4">
                <thead>
                  <tr>
                    <th className={TH} style={{ width: 28 }}>번호</th>
                    <th className={TH}>점검항목</th>
                    <th className={TH} style={{ width: 140 }}>기준</th>
                    <th className={TH} style={{ width: 28 }}>O</th>
                    <th className={TH} style={{ width: 28 }}>X</th>
                    <th className={TH} style={{ width: 70 }}>결과</th>
                    <th className={TH} style={{ width: 80 }}>작성자</th>
                    <th className={TH} style={{ width: 110 }}>비고(개선조치)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
                    return (
                      <tr key={idx} className={row.result === 'fail' ? 'bg-rose-50' : ''}>
                        <td className={TD}>{idx + 1}</td>
                        <td className={TDL}>{item.item}</td>
                        <td className={TD}>{item.standard}</td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'pass'} onChange={() => toggleResult(idx, 'pass')} disabled={isReadOnly} />
                        </td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'fail'} onChange={() => toggleResult(idx, 'fail')} disabled={isReadOnly} />
                        </td>
                        <td className={TD}>{resultBadge(row.result)}</td>
                        <td className={TD}>
                          {row.inspector
                            ? <span className="inline-flex px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">{row.inspector}</span>
                            : <span className="text-slate-300 text-xs">-</span>
                          }
                        </td>
                        <td className={TDL}>
                          <input
                            value={row.note}
                            onChange={e => setRow(idx, 'note', e.target.value)}
                            disabled={isReadOnly}
                            className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60"
                            placeholder={row.result === 'fail' ? '조치 내용 필수' : ''}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mb-4">
              <div className="text-xs font-bold text-slate-700 mb-1">특이사항</div>
              <textarea
                value={selected.specialNotes}
                onChange={e => !isReadOnly && editSelected(prev => prev ? { ...prev, specialNotes: e.target.value } : prev)}
                disabled={isReadOnly}
                rows={2}
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs disabled:opacity-60 resize-none"
                placeholder="특이사항을 입력하세요"
              />
            </div>

            {/* 서명란 — 확인자 없이, 관리자는 확인 시에만 표시 */}
            <div className="flex gap-2 mt-3 justify-end">
              <div className="border border-slate-400 text-center w-24">
                <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">작성자</div>
                <div className="h-8 flex items-center justify-center text-xs text-slate-700">
                  {selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '')}
                </div>
              </div>
              <div className="border border-slate-400 text-center w-24">
                <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">관리자</div>
                <div className="h-8 flex items-center justify-center text-xs text-slate-700">
                  {selected.confirmedBy
                    ? <span className="text-emerald-700 font-bold">{selected.confirmedBy}</span>
                    : <span className="text-slate-300">-</span>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    </fieldset>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. 마감 체크리스트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CLOSING_ITEMS_DEFAULT: { item: string; standard: string }[] = [
  { item: '마감 항목 1', standard: '기준' },
  { item: '마감 항목 2', standard: '기준' },
  { item: '마감 항목 3', standard: '기준' },
  { item: '마감 항목 4', standard: '기준' },
  { item: '마감 항목 5', standard: '기준' },
];

interface ClosingRecord {
  id?: string;
  checkDate: string;
  checkZone: string;
  rows: PeriodRow[];
  specialNotes: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

const emptyClosingRecord = (date: string, items: { item: string; standard: string }[]): Omit<ClosingRecord, 'id'> => ({
  checkDate: date,
  checkZone: '',
  rows: items.map(() => ({ result: '', note: '', inspector: '' })),
  specialNotes: '',
  createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
});

const ClosingChecklistTemplateEditor: React.FC = () => {
  const companyId = useHaccpCompany();
  const [items, setItems] = useState<{ item: string; standard: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'closing_checklist')), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) { setItems(data); return; }
      }
      setItems([...CLOSING_ITEMS_DEFAULT]);
    });
  }, [companyId]);

  const handleSave = async () => {
    const validItems = items.filter(it => it.item.trim());
    if (validItems.length === 0) { alert('항목명을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDocument('haccp_templates', haccpTemplateDocId(companyId, 'closing_checklist'), { items: validItems });
      setEditing(false);
    } finally { setSaving(false); }
  };

  const updateItem = (idx: number, field: 'item' | 'standard', val: string) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const addItem = () => setItems(prev => [...prev, { item: '', standard: '' }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const moveItem = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
  };

  const { dragIdx, handleProps, rowProps } = useDragReorder(
    (from, to) => setItems(prev => arrayMove(prev, from, to))
  );

  if (!editing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-bold text-slate-700">마감 체크리스트 항목 템플릿</span>
            <span className="ml-2 text-xs text-slate-400">{items.length}개 항목</span>
          </div>
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-xs font-bold hover:bg-indigo-100">
            <Wrench size={11} /> 항목 편집
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((it, idx) => (
            <span key={idx} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
              {idx + 1}. {it.item}
              {it.standard && <span className="text-slate-400 ml-1">({it.standard})</span>}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-slate-700">마감 체크리스트 항목 편집</span>
        <div className="flex gap-2">
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">취소</button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 mb-3">
        {items.map((it, idx) => (
          <div key={idx} {...rowProps(idx)} className={`flex items-center gap-2 rounded ${dragIdx === idx ? 'opacity-60 ring-1 ring-indigo-400' : ''}`}>
            <span {...handleProps(idx)} className={DRAG_HANDLE_CLASS}><GripVertical size={13} /></span>
            <span className="text-xs text-slate-400 w-5 text-right">{idx + 1}</span>
            <input value={it.item} onChange={e => updateItem(idx, 'item', e.target.value)} placeholder="점검항목" className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs" />
            <input value={it.standard} onChange={e => updateItem(idx, 'standard', e.target.value)} placeholder="기준" className="w-36 border border-slate-300 rounded px-2 py-1 text-xs" />
            <button onClick={() => moveItem(idx, -1)} className="text-slate-400 hover:text-slate-700 text-xs px-1">↑</button>
            <button onClick={() => moveItem(idx, 1)} className="text-slate-400 hover:text-slate-700 text-xs px-1">↓</button>
            <button onClick={() => removeItem(idx)} className="text-rose-400 hover:text-rose-600 text-xs px-1"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <button onClick={addItem} className="flex items-center gap-1 px-3 py-2 border border-dashed border-indigo-300 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-50 w-full justify-center">
        <Plus size={12} /> 항목 추가
      </button>
    </div>
  );
};

const ClosingChecklistForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const companyId = useHaccpCompany();
  const [checkDate, setCheckDate] = useState(todayStr());
  const [templateItems, setTemplateItems] = useState<{ item: string; standard: string }[]>(CLOSING_ITEMS_DEFAULT);
  const [records, setRecords] = useState<ClosingRecord[]>([]);
  const [selected, setSelected] = useState<ClosingRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const printRef = useRef<HTMLDivElement>(null);
  const control = useChecklistDraftControl();
  const [recordsReady, setRecordsReady] = useState(false), [recordsError, setRecordsError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  const readRef = useRef({ ready: false, blocked: false, rows: [] as ClosingRecord[] });

  useEffect(() => {
    let active = true, serverConfirmed = false;
    readRef.current.ready = false; readRef.current.blocked = false; setRecordsReady(false); setRecordsError('');
    const q = query(collection(db, 'haccp_closing_checklist'), where('companyId', '==', companyId));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      if (!active || !control.active.current) return;
      const rows = snap.docs.map(d => ({ ...d.data(), id: d.id } as ClosingRecord)).filter(row => typeof row.checkDate === 'string').sort((a, b) => b.checkDate.localeCompare(a.checkDate));
      if (snap.metadata?.fromCache === false) serverConfirmed = true;
      const ready = serverConfirmed && !readRef.current.blocked;
      readRef.current = { ready, blocked: readRef.current.blocked, rows }; setRecords(rows); setRecordsReady(ready); if (ready) setRecordsError('');
    }, () => {
      if (!active || !control.active.current) return;
      active = false; serverConfirmed = false; readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false);
      setRecordsError('기존 기록을 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 저장해 주세요.');
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId, readAttempt]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(companyId, 'closing_checklist')), snap => {
      if (!active) return;
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setTemplateItems(data);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [companyId]);

  useEffect(() => {
    control.generation.current++; control.dirty.current = false;
    const existing = readRef.current.ready ? readRef.current.rows.find(r => r.checkDate === checkDate) : undefined;
    setSelected(existing ?? ({ ...emptyClosingRecord(checkDate, templateItems) } as ClosingRecord)); setSaveError('');
  }, [checkDate]);
  useEffect(() => {
    const existing = records.find(r => r.checkDate === checkDate);
    if (readRef.current.ready && existing && !selected?.id && !control.dirty.current && !control.busy.current) setSelected(existing);
  }, [records, recordsReady, checkDate, selected?.id]);

  const isReadOnly = checkDate !== todayStr();

  const editSelected = (update: React.SetStateAction<ClosingRecord | null>) => {
    if (isReadOnly || control.busy.current) return;
    control.dirty.current = true; setSelected(update);
  };
  // 템플릿 항목이 추가돼(예: 6·7번) rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: PeriodRow[]): PeriodRow[] =>
    rows.length >= templateItems.length
      ? rows
      : [...rows, ...templateItems.slice(rows.length).map((): PeriodRow => ({ result: '', note: '', inspector: '' }))];

  const toggleResult = (idx: number, val: 'pass' | 'fail') => {
    if (isReadOnly) return;
    const userName = currentUser?.name ?? '';
    editSelected(prev => {
      if (!prev) return prev;
      const rows = padRows(prev.rows);
      const row = rows[idx];
      const newResult = row.result === val ? '' : val;
      return {
        ...prev,
        rows: rows.map((r, i) => i === idx ? { ...r, result: newResult, inspector: r.inspector || (newResult ? userName : '') } : r),
      };
    });
  };

  const setRow = (idx: number, field: keyof PeriodRow, val: string) => {
    if (isReadOnly) return;
    editSelected(prev => prev ? { ...prev, rows: padRows(prev.rows).map((r, i) => i === idx ? { ...r, [field]: val } : r) } : prev);
  };

  const handleSave = async () => {
    if (!selected || isReadOnly || control.busy.current) return;
    if (!readRef.current.ready) { setSaveError('기존 기록 조회가 끝나야 저장할 수 있습니다. 입력을 유지한 채 다시 조회해 주세요.'); return; }
    if (!selected.id && readRef.current.rows.some(r => r.checkDate === checkDate)) { setSaveError('같은 기간에 저장된 기록이 있습니다. 저장된 기록을 열어 확인해 주세요.'); return; }
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (templateItems[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) { setSaveError(`부적합 항목의 비고사항을 입력해주세요: ${missingNote.join(', ')}`); return; }
    setSaveError('');
    control.busy.current = true; const token = control.generation.current;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data: Omit<ClosingRecord, 'id'> = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now };
        const id = await addItem('haccp_closing_checklist', data);
        if (!control.current(token)) return;
        control.dirty.current = false; setSelected({ ...data, id });
      } else {
        const update = { ...selected, updatedBy: userName, updatedAt: now };
        await updateItem('haccp_closing_checklist', selected.id, update as any);
        if (!control.current(token)) return;
        control.dirty.current = false; setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('저장 결과를 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회한 뒤 기존 기록을 확인해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setSaving(false); } }
  };

  const handleConfirm = async () => {
    if (!canConfirm || control.busy.current || !readRef.current.ready) return;
    if (!selected?.id) { alert('점검표를 먼저 저장해주세요.'); return; }
    control.busy.current = true; const token = control.generation.current;
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateItem('haccp_closing_checklist', selected.id, update);
      if (!control.current(token)) return;
      const confirmed = { ...selected, ...update };
      setSelected(confirmed);
      if (await appConfirm('확인 처리되었습니다.\nPDF 파일을 만들겠습니까?')) {
        if (control.current(token) && printRef.current) await downloadAsPDF(printRef.current, `마감체크리스트_${selected.checkDate}.pdf`);
      }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('확인 처리 결과를 확인하지 못했습니다. 입력을 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setConfirming(false); } }
  };

  const handleDelete = async (id: string) => {
    if (control.busy.current || !control.active.current) return;
    control.busy.current = true; const token = control.generation.current; setDeleting(true);
    try {
      if (!await appConfirm('이 점검표를 삭제하시겠습니까?')) return;
      if (!control.current(token)) return;
      await deleteItem('haccp_closing_checklist', id);
      if (control.current(token) && selected?.id === id) { control.dirty.current = false; setSelected(null); }
    } catch { if (control.current(token)) { readRef.current.ready = false; readRef.current.blocked = true; setRecordsReady(false); setRecordsError('삭제 결과를 확인하지 못했습니다. 초안은 유지했습니다. 다시 조회해 주세요.'); }
    } finally { if (control.current(token)) { control.busy.current = false; setDeleting(false); } }
  };

  const resultBadge = (result: PeriodRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  const pastRecords = records.filter(r => r.checkDate !== todayStr());
  const currentRecord = records.find(r => r.checkDate === checkDate);

  return (
    <fieldset disabled={saving || confirming || deleting} className="flex min-w-0 flex-col gap-4 border-0 p-0 m-0">
      {!recordsReady && !recordsError && <p role="status" className="text-xs text-slate-600">기존 기록을 조회 중입니다. 입력할 수 있으며 조회가 끝난 뒤 저장할 수 있습니다.</p>}
      {recordsError && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>{recordsError}</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={() => { readRef.current.ready = false; setRecordsReady(false); setReadAttempt(value => value + 1); }}>다시 조회</button></div>}
      {recordsReady && selected && !selected.id && currentRecord && control.dirty.current && <div role="alert" className="border border-slate-200 bg-white rounded px-3 py-2 text-xs"><p>작성 중 같은 기간의 저장된 기록이 확인되었습니다. 초안은 유지했으며 중복 저장은 막았습니다.</p><button className="mt-2 rounded border border-slate-300 px-3 py-1.5 font-medium text-slate-700" type="button" onClick={() => { void control.change(() => { const existing = readRef.current.rows.find(r => r.checkDate === checkDate); if (existing) { setSelected(existing); setSaveError(''); } }); }}>저장된 기록 열기</button></div>}
      {/* 날짜 선택 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">점검일자:</span>
          <input type="date" value={checkDate} onChange={e => { const value = e.target.value; if (value !== checkDate) void control.change(() => setCheckDate(value)); }} className="border border-slate-300 rounded px-2 py-1 text-xs" />
          {currentRecord && <span className="text-xs text-emerald-600 font-bold">✓ 저장된 기록</span>}
          {isReadOnly && <span className="text-xs text-amber-600 font-medium">📋 오늘({todayStr()})만 작성 가능</span>}
        </div>
      </div>

      {/* 이전 기록 */}
      <button onClick={() => setShowHistory(v => !v)} className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
        <span>이전 마감 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {pastRecords.map(r => (
            <button key={r.id} onClick={() => { void control.change(() => { setCheckDate(r.checkDate); setShowHistory(false); }); }}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 border rounded-lg text-xs font-medium transition-colors ${
                checkDate === r.checkDate ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="font-bold">{r.checkDate}</span>
              <span className="text-slate-400">{r.confirmedBy ? `✓ ${r.confirmedBy}` : '미확인'}</span>
              {isAdmin && r.id && (
                <span onClick={e => { e.stopPropagation(); handleDelete(r.id!); }} className="mt-1 text-rose-400 hover:text-rose-600 text-xs cursor-pointer">삭제</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 폼 */}
      {selected && <div className="flex flex-col gap-3">
        {/* 액션 바 */}
        <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
          <span className={`text-xs font-bold px-2 py-1 rounded border ${
            isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${selected.id ? '수정' : '신규'}`}
          </span>
          <span className="text-xs text-slate-500">마감 체크리스트 · {selected.checkDate}</span>
          <div className="ml-auto flex gap-2 flex-wrap justify-end">
            <button onClick={() => printRef.current && downloadAsPDF(printRef.current, `마감체크리스트_${selected.checkDate}.pdf`)}
              className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700">
              <FileDown size={12} /> PDF
            </button>
            {canConfirm && (
              selected.confirmedBy
                ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold">
                    <BadgeCheck size={13} /> {selected.confirmedBy} 확인완료
                  </span>
                : <button onClick={handleConfirm} disabled={confirming || !selected.id}
                    className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40">
                    <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : '관리자 확인'}
                  </button>
            )}
            {!isReadOnly && (
              <button onClick={handleSave} disabled={saving || !recordsReady || !!recordsError || (!selected.id && !!currentRecord)}
                className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                <Save size={12} /> {saving ? '저장 중...' : '저장'}
              </button>
            )}
          </div>
        </div>

        {saveError && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-3 py-2">⚠️ {saveError}</div>}

        {/* 인쇄 영역 */}
        <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
          <h2 className="text-base md:text-lg font-black text-center mb-4">마감 체크리스트</h2>

          {/* 헤더 정보 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
            {[
              { label: '회사명',   value: '태백식품' },
              { label: '문서번호', value: 'HACCP-PRP-003' },
              { label: '작성자',   value: selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '-') },
              { label: '개정번호', value: selected.id ? '최신' : '미저장' },
              { label: '점검일자', value: selected.checkDate },
            ].map(f => (
              <div key={f.label} className="bg-white">
                <div className="bg-slate-100 px-2 py-1 font-bold text-slate-600 border-b border-slate-300">{f.label}</div>
                <div className="px-2 py-1.5 text-slate-800">{f.value}</div>
              </div>
            ))}
            <div className="bg-white col-span-3">
              <div className="bg-slate-100 px-2 py-1 font-bold text-slate-600 border-b border-slate-300">점검구역</div>
              <div className="px-1 py-1">
                {isReadOnly
                  ? <div className="px-1 py-0.5 text-slate-800">{selected.checkZone || '-'}</div>
                  : <input value={selected.checkZone ?? ''} onChange={e => editSelected(p => p ? { ...p, checkZone: e.target.value } : p)}
                      placeholder="구역 입력" className="w-full text-xs outline-none bg-transparent" />
                }
              </div>
            </div>
          </div>

          <div className="text-xs font-bold mb-2">■ 마감 점검 항목</div>

          {/* 모바일 카드 */}
          <div className="flex flex-col gap-1.5 md:hidden">
            {templateItems.map((item, idx) => {
              const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
              const needNote = row.result === 'fail' && !row.note?.trim();
              return (
                <div key={idx} className={`border rounded-lg text-xs ${
                  row.result === 'pass' ? 'border-emerald-200 bg-emerald-50' :
                  row.result === 'fail' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'
                }`}>
                  <div className="flex items-start gap-2 p-2.5">
                    <span className="text-slate-400 font-bold shrink-0 pt-0.5">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-800 leading-snug">{item.item}</div>
                      <div className="text-slate-400 text-[11px] mt-0.5 leading-snug">{item.standard}</div>
                    </div>
                    {isReadOnly
                      ? <div className="shrink-0">{resultBadge(row.result)}</div>
                      : <div className="flex gap-1 shrink-0">
                          <button onClick={() => toggleResult(idx, 'pass')} className={`w-10 h-9 rounded font-bold border text-sm transition-colors ${
                            row.result === 'pass' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-emerald-600 border-emerald-300'
                          }`}>O</button>
                          <button onClick={() => toggleResult(idx, 'fail')} className={`w-10 h-9 rounded font-bold border text-sm transition-colors ${
                            row.result === 'fail' ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-rose-600 border-rose-300'
                          }`}>X</button>
                        </div>
                    }
                  </div>
                  {(row.result === 'fail' || (isReadOnly && row.note)) && (
                    <div className="px-2.5 pb-2.5">
                      <div className="border-t border-slate-200 pt-2">
                        {isReadOnly
                          ? <div className="text-slate-700">{row.note || '-'}</div>
                          : <input value={row.note} onChange={e => setRow(idx, 'note', e.target.value)}
                              placeholder="조치 내용 필수 입력"
                              className={`w-full border rounded px-2 py-1.5 text-xs bg-white ${needNote ? 'border-rose-400' : 'border-slate-200'}`} />
                        }
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 데스크탑 테이블 */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-xs mb-4">
              <thead>
                <tr>
                  <th className={TH} style={{ width: 28 }}>번호</th>
                  <th className={TH}>점검항목</th>
                  <th className={TH} style={{ width: 140 }}>기준</th>
                  <th className={TH} style={{ width: 28 }}>O</th>
                  <th className={TH} style={{ width: 28 }}>X</th>
                  <th className={TH} style={{ width: 70 }}>결과</th>
                  <th className={TH} style={{ width: 80 }}>작성자</th>
                  <th className={TH} style={{ width: 110 }}>비고(개선조치)</th>
                </tr>
              </thead>
              <tbody>
                {templateItems.map((item, idx) => {
                  const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
                  return (
                    <tr key={idx} className={row.result === 'fail' ? 'bg-rose-50' : ''}>
                      <td className={TD}>{idx + 1}</td>
                      <td className={TDL}>{item.item}</td>
                      <td className={TD}>{item.standard}</td>
                      <td className={TD}><input type="checkbox" checked={row.result === 'pass'} onChange={() => toggleResult(idx, 'pass')} disabled={isReadOnly} /></td>
                      <td className={TD}><input type="checkbox" checked={row.result === 'fail'} onChange={() => toggleResult(idx, 'fail')} disabled={isReadOnly} /></td>
                      <td className={TD}>{resultBadge(row.result)}</td>
                      <td className={TD}>
                        {row.inspector
                          ? <span className="inline-flex px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium">{row.inspector}</span>
                          : <span className="text-slate-300 text-xs">-</span>
                        }
                      </td>
                      <td className={TDL}>
                        <input value={row.note} onChange={e => setRow(idx, 'note', e.target.value)} disabled={isReadOnly}
                          className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60"
                          placeholder={row.result === 'fail' ? '조치 내용 필수' : ''} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mb-4">
            <div className="text-xs font-bold text-slate-700 mb-1">특이사항</div>
            <textarea value={selected.specialNotes}
              onChange={e => !isReadOnly && editSelected(prev => prev ? { ...prev, specialNotes: e.target.value } : prev)}
              disabled={isReadOnly} rows={2}
              className="w-full border border-slate-300 rounded px-2 py-1 text-xs disabled:opacity-60 resize-none"
              placeholder="특이사항을 입력하세요" />
          </div>

          {/* 서명란 */}
          <div className="flex gap-2 mt-3 justify-end">
            <div className="border border-slate-400 text-center w-24">
              <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">작성자</div>
              <div className="h-8 flex items-center justify-center text-xs text-slate-700">
                {selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '')}
              </div>
            </div>
            <div className="border border-slate-400 text-center w-24">
              <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">관리자</div>
              <div className="h-8 flex items-center justify-center text-xs text-slate-700">
                {selected.confirmedBy
                  ? <span className="text-emerald-700 font-bold">{selected.confirmedBy}</span>
                  : <span className="text-slate-300">-</span>
                }
              </div>
            </div>
          </div>
        </div>
      </div>}
    </fieldset>
  );
};

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
