import React, { useEffect, useState } from 'react';
import { ExternalLink, Plus, X, Check, Pencil } from 'lucide-react';
import { addItem, deleteItem, fetchCollection, updateItem } from '../src/shared/services/firebaseService';

/**
 * 대시보드 바로가기 — 자주 여는 홈페이지(스마트스토어·거래처·은행 …)를 담아 둔다.
 *
 * 코드에 박지 않고 `dashboardLinks` 컬렉션에 둔다 — 링크는 사람마다 다르고 자주 바뀐다.
 * 한 번 박아 두면 추가할 때마다 배포해야 한다.
 */
export interface DashboardLink {
  id: string;
  label: string;
  url: string;
  order?: number;
}

const COL = 'dashboardLinks';

/** 사람은 'naver.com'이라고 적는다 — 프로토콜이 없으면 못 여니 붙여 준다. */
const normalizeUrl = (raw: string): string => {
  const u = raw.trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

/** 주소에서 보여줄 짧은 이름 — 이름을 안 적었을 때 쓴다 */
const hostOf = (url: string): string => {
  try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, ''); }
  catch { return url; }
};

const DashboardLinks: React.FC<{ isAdmin?: boolean }> = ({ isAdmin = true }) => {
  const [links, setLinks] = useState<DashboardLink[]>([]);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => {
    fetchCollection<DashboardLink>(COL)
      .then(rows => setLinks([...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'ko'))))
      .catch(() => {});
  };
  useEffect(reload, []);

  const add = async () => {
    const u = normalizeUrl(url);
    if (!u) { alert('주소를 입력하세요.'); return; }
    setBusy(true);
    try {
      await addItem(COL, { label: label.trim() || hostOf(u), url: u, order: links.length });
      setLabel(''); setUrl('');
      reload();
    } catch (e: any) {
      alert('바로가기 추가 실패: ' + (e?.message ?? String(e)));
    } finally { setBusy(false); }
  };

  const rename = async (l: DashboardLink) => {
    const next = window.prompt('바로가기 이름', l.label)?.trim();
    if (next == null || next === l.label) return;
    await updateItem(COL, l.id, { label: next || hostOf(l.url) });
    reload();
  };

  const remove = async (l: DashboardLink) => {
    if (!window.confirm(`'${l.label}' 바로가기를 지울까요?`)) return;
    await deleteItem(COL, l.id);
    reload();
  };

  if (links.length === 0 && !isAdmin) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-black text-slate-800 flex items-center gap-1.5">
          <ExternalLink size={15} className="text-slate-400" />바로가기
        </span>
        {isAdmin && (
          <button onClick={() => setEditing(v => !v)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black transition-colors ${
              editing ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-100'}`}>
            {editing ? <><Check size={11} />완료</> : <><Pencil size={11} />편집</>}
          </button>
        )}
      </div>

      {links.length === 0 && !editing && (
        <p className="text-[11px] font-bold text-slate-300 py-3 text-center">
          자주 여는 홈페이지를 담아 두세요 — 오른쪽 위 '편집'
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {links.map(l => (
          <span key={l.id} className="inline-flex items-center">
            <a href={normalizeUrl(l.url)} target="_blank" rel="noopener noreferrer"
              title={l.url}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all">
              <ExternalLink size={12} className="opacity-50" />
              {l.label}
            </a>
            {editing && (
              <>
                <button onClick={() => rename(l)} title="이름 바꾸기"
                  className="ml-1 p-1 text-slate-300 hover:text-indigo-500 transition-colors"><Pencil size={12} /></button>
                <button onClick={() => remove(l)} title="지우기"
                  className="p-1 text-slate-300 hover:text-rose-500 transition-colors"><X size={13} /></button>
              </>
            )}
          </span>
        ))}
      </div>

      {editing && (
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 flex-wrap">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="이름 (비우면 주소에서 따옴)"
            className="flex-1 min-w-[120px] border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="주소 (예: smartstore.naver.com/…)"
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            className="flex-[2] min-w-[180px] border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
          <button onClick={add} disabled={busy || !url.trim()}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-40">
            <Plus size={12} strokeWidth={3} />추가
          </button>
        </div>
      )}
    </div>
  );
};

export default DashboardLinks;
