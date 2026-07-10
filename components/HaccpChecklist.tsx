import React, { useState, useRef, useEffect } from 'react';
import { FileDown, ClipboardList, Thermometer, Bug, CheckSquare, Scan, ShoppingCart, Wrench, ShieldAlert, Save, Trash2, BadgeCheck, User, Plus } from 'lucide-react';
import { db } from '../src/shared/firebase';
import { collection, addDoc, updateDoc, setDoc, doc, onSnapshot, query, orderBy, deleteDoc } from 'firebase/firestore';

// ── 공통 스타일 ────────────────────────────────────────────────────────────────
const TH = 'border border-slate-400 bg-slate-100 p-1.5 text-xs font-bold text-center';
const TD = 'border border-slate-400 p-1.5 text-xs text-center';
const TDL = 'border border-slate-400 p-1.5 text-xs text-left';

// ── PDF 다운로드 유틸 ──────────────────────────────────────────────────────────
async function downloadAsPDF(element: HTMLElement, filename: string) {
  const { default: jsPDF } = await import('jspdf') as any;
  const { default: html2canvas } = await import('html2canvas') as any;
  const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  const pageHeight = 297;
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  let remainingHeight = imgHeight;
  let currentY = 0;
  let isFirstPage = true;
  while (remainingHeight > 0) {
    if (!isFirstPage) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, -currentY, imgWidth, imgHeight);
    currentY += pageHeight;
    remainingHeight -= pageHeight;
    isFirstPage = false;
  }
  pdf.save(filename);
}

// ── 공통 헬퍼 컴포넌트 ────────────────────────────────────────────────────────
const FormHeader: React.FC<{ title: string; company?: string; date?: string }> = ({
  title, company = '태백식품', date,
}) => (
  <div className="mb-4">
    <div className="flex items-center justify-between border-b-2 border-slate-600 pb-2">
      <div className="text-base font-black text-slate-800">{title}</div>
      <div className="text-xs text-slate-500">{company} | {date ?? new Date().toLocaleDateString('ko-KR')}</div>
    </div>
  </div>
);

const SignBox: React.FC<{ labels?: string[] }> = ({ labels = ['작성자', '확인자', '관리자'] }) => (
  <div className="flex gap-2 mt-3 justify-end">
    {labels.map(l => (
      <div key={l} className="border border-slate-400 text-center w-20">
        <div className="bg-slate-100 text-xs font-bold py-0.5 border-b border-slate-400">{l}</div>
        <div className="h-8" />
      </div>
    ))}
  </div>
);

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
  const [evalDate, setEvalDate] = useState(new Date().toISOString().slice(0, 10));
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
const PEST_LOCATIONS = [
  '원료 창고', '제조실(향미유)', '제조실(고춧가루)', '포장실', '완제품 창고', '탈의실', '화장실', '외부 주변',
];
const PEST_CHECK_ITEMS = [
  '방충망 파손 여부', '출입문 틈새 여부', '끈끈이 트랩 포획 유무', '쥐덫 포획 유무', '배수구 망 상태', '이물·쥐똥 흔적 여부',
];

interface PestRow {
  date: string;
  season: '하절기' | '동절기';
  location: string;
  checks: Record<string, '' | 'O' | 'X'>;
  corrective: string;
  inspector: string;
}

