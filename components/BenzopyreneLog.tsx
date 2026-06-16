import React, { useEffect, useRef, useState } from 'react';
import { FlaskConical, Plus, Trash2, FileDown, Save, X } from 'lucide-react';
import { db } from '../src/shared/firebase';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';

// 벤조피렌 시험 검사성적서 1건
interface BenzopyreneTest {
  id: string;
  productName: string;    // 제품명
  receivedDate: string;   // 접수 연월일
  completedDate: string;  // 검사 완료일
  testItem: string;       // 검사항목 (기본 '벤조피렌')
  criteria: string;       // 시험 검사 기준
  result: string;         // 검사결과
  judgment: '적합' | '부적합' | '';  // 판정
  lotNo?: string;         // (선택) 로트번호
  createdAt: string;
  addedBy?: string;
}

const COL = 'border border-slate-300 px-2 py-1.5 text-xs';
const DEFAULT_CRITERIA = '2.0 μg/kg 이하';
const todayStr = () => new Date().toISOString().slice(0, 10);

interface Props {
  currentUserName?: string;
  isAdmin?: boolean;
}

const emptyDraft = (): Omit<BenzopyreneTest, 'id' | 'createdAt'> => ({
  productName: '', receivedDate: todayStr(), completedDate: todayStr(),
  testItem: '벤조피렌', criteria: DEFAULT_CRITERIA, result: '', judgment: '', lotNo: '',
});

