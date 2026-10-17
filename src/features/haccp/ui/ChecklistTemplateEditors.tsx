import React, {useState,useEffect} from 'react';
import {Wrench,Save,Trash2,Plus,GripVertical} from 'lucide-react';
import {doc,onSnapshot} from 'firebase/firestore';
import {db} from '../../../shared/firebase';
import {addItem,setDocument,updateItem} from '../../../shared/services/firebaseService';
import {haccpTemplateDocId} from '../../../shared/haccpTemplateId';
import {useHaccpCompany} from '../context/HaccpCompanyContext';
import {useDragReorder,arrayMove} from '../hooks/useDragReorder';
import {STORAGE_ZONES,type StorageZone} from '../domain/tempZones';
import {SANITATION_ITEMS} from '../domain/sanitationItems';
import {PERSONAL_HYGIENE_COLS} from '../domain/personalHygieneColumns';
import {WEEKLY_ITEMS_DEFAULT,MONTHLY_ITEMS_DEFAULT,type PeriodCycle} from '../domain/periodicSanitation';
import {CLOSING_ITEMS_DEFAULT} from '../domain/closingChecklist';

export const DRAG_HANDLE_CLASS = 'cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 shrink-0';

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

export const PeriodicSanitationTemplateEditor: React.FC<{ cycle: PeriodCycle }> = ({ cycle }) => {
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

export const ClosingChecklistTemplateEditor: React.FC = () => {
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
