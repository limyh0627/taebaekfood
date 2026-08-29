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

/**
 * 사이트 아이콘 — 그 도메인의 favicon을 구글이 대신 내준다.
 * 사이트마다 파일 위치가 제각각(/favicon.ico·apple-touch-icon·manifest)이라 직접 찾으면
 * 절반은 깨진다. 못 가져오면 아래에서 첫 글자로 갈음한다(onError).
 */
const faviconOf = (url: string): string => {
  try { return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(normalizeUrl(url)).hostname}`; }
  catch { return ''; }
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
  const [dragOver, setDragOver] = useState(false);

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

  /**
   * 주소창·링크를 끌어다 떨구면 그대로 담는다 — 이름·주소를 손으로 옮겨 적을 일이 없다.
   *
   * 브라우저는 링크를 끌 때 `text/uri-list`(주소)와 `text/html`(<a>태그)을 같이 준다.
   * 이름은 그 <a>의 글자에서 따고, 없으면 주소에서 딴다.
   */
  const addFromDrop = async (dt: DataTransfer) => {
    //  uri-list는 여러 줄일 수 있고 '#'로 시작하는 줄은 주석이다.
    const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '')
      .split(/\r?\n/).map(v => v.trim()).find(v => v && !v.startsWith('#')) ?? '';
    const u = normalizeUrl(raw);
    if (!u || !/^https?:\/\/[^\s]+\./i.test(u)) { alert('주소를 못 읽었습니다. 링크나 주소창을 끌어다 놓아 주세요.'); return; }
    let name = '';
    const html = dt.getData('text/html');
    if (html) {
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && !/^https?:\/\//i.test(text)) name = text.slice(0, 30);
    }
    if (links.some(l => normalizeUrl(l.url) === u)) { alert('이미 담긴 주소입니다.'); return; }
    setBusy(true);
    try {
      await addItem(COL, { label: name || hostOf(u), url: u, order: links.length });
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
    <div
      onDragOver={isAdmin ? (e => { e.preventDefault(); setDragOver(true); }) : undefined}
      onDragLeave={isAdmin ? (() => setDragOver(false)) : undefined}
      onDrop={isAdmin ? (e => { e.preventDefault(); setDragOver(false); addFromDrop(e.dataTransfer); }) : undefined}
      className={`bg-white rounded-2xl shadow-sm border p-5 transition-all ${
        dragOver ? 'border-indigo-400 ring-4 ring-indigo-500/10 bg-indigo-50/40' : 'border-slate-100'}`}>
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

      {dragOver && (
        <p className="text-[11px] font-black text-indigo-500 py-3 text-center">여기에 놓으면 담깁니다</p>
      )}
      {links.length === 0 && !editing && !dragOver && (
        <p className="text-[11px] font-bold text-slate-300 py-3 text-center">
          주소창이나 링크를 <b className="text-slate-400">끌어다 놓으면</b> 담깁니다 · 직접 넣으려면 오른쪽 위 '편집'
        </p>
      )}

      {/* 아이콘 타일 — 글자 줄보다 눈이 먼저 찾는다. 이름은 아이콘 밑에 붙인다. */}
      <div className="flex flex-wrap gap-3">
        {links.map(l => (
          <div key={l.id} className="relative group/tile">
            <a href={normalizeUrl(l.url)} target="_blank" rel="noopener noreferrer"
              title={`${l.label} — ${l.url}`}
              className="flex flex-col items-center gap-1.5 w-[76px] p-2 rounded-2xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm transition-all">
              <span className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {/* 파비콘이 안 오면 첫 글자로 갈음한다 — 빈 네모가 남으면 뭐가 뭔지 모른다 */}
                <img src={faviconOf(l.url)} alt="" className="w-5 h-5"
                  onError={e => {
                    const img = e.currentTarget;
                    img.style.display = 'none';
                    const fb = img.nextElementSibling as HTMLElement | null;
                    if (fb) fb.style.display = 'block';
                  }} />
                <span className="hidden text-sm font-black text-slate-400">{(l.label || hostOf(l.url)).slice(0, 1)}</span>
              </span>
              <span className="text-[10px] font-black text-slate-600 leading-tight text-center line-clamp-2 break-all">{l.label}</span>
            </a>
            {editing && (
              <div className="absolute -top-1.5 -right-1.5 flex gap-0.5">
                <button onClick={() => rename(l)} title="이름 바꾸기"
                  className="p-1 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-indigo-500 shadow-sm"><Pencil size={10} /></button>
                <button onClick={() => remove(l)} title="지우기"
                  className="p-1 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-500 shadow-sm"><X size={11} /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 flex-wrap">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="이름 (비우면 주소에서 따옴)"
            className="flex-1 min-w-[120px] border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="주소 (끌어다 놓아도 됩니다)"
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