const BenzopyreneLog: React.FC<Props> = ({ currentUserName, isAdmin = false }) => {
  const [rows, setRows] = useState<BenzopyreneTest[]>([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<BenzopyreneTest | null>(null);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // 이 탭을 열 때만 구독 (읽기 절약). 작은 컬렉션.
  useEffect(() => {
    const q = query(collection(db, 'benzopyreneTests'), orderBy('completedDate', 'desc'));
    const unsub = onSnapshot(q,
      snap => setRows(snap.docs.map(d => ({ id: d.id, ...d.data() } as BenzopyreneTest))),
      err => console.error('[벤조피렌] 구독 실패:', err));
    return () => unsub();
  }, []);

  const addRow = async () => {
    if (!draft.productName.trim()) { alert('제품명을 입력해주세요.'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'benzopyreneTests'), {
        ...draft,
        productName: draft.productName.trim(),
        result: draft.result.trim(),
        createdAt: new Date().toISOString(),
        ...(currentUserName ? { addedBy: currentUserName } : {}),
      });
      setDraft(emptyDraft());
    } catch (e) {
      console.error('[벤조피렌] 저장 실패:', e);
      alert('저장 실패: ' + ((e as Error)?.message ?? e));
    } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    try {
      const { id, ...data } = editRow;
      await updateDoc(doc(db, 'benzopyreneTests', id), data as Record<string, unknown>);
      setEditingId(null); setEditRow(null);
    } catch (e) {
      console.error('[벤조피렌] 수정 실패:', e);
      alert('수정 실패: ' + ((e as Error)?.message ?? e));
    } finally { setSaving(false); }
  };

  const removeRow = async (id: string) => {
    if (!confirm('이 검사 기록을 삭제할까요?')) return;
    try { await deleteDoc(doc(db, 'benzopyreneTests', id)); }
    catch (e) { console.error('[벤조피렌] 삭제 실패:', e); alert('삭제 실패: ' + ((e as Error)?.message ?? e)); }
  };

  const downloadPDF = async () => {
    if (!tableRef.current) return;
    const { default: jsPDF } = await import('jspdf') as any;
    const { default: html2canvas } = await import('html2canvas') as any;
    const canvas = await html2canvas(tableRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pdf = new jsPDF('l', 'mm', 'a4');
    const w = 297, h = (canvas.height * w) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, Math.min(h, 210));
    pdf.save(`벤조피렌_검사성적서_${todayStr()}.pdf`);
  };

  const judgeCls = (j: string) => j === '적합' ? 'text-emerald-600 font-black' : j === '부적합' ? 'text-rose-600 font-black' : 'text-slate-400';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-indigo-500" />
          <h3 className="text-sm font-black text-slate-800">벤조피렌 시험 검사성적서</h3>
          <span className="text-[11px] font-bold text-slate-400">{rows.length}건</span>
        </div>
        <button onClick={downloadPDF} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-black hover:bg-slate-200 transition-colors">
          <FileDown size={13} /> PDF 다운로드
        </button>
      </div>

      {/* 입력 폼 */}
      {isAdmin && (
        <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="제품명">
            <input value={draft.productName} onChange={e => setDraft(d => ({ ...d, productName: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400" placeholder="제품명 입력" />
          </Field>
          <Field label="접수 연월일">
            <input type="date" value={draft.receivedDate} onChange={e => setDraft(d => ({ ...d, receivedDate: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400" />
          </Field>
          <Field label="검사 완료일">
            <input type="date" value={draft.completedDate} onChange={e => setDraft(d => ({ ...d, completedDate: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400" />
          </Field>
          <Field label="시험 검사 기준">
            <input value={draft.criteria} onChange={e => setDraft(d => ({ ...d, criteria: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400" />
          </Field>
          <Field label="검사결과">
            <input value={draft.result} onChange={e => setDraft(d => ({ ...d, result: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400" placeholder="예: 불검출 / 0.5 μg/kg" />
          </Field>
          <Field label="판정">
            <select value={draft.judgment} onChange={e => setDraft(d => ({ ...d, judgment: e.target.value as BenzopyreneTest['judgment'] }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white">
              <option value="">선택</option><option value="적합">적합</option><option value="부적합">부적합</option>
            </select>
          </Field>
          <Field label="로트번호 (선택)">
            <input value={draft.lotNo} onChange={e => setDraft(d => ({ ...d, lotNo: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400" placeholder="예: 260616-01" />
          </Field>
          <div className="flex items-end">
            <button onClick={addRow} disabled={saving} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              <Plus size={14} /> {saving ? '저장 중…' : '검사 기록 추가'}
            </button>
          </div>
        </div>
      )}

      {/* 표 */}
      <div ref={tableRef} className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className={`${COL} font-black`}>제품명</th>
              <th className={`${COL} font-black`}>접수 연월일</th>
              <th className={`${COL} font-black`}>검사 완료일</th>
              <th className={`${COL} font-black`}>검사항목</th>
              <th className={`${COL} font-black`}>시험 검사 기준</th>
              <th className={`${COL} font-black`}>검사결과</th>
              <th className={`${COL} font-black`}>판정</th>
              <th className={`${COL} font-black`}>로트</th>
              {isAdmin && <th className={`${COL} font-black w-20`}>관리</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className={`${COL} text-center text-slate-300 py-6`} colSpan={isAdmin ? 9 : 8}>검사 기록이 없습니다</td></tr>
            )}
            {rows.map(r => editingId === r.id && editRow ? (
              <tr key={r.id} className="bg-amber-50">
                <td className={COL}><input value={editRow.productName} onChange={e => setEditRow({ ...editRow, productName: e.target.value })} className="w-full border rounded px-1 py-0.5" /></td>
                <td className={COL}><input type="date" value={editRow.receivedDate} onChange={e => setEditRow({ ...editRow, receivedDate: e.target.value })} className="w-full border rounded px-1 py-0.5" /></td>
                <td className={COL}><input type="date" value={editRow.completedDate} onChange={e => setEditRow({ ...editRow, completedDate: e.target.value })} className="w-full border rounded px-1 py-0.5" /></td>
                <td className={COL}><input value={editRow.testItem} onChange={e => setEditRow({ ...editRow, testItem: e.target.value })} className="w-full border rounded px-1 py-0.5" /></td>
                <td className={COL}><input value={editRow.criteria} onChange={e => setEditRow({ ...editRow, criteria: e.target.value })} className="w-full border rounded px-1 py-0.5" /></td>
                <td className={COL}><input value={editRow.result} onChange={e => setEditRow({ ...editRow, result: e.target.value })} className="w-full border rounded px-1 py-0.5" /></td>
                <td className={COL}>
                  <select value={editRow.judgment} onChange={e => setEditRow({ ...editRow, judgment: e.target.value as BenzopyreneTest['judgment'] })} className="w-full border rounded px-1 py-0.5 bg-white">
                    <option value="">선택</option><option value="적합">적합</option><option value="부적합">부적합</option>
                  </select>
                </td>
                <td className={COL}><input value={editRow.lotNo ?? ''} onChange={e => setEditRow({ ...editRow, lotNo: e.target.value })} className="w-full border rounded px-1 py-0.5" /></td>
                <td className={`${COL} whitespace-nowrap`}>
                  <button onClick={saveEdit} disabled={saving} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save size={13} /></button>
                  <button onClick={() => { setEditingId(null); setEditRow(null); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X size={13} /></button>
                </td>
              </tr>
            ) : (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className={`${COL} font-bold text-slate-700`}>{r.productName}</td>
                <td className={`${COL} text-center`}>{r.receivedDate}</td>
                <td className={`${COL} text-center`}>{r.completedDate}</td>
                <td className={`${COL} text-center`}>{r.testItem}</td>
                <td className={`${COL} text-center`}>{r.criteria}</td>
                <td className={`${COL} text-center`}>{r.result}</td>
                <td className={`${COL} text-center ${judgeCls(r.judgment)}`}>{r.judgment || '-'}</td>
                <td className={`${COL} text-center text-slate-400`}>{r.lotNo || '-'}</td>
                {isAdmin && (
                  <td className={`${COL} whitespace-nowrap text-center`}>
                    <button onClick={() => { setEditingId(r.id); setEditRow(r); }} className="px-1.5 py-0.5 text-[10px] font-black text-indigo-500 hover:bg-indigo-50 rounded">수정</button>
                    <button onClick={() => removeRow(r.id)} className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded"><Trash2 size={12} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">※ 식용유지 벤조피렌 기준: 2.0 μg/kg 이하(식품공전). 부적합 시 해당 로트 사용 보류·재검토 필요.</p>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-black text-slate-500 mb-1">{label}</label>
    {children}
  </div>
);

export default BenzopyreneLog;