const PestForm: React.FC = () => {
  const [rows, setRows] = useState<PestRow[]>([
    { date: new Date().toISOString().slice(0, 10), season: '하절기', location: '', checks: {}, corrective: '', inspector: '' },
  ]);
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: new Date().toISOString().slice(0, 10), season: '하절기', location: '', checks: {}, corrective: '', inspector: '' }]);
  const updateRow = (idx: number, field: keyof PestRow, value: any) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  const updateCheck = (idx: number, key: string, val: '' | 'O' | 'X') =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, checks: { ...r.checks, [key]: val } } : r));

  const currentYear = new Date().getFullYear();

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <span className="text-xs text-slate-500">※ 하절기(4~10월): 주 1회 이상 / 동절기(11~3월): 월 1회 이상</span>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_방충방서점검표_${currentYear}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="방충·방서 점검표" />
        <p className="text-xs text-slate-500 mb-3">O: 이상 없음 / X: 이상 있음 (X 시 개선조치 기재 필수)</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th className={TH}>점검일</th>
                <th className={TH}>구분</th>
                <th className={TH}>장소</th>
                {PEST_CHECK_ITEMS.map(c => <th key={c} className={TH}>{c}</th>)}
                <th className={TH}>개선조치</th>
                <th className={TH}>점검자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}>
                    <input type="date" value={row.date} onChange={e => updateRow(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" />
                  </td>
                  <td className={TD}>
                    <select value={row.season} onChange={e => updateRow(idx, 'season', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      <option>하절기</option>
                      <option>동절기</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.location} onChange={e => updateRow(idx, 'location', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      <option value="">선택</option>
                      {PEST_LOCATIONS.map(l => <option key={l}>{l}</option>)}
                    </select>
                  </td>
                  {PEST_CHECK_ITEMS.map(c => (
                    <td key={c} className={TD}>
                      <select value={row.checks[c] ?? ''} onChange={e => updateCheck(idx, c, e.target.value as '' | 'O' | 'X')} className={`text-xs border-none outline-none bg-transparent font-bold ${row.checks[c] === 'X' ? 'text-rose-600' : row.checks[c] === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                  ))}
                  <td className={TDL}>
                    <input value={row.corrective} onChange={e => updateRow(idx, 'corrective', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" />
                  </td>
                  <td className={TD}>
                    <input value={row.inspector} onChange={e => updateRow(idx, 'inspector', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SignBox />
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. 냉장·냉동창고 온도관리 일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STORAGE_ZONES = [
  { name: '냉장창고 1', standard: '0~10℃' },
  { name: '냉장창고 2', standard: '0~10℃' },
  { name: '냉동창고', standard: '-18℃ 이하' },
  { name: '원료 보관실', standard: '실온(15~25℃)' },
];
type StorageZone = { name: string; standard: string };

interface TempRow {
  zone: string;
  temp: string;
  result: '' | 'O' | 'X';
  corrective: string;
  inspector: string;
}

interface TempRecord {
  id?: string;
  date: string;
  measureTime: '12:30';
  rows: TempRow[];
  createdBy: string; createdAt: string;
  updatedBy: string; updatedAt: string;
  revisionCount: number;
  confirmedBy?: string; confirmedAt?: string;
}

const defaultTempRows = (zones: StorageZone[] = STORAGE_ZONES): TempRow[] =>
  zones.map(z => ({ zone: z.name, temp: '', result: '' as '', corrective: '', inspector: '' }));

export const TempForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const today = todayStr();
  const [records, setRecords] = useState<TempRecord[]>([]);
  const [selected, setSelected] = useState<TempRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [templateZones, setTemplateZones] = useState<StorageZone[]>(STORAGE_ZONES);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'haccp_temp'), orderBy('date', 'desc'));
    return onSnapshot(q, snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as TempRecord))));
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'temp_zones'), snap => {
      if (snap.exists()) {
        const data = snap.data().zones;
        if (Array.isArray(data) && data.length > 0) setTemplateZones(data);
      }
    });
  }, []);

  const todayRecord = records.find(r => r.date === today);
  const isReadOnly = selected ? selected.date !== today : false;

  const openToday = () => {
    if (todayRecord) { setSelected(todayRecord); return; }
    const rows = defaultTempRows(templateZones).map(r => ({ ...r, inspector: currentUser?.name ?? '' }));
    setSelected({ date: today, measureTime: '12:30', rows, createdBy: '', createdAt: '', updatedBy: '', updatedAt: '', revisionCount: -1 } as TempRecord);
  };

  const openHistory = (r: TempRecord) => { setSelected(r); setShowHistory(false); };

  const update = (idx: number, field: keyof TempRow, value: string) => {
    if (isReadOnly) return;
    if (field === 'temp') value = value.replace(/[^-\d]/g, '');
    setSelected(prev => prev ? { ...prev, rows: prev.rows.map((r, i) => i === idx ? { ...r, [field]: value } : r) } : prev);
  };

  const addRow = () => {
    if (isReadOnly || !isAdmin) return;
    setSelected(prev => prev ? {
      ...prev,
      rows: [...prev.rows, { zone: templateZones[0]?.name ?? '', temp: '', result: '' as '', corrective: '', inspector: currentUser?.name ?? '' }],
    } : prev);
  };

  const handleSave = async () => {
    if (!selected || isReadOnly) return;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 };
        const ref = await addDoc(collection(db, 'haccp_temp'), data);
        setSelected({ ...data, id: ref.id });
      } else {
        const upd = { rows: selected.rows, updatedBy: userName, updatedAt: now, revisionCount: (selected.revisionCount ?? 0) + 1 };
        await updateDoc(doc(db, 'haccp_temp', selected.id), upd as any);
        setSelected(prev => prev ? { ...prev, ...upd } : prev);
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !selected?.id) return;
    setConfirming(true);
    try {
      const upd = { confirmedBy: currentUser?.name ?? '관리자', confirmedAt: new Date().toISOString() };
      await updateDoc(doc(db, 'haccp_temp', selected.id), upd);
      setSelected(prev => prev ? { ...prev, ...upd } : prev);
    } finally { setConfirming(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 기록을 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, 'haccp_temp', id));
    if (selected?.id === id) setSelected(null);
  };

  const revLabel = (r: TempRecord) => r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;
  const pastRecords = records.filter(r => r.date !== today);

  return (
    <div className="flex flex-col gap-4">
      {/* 오늘 날짜 카드 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3">
          오늘 측정일 <span className="font-bold text-slate-800 ml-1">{today}</span>
          <span className="ml-2 text-slate-400">· 측정시간 12:30 · 1일 1회</span>
        </div>
        <button onClick={openToday} className={`w-full flex flex-col items-center justify-center gap-1 py-4 rounded-xl border-2 text-sm font-bold transition-all ${
          selected?.date === today ? 'border-teal-500 bg-teal-50 text-teal-700'
          : todayRecord ? 'border-teal-200 bg-teal-50/50 text-teal-600 hover:border-teal-400'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
        }`}>
          <span className="text-base">🌡️</span>
          <span>오늘 온도 측정 기록</span>
          {todayRecord
            ? <span className="text-xs font-normal text-teal-500">✓ {revLabel(todayRecord)} 저장됨</span>
            : <span className="text-xs font-normal text-slate-400">미작성</span>}
        </button>
      </div>

      {/* 이전 기록 */}
      <button onClick={() => setShowHistory(v => !v)} className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
        <span>이전 측정 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {pastRecords.length === 0 && <p className="col-span-full text-xs text-slate-400 py-4 text-center">이전 기록이 없습니다</p>}
          {pastRecords.map(r => (
            <div key={r.id} onClick={() => openHistory(r)} className={`p-3 rounded-lg border cursor-pointer text-xs transition-colors ${selected?.id === r.id ? 'bg-slate-100 border-slate-400' : 'bg-white border-slate-200 hover:border-slate-400'}`}>
              <div className="font-bold text-slate-700">{r.date}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-slate-500">{revLabel(r)}</span>
                {isAdmin && <button onClick={e => { e.stopPropagation(); r.id && handleDelete(r.id); }} className="text-rose-400 hover:text-rose-600"><Trash2 size={11} /></button>}
              </div>
              {r.confirmedBy && <div className="text-emerald-600 font-bold mt-1 text-[10px]">✓ 확인완료</div>}
              {!r.confirmedBy && r.createdBy && <div className="text-slate-400 mt-1 truncate">{r.createdBy}</div>}
            </div>
          ))}
        </div>
      )}

      {!selected && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
          <Thermometer size={28} className="text-slate-300" />
          <p className="text-sm">위에서 오늘 온도 측정을 시작해주세요</p>
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-3">
          {/* 액션 바 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${revLabel(selected)}`}
            </span>
            <span className="text-xs text-slate-500">{selected.date} · 측정시간 12:30</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button onClick={() => printRef.current && downloadAsPDF(printRef.current, `HACCP_온도관리일지_${selected.date}.pdf`)}
                className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700">
                <FileDown size={12} /> PDF
              </button>
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold"><BadgeCheck size={13} /> {selected.confirmedBy} 확인완료</span>
                  : <button onClick={handleConfirm} disabled={confirming || !selected.id}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 px-3 py-2 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700 disabled:opacity-50">
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">냉장·냉동창고 온도관리 일지</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
              {[
                { label: '회사명', value: '태백식품' },
                { label: '측정일', value: selected.date },
                { label: '측정시간', value: '12:30' },
                { label: '측정자', value: selected.rows[0]?.inspector || currentUser?.name || '-' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col">
                  <span className="bg-slate-100 text-slate-600 font-bold text-center py-1 text-[10px] border-b border-slate-200">{label}</span>
                  <span className="text-center py-1.5 text-slate-800 font-medium">{value}</span>
                </div>
              ))}
            </div>

            <div className="mb-3 text-xs">
              <table className="border-collapse w-full mb-2">
                <thead><tr><th className={TH}>보관장소</th><th className={TH}>관리기준</th></tr></thead>
                <tbody>
                  {templateZones.map(z => (<tr key={z.name}><td className={TD}>{z.name}</td><td className={TD}>{z.standard}</td></tr>))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500 mb-2">※ O: 기준 내 / X: 기준 이탈 (이탈 시 개선조치 기재)</p>
            <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs min-w-[500px]">
              <thead>
                <tr>
                  <th className={TH}>보관장소</th>
                  <th className={TH}>온도(℃)</th>
                  <th className={TH}>적합여부</th>
                  <th className={TH} style={{ width: 130 }}>개선조치</th>
                  <th className={TH}>측정자</th>
                </tr>
              </thead>
              <tbody>
                {selected.rows.map((row, idx) => (
                  <tr key={idx} className={row.result === 'X' ? 'bg-rose-50' : row.result === 'O' ? 'bg-emerald-50/50' : ''}>
                    <td className={TDL}>
                      {isReadOnly
                        ? row.zone
                        : <select value={row.zone} onChange={e => update(idx, 'zone', e.target.value)} className="text-xs border-none outline-none bg-transparent w-full">
                            {templateZones.map(z => <option key={z.name} value={z.name}>{z.name}</option>)}
                            {row.zone && !templateZones.find(z => z.name === row.zone) && <option value={row.zone}>{row.zone}</option>}
                          </select>
                      }
                    </td>
                    <td className={TD}>
                      <input value={row.temp} onChange={e => update(idx, 'temp', e.target.value)} disabled={isReadOnly}
                        placeholder="예: 5" className="w-14 text-xs border-none outline-none bg-transparent text-center disabled:text-slate-500" />
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} disabled={isReadOnly}
                        className={`text-xs border-none outline-none bg-transparent font-bold ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option><option value="O">O</option><option value="X">X</option>
                      </select>
                    </td>
                    <td className={TDL}>
                      <input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} disabled={isReadOnly}
                        className="w-full text-xs border-none outline-none bg-transparent" />
                    </td>
                    <td className={TD}>
                      <input value={row.inspector} onChange={e => update(idx, 'inspector', e.target.value)} disabled={isReadOnly}
                        className="w-16 text-xs border-none outline-none bg-transparent text-center" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {!isReadOnly && isAdmin && (
              <button onClick={addRow} className="mt-2 flex items-center gap-1 px-3 py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 hover:border-teal-400 hover:text-teal-500">
                <Plus size={12} /> 행 추가
              </button>
            )}

            {/* 서명란 */}
            <div className="grid grid-cols-2 gap-3 mt-4 md:flex md:justify-end md:gap-4 text-xs">
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">측정자</div>
                <div className="h-10 flex items-center justify-center text-slate-700 font-semibold">
                  {selected.rows[0]?.inspector || currentUser?.name || '-'}
                </div>
              </div>
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">확인자</div>
                <div className="h-10 flex items-center justify-center">
                  {selected.confirmedBy
                    ? <span className="text-slate-700 font-semibold">{selected.confirmedBy}</span>
                    : canConfirm && selected.id
                      ? <button onClick={handleConfirm} disabled={confirming}
                          className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40">
                          <BadgeCheck size={11} /> {confirming ? '처리 중...' : '확인'}
                        </button>
                      : canConfirm && !selected.id
                        ? <span className="text-slate-300 text-[10px]">저장 후 확인</span>
                        : <span className="text-slate-200 text-xs">-</span>
                  }
                </div>
              </div>
            </div>

            {selected.id && (
              <div className="mt-3 text-xs text-slate-400 text-right">
                최초 작성: {selected.createdBy} ({selected.createdAt?.slice(0, 16).replace('T', ' ')})
                {selected.updatedBy !== selected.createdBy && (
                  <> · 최종 수정: {selected.updatedBy} ({selected.updatedAt?.slice(0, 16).replace('T', ' ')})</>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. CCP-B 가열·살균공정 모니터링일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CCP_PRODUCTS = ['시골향참기름', '시골향들기름', '시골향고추기름', '시골향마늘기름', '향미유(기타)', '고춧가루'];

interface CCPHeatRow {
  date: string;
  product: string;
  batch: string;
  startTime: string;
  endTime: string;
  setTemp: string;
  measuredTemp: string;
  duration: string;
  coreTemp: string;
  result: '' | 'O' | 'X';
  corrective: string;
  operator: string;
  verifier: string;
}

const CCPHeatForm: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<CCPHeatRow[]>([
    { date: '', product: CCP_PRODUCTS[0], batch: '', startTime: '', endTime: '', setTemp: '', measuredTemp: '', duration: '', coreTemp: '', result: '', corrective: '', operator: '', verifier: '' },
  ]);
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: '', product: CCP_PRODUCTS[0], batch: '', startTime: '', endTime: '', setTemp: '', measuredTemp: '', duration: '', coreTemp: '', result: '', corrective: '', operator: '', verifier: '' }]);
  const update = (idx: number, field: keyof CCPHeatRow, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_CCP가열살균모니터링일지_${month}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="CCP-B 모니터링일지 [가열·살균공정]" date={month} />

        <div className="border border-slate-400 p-2 mb-3 text-xs bg-amber-50">
          <div className="font-bold mb-1">한계기준(CL) — 이탈 시 즉각 개선조치 필요</div>
          <div>• 가열온도: 95~100℃ / 가열시간: 15~20분 이상 / 품온: 70~85℃ 이상</div>
          <div>• 기준 이탈 시: 재가열 또는 해당 배치 격리 후 품질 판정</div>
        </div>

        <p className="text-xs text-slate-500 mb-2">O: 한계기준 적합 / X: 한계기준 이탈 (개선조치 기재 필수)</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th className={TH}>제조일</th>
                <th className={TH}>제품명</th>
                <th className={TH}>배치번호</th>
                <th className={TH}>시작시간</th>
                <th className={TH}>종료시간</th>
                <th className={TH}>설정온도(℃)</th>
                <th className={TH}>실측온도(℃)</th>
                <th className={TH}>가열시간(분)</th>
                <th className={TH}>품온(℃)</th>
                <th className={TH}>적합</th>
                <th className={TH}>개선조치</th>
                <th className={TH}>작업자</th>
                <th className={TH}>확인자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}><input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" /></td>
                  <td className={TD}>
                    <select value={row.product} onChange={e => update(idx, 'product', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      {CCP_PRODUCTS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className={TD}><input value={row.batch} onChange={e => update(idx, 'batch', e.target.value)} className="w-16 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input type="time" value={row.startTime} onChange={e => update(idx, 'startTime', e.target.value)} className="text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input type="time" value={row.endTime} onChange={e => update(idx, 'endTime', e.target.value)} className="text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input value={row.setTemp} onChange={e => update(idx, 'setTemp', e.target.value)} placeholder="95~100" className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.measuredTemp} onChange={e => update(idx, 'measuredTemp', e.target.value)} placeholder="실측값" className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.duration} onChange={e => update(idx, 'duration', e.target.value)} placeholder="15~20" className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.coreTemp} onChange={e => update(idx, 'coreTemp', e.target.value)} placeholder="70~85" className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}>
                    <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O</option>
                      <option value="X">X</option>
                    </select>
                  </td>
                  <td className={TDL}><input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input value={row.operator} onChange={e => update(idx, 'operator', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.verifier} onChange={e => update(idx, 'verifier', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SignBox labels={['작성자', '검증자', '관리자']} />
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. CCP-P 금속검출공정 모니터링일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface CCPMetalRow {
  date: string;
  time: string;
  product: string;
  batch: string;
  fe: string;
  sus: string;
  feResult: '' | 'O' | 'X';
  susResult: '' | 'O' | 'X';
  productResult: '' | 'O' | 'X';
  corrective: string;
  operator: string;
  verifier: string;
}

const CCPMetalForm: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<CCPMetalRow[]>([
    { date: '', time: '', product: CCP_PRODUCTS[0], batch: '', fe: '', sus: '', feResult: '', susResult: '', productResult: '', corrective: '', operator: '', verifier: '' },
  ]);
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: '', time: '', product: CCP_PRODUCTS[0], batch: '', fe: '', sus: '', feResult: '', susResult: '', productResult: '', corrective: '', operator: '', verifier: '' }]);
  const update = (idx: number, field: keyof CCPMetalRow, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_CCP금속검출모니터링일지_${month}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="CCP-P 모니터링일지 [금속검출공정]" date={month} />

        <div className="border border-slate-400 p-2 mb-3 text-xs bg-amber-50">
          <div className="font-bold mb-1">한계기준(CL) — 이탈 시 즉각 개선조치 필요</div>
          <div>• Fe(철) 테스트피스: 2.0㎜φ — 검출(감도 확인) / 제품: 불검출</div>
          <div>• Sus(스테인리스) 테스트피스: 2.5㎜φ — 검출(감도 확인) / 제품: 불검출</div>
          <div>• 기준 이탈 시: 해당 배치 전량 재검사 또는 격리 후 처리</div>
        </div>

        <p className="text-xs text-slate-500 mb-2">감도확인: O=검출(정상) X=미검출(이상) / 제품검사: O=불검출(정상) X=검출(이상)</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th className={TH} rowSpan={2}>검사일</th>
                <th className={TH} rowSpan={2}>검사시간</th>
                <th className={TH} rowSpan={2}>제품명</th>
                <th className={TH} rowSpan={2}>배치번호</th>
                <th className={TH} colSpan={2}>감도확인(테스트피스)</th>
                <th className={TH} rowSpan={2}>제품검사결과</th>
                <th className={TH} rowSpan={2}>개선조치</th>
                <th className={TH} rowSpan={2}>검사자</th>
                <th className={TH} rowSpan={2}>확인자</th>
              </tr>
              <tr>
                <th className={TH}>Fe 2.0㎜φ</th>
                <th className={TH}>Sus 2.5㎜φ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}><input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" /></td>
                  <td className={TD}><input type="time" value={row.time} onChange={e => update(idx, 'time', e.target.value)} className="text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}>
                    <select value={row.product} onChange={e => update(idx, 'product', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      {CCP_PRODUCTS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className={TD}><input value={row.batch} onChange={e => update(idx, 'batch', e.target.value)} className="w-14 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}>
                    <select value={row.feResult} onChange={e => update(idx, 'feResult', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.feResult === 'X' ? 'text-rose-600' : row.feResult === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O(검출)</option>
                      <option value="X">X(미검출)</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.susResult} onChange={e => update(idx, 'susResult', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.susResult === 'X' ? 'text-rose-600' : row.susResult === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O(검출)</option>
                      <option value="X">X(미검출)</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.productResult} onChange={e => update(idx, 'productResult', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.productResult === 'X' ? 'text-rose-600' : row.productResult === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O(불검출)</option>
                      <option value="X">X(검출)</option>
                    </select>
                  </td>
                  <td className={TDL}><input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input value={row.operator} onChange={e => update(idx, 'operator', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input value={row.verifier} onChange={e => update(idx, 'verifier', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SignBox labels={['작성자', '검증자', '관리자']} />
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. 입고검사일지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const RAW_MATERIALS = [
  '참깨', '들깨', '고추', '마늘', '대두유(식용유)', '혼합식물성유지', '고춧가루', '기타원료',
];
const SUB_MATERIALS = [
  '유리병', '플라스틱용기', '마개(캡)', '라벨', '박스', '테이프', '비닐백', '기타부자재',
];

interface IncomingRow {
  date: string;
  inboundPartner: string;
  material: string;
  materialType: '원료' | '부자재';
  quantity: string;
  unit: string;
  lotNo: string;
  expDate: string;
  appearance: '' | 'O' | 'X';
  packaging: '' | 'O' | 'X';
  label: '' | 'O' | 'X';
  certAvail: '' | 'O' | 'X' | 'N/A';
  result: '' | '합격' | '불합격' | '조건부합격';
  corrective: string;
  inspector: string;
}

interface IncomingRecord {
  id?: string;
  month: string;
  rows: IncomingRow[];
  createdBy: string; createdAt: string;
  updatedBy: string; updatedAt: string;
  revisionCount: number;
  confirmedBy?: string; confirmedAt?: string;
}

const defaultIncomingRow = (): IncomingRow => ({ date: '', inboundPartner: '', material: RAW_MATERIALS[0], materialType: '원료', quantity: '', unit: 'kg', lotNo: '', expDate: '', appearance: '' as '', packaging: '' as '', label: '' as '', certAvail: '' as '', result: '' as '', corrective: '', inspector: '' });

const IncomingForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [records, setRecords] = useState<IncomingRecord[]>([]);
  const [workingRows, setWorkingRows] = useState<IncomingRow[]>([defaultIncomingRow()]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'haccp_incoming'), orderBy('month', 'desc'));
    return onSnapshot(q, snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as IncomingRecord))));
  }, []);

  const currentRecord = records.find(r => r.month === month);
  const isReadOnly = month < currentMonth && !isAdmin;

  useEffect(() => {
    const rec = records.find(r => r.month === month);
    setWorkingRows(rec ? rec.rows : [defaultIncomingRow()]);
  }, [month, records]);

  const addRow = () => { if (!isReadOnly) setWorkingRows(prev => [...prev, defaultIncomingRow()]); };
  const update = (idx: number, field: keyof IncomingRow, value: string) => {
    if (isReadOnly) return;
    setWorkingRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!currentRecord?.id) {
        await addDoc(collection(db, 'haccp_incoming'), { month, rows: workingRows, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 });
      } else {
        await updateDoc(doc(db, 'haccp_incoming', currentRecord.id), { rows: workingRows, updatedBy: userName, updatedAt: now, revisionCount: (currentRecord.revisionCount ?? 0) + 1 });
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !currentRecord?.id) return;
    setConfirming(true);
    try {
      await updateDoc(doc(db, 'haccp_incoming', currentRecord.id), { confirmedBy: currentUser?.name ?? '관리자', confirmedAt: new Date().toISOString() });
    } finally { setConfirming(false); }
  };

  const resultColor = (r: IncomingRow['result']) => r === '합격' ? 'text-green-600' : r === '불합격' ? 'text-rose-600' : r === '조건부합격' ? 'text-amber-600' : '';

  const statusEl = currentRecord?.confirmedBy
    ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-bold"><BadgeCheck size={13}/>{currentRecord.confirmedBy} 확인완료</span>
    : currentRecord
    ? <span className="text-xs text-blue-600 font-bold">저장됨 · 수정 {currentRecord.revisionCount}회 · {currentRecord.updatedBy}</span>
    : <span className="text-xs text-slate-400">미저장</span>;

  return (
    <div className="relative pb-16">
      {/* 컨트롤 바 */}
      <div className="flex gap-3 mb-3 flex-wrap items-center">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        {statusEl}
        {isReadOnly && (
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">읽기 전용</span>
        )}
        {records.length > 0 && (
          <select
            className="ml-auto text-xs border border-slate-300 rounded px-2 py-1"
            value={month}
            onChange={e => setMonth(e.target.value)}
          >
            {records.map(r => (
              <option key={r.month} value={r.month}>{r.month} {r.confirmedBy ? '✓' : ''}</option>
            ))}
          </select>
        )}
      </div>

      {/* 인쇄 영역 */}
      <div ref={printRef} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="원료·부자재 입고검사일지" date={month} />
        <p className="text-xs text-slate-500 mb-3">O: 적합 / X: 부적합 / N/A: 해당 없음 | 불합격 시 반품 또는 격리 조치 후 처리결과 기재</p>

        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" style={{ minWidth: 1000 }}>
            <thead>
              <tr>
                <th className={TH}>입고일</th>
                <th className={TH}>공급업체</th>
                <th className={TH}>품목명</th>
                <th className={TH}>구분</th>
                <th className={TH}>수량</th>
                <th className={TH}>단위</th>
                <th className={TH}>Lot번호</th>
                <th className={TH}>유통기한</th>
                <th className={TH}>외관</th>
                <th className={TH}>포장</th>
                <th className={TH}>표시사항</th>
                <th className={TH}>성적서</th>
                <th className={TH}>판정</th>
                <th className={TH}>조치사항</th>
                <th className={TH}>검사자</th>
              </tr>
            </thead>
            <tbody>
              {workingRows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}><input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" /></td>
                  <td className={TDL}><input value={row.inboundPartner} onChange={e => update(idx, 'inboundPartner', e.target.value)} disabled={isReadOnly} className="w-20 text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  <td className={TD}>
                    <select value={row.material} onChange={e => update(idx, 'material', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent max-w-20 disabled:opacity-60">
                      <optgroup label="원료">{RAW_MATERIALS.map(m => <option key={m}>{m}</option>)}</optgroup>
                      <optgroup label="부자재">{SUB_MATERIALS.map(m => <option key={m}>{m}</option>)}</optgroup>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.materialType} onChange={e => update(idx, 'materialType', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                      <option>원료</option>
                      <option>부자재</option>
                    </select>
                  </td>
                  <td className={TD}><input value={row.quantity} onChange={e => update(idx, 'quantity', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                  <td className={TD}>
                    <select value={row.unit} onChange={e => update(idx, 'unit', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                      {['kg', 'g', 'L', '개', '본', '장', '롤'].map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className={TD}><input value={row.lotNo} onChange={e => update(idx, 'lotNo', e.target.value)} disabled={isReadOnly} className="w-16 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                  <td className={TD}><input type="date" value={row.expDate} onChange={e => update(idx, 'expDate', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" /></td>
                  {(['appearance', 'packaging', 'label'] as const).map(f => (
                    <td key={f} className={TD}>
                      <select value={row[f]} onChange={e => update(idx, f, e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row[f] === 'X' ? 'text-rose-600' : row[f] === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                  ))}
                  <td className={TD}>
                    <select value={row.certAvail} onChange={e => update(idx, 'certAvail', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.certAvail === 'X' ? 'text-rose-600' : row.certAvail === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O</option>
                      <option value="X">X</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${resultColor(row.result)}`}>
                      <option value="">-</option>
                      <option value="합격">합격</option>
                      <option value="불합격">불합격</option>
                      <option value="조건부합격">조건부합격</option>
                    </select>
                  </td>
                  <td className={TDL}><input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  <td className={TD}><input value={row.inspector} onChange={e => update(idx, 'inspector', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SignBox />
      </div>

      {/* 하단 액션 바 */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center gap-2 z-10">
        {!isReadOnly && (
          <button onClick={addRow} className="flex items-center gap-1 text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium">
            <Plus size={12} /> 행 추가
          </button>
        )}
        <button
          onClick={() => printRef.current && downloadAsPDF(printRef.current, `HACCP_입고검사일지_${month}.pdf`)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 font-medium"
        >
          <FileDown size={12} /> PDF
        </button>
        {canConfirm && currentRecord?.id && !currentRecord.confirmedBy && (
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold disabled:opacity-50"
          >
            <BadgeCheck size={12} /> {confirming ? '처리 중…' : '관리자 확인'}
          </button>
        )}
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto flex items-center gap-1.5 text-xs px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold disabled:opacity-50"
          >
            <Save size={12} /> {saving ? '저장 중…' : '저장'}
          </button>
        )}
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. 세척·소독 일지 (기계·설비 + 작업구역)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MACHINES = [
  { name: '착유기 1호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '착유기 2호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '착유기 3호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '착유기 4호', method: '분해세척 → 온수헹굼 → 자연건조' },
  { name: '볶음기 1호', method: '잔재물 제거 → 내·외부 브러시세척 → 건식소독' },
  { name: '볶음기 2호', method: '잔재물 제거 → 내·외부 브러시세척 → 건식소독' },
  { name: '볶음기 3호', method: '잔재물 제거 → 내·외부 브러시세척 → 건식소독' },
  { name: '필터프레스', method: '필터판 분리세척 → 온수헹굼 → 건조' },
];
const MACHINE_NAMES = MACHINES.map(m => m.name);

const CLEAN_AREAS = [
  '제조실(착유·향미유) - 바닥',
  '제조실(착유·향미유) - 작업대',
  '제조실(착유·향미유) - 배수구',
  '제조실(고춧가루) - 바닥',
  '제조실(고춧가루) - 작업대',
  '포장실 - 바닥/작업대',
  '원료창고 - 바닥/선반',
  '완제품창고 - 바닥/선반',
  '화장실 - 전체',
  '탈의실 - 전체',
  '환기후드·덕트',
  '배수구·트렌치',
];

const SANITIZERS = [
  '알코올 70%',
  '차아염소산나트륨 100ppm',
  '차아염소산나트륨 200ppm',
  '과산화수소 3%',
  '열탕소독(80℃↑)',
  '기타',
];

interface MachineCleanRow {
  date: string;
  machine: string;
  used: '' | 'O' | 'X';
  cleanMethod: string;
  sanitizer: string;
  result: '' | 'O' | 'X';
  cleaner: string;
  verifier: string;
  note: string;
}

interface AreaCleanRow {
  date: string;
  area: string;
  result: '' | 'O' | 'X';
  sanitized: '' | 'O' | 'X' | 'N/A';
  sanitizer: string;
  cleaner: string;
  note: string;
}

interface CleaningRecord {
  id?: string;
  month: string;
  machineRows: MachineCleanRow[];
  areaRows: AreaCleanRow[];
  createdBy: string; createdAt: string;
  updatedBy: string; updatedAt: string;
  revisionCount: number;
  confirmedBy?: string; confirmedAt?: string;
}

const defaultMachineRows = (): MachineCleanRow[] =>
  MACHINES.map(m => ({ date: '', machine: m.name, used: '' as '', cleanMethod: m.method, sanitizer: '', result: '' as '', cleaner: '', verifier: '', note: '' }));
const defaultAreaRows = (): AreaCleanRow[] =>
  CLEAN_AREAS.map(a => ({ date: '', area: a, result: '' as '', sanitized: '' as '', sanitizer: '', cleaner: '', note: '' }));

const CleaningForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [records, setRecords] = useState<CleaningRecord[]>([]);
  const [machineRows, setMachineRows] = useState<MachineCleanRow[]>(defaultMachineRows());
  const [areaRows, setAreaRows] = useState<AreaCleanRow[]>(defaultAreaRows());
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const machineRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'haccp_cleaning'), orderBy('month', 'desc'));
    return onSnapshot(q, snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as CleaningRecord))));
  }, []);

  const currentRecord = records.find(r => r.month === month);
  const isReadOnly = month < currentMonth && !isAdmin;

  useEffect(() => {
    const rec = records.find(r => r.month === month);
    setMachineRows(rec ? rec.machineRows : defaultMachineRows());
    setAreaRows(rec ? rec.areaRows : defaultAreaRows());
  }, [month, records]);

  const addMachineRow = () => { if (!isReadOnly) setMachineRows(prev => [...prev, { date: '', machine: MACHINE_NAMES[0], used: '' as '', cleanMethod: MACHINES[0].method, sanitizer: '', result: '' as '', cleaner: '', verifier: '', note: '' }]); };
  const updateMachine = (idx: number, field: keyof MachineCleanRow, value: string) => {
    if (isReadOnly) return;
    setMachineRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const addAreaRow = () => { if (!isReadOnly) setAreaRows(prev => [...prev, { date: '', area: CLEAN_AREAS[0], result: '' as '', sanitized: '' as '', sanitizer: '', cleaner: '', note: '' }]); };
  const updateArea = (idx: number, field: keyof AreaCleanRow, value: string) => {
    if (isReadOnly) return;
    setAreaRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!currentRecord?.id) {
        await addDoc(collection(db, 'haccp_cleaning'), { month, machineRows, areaRows, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 });
      } else {
        await updateDoc(doc(db, 'haccp_cleaning', currentRecord.id), { machineRows, areaRows, updatedBy: userName, updatedAt: now, revisionCount: (currentRecord.revisionCount ?? 0) + 1 });
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !currentRecord?.id) return;
    setConfirming(true);
    try {
      await updateDoc(doc(db, 'haccp_cleaning', currentRecord.id), { confirmedBy: currentUser?.name ?? '관리자', confirmedAt: new Date().toISOString() });
    } finally { setConfirming(false); }
  };

  const statusEl = currentRecord?.confirmedBy
    ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-bold"><BadgeCheck size={13}/>{currentRecord.confirmedBy} 확인완료</span>
    : currentRecord
    ? <span className="text-xs text-blue-600 font-bold">저장됨 · 수정 {currentRecord.revisionCount}회 · {currentRecord.updatedBy}</span>
    : <span className="text-xs text-slate-400">미저장</span>;

  return (
    <div className="relative pb-16 space-y-8">
      {/* 컨트롤 바 */}
      <div className="flex gap-3 flex-wrap items-center">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        {statusEl}
        {isReadOnly && (
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">읽기 전용</span>
        )}
        {records.length > 0 && (
          <select
            className="ml-auto text-xs border border-slate-300 rounded px-2 py-1"
            value={month}
            onChange={e => setMonth(e.target.value)}
          >
            {records.map(r => (
              <option key={r.month} value={r.month}>{r.month} {r.confirmedBy ? '✓' : ''}</option>
            ))}
          </select>
        )}
      </div>

      {/* 세척소독제 기준 안내 */}
      <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-xs">
        <div className="font-bold text-amber-800 mb-1">세척·소독제 사용 기준 (식약처 소규모 HACCP 기준)</div>
        <div className="text-amber-700 space-y-0.5">
          <div>• 알코올 70% — 작업대·기구 소독 (식품 직접 접촉면)</div>
          <div>• 차아염소산나트륨 100ppm — 바닥·벽면 소독</div>
          <div>• 차아염소산나트륨 200ppm — 화장실·배수구</div>
          <div>• 열탕소독(80℃ 이상) — 착유기 분해 부품, 기구류</div>
          <div>• 소독 후 식품 접촉면은 반드시 음용수로 헹굼</div>
        </div>
      </div>

      {/* ── 기계·설비 세척소독 일지 ── */}
      <div>
        <div className="flex gap-3 mb-3 flex-wrap items-center">
          <span className="text-sm font-bold text-slate-700">기계·설비 세척소독 일지</span>
          {!isReadOnly && (
            <button onClick={addMachineRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 ml-2">+ 행 추가</button>
          )}
          <button
            onClick={() => machineRef.current && downloadAsPDF(machineRef.current, `HACCP_기계세척소독일지_${month}.pdf`)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
          >
            <FileDown size={13} /> PDF 저장
          </button>
        </div>
        <div ref={machineRef} className="bg-white p-4 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
          <FormHeader title="기계·설비 세척소독 일지" date={month} />
          <div className="border border-slate-300 bg-slate-50 p-2 mb-3 text-xs">
            <span className="font-bold">세척 주기:</span> 착유기·볶음기·필터프레스 — 사용 후 매회 / O: 적합 / X: 부적합 (부적합 시 비고에 개선조치 기재)
          </div>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th className={TH}>세척일</th>
                  <th className={TH}>기계명</th>
                  <th className={TH}>당일사용</th>
                  <th className={TH}>세척방법</th>
                  <th className={TH}>소독제(종류/농도)</th>
                  <th className={TH}>세척결과</th>
                  <th className={TH}>세척자</th>
                  <th className={TH}>확인자</th>
                  <th className={TH}>비고</th>
                </tr>
              </thead>
              <tbody>
                {machineRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className={TD}>
                      <input type="date" value={row.date} onChange={e => updateMachine(idx, 'date', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" />
                    </td>
                    <td className={TD}>
                      <select value={row.machine} onChange={e => updateMachine(idx, 'machine', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        {MACHINE_NAMES.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.used} onChange={e => updateMachine(idx, 'used', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.used === 'X' ? 'text-slate-400' : row.used === 'O' ? 'text-slate-700' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O(사용)</option>
                        <option value="X">X(미사용)</option>
                      </select>
                    </td>
                    <td className={TDL}>
                      <input value={row.cleanMethod} onChange={e => updateMachine(idx, 'cleanMethod', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" placeholder="세척방법 기재" />
                    </td>
                    <td className={TD}>
                      <select value={row.sanitizer} onChange={e => updateMachine(idx, 'sanitizer', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        <option value="">선택</option>
                        {SANITIZERS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => updateMachine(idx, 'result', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td className={TD}><input value={row.cleaner} onChange={e => updateMachine(idx, 'cleaner', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                    <td className={TD}><input value={row.verifier} onChange={e => updateMachine(idx, 'verifier', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                    <td className={TDL}><input value={row.note} onChange={e => updateMachine(idx, 'note', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SignBox />
        </div>
      </div>

      {/* ── 작업구역 청소·소독 일지 ── */}
      <div>
        <div className="flex gap-3 mb-3 flex-wrap items-center">
          <span className="text-sm font-bold text-slate-700">작업구역 청소·소독 일지</span>
          {!isReadOnly && (
            <button onClick={addAreaRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 ml-2">+ 행 추가</button>
          )}
          <button
            onClick={() => areaRef.current && downloadAsPDF(areaRef.current, `HACCP_구역청소일지_${month}.pdf`)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
          >
            <FileDown size={13} /> PDF 저장
          </button>
        </div>
        <div ref={areaRef} className="bg-white p-4 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
          <FormHeader title="작업구역 청소·소독 일지" date={month} />
          <p className="text-xs text-slate-500 mb-3">
            제조실·포장실·화장실: 1일 1회 이상 / 창고·탈의실: 주 1회 이상 | O: 적합 / X: 부적합
          </p>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th className={TH}>점검일</th>
                  <th className={TH}>구역</th>
                  <th className={TH}>청소결과</th>
                  <th className={TH}>소독실시</th>
                  <th className={TH}>소독제(종류/농도)</th>
                  <th className={TH}>담당자</th>
                  <th className={TH}>비고(개선조치)</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className={TD}>
                      <input type="date" value={row.date} onChange={e => updateArea(idx, 'date', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent w-24 disabled:opacity-60" />
                    </td>
                    <td className={TD}>
                      <select value={row.area} onChange={e => updateArea(idx, 'area', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        {CLEAN_AREAS.map(a => <option key={a}>{a}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => updateArea(idx, 'result', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.sanitized} onChange={e => updateArea(idx, 'sanitized', e.target.value)} disabled={isReadOnly} className={`text-xs border-none outline-none bg-transparent font-bold disabled:opacity-60 ${row.sanitized === 'X' ? 'text-rose-600' : row.sanitized === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O(실시)</option>
                        <option value="X">X(미실시)</option>
                        <option value="N/A">N/A</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.sanitizer} onChange={e => updateArea(idx, 'sanitizer', e.target.value)} disabled={isReadOnly} className="text-xs border-none outline-none bg-transparent disabled:opacity-60">
                        <option value="">선택</option>
                        {SANITIZERS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={TD}><input value={row.cleaner} onChange={e => updateArea(idx, 'cleaner', e.target.value)} disabled={isReadOnly} className="w-12 text-xs border-none outline-none bg-transparent text-center disabled:opacity-60" /></td>
                    <td className={TDL}><input value={row.note} onChange={e => updateArea(idx, 'note', e.target.value)} disabled={isReadOnly} className="w-full text-xs border-none outline-none bg-transparent disabled:opacity-60" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SignBox />
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center gap-2 z-10">
        {canConfirm && currentRecord?.id && !currentRecord.confirmedBy && (
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-bold disabled:opacity-50"
          >
            <BadgeCheck size={12} /> {confirming ? '처리 중…' : '관리자 확인'}
          </button>
        )}
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto flex items-center gap-1.5 text-xs px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold disabled:opacity-50"
          >
            <Save size={12} /> {saving ? '저장 중…' : '저장'}
          </button>
        )}
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. 작업장 위생점검표 (HACCP-PRP-001)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SANITATION_ITEMS: { item: string; standard: string }[] = [
  { item: '바닥 청결상태',   standard: '오염 및 잔여물 없음' },
  { item: '벽면 상태',       standard: '곰팡이 및 오염 없음' },
  { item: '배수구 상태',     standard: '막힘 및 악취 없음' },
  { item: '작업대 청결',     standard: '세척 완료 상태 유지' },
  { item: '조명 상태',       standard: '파손 및 오염 없음' },
  { item: '환기시설 상태',   standard: '정상 작동' },
  { item: '폐기물 관리',     standard: '밀폐 및 즉시 처리' },
  { item: '세척도구 관리',   standard: '구분 보관 실시' },
];

type SlotTime = '08:30' | '15:00';

interface SanitationRow {
  result: 'pass' | 'fail' | '';
  note: string;
  inspector: string;
}

interface SanitationRecord {
  id?: string;
  checkDate: string;
  checkZone: string;
  checkTime: SlotTime;
  rows: SanitationRow[];
  specialNotes: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revisionCount: number;
  confirmedBy?: string;
  confirmedAt?: string;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyRecord = (slot: SlotTime, items = SANITATION_ITEMS): Omit<SanitationRecord, 'id'> => ({
  checkDate: todayStr(),
  checkZone: '',
  checkTime: slot,
  rows: items.map(() => ({ result: '', note: '', inspector: '' })),
  specialNotes: '',
  createdBy: '',
  createdAt: '',
  updatedBy: '',
  updatedAt: '',
  revisionCount: -1,
});

// ── 월별 심사자료(PDF) — 읽기전용 서식 재현 ───────────────────────────────
const sanSlotLabel = (slot: SlotTime) => slot === '08:30' ? '오전 08:30' : '오후 15:00';
const sanRevLabel = (r: { revisionCount: number }) => r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;

// 단일 점검표 1장(A4 1페이지) — 화면 서식과 동일하게 재현(읽기전용)
const SanitationPrintable: React.FC<{ record: SanitationRecord; templateItems: { item: string; standard: string }[] }> = ({ record, templateItems }) => (
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

// 표지 — 월간 실시 현황 요약
const SanitationMonthlyCover: React.FC<{ ym: string; monthRecords: SanitationRecord[] }> = ({ ym, monthRecords }) => {
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

export const SanitationForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const [records, setRecords] = useState<SanitationRecord[]>([]);
  const [selected, setSelected] = useState<SanitationRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [templateItems, setTemplateItems] = useState<{ item: string; standard: string }[]>(SANITATION_ITEMS);
  const printRef = useRef<HTMLDivElement>(null);

  const today = todayStr();

  useEffect(() => {
    const q = query(collection(db, 'haccp_sanitation'), orderBy('checkDate', 'desc'));
    return onSnapshot(q, snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as SanitationRecord)));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'sanitation'), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setTemplateItems(data);
      }
    });
  }, []);

  // ── 월별 심사자료 PDF 다운로드 (관리자) ──────────────────────────────
  const bulkRef = useRef<HTMLDivElement>(null);
  const [bulkMonth, setBulkMonth] = useState(today.slice(0, 7));
  const [bulkList, setBulkList] = useState<SanitationRecord[] | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ cur: number; total: number } | null>(null);

  const monthRecordsSorted = (ym: string) =>
    records
      .filter(r => r.checkDate.slice(0, 7) === ym)
      .sort((a, b) => a.checkDate.localeCompare(b.checkDate) || a.checkTime.localeCompare(b.checkTime));

  const startBulkDownload = () => {
    const list = monthRecordsSorted(bulkMonth);
    if (list.length === 0) { alert(`${bulkMonth} 에 저장된 점검표가 없습니다.`); return; }
    setBulkList(list); // 숨은 영역 렌더 트리거 → useEffect에서 캡처
  };

  useEffect(() => {
    if (!bulkList) return;
    let cancelled = false;
    (async () => {
      // 숨은 영역 렌더/레이아웃 완료 대기 (2 프레임)
      await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
      if (cancelled || !bulkRef.current) { setBulkList(null); return; }
      const pages = Array.from(bulkRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]'));
      if (pages.length === 0) { setBulkList(null); return; }
      try {
        const { default: jsPDF } = await import('jspdf') as any;
        const { default: html2canvas } = await import('html2canvas') as any;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageW = 210, pageH = 297;
        for (let i = 0; i < pages.length; i++) {
          if (cancelled) return;
          setBulkProgress({ cur: i + 1, total: pages.length });
          const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
          let w = pageW;
          let h = (canvas.height * w) / canvas.width;
          if (h > pageH) { h = pageH; w = (canvas.width * h) / canvas.height; }
          if (i > 0) pdf.addPage();
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pageW - w) / 2, 0, w, h);
        }
        if (!cancelled) pdf.save(`작업장위생점검표_${bulkMonth}_월별.pdf`);
      } finally {
        if (!cancelled) { setBulkProgress(null); setBulkList(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [bulkList]); // eslint-disable-line react-hooks/exhaustive-deps

  // 오늘 슬롯 기존 데이터 조회
  const todayMorning = records.find(r => r.checkDate === today && r.checkTime === '08:30');
  const todayAfternoon = records.find(r => r.checkDate === today && r.checkTime === '15:00');

  const openSlot = (slot: SlotTime) => {
    const existing = slot === '08:30' ? todayMorning : todayAfternoon;
    setSelected(existing ?? { ...emptyRecord(slot, templateItems) } as SanitationRecord);
    setSaveError('');
  };

  const openHistory = (r: SanitationRecord) => {
    setSelected(r);
    setSaveError('');
    setShowHistory(false);
  };

  const isToday = selected ? selected.checkDate === today : false;
  const isReadOnly = selected ? !isToday : false;
  const allChecked = selected ? selected.rows.every(r => r.result === 'pass' || r.result === 'fail') : false;

  // 템플릿 항목이 추가돼 rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: SanitationRow[]): SanitationRow[] =>
    rows.length >= templateItems.length
      ? rows
      : [...rows, ...templateItems.slice(rows.length).map((): SanitationRow => ({ result: '', note: '', inspector: '' }))];

  const setRow = (idx: number, field: keyof SanitationRow, val: string) => {
    if (isReadOnly) return;
    setSelected(prev => prev ? {
      ...prev,
      rows: padRows(prev.rows).map((r, i) => i === idx ? { ...r, [field]: val } : r),
    } : prev);
  };

  const toggleResult = (idx: number, val: 'pass' | 'fail') => {
    if (isReadOnly) return;
    const userName = currentUser?.name ?? '';
    setSelected(prev => {
      if (!prev) return prev;
      const rows = padRows(prev.rows);
      const row = rows[idx];
      const newResult = row.result === val ? '' : val;
      return {
        ...prev,
        rows: rows.map((r, i) => i === idx ? {
          ...r,
          result: newResult,
          inspector: r.inspector || (newResult ? userName : ''),
        } : r),
      };
    });
  };

  const handleSave = async () => {
    if (!selected || isReadOnly) return;
    // 부적합 행은 비고사항(조치) 필수
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (templateItems[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) {
      setSaveError(`부적합 항목의 비고사항(조치)을 입력해주세요: ${missingNote.join(', ')}`);
      return;
    }
    setSaveError('');
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data: Omit<SanitationRecord, 'id'> = {
          ...selected,
          createdBy: userName,
          createdAt: now,
          updatedBy: userName,
          updatedAt: now,
          revisionCount: 0,
        };
        const ref = await addDoc(collection(db, 'haccp_sanitation'), data);
        setSelected({ ...data, id: ref.id });
      } else {
        const newRev = (selected.revisionCount ?? 0) + 1;
        const update: Partial<SanitationRecord> = {
          ...selected,
          updatedBy: userName,
          updatedAt: now,
          revisionCount: newRev,
        };
        await updateDoc(doc(db, 'haccp_sanitation', selected.id), update as any);
        setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    if (!selected?.id) {
      alert('점검표를 먼저 저장해주세요.');
      return;
    }
    if (!allChecked) {
      alert('모든 점검 항목을 확인(적합/부적합) 완료 후 확인할 수 있습니다.');
      return;
    }
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateDoc(doc(db, 'haccp_sanitation', selected.id), update);
      const confirmed = { ...selected, ...update };
      setSelected(confirmed);
      if (window.confirm('확인 처리되었습니다.\nPDF 파일을 만들겠습니까?')) {
        if (printRef.current) await downloadAsPDF(printRef.current, `작업장위생점검표_${selected.checkDate}_${selected.checkTime.replace(':', '')}_확인완료.pdf`);
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 점검표를 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, 'haccp_sanitation', id));
    if (selected?.id === id) setSelected(null);
  };

  const revLabel = (r: SanitationRecord) =>
    r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;

  const slotLabel = (slot: SlotTime) => slot === '08:30' ? '오전 08:30' : '오후 15:00';

  const resultBadge = (result: SanitationRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  // ── 조회: 월별 그룹 ──────────────────────────────────────────
  const [historyMonth, setHistoryMonth] = useState(today.slice(0, 7));
  const monthOptions = Array.from(new Set([...records.map(r => r.checkDate.slice(0, 7)), today.slice(0, 7)])).sort((a, b) => b.localeCompare(a));
  const historyList = records
    .filter(r => r.checkDate.slice(0, 7) === historyMonth)
    .sort((a, b) => b.checkDate.localeCompare(a.checkDate) || a.checkTime.localeCompare(b.checkTime));
  const historyDates = Array.from(new Set(historyList.map(r => r.checkDate))).sort((a, b) => b.localeCompare(a));
  const historyConfirmed = historyList.filter(r => r.confirmedBy).length;
  const historyFail = historyList.filter(r => r.rows.some(row => row.result === 'fail')).length;

  const historySlotChip = (rec: SanitationRecord | undefined, label: string) => {
    if (!rec) return (
      <span className="inline-flex items-center px-2 py-1 rounded text-[11px] bg-slate-50 text-slate-400 border border-slate-200">{label} 미점검</span>
    );
    const hasFail = rec.rows.some(r => r.result === 'fail');
    const confirmed = !!rec.confirmedBy;
    return (
      <button
        onClick={() => openHistory(rec)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors ${selected?.id === rec.id ? 'ring-2 ring-slate-400 ' : ''}${confirmed
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-400'
          : 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-400'}`}
      >
        <span className="font-bold">{label}</span>
        <span>{confirmed ? '✔확인' : '저장'}</span>
        {hasFail && <span className="text-rose-600 font-bold">·부적합</span>}
        {isAdmin && (
          <span role="button" onClick={e => { e.stopPropagation(); rec.id && handleDelete(rec.id); }}
            className="ml-0.5 text-rose-400 hover:text-rose-600"><Trash2 size={10} /></span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ── 오늘 날짜 + 슬롯 선택 ────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3">
          오늘 점검일 <span className="font-bold text-slate-800 ml-1">{today}</span>
          <span className="ml-2 text-slate-400">· 1일 2회 (08:30 / 15:00)</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['08:30', '15:00'] as SlotTime[]).map(slot => {
            const existing = slot === '08:30' ? todayMorning : todayAfternoon;
            const isActive = selected?.checkTime === slot && selected?.checkDate === today;
            return (
              <button
                key={slot}
                onClick={() => openSlot(slot)}
                className={`flex flex-col items-center justify-center gap-1 py-4 rounded-xl border-2 text-sm font-bold transition-all ${
                  isActive
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : existing
                    ? 'border-emerald-200 bg-emerald-50/50 text-emerald-600 hover:border-emerald-400'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                <span className="text-base">{slot === '08:30' ? '🌅' : '🌇'}</span>
                <span>{slotLabel(slot)}</span>
                {existing
                  ? <span className="text-xs font-normal text-emerald-500">✓ {revLabel(existing)} 저장됨</span>
                  : <span className="text-xs font-normal text-slate-400">미작성</span>
                }
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 점검 기록 조회 (월별) ─────────────────────────────── */}
      <button
        onClick={() => setShowHistory(v => !v)}
        className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <span>점검 기록 조회 (총 {records.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          {/* 월 선택 + 요약 */}
          <div className="flex items-center gap-2 flex-wrap">
            <select value={historyMonth} onChange={e => setHistoryMonth(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs font-medium">
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-[11px] text-slate-500">
              점검 <b className="text-slate-700">{historyList.length}</b>회 · 확인 <b className="text-emerald-600">{historyConfirmed}</b>회
              {historyFail > 0 && <span className="text-rose-600 font-bold"> · 부적합 {historyFail}회</span>}
            </span>
          </div>

          {/* 날짜별 행 (오전/오후 슬롯 상태) */}
          {historyDates.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">이 달 점검 기록이 없습니다</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {historyDates.map(date => {
                const morning = historyList.find(r => r.checkDate === date && r.checkTime === '08:30');
                const afternoon = historyList.find(r => r.checkDate === date && r.checkTime === '15:00');
                return (
                  <div key={date} className="flex items-center gap-2 border border-slate-100 rounded-lg px-2.5 py-2 bg-slate-50/50">
                    <span className="text-xs font-bold text-slate-700 w-24 shrink-0">
                      {date}{date === today && <span className="text-emerald-500 ml-1">(오늘)</span>}
                    </span>
                    <div className="flex gap-1.5 flex-wrap">
                      {historySlotChip(morning, '오전')}
                      {historySlotChip(afternoon, '오후')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-slate-400">🟩 확인완료 · 🟦 저장(미확인) · ⬜ 미점검 · 칩을 누르면 해당 점검표가 열립니다</p>
        </div>
      )}

      {/* ── 월별 심사자료 다운로드 (관리자) ───────────────────── */}
      {isAdmin && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <FileDown size={14} className="text-indigo-600" />
            <span className="text-sm font-bold text-slate-800">월별 심사자료 다운로드</span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">선택한 달의 <b>표지(실시 현황) + 점검표 전체</b>를 PDF 한 파일로 내려받습니다. (심사 제출용)</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="month" value={bulkMonth} max={today.slice(0, 7)} disabled={!!bulkList}
              onChange={e => setBulkMonth(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-xs disabled:opacity-50" />
            <button onClick={startBulkDownload} disabled={!!bulkList}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
              <FileDown size={13} />
              {bulkList ? (bulkProgress ? `생성 중… ${bulkProgress.cur}/${bulkProgress.total}` : '준비 중…') : '월별 PDF 생성'}
            </button>
            <span className="text-[11px] text-slate-400">{bulkMonth} · {monthRecordsSorted(bulkMonth).length}건</span>
          </div>
          {bulkList && (
            <p className="text-[11px] text-amber-600 mt-2">※ 페이지가 많으면 최대 1분가량 걸릴 수 있습니다. 창을 닫지 말고 기다려주세요.</p>
          )}
        </div>
      )}

      {/* ── PDF 생성용 숨은 렌더 영역 (화면에 보이지 않음) ─────── */}
      {bulkList && (
        <div ref={bulkRef} aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 760, background: '#fff', zIndex: -1, pointerEvents: 'none' }}>
          <div data-pdf-page style={{ width: 760, padding: 24, boxSizing: 'border-box', background: '#fff' }}>
            <SanitationMonthlyCover ym={bulkMonth} monthRecords={bulkList} />
          </div>
          {bulkList.map(r => (
            <div key={r.id} data-pdf-page style={{ width: 760, padding: 24, boxSizing: 'border-box', background: '#fff' }}>
              <SanitationPrintable record={r} templateItems={templateItems} />
            </div>
          ))}
        </div>
      )}

      {/* ── 폼 없음 안내 ─────────────────────────────────────── */}
      {!selected && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
          <ShieldAlert size={28} className="text-slate-300" />
          <p className="text-sm">위에서 점검 시간대를 선택해주세요</p>
        </div>
      )}

      {/* ── 폼 본문 ──────────────────────────────────────────── */}
      {selected && (
        <div className="flex flex-col gap-3">
          {/* 액션 바 — 스크롤해도 상단 고정 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${
              isReadOnly
                ? 'bg-slate-100 text-slate-500 border-slate-300'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${revLabel(selected)}`}
            </span>
            <span className="text-xs text-slate-500">{selected.checkDate} {slotLabel(selected.checkTime)}</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button
                onClick={() => printRef.current && downloadAsPDF(printRef.current, `작업장위생점검표_${selected.checkDate}_${selected.checkTime.replace(':', '')}.pdf`)}
                className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700"
              >
                <FileDown size={12} /> PDF
              </button>
              {/* 관리자 전용 확인 버튼 — canConfirm이면 표시 */}
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold">
                      <BadgeCheck size={13} /> {selected.confirmedBy} 확인완료
                    </span>
                  : <button
                      onClick={handleConfirm}
                      disabled={confirming || !selected.id || !allChecked}
                      title={!selected.id ? '저장 후 확인할 수 있습니다' : !allChecked ? '모든 항목 체크 완료 후 확인 가능' : ''}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : !allChecked ? '항목 미완료' : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {/* 부적합 오류 메시지 */}
          {saveError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-3 py-2">
              ⚠️ {saveError}
            </div>
          )}

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">HACCP 작업장 위생점검표</h2>

            {/* 헤더 정보 — 2열(모바일) / 4열(데스크탑) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-slate-300 rounded-lg overflow-hidden mb-4 text-xs">
              {[
                { label: '회사명',    value: '태백식품' },
                { label: '문서번호',  value: 'HACCP-PRP-001' },
                { label: '작성자',    value: selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '-') },
                { label: '개정번호',  value: revLabel(selected) },
                { label: '점검일자',  value: selected.checkDate },
                { label: '점검시간',  value: slotLabel(selected.checkTime) },
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
                    : <input value={selected.checkZone}
                        onChange={e => setSelected(p => p ? { ...p, checkZone: e.target.value } : p)}
                        placeholder="구역 입력" className="w-full text-xs outline-none bg-transparent" />
                  }
                </div>
              </div>
            </div>

            {/* 점검 항목 */}
            <div className="text-xs font-bold mb-2">■ 작업장 위생 점검 항목</div>

            {/* 모바일 카드 */}
            <div className="flex flex-col gap-1.5 md:hidden">
              {templateItems.map((item, idx) => {
                const row = selected.rows[idx] ?? { result: '', note: '', inspector: '', author: '' };
                const needNote = row.result === 'fail' && !row.note.trim();
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
                    <th className={TH} style={{ width: 28 }}>No</th>
                    <th className={TH}>점검항목</th>
                    <th className={TH}>점검기준</th>
                    <th className={TH} style={{ width: 46 }}>적합</th>
                    <th className={TH} style={{ width: 46 }}>부적합</th>
                    <th className={TH} style={{ width: 80 }}>점검자</th>
                    <th className={TH}>비고사항(조치)</th>
                  </tr>
                </thead>
                <tbody>
                  {templateItems.map((item, idx) => {
                    const row = selected.rows[idx] ?? { result: '', note: '', inspector: '' };
                    const needNote = row.result === 'fail' && !row.note.trim();
                    return (
                      <tr key={idx} className={
                        row.result === 'pass' ? 'bg-emerald-50' :
                        row.result === 'fail' ? 'bg-rose-50' : ''
                      }>
                        <td className={TD}>{idx + 1}</td>
                        <td className={TDL}>{item.item}</td>
                        <td className={TDL}>{item.standard}</td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'pass'}
                            onChange={() => toggleResult(idx, 'pass')} disabled={isReadOnly} />
                        </td>
                        <td className={TD}>
                          <input type="checkbox" checked={row.result === 'fail'}
                            onChange={() => toggleResult(idx, 'fail')} disabled={isReadOnly} />
                        </td>
                        <td className={TDL}>
                          {isReadOnly
                            ? row.inspector
                            : <input value={row.inspector} onChange={e => setRow(idx, 'inspector', e.target.value)}
                                placeholder={currentUser?.name ?? ''} className="w-full text-xs border-none outline-none bg-transparent" />
                          }
                        </td>
                        <td className={`${TDL} ${needNote ? 'bg-rose-100' : ''}`}>
                          {isReadOnly
                            ? row.note
                            : <input value={row.note} onChange={e => setRow(idx, 'note', e.target.value)}
                                className="w-full text-xs border-none outline-none bg-transparent"
                                placeholder={row.result === 'fail' ? '필수 입력' : '비고'} />
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 특이사항 및 개선조치 */}
            <div className="text-xs font-bold mb-1 mt-2">■ 특이사항 및 개선조치</div>
            {isReadOnly
              ? <div className="border border-slate-200 rounded-lg p-2 text-xs min-h-[60px] text-slate-700">{selected.specialNotes || '-'}</div>
              : <textarea value={selected.specialNotes}
                  onChange={e => setSelected(p => p ? { ...p, specialNotes: e.target.value } : p)}
                  rows={3} className="w-full border border-slate-300 rounded-lg p-2 text-xs resize-none"
                  placeholder="특이사항 및 개선조치 내용을 입력하세요" />
            }

            {/* 서명란 */}
            <div className="grid grid-cols-2 gap-3 mt-4 md:flex md:justify-end md:gap-4 text-xs">
              {/* 작성자 */}
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">작성자</div>
                <div className="h-10 flex items-center justify-center text-slate-700 font-semibold">
                  {selected.createdBy || (isReadOnly ? '-' : currentUser?.name ?? '')}
                </div>
              </div>
              {/* 수정자 (있을 때만) */}
              {selected.updatedBy && selected.updatedBy !== selected.createdBy && (
                <div className="border border-slate-400 text-center md:w-28">
                  <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">수정자</div>
                  <div className="h-10 flex items-center justify-center text-slate-700 font-semibold">
                    {selected.updatedBy}
                  </div>
                </div>
              )}
              {/* 확인자 — 항상 표시 */}
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">확인자</div>
                <div className="h-10 flex items-center justify-center">
                  {selected.confirmedBy
                    ? <span className="text-slate-700 font-semibold">{selected.confirmedBy}</span>
                    : canConfirm && selected.id && allChecked
                      ? <button
                          onClick={handleConfirm}
                          disabled={confirming}
                          className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40"
                        >
                          <BadgeCheck size={11} /> {confirming ? '처리 중...' : '확인'}
                        </button>
                      : canConfirm && !selected.id
                        ? <span className="text-slate-300 text-[10px]">저장 후 확인</span>
                        : canConfirm && !allChecked
                          ? <span className="text-slate-300 text-[10px]">항목 완료 후</span>
                          : <span className="text-slate-200 text-xs">-</span>
                  }
                </div>
              </div>
            </div>

            {/* 이력 */}
            {selected.id && (
              <div className="mt-3 text-xs text-slate-400 text-right">
                최초 작성: {selected.createdBy} ({selected.createdAt?.slice(0, 16).replace('T', ' ')})
                {selected.updatedBy !== selected.createdBy && (
                  <> · 최종 수정: {selected.updatedBy} ({selected.updatedAt?.slice(0, 16).replace('T', ' ')})</>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. 개인위생점검표 (HACCP-PRP-002)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PERSONAL_HYGIENE_COLS = ['건강', '손세척', '손톱', '악세사리', '위생복', '위생모', '마스크', '장갑'];

interface PersonalHygieneRow {
  name: string;
  checks: Record<string, 'O' | 'X' | ''>;
  note: string;
}
interface PersonalHygieneRecord {
  id?: string;
  checkDate: string;
  rows: PersonalHygieneRow[];
  inspector: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revisionCount: number;
  confirmedBy?: string;
  confirmedAt?: string;
}

const emptyPersonalRecord = (cols: string[] = PERSONAL_HYGIENE_COLS): Omit<PersonalHygieneRecord, 'id'> => ({
  checkDate: todayStr(),
  rows: Array.from({ length: 8 }, () => ({
    name: '',
    checks: Object.fromEntries(cols.map(k => [k, ''])) as Record<string, 'O' | 'X' | ''>,
    note: '',
  })),
  inspector: '',
  createdBy: '',
  createdAt: '',
  updatedBy: '',
  updatedAt: '',
  revisionCount: -1,
});

export const PersonalHygieneForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const [records, setRecords] = useState<PersonalHygieneRecord[]>([]);
  const [selected, setSelected] = useState<PersonalHygieneRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [templateCols, setTemplateCols] = useState<string[]>(PERSONAL_HYGIENE_COLS);
  const printRef = useRef<HTMLDivElement>(null);
  const today = todayStr();

  useEffect(() => {
    const q = query(collection(db, 'haccp_personal_hygiene'), orderBy('checkDate', 'desc'));
    return onSnapshot(q, snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as PersonalHygieneRecord)));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'personal_hygiene'), snap => {
      if (snap.exists()) {
        const data = snap.data().cols;
        if (Array.isArray(data) && data.length > 0) setTemplateCols(data);
      }
    });
  }, []);

  const todayRecord = records.find(r => r.checkDate === today);

  const openToday = () => {
    const record = todayRecord ?? { ...emptyPersonalRecord(templateCols) } as PersonalHygieneRecord;
    if (!isAdmin && currentUser?.name) {
      const byName = record.rows.findIndex(r => r.name === currentUser.name);
      const targetIdx = byName >= 0 ? byName : record.rows.findIndex(r => !r.name.trim());
      if (targetIdx >= 0 && record.rows[targetIdx].name !== currentUser.name) {
        setSelected({ ...record, rows: record.rows.map((r, i) => i === targetIdx ? { ...r, name: currentUser.name } : r) });
        return;
      }
    }
    setSelected(record);
  };

  const openHistory = (r: PersonalHygieneRecord) => { setSelected(r); setShowHistory(false); };
  const isReadOnly = selected ? selected.checkDate !== today : false;
  const filledRows = selected?.rows.filter(r => r.name.trim()) ?? [];
  const allChecked = filledRows.length > 0 && filledRows.every(r => templateCols.every(col => r.checks[col] !== ''));

  // 비관리자: 본인 행 인덱스 (이름 일치 → 없으면 첫 빈 행)
  const myRowIdx: number = (!isAdmin && selected && currentUser?.name)
    ? (() => {
        const byName = selected.rows.findIndex(r => r.name === currentUser.name);
        return byName >= 0 ? byName : selected.rows.findIndex(r => !r.name.trim());
      })()
    : -1;

  const canEditRow = (rowIdx: number) => isAdmin || rowIdx === myRowIdx;

  const toggleCheck = (rowIdx: number, col: string, val: 'O' | 'X') => {
    if (isReadOnly || !canEditRow(rowIdx)) return;
    setSelected(prev => {
      if (!prev) return prev;
      const newVal = prev.rows[rowIdx].checks[col] === val ? '' : val;
      return { ...prev, rows: prev.rows.map((r, i) => i === rowIdx ? { ...r, checks: { ...r.checks, [col]: newVal } } : r) };
    });
  };

  const setRowField = (rowIdx: number, field: 'name' | 'note', val: string) => {
    if (isReadOnly || !canEditRow(rowIdx)) return;
    if (!isAdmin && field === 'name') return; // 비관리자는 이름 변경 불가
    setSelected(prev => prev ? { ...prev, rows: prev.rows.map((r, i) => i === rowIdx ? { ...r, [field]: val } : r) } : prev);
  };

  const addRow = () => setSelected(prev => prev ? {
    ...prev,
    rows: [...prev.rows, { name: '', checks: Object.fromEntries(templateCols.map(k => [k, ''])) as Record<string, 'O' | 'X' | ''>, note: '' }],
  } : prev);

  const revLabel = (r: PersonalHygieneRecord) => r.revisionCount < 0 ? '미저장' : `Rev.${r.revisionCount}`;

  const handleSave = async () => {
    if (!selected || isReadOnly) return;
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data: Omit<PersonalHygieneRecord, 'id'> = { ...selected, inspector: selected.inspector || userName, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now, revisionCount: 0 };
        const ref = await addDoc(collection(db, 'haccp_personal_hygiene'), data);
        setSelected({ ...data, id: ref.id });
      } else {
        const update = { ...selected, updatedBy: userName, updatedAt: now, revisionCount: (selected.revisionCount ?? 0) + 1 };
        await updateDoc(doc(db, 'haccp_personal_hygiene', selected.id), update as any);
        setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !selected?.id) return;
    if (!allChecked) { alert('성명이 입력된 모든 작업자의 항목을 완료 후 확인할 수 있습니다.'); return; }
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateDoc(doc(db, 'haccp_personal_hygiene', selected.id), update);
      setSelected(prev => prev ? { ...prev, ...update } : prev);
    } finally { setConfirming(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 점검표를 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, 'haccp_personal_hygiene', id));
    if (selected?.id === id) setSelected(null);
  };

  const pastRecords = records.filter(r => r.checkDate !== today);

  return (
    <div className="flex flex-col gap-4">
      {/* 오늘 점검 버튼 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3">
          오늘 점검일 <span className="font-bold text-slate-800 ml-1">{today}</span>
          <span className="ml-2 text-slate-400">· 1일 1회</span>
        </div>
        <button onClick={openToday} className={`w-full flex flex-col items-center justify-center gap-1 py-4 rounded-xl border-2 text-sm font-bold transition-all ${
          selected?.checkDate === today ? 'border-blue-500 bg-blue-50 text-blue-700'
          : todayRecord ? 'border-blue-200 bg-blue-50/50 text-blue-600 hover:border-blue-400'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
        }`}>
          <span className="text-base">🧑‍⚕️</span>
          <span>오늘 개인위생 점검</span>
          {todayRecord
            ? <span className="text-xs font-normal text-blue-500">✓ {revLabel(todayRecord)} 저장됨</span>
            : <span className="text-xs font-normal text-slate-400">미작성</span>}
        </button>
      </div>

      {/* 이전 기록 */}
      <button onClick={() => setShowHistory(v => !v)} className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
        <span>이전 점검 기록 ({pastRecords.length}건)</span>
        <span>{showHistory ? '▲' : '▼'}</span>
      </button>
      {showHistory && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {pastRecords.length === 0 && <p className="col-span-full text-xs text-slate-400 py-4 text-center">이전 기록이 없습니다</p>}
          {pastRecords.map(r => (
            <div key={r.id} onClick={() => openHistory(r)} className={`p-3 rounded-lg border cursor-pointer text-xs transition-colors ${selected?.id === r.id ? 'bg-slate-100 border-slate-400' : 'bg-white border-slate-200 hover:border-slate-400'}`}>
              <div className="font-bold text-slate-700">{r.checkDate}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-slate-500">{revLabel(r)}</span>
              {isAdmin && <button onClick={e => { e.stopPropagation(); r.id && handleDelete(r.id); }} className="text-rose-400 hover:text-rose-600"><Trash2 size={11} /></button>}
              </div>
              {r.inspector && <div className="text-slate-400 mt-1 truncate">점검자: {r.inspector}</div>}
            </div>
          ))}
        </div>
      )}

      {!selected && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
          <User size={28} className="text-slate-300" />
          <p className="text-sm">위에서 오늘 점검을 시작해주세요</p>
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-3">
          {/* 액션 바 */}
          <div className="sticky top-0 z-20 flex items-center gap-2 flex-wrap bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 py-2 -mx-6 px-6">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${isReadOnly ? 'bg-slate-100 text-slate-500 border-slate-300' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
              {isReadOnly ? '📋 조회 (수정 불가)' : `✏️ ${revLabel(selected)}`}
            </span>
            <span className="text-xs text-slate-500">{selected.checkDate}</span>
            <div className="ml-auto flex gap-2 flex-wrap justify-end">
              <button onClick={() => printRef.current && downloadAsPDF(printRef.current, `개인위생점검표_${selected.checkDate}.pdf`)} className="flex items-center gap-1 px-3 py-2 bg-slate-600 text-white rounded-lg text-xs font-bold hover:bg-slate-700">
                <FileDown size={12} /> PDF
              </button>
              {canConfirm && (
                selected.confirmedBy
                  ? <span className="flex items-center gap-1 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-bold"><BadgeCheck size={13} /> {selected.confirmedBy} 확인완료</span>
                  : <button onClick={handleConfirm} disabled={confirming || !selected.id || !allChecked}
                      title={!selected.id ? '저장 후 확인' : !allChecked ? '모든 항목 완료 후 확인 가능' : ''}
                      className="flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      <BadgeCheck size={13} /> {confirming ? '처리 중...' : !selected.id ? '저장 먼저' : !allChecked ? '항목 미완료' : '관리자 확인'}
                    </button>
              )}
              {!isReadOnly && (
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                  <Save size={12} /> {saving ? '저장 중...' : '저장'}
                </button>
              )}
            </div>
          </div>

          {/* 인쇄 영역 */}
          <div ref={printRef} className="bg-white border border-slate-200 rounded-xl p-4 md:p-6" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
            <h2 className="text-base md:text-lg font-black text-center mb-4">개인위생점검표</h2>
            <div className="mb-4 text-xs text-slate-600">
              점검일자 : <strong>{selected.checkDate.replace('-', '년 ').replace('-', '월 ')}일</strong>
            </div>

            {/* 모바일 카드 */}
            <div className="flex flex-col gap-2 md:hidden">
              {selected.rows.map((row, rowIdx) => {
                const isMyRow = rowIdx === myRowIdx;
                const rowEditable = !isReadOnly && canEditRow(rowIdx);
                return (
                  <div key={rowIdx} className={`border rounded-xl p-3 ${isMyRow ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-slate-400 font-bold w-5 shrink-0">{rowIdx + 1}</span>
                      {isMyRow && !isReadOnly
                        ? <span className="flex-1 text-sm font-bold text-blue-700 px-2 py-1.5 bg-blue-100 rounded-lg">{row.name} <span className="text-[10px] font-normal text-blue-400 ml-1">(나)</span></span>
                        : isReadOnly || !isAdmin
                          ? <span className="text-sm font-bold text-slate-800">{row.name || '-'}</span>
                          : <input value={row.name} onChange={e => setRowField(rowIdx, 'name', e.target.value)} placeholder="성명" className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      }
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-2">
                      {templateCols.map(col => (
                        <div key={col} className="flex flex-col items-center gap-1">
                          <span className="text-[9px] text-slate-500 font-bold leading-tight text-center">{col}</span>
                          <div className="flex gap-0.5">
                            {(['O', 'X'] as const).map(val => (
                              <button key={val} onClick={() => toggleCheck(rowIdx, col, val)} disabled={!rowEditable}
                                className={`w-6 h-6 rounded text-[10px] font-black border transition-colors ${row.checks[col] === val ? (val === 'O' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500') : rowEditable ? 'bg-white text-slate-400 border-slate-200 hover:border-slate-400' : 'bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed'}`}>
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {!rowEditable
                      ? <span className="text-xs text-slate-600">{row.note}</span>
                      : <input value={row.note} onChange={e => setRowField(rowIdx, 'note', e.target.value)} placeholder="비고" className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none" />}
                  </div>
                );
              })}
              {!isReadOnly && isAdmin && (
                <button onClick={addRow} className="flex items-center justify-center gap-1 py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-xs text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                  <Plus size={13} /> 행 추가
                </button>
              )}
              {!isReadOnly && !isAdmin && myRowIdx < 0 && (
                <div className="text-center text-xs text-rose-500 py-3 bg-rose-50 rounded-xl border border-rose-200">
                  빈 행이 없습니다. 관리자에게 문의해주세요.
                </div>
              )}
            </div>

            {/* 데스크탑 테이블 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse text-xs mb-3">
                <thead>
                  <tr>
                    <th className={TH} style={{ width: 28 }}>No</th>
                    <th className={TH} style={{ width: 72 }}>성명</th>
                    {templateCols.map(col => <th key={col} className={TH} style={{ width: 52 }}>{col}</th>)}
                    <th className={TH}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.rows.map((row, rowIdx) => {
                    const isMyRow = rowIdx === myRowIdx;
                    const rowEditable = !isReadOnly && canEditRow(rowIdx);
                    return (
                    <tr key={rowIdx} className={
                      isMyRow && !isReadOnly ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' :
                      Object.values(row.checks).some(v => v === 'X') ? 'bg-rose-50' : ''
                    }>
                      <td className={TD}>{rowIdx + 1}</td>
                      <td className={TD}>
                        {isMyRow && !isReadOnly
                          ? <span className="font-bold text-blue-700">{row.name}<span className="text-[9px] text-blue-400 ml-1">(나)</span></span>
                          : isReadOnly || !isAdmin
                            ? row.name
                            : <input value={row.name} onChange={e => setRowField(rowIdx, 'name', e.target.value)} placeholder="성명" className="w-full text-xs border-none outline-none bg-transparent text-center" />
                        }
                      </td>
                      {templateCols.map(col => (
                        <td key={col} className={TD}>
                          {!rowEditable
                            ? <span className={row.checks[col] === 'O' ? 'text-emerald-600 font-black' : row.checks[col] === 'X' ? 'text-rose-600 font-black' : 'text-slate-300'}>{row.checks[col] || '-'}</span>
                            : <div className="flex gap-0.5 justify-center">
                                {(['O', 'X'] as const).map(val => (
                                  <button key={val} onClick={() => toggleCheck(rowIdx, col, val)}
                                    className={`w-6 h-6 rounded text-[10px] font-black border transition-colors ${row.checks[col] === val ? (val === 'O' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500') : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                                    {val}
                                  </button>
                                ))}
                              </div>
                          }
                        </td>
                      ))}
                      <td className={TDL}>
                        {!rowEditable ? row.note
                          : <input value={row.note} onChange={e => setRowField(rowIdx, 'note', e.target.value)} placeholder="비고" className="w-full text-xs border-none outline-none bg-transparent" />}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {!isReadOnly && isAdmin && (
                <button onClick={addRow} className="flex items-center gap-1 px-3 py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                  <Plus size={12} /> 행 추가
                </button>
              )}
            </div>

            <div className="mt-3 text-xs font-bold text-slate-700">※이상 발생 시 즉시 작업 배제 및 보고</div>

            {/* 서명란 */}
            <div className="grid grid-cols-2 gap-3 mt-4 md:flex md:justify-end md:gap-4 text-xs">
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">점검자</div>
                <div className="h-10 flex items-center justify-center">
                  {isReadOnly
                    ? <span className="text-slate-700 font-semibold">{selected.inspector || '-'}</span>
                    : <input value={selected.inspector} onChange={e => setSelected(prev => prev ? { ...prev, inspector: e.target.value } : prev)} placeholder={currentUser?.name ?? '이름'} className="w-full text-xs text-center border-none outline-none bg-transparent font-semibold" />}
                </div>
              </div>
              <div className="border border-slate-400 text-center md:w-28">
                <div className="bg-slate-100 text-xs font-bold py-1 border-b border-slate-400">확인자</div>
                <div className="h-10 flex items-center justify-center">
                  {selected.confirmedBy
                    ? <span className="text-slate-700 font-semibold">{selected.confirmedBy}</span>
                    : canConfirm && selected.id && allChecked
                      ? <button onClick={handleConfirm} disabled={confirming} className="flex items-center gap-1 px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-40">
                          <BadgeCheck size={11} /> {confirming ? '처리 중...' : '확인'}
                        </button>
                      : canConfirm && !selected.id ? <span className="text-slate-300 text-[10px]">저장 후 확인</span>
                      : canConfirm ? <span className="text-slate-300 text-[10px]">항목 완료 후</span>
                      : <span className="text-slate-200 text-xs">-</span>}
                </div>
              </div>
            </div>

            {selected.id && (
              <div className="mt-3 text-xs text-slate-400 text-right">
                최초 작성: {selected.createdBy} ({selected.createdAt?.slice(0, 16).replace('T', ' ')})
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 개인위생 템플릿 에디터 (관리자 전용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const PersonalHygieneTemplateEditor: React.FC = () => {
  const [cols, setCols] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newCol, setNewCol] = useState('');

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'personal_hygiene'), snap => {
      if (snap.exists()) {
        const data = snap.data().cols;
        if (Array.isArray(data) && data.length > 0) { setCols(data); return; }
      }
      setCols([...PERSONAL_HYGIENE_COLS]);
    });
  }, []);

  const handleSave = async () => {
    const valid = cols.filter(c => c.trim());
    if (valid.length === 0) { alert('항목을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'haccp_templates', 'personal_hygiene'), { cols: valid });
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
          <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
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
  const [zones, setZones] = useState<StorageZone[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'temp_zones'), snap => {
      if (snap.exists()) {
        const data = snap.data().zones;
        if (Array.isArray(data) && data.length > 0) { setZones(data); return; }
      }
      setZones([...STORAGE_ZONES]);
    });
  }, []);

  const handleSave = async () => {
    const valid = zones.filter(z => z.name.trim());
    if (valid.length === 0) { alert('보관장소를 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'haccp_templates', 'temp_zones'), { zones: valid });
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
          <div key={idx} className="grid grid-cols-12 gap-1 items-center bg-slate-50 rounded-lg p-2">
            <div className="col-span-1 text-xs text-slate-400 text-center font-bold">{idx + 1}</div>
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
  const [items, setItems] = useState<{ item: string; standard: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'sanitation'), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) { setItems(data); return; }
      }
      setItems([...SANITATION_ITEMS]);
    });
  }, []);

  const handleSave = async () => {
    const validItems = items.filter(it => it.item.trim());
    if (validItems.length === 0) { alert('항목명을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'haccp_templates', 'sanitation'), { items: validItems });
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
          <div key={idx} className="grid grid-cols-12 gap-1 items-center bg-slate-50 rounded-lg p-2">
            <div className="col-span-1 text-xs text-slate-400 text-center font-bold">{idx + 1}</div>
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
export const StaffChecklistView: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean }> = ({ currentUser, isAdmin }) => {
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
  return (
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
          {STAFF_TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id ? activeColor[tab.color] : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}>
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
  const templateKey = cycle === 'weekly' ? 'weekly_sanitation' : 'monthly_sanitation';
  const defaultItems = cycle === 'weekly' ? WEEKLY_ITEMS_DEFAULT : MONTHLY_ITEMS_DEFAULT;
  const [items, setItems] = useState<{ item: string; standard: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', templateKey), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) { setItems(data); return; }
      }
      setItems([...defaultItems]);
    });
  }, [cycle]);

  const handleSave = async () => {
    const validItems = items.filter(it => it.item.trim());
    if (validItems.length === 0) { alert('항목명을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'haccp_templates', templateKey), { items: validItems });
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
          <div key={idx} className="flex items-center gap-2">
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

const PeriodicSanitationForm: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean; canConfirm?: boolean }> = ({ currentUser, isAdmin, canConfirm }) => {
  const [cycle, setCycle] = useState<PeriodCycle>('weekly');
  const [weekPeriod, setWeekPeriod] = useState(currentWeekStr());
  const [monthPeriod, setMonthPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [weekItems, setWeekItems] = useState<{ item: string; standard: string }[]>(WEEKLY_ITEMS_DEFAULT);
  const [monthItems, setMonthItems] = useState<{ item: string; standard: string }[]>(MONTHLY_ITEMS_DEFAULT);
  const [records, setRecords] = useState<PeriodRecord[]>([]);
  const [selected, setSelected] = useState<PeriodRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  const period = cycle === 'weekly' ? weekPeriod : monthPeriod;
  const items = cycle === 'weekly' ? weekItems : monthItems;
  const cycleName = cycle === 'weekly' ? '주간' : '월간';

  useEffect(() => {
    const q = query(collection(db, 'haccp_periodic_sanitation'), orderBy('period', 'desc'));
    return onSnapshot(q, snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as PeriodRecord)));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'weekly_sanitation'), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setWeekItems(data);
      }
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'monthly_sanitation'), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setMonthItems(data);
      }
    });
  }, []);

  const currentRecord = records.find(r => r.cycle === cycle && r.period === period);

  // 주기/기간이 바뀌면 해당 기록으로 자동 초기화
  useEffect(() => {
    const existing = records.find(r => r.cycle === cycle && r.period === period);
    setSelected(existing ?? ({ ...emptyPeriodRecord(cycle, period, items) } as PeriodRecord));
    setSaveError('');
  }, [cycle, period]);

  // Firestore 기록이 뒤늦게 로드됐을 때 미저장 상태면 동기화
  useEffect(() => {
    const existing = records.find(r => r.cycle === cycle && r.period === period);
    if (existing && !selected?.id) setSelected(existing);
  }, [records]);

  const openHistory = (r: PeriodRecord) => {
    setSelected(r);
    setSaveError('');
    setShowHistory(false);
  };

  // 실제 이번 주/이번 달만 작성 가능
  const actualCurrentPeriod = cycle === 'weekly' ? currentWeekStr() : new Date().toISOString().slice(0, 7);
  const isReadOnly = period !== actualCurrentPeriod;

  // 템플릿 항목이 추가돼 rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: PeriodRow[]): PeriodRow[] =>
    rows.length >= items.length
      ? rows
      : [...rows, ...items.slice(rows.length).map((): PeriodRow => ({ result: '', note: '', inspector: '' }))];

  const toggleResult = (idx: number, val: 'pass' | 'fail') => {
    if (isReadOnly) return;
    const userName = currentUser?.name ?? '';
    setSelected(prev => {
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
    setSelected(prev => prev ? { ...prev, rows: padRows(prev.rows).map((r, i) => i === idx ? { ...r, [field]: val } : r) } : prev);
  };

  const handleSave = async () => {
    if (!selected || isReadOnly) return;
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (items[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) { setSaveError(`부적합 항목의 비고사항을 입력해주세요: ${missingNote.join(', ')}`); return; }
    setSaveError('');
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data: Omit<PeriodRecord, 'id'> = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now };
        const ref = await addDoc(collection(db, 'haccp_periodic_sanitation'), data);
        setSelected({ ...data, id: ref.id });
      } else {
        const update = { ...selected, updatedBy: userName, updatedAt: now };
        await updateDoc(doc(db, 'haccp_periodic_sanitation', selected.id), update as any);
        setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    if (!selected?.id) { alert('점검표를 먼저 저장해주세요.'); return; }
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateDoc(doc(db, 'haccp_periodic_sanitation', selected.id), update);
      const confirmed = { ...selected, ...update };
      setSelected(confirmed);
      if (window.confirm('확인 처리되었습니다.\nPDF 파일을 만들겠습니까?')) {
        if (printRef.current) await downloadAsPDF(printRef.current, `작업장위생점검표_${cycleName}_${selected.period}.pdf`);
      }
    } finally { setConfirming(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 점검표를 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, 'haccp_periodic_sanitation', id));
    if (selected?.id === id) setSelected(null);
  };

  const resultBadge = (result: PeriodRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  const pastRecords = records.filter(r => r.cycle === cycle && !(r.cycle === cycle && r.period === period));

  return (
    <div className="flex flex-col gap-4">
      {/* 주간/월간 서브 탭 + 기간 선택 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex gap-2 mb-4">
          {(['weekly', 'monthly'] as PeriodCycle[]).map(c => (
            <button
              key={c}
              onClick={() => { setCycle(c); setSaveError(''); }}
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
            <input type="week" value={weekPeriod} onChange={e => setWeekPeriod(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs" />
          ) : (
            <input type="month" value={monthPeriod} onChange={e => setMonthPeriod(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs" />
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
                <button onClick={handleSave} disabled={saving}
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
                    : <input value={selected.checkZone ?? ''} onChange={e => setSelected(p => p ? { ...p, checkZone: e.target.value } : p)}
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
                onChange={e => !isReadOnly && setSelected(prev => prev ? { ...prev, specialNotes: e.target.value } : prev)}
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
    </div>
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
  const [items, setItems] = useState<{ item: string; standard: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'closing_checklist'), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) { setItems(data); return; }
      }
      setItems([...CLOSING_ITEMS_DEFAULT]);
    });
  }, []);

  const handleSave = async () => {
    const validItems = items.filter(it => it.item.trim());
    if (validItems.length === 0) { alert('항목명을 1개 이상 입력해주세요.'); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, 'haccp_templates', 'closing_checklist'), { items: validItems });
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
          <div key={idx} className="flex items-center gap-2">
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
  const [checkDate, setCheckDate] = useState(todayStr());
  const [templateItems, setTemplateItems] = useState<{ item: string; standard: string }[]>(CLOSING_ITEMS_DEFAULT);
  const [records, setRecords] = useState<ClosingRecord[]>([]);
  const [selected, setSelected] = useState<ClosingRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [saveError, setSaveError] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(collection(db, 'haccp_closing_checklist'), orderBy('checkDate', 'desc'));
    return onSnapshot(q, snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClosingRecord)));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'haccp_templates', 'closing_checklist'), snap => {
      if (snap.exists()) {
        const data = snap.data().items;
        if (Array.isArray(data) && data.length > 0) setTemplateItems(data);
      }
    });
  }, []);

  // 날짜가 바뀌면 해당 날짜 기록으로 자동 초기화
  useEffect(() => {
    const existing = records.find(r => r.checkDate === checkDate);
    setSelected(existing ?? ({ ...emptyClosingRecord(checkDate, templateItems) } as ClosingRecord));
    setSaveError('');
  }, [checkDate]);

  useEffect(() => {
    const existing = records.find(r => r.checkDate === checkDate);
    if (existing && !selected?.id) setSelected(existing);
  }, [records]);

  const isReadOnly = checkDate !== todayStr();

  // 템플릿 항목이 추가돼(예: 6·7번) rows 길이가 부족하면 빈 행으로 채워 인덱스 접근 오류 방지
  const padRows = (rows: PeriodRow[]): PeriodRow[] =>
    rows.length >= templateItems.length
      ? rows
      : [...rows, ...templateItems.slice(rows.length).map((): PeriodRow => ({ result: '', note: '', inspector: '' }))];

  const toggleResult = (idx: number, val: 'pass' | 'fail') => {
    if (isReadOnly) return;
    const userName = currentUser?.name ?? '';
    setSelected(prev => {
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
    setSelected(prev => prev ? { ...prev, rows: padRows(prev.rows).map((r, i) => i === idx ? { ...r, [field]: val } : r) } : prev);
  };

  const handleSave = async () => {
    if (!selected || isReadOnly) return;
    const missingNote = selected.rows
      .map((r, i) => r.result === 'fail' && !r.note.trim() ? (templateItems[i]?.item ?? `항목 ${i + 1}`) : null)
      .filter(Boolean) as string[];
    if (missingNote.length > 0) { setSaveError(`부적합 항목의 비고사항을 입력해주세요: ${missingNote.join(', ')}`); return; }
    setSaveError('');
    setSaving(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '알 수 없음';
    try {
      if (!selected.id) {
        const data: Omit<ClosingRecord, 'id'> = { ...selected, createdBy: userName, createdAt: now, updatedBy: userName, updatedAt: now };
        const ref = await addDoc(collection(db, 'haccp_closing_checklist'), data);
        setSelected({ ...data, id: ref.id });
      } else {
        const update = { ...selected, updatedBy: userName, updatedAt: now };
        await updateDoc(doc(db, 'haccp_closing_checklist', selected.id), update as any);
        setSelected(prev => prev ? { ...prev, ...update } : prev);
      }
    } finally { setSaving(false); }
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    if (!selected?.id) { alert('점검표를 먼저 저장해주세요.'); return; }
    setConfirming(true);
    const now = new Date().toISOString();
    const userName = currentUser?.name ?? '관리자';
    try {
      const update = { confirmedBy: userName, confirmedAt: now };
      await updateDoc(doc(db, 'haccp_closing_checklist', selected.id), update);
      const confirmed = { ...selected, ...update };
      setSelected(confirmed);
      if (window.confirm('확인 처리되었습니다.\nPDF 파일을 만들겠습니까?')) {
        if (printRef.current) await downloadAsPDF(printRef.current, `마감체크리스트_${selected.checkDate}.pdf`);
      }
    } finally { setConfirming(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('이 체크리스트를 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, 'haccp_closing_checklist', id));
    if (selected?.id === id) setSelected(null);
  };

  const resultBadge = (result: PeriodRow['result']) => {
    if (result === 'pass') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">적합</span>;
    if (result === 'fail') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">부적합</span>;
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-400">미입력</span>;
  };

  const pastRecords = records.filter(r => r.checkDate !== todayStr());
  const currentRecord = records.find(r => r.checkDate === checkDate);

  return (
    <div className="flex flex-col gap-4">
      {/* 날짜 선택 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">점검일자:</span>
          <input type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs" />
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
            <button key={r.id} onClick={() => { setCheckDate(r.checkDate); setShowHistory(false); }}
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
              <button onClick={handleSave} disabled={saving}
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
                  : <input value={selected.checkZone ?? ''} onChange={e => setSelected(p => p ? { ...p, checkZone: e.target.value } : p)}
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
              onChange={e => !isReadOnly && setSelected(prev => prev ? { ...prev, specialNotes: e.target.value } : prev)}
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
    </div>
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

const HaccpChecklist: React.FC<{ currentUser?: { id: string; name: string }; isAdmin?: boolean }> = ({ currentUser, isAdmin }) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
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
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-emerald-50 text-emerald-700 font-bold'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
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
  );
};

export default HaccpChecklist;
