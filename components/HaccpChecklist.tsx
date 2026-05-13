import React, { useState, useRef } from 'react';
import { FileDown, ClipboardList, Thermometer, Bug, CheckSquare, Scan, ShoppingCart, Wrench } from 'lucide-react';

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
type TabId = 'overview' | 'daily' | 'pest' | 'temp' | 'ccp-heat' | 'ccp-metal' | 'incoming' | 'cleaning';

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
  { id: 'ref1', name: '냉장창고 1', standard: '0~10℃' },
  { id: 'ref2', name: '냉장창고 2', standard: '0~10℃' },
  { id: 'fz1', name: '냉동창고', standard: '-18℃ 이하' },
  { id: 'rm1', name: '원료 보관실', standard: '실온(15~25℃)' },
];

interface TempRow {
  date: string;
  zone: string;
  amTemp: string;
  pmTemp: string;
  result: '' | 'O' | 'X';
  corrective: string;
  inspector: string;
}

const TempForm: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<TempRow[]>(() =>
    STORAGE_ZONES.map(z => ({ date: '', zone: z.id, amTemp: '', pmTemp: '', result: '', corrective: '', inspector: '' }))
  );
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: '', zone: STORAGE_ZONES[0].id, amTemp: '', pmTemp: '', result: '', corrective: '', inspector: '' }]);
  const update = (idx: number, field: keyof TempRow, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_온도관리일지_${month}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
        <FormHeader title="냉장·냉동창고 온도관리 일지" date={month} />

        <div className="mb-3 text-xs">
          <table className="border-collapse w-full mb-2">
            <thead>
              <tr>
                <th className={TH}>보관장소</th>
                <th className={TH}>관리기준</th>
                <th className={TH}>비고</th>
              </tr>
            </thead>
            <tbody>
              {STORAGE_ZONES.map(z => (
                <tr key={z.id}>
                  <td className={TD}>{z.name}</td>
                  <td className={TD}>{z.standard}</td>
                  <td className={TDL}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500 mb-2">※ 1일 1회 이상 측정 / O: 기준 내 / X: 기준 이탈 (이탈 시 개선조치 기재)</p>

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={TH}>측정일</th>
              <th className={TH}>보관장소</th>
              <th className={TH}>오전온도(℃)</th>
              <th className={TH}>오후온도(℃)</th>
              <th className={TH}>적합여부</th>
              <th className={TH} style={{ width: 130 }}>개선조치</th>
              <th className={TH}>측정자</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td className={TD}>
                  <input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" />
                </td>
                <td className={TD}>
                  <select value={row.zone} onChange={e => update(idx, 'zone', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                    {STORAGE_ZONES.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </td>
                <td className={TD}>
                  <input value={row.amTemp} onChange={e => update(idx, 'amTemp', e.target.value)} placeholder="예: 5.2" className="w-14 text-xs border-none outline-none bg-transparent text-center" />
                </td>
                <td className={TD}>
                  <input value={row.pmTemp} onChange={e => update(idx, 'pmTemp', e.target.value)} placeholder="예: 6.1" className="w-14 text-xs border-none outline-none bg-transparent text-center" />
                </td>
                <td className={TD}>
                  <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                    <option value="">-</option>
                    <option value="O">O</option>
                    <option value="X">X</option>
                  </select>
                </td>
                <td className={TDL}>
                  <input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" />
                </td>
                <td className={TD}>
                  <input value={row.inspector} onChange={e => update(idx, 'inspector', e.target.value)} className="w-16 text-xs border-none outline-none bg-transparent text-center" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <SignBox />
      </div>
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
  supplier: string;
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

const IncomingForm: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<IncomingRow[]>([
    { date: '', supplier: '', material: RAW_MATERIALS[0], materialType: '원료', quantity: '', unit: 'kg', lotNo: '', expDate: '', appearance: '', packaging: '', label: '', certAvail: '', result: '', corrective: '', inspector: '' },
  ]);
  const ref = useRef<HTMLDivElement>(null);

  const addRow = () => setRows(prev => [...prev, { date: '', supplier: '', material: RAW_MATERIALS[0], materialType: '원료', quantity: '', unit: 'kg', lotNo: '', expDate: '', appearance: '', packaging: '', label: '', certAvail: '', result: '', corrective: '', inspector: '' }]);
  const update = (idx: number, field: keyof IncomingRow, value: string) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  const resultColor = (r: IncomingRow['result']) => r === '합격' ? 'text-green-600' : r === '불합격' ? 'text-rose-600' : r === '조건부합격' ? 'text-amber-600' : '';

  return (
    <div>
      <div className="flex gap-3 mb-3 flex-wrap">
        <label className="text-xs text-slate-600 flex items-center gap-1">
          관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
        </label>
        <button onClick={addRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
        <button
          onClick={() => ref.current && downloadAsPDF(ref.current, `HACCP_입고검사일지_${month}.pdf`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
        >
          <FileDown size={13} /> PDF 저장
        </button>
      </div>

      <div ref={ref} className="bg-white p-6 font-sans" style={{ fontFamily: 'Malgun Gothic, sans-serif' }}>
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
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className={TD}><input type="date" value={row.date} onChange={e => update(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" /></td>
                  <td className={TDL}><input value={row.supplier} onChange={e => update(idx, 'supplier', e.target.value)} className="w-20 text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}>
                    <select value={row.material} onChange={e => update(idx, 'material', e.target.value)} className="text-xs border-none outline-none bg-transparent max-w-20">
                      <optgroup label="원료">{RAW_MATERIALS.map(m => <option key={m}>{m}</option>)}</optgroup>
                      <optgroup label="부자재">{SUB_MATERIALS.map(m => <option key={m}>{m}</option>)}</optgroup>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.materialType} onChange={e => update(idx, 'materialType', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      <option>원료</option>
                      <option>부자재</option>
                    </select>
                  </td>
                  <td className={TD}><input value={row.quantity} onChange={e => update(idx, 'quantity', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}>
                    <select value={row.unit} onChange={e => update(idx, 'unit', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                      {['kg', 'g', 'L', '개', '본', '장', '롤'].map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className={TD}><input value={row.lotNo} onChange={e => update(idx, 'lotNo', e.target.value)} className="w-16 text-xs border-none outline-none bg-transparent text-center" /></td>
                  <td className={TD}><input type="date" value={row.expDate} onChange={e => update(idx, 'expDate', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" /></td>
                  {(['appearance', 'packaging', 'label'] as const).map(f => (
                    <td key={f} className={TD}>
                      <select value={row[f]} onChange={e => update(idx, f, e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row[f] === 'X' ? 'text-rose-600' : row[f] === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                  ))}
                  <td className={TD}>
                    <select value={row.certAvail} onChange={e => update(idx, 'certAvail', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.certAvail === 'X' ? 'text-rose-600' : row.certAvail === 'O' ? 'text-green-600' : ''}`}>
                      <option value="">-</option>
                      <option value="O">O</option>
                      <option value="X">X</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </td>
                  <td className={TD}>
                    <select value={row.result} onChange={e => update(idx, 'result', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${resultColor(row.result)}`}>
                      <option value="">-</option>
                      <option value="합격">합격</option>
                      <option value="불합격">불합격</option>
                      <option value="조건부합격">조건부합격</option>
                    </select>
                  </td>
                  <td className={TDL}><input value={row.corrective} onChange={e => update(idx, 'corrective', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" /></td>
                  <td className={TD}><input value={row.inspector} onChange={e => update(idx, 'inspector', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
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

const CleaningForm: React.FC = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [machineRows, setMachineRows] = useState<MachineCleanRow[]>(
    MACHINES.map(m => ({ date: '', machine: m.name, used: '', cleanMethod: m.method, sanitizer: '', result: '', cleaner: '', verifier: '', note: '' }))
  );
  const [areaRows, setAreaRows] = useState<AreaCleanRow[]>(
    CLEAN_AREAS.map(a => ({ date: '', area: a, result: '', sanitized: '', sanitizer: '', cleaner: '', note: '' }))
  );
  const machineRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const addMachineRow = () =>
    setMachineRows(prev => [...prev, { date: '', machine: MACHINE_NAMES[0], used: '', cleanMethod: MACHINES[0].method, sanitizer: '', result: '', cleaner: '', verifier: '', note: '' }]);
  const updateMachine = (idx: number, field: keyof MachineCleanRow, value: string) =>
    setMachineRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  const addAreaRow = () =>
    setAreaRows(prev => [...prev, { date: '', area: CLEAN_AREAS[0], result: '', sanitized: '', sanitizer: '', cleaner: '', note: '' }]);
  const updateArea = (idx: number, field: keyof AreaCleanRow, value: string) =>
    setAreaRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));

  return (
    <div className="space-y-8">
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
          <label className="text-xs text-slate-600 flex items-center gap-1 ml-2">
            관리월: <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
          </label>
          <button onClick={addMachineRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50">+ 행 추가</button>
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
                      <input type="date" value={row.date} onChange={e => updateMachine(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" />
                    </td>
                    <td className={TD}>
                      <select value={row.machine} onChange={e => updateMachine(idx, 'machine', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                        {MACHINE_NAMES.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.used} onChange={e => updateMachine(idx, 'used', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.used === 'X' ? 'text-slate-400' : row.used === 'O' ? 'text-slate-700' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O(사용)</option>
                        <option value="X">X(미사용)</option>
                      </select>
                    </td>
                    <td className={TDL}>
                      <input value={row.cleanMethod} onChange={e => updateMachine(idx, 'cleanMethod', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" placeholder="세척방법 기재" />
                    </td>
                    <td className={TD}>
                      <select value={row.sanitizer} onChange={e => updateMachine(idx, 'sanitizer', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                        <option value="">선택</option>
                        {SANITIZERS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => updateMachine(idx, 'result', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td className={TD}><input value={row.cleaner} onChange={e => updateMachine(idx, 'cleaner', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                    <td className={TD}><input value={row.verifier} onChange={e => updateMachine(idx, 'verifier', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                    <td className={TDL}><input value={row.note} onChange={e => updateMachine(idx, 'note', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" /></td>
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
          <button onClick={addAreaRow} className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 ml-2">+ 행 추가</button>
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
                      <input type="date" value={row.date} onChange={e => updateArea(idx, 'date', e.target.value)} className="text-xs border-none outline-none bg-transparent w-24" />
                    </td>
                    <td className={TD}>
                      <select value={row.area} onChange={e => updateArea(idx, 'area', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                        {CLEAN_AREAS.map(a => <option key={a}>{a}</option>)}
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.result} onChange={e => updateArea(idx, 'result', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.result === 'X' ? 'text-rose-600' : row.result === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O</option>
                        <option value="X">X</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.sanitized} onChange={e => updateArea(idx, 'sanitized', e.target.value)} className={`text-xs border-none outline-none bg-transparent font-bold ${row.sanitized === 'X' ? 'text-rose-600' : row.sanitized === 'O' ? 'text-green-600' : ''}`}>
                        <option value="">-</option>
                        <option value="O">O(실시)</option>
                        <option value="X">X(미실시)</option>
                        <option value="N/A">N/A</option>
                      </select>
                    </td>
                    <td className={TD}>
                      <select value={row.sanitizer} onChange={e => updateArea(idx, 'sanitizer', e.target.value)} className="text-xs border-none outline-none bg-transparent">
                        <option value="">선택</option>
                        {SANITIZERS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={TD}><input value={row.cleaner} onChange={e => updateArea(idx, 'cleaner', e.target.value)} className="w-12 text-xs border-none outline-none bg-transparent text-center" /></td>
                    <td className={TDL}><input value={row.note} onChange={e => updateArea(idx, 'note', e.target.value)} className="w-full text-xs border-none outline-none bg-transparent" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SignBox />
        </div>
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 HaccpChecklist 컴포넌트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TABS: { id: TabId; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'overview',  label: '사후평가 점검표',    icon: <ClipboardList size={14} />, desc: '소규모 HACCP 20항목 사후평가' },
  { id: 'daily',    label: '일반위생관리',        icon: <CheckSquare size={14} />,   desc: '일일/주간/월간/반기/연간 위생점검' },
  { id: 'cleaning', label: '세척·소독 일지',      icon: <Wrench size={14} />,        desc: '기계·설비(착유기·볶음기·필터프레스) 및 작업구역 청소소독 기록' },
  { id: 'pest',     label: '방충·방서 점검',      icon: <Bug size={14} />,           desc: '하절기 주 1회 / 동절기 월 1회' },
  { id: 'temp',     label: '온도관리 일지',        icon: <Thermometer size={14} />,   desc: '냉장·냉동창고 온도 기록' },
  { id: 'ccp-heat', label: 'CCP-B 가열·살균',    icon: <Scan size={14} />,          desc: '가열공정 온도·시간 모니터링' },
  { id: 'ccp-metal',label: 'CCP-P 금속검출',     icon: <Scan size={14} />,          desc: 'Fe 2.0㎜ / Sus 2.5㎜ 불검출' },
  { id: 'incoming', label: '입고검사일지',         icon: <ShoppingCart size={14} />,  desc: '원료·부자재 입고검사' },
];

const HaccpChecklist: React.FC = () => {
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
        {activeTab === 'cleaning'  && <CleaningForm />}
        {activeTab === 'pest'      && <PestForm />}
        {activeTab === 'temp'      && <TempForm />}
        {activeTab === 'ccp-heat'  && <CCPHeatForm />}
        {activeTab === 'ccp-metal' && <CCPMetalForm />}
        {activeTab === 'incoming'  && <IncomingForm />}
      </div>
    </div>
  );
};

export default HaccpChecklist;
