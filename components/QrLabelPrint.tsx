import React, { useState, useEffect } from 'react';
import { X, Printer, QrCode, Search } from 'lucide-react';
import QRCode from 'qrcode';
import { Item } from '../src/shared/types';

interface QrLabelPrintProps {
  submaterials: Item[];
  onClose: () => void;
}

const QrLabelPrint: React.FC<QrLabelPrintProps> = ({ submaterials, onClose }) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

  const filtered = submaterials.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const generate = async () => {
      const entries: [string, string][] = await Promise.all(
        submaterials.map(async s => {
          const url = await QRCode.toDataURL(s.id, { width: 120, margin: 1 });
          return [s.id, url] as [string, string];
        })
      );
      setQrUrls(Object.fromEntries(entries));
    };
    generate();
  }, [submaterials]);

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(s => s.id)));
    }
  };

  const handlePrint = () => {
    const items = submaterials.filter(s => selected.has(s.id));
    if (items.length === 0) { alert('라벨을 선택해주세요.'); return; }

    const labelsHtml = items.map(s => `
      <div class="label">
        <img src="${qrUrls[s.id]}" width="90" height="90" />
        <div class="name">${s.name}</div>
        <div class="unit">${s.unit}</div>
      </div>
    `).join('');

    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR 라벨</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Malgun Gothic', sans-serif; background: #fff; }
        .grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; }
        .label { width: 110px; border: 1px solid #ccc; border-radius: 6px; padding: 6px; text-align: center; page-break-inside: avoid; }
        .label img { display: block; margin: 0 auto; }
        .name { font-size: 9px; font-weight: 900; margin-top: 4px; word-break: keep-all; line-height: 1.3; }
        .unit { font-size: 8px; color: #666; margin-top: 2px; }
        @media print { body { margin: 0; } }
      </style></head><body>
      <div class="grid">${labelsHtml}</div>
      <script>window.onload = () => { window.print(); window.close(); }<\/script>
      </body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <QrCode size={18} className="text-teal-500" />
            <h3 className="font-black text-slate-800">QR 라벨 인쇄</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400">
            <X size={18} />
          </button>
        </div>

        {/* 검색 + 전체선택 */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 shrink-0">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="품목 검색..."
              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </div>
          <button
            onClick={toggleAll}
            className="text-xs font-black text-slate-500 hover:text-teal-600 whitespace-nowrap"
          >
            {selected.size === filtered.length && filtered.length > 0 ? '전체 해제' : '전체 선택'}
          </button>
          <span className="text-xs text-slate-400">{selected.size}개 선택</span>
        </div>

        {/* 품목 목록 */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 sm:grid-cols-4 gap-3 content-start">
          {filtered.map(s => {
            const isSelected = selected.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => setSelected(prev => {
                  const next = new Set(prev);
                  next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                  return next;
                })}
                className={`flex flex-col items-center p-3 rounded-2xl border-2 transition-all text-left gap-2 ${isSelected ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              >
                {qrUrls[s.id]
                  ? <img src={qrUrls[s.id]} alt="" className="w-16 h-16" />
                  : <div className="w-16 h-16 bg-slate-100 rounded-lg animate-pulse" />
                }
                <p className="text-[10px] font-black text-slate-700 text-center leading-tight">{s.name}</p>
                <p className="text-[9px] text-slate-400">{s.unit}</p>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-4 py-12 text-center text-slate-300 text-sm font-bold">검색 결과 없음</div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="px-5 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={handlePrint}
            disabled={selected.size === 0}
            className="w-full flex items-center justify-center gap-2 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-black rounded-2xl text-sm transition-colors"
          >
            <Printer size={16} /> 선택 {selected.size}개 라벨 인쇄
          </button>
        </div>
      </div>
    </div>
  );
};

export default QrLabelPrint;
