import React from 'react';
import type { AccountCode, FixedCostTemplate } from './types';

/**
 * 일반전표 템플릿 — 자주 끊는 자금전표를 한 번에 채운다.
 *
 * 전표 하나 끊을 때마다 계정과목 목록을 훑어 내려가는 게 실제 병목이었다.
 * 계정을 잘못 고르면 손익·현금흐름이 통째로 어긋나므로, 자주 쓰는 것만 미리 박아 둔다.
 *
 * **방향으로 갈라 둔다.** 들어오는 돈과 나가는 돈은 쓰는 계정이 아예 다르다 —
 * 한 줄에 섞어 놓으면 전기세 옆에 차입실행이 붙어 눈으로 고르는 의미가 없어진다.
 *
 * 대출상환·급여는 계정 하나로 안 끝나서(원금/이자, 급여/예수금/실지급) 전용 입력이 따로 있다.
 * 그래도 **고르는 자리는 같아야** 해서 여기 같은 카드로 둔다 — 위 탭에서 한 번, 아래 카드에서
 * 또 한 번 고르게 하면 지금 무슨 전표를 쓰는 중인지 흐려진다.
 *
 * 코드는 setup-account-codes.mjs의 계정과목과 같다. 계정이 없으면 그 카드는 안 뜬다
 * (filterTemplates가 거른다) — 죽은 버튼을 남기면 어디에도 안 잡히는 전표가 생긴다.
 */
export interface CashTemplate {
  id: string;
  label: string;
  dir: '입금' | '출금';
  /** 어느 입력 화면을 쓰는지 — 상환·급여·보험은 줄이 여러 개라 전용 입력이 따로 있다 */
  mode: '일반' | '상환' | '급여' | '보험';
  accountCode?: string;
  /** 비고 기본값 — 비워 두면 사용자가 적는다 */
  note?: string;
  /** 거래처를 골라야 뜻이 통하는 것(수금·운임 등). false면 고른 거래처를 지운다. */
  wantsPartner?: boolean;
  /** 카드 아래 설명. 없으면 계정과목 이름을 쓴다. */
  hint?: string;
  /** 저장해 둔 금액 — 고르면 금액 칸이 채워진다(0이면 안 채운다) */
  amount?: number;
  partnerId?: string;
  partnerName?: string;
  /** 기본 템플릿 표식 — 있으면 삭제 못 하고 숨기기만 된다 */
  builtin?: string;
  /** 묶음 이름 — 목록이 길어서 이름만으로는 못 찾는다 */
  group?: string;
  /** 즐겨찾기 — 목록 맨 위 */
  favorite?: boolean;
}

export const CASH_TEMPLATES: CashTemplate[] = [
  // ══ 출금 ══════════════════════════════════════════════════════════
  //   맨 위는 직접입력 — 목록에 없는 전표가 더 많고, 기본값이기도 하다
  { id: 'freeOut', label: '직접입력', dir: '출금', mode: '일반', hint: '계정 직접 선택' },
  // 줄이 여러 개라 전용 입력을 쓰는 것
  { id: 'loan',    label: '대출상환', dir: '출금', mode: '상환', hint: '원금 + 이자' },
  { id: 'salary',  label: '급여',     dir: '출금', mode: '급여', hint: '총급여 − 공제' },
  // 거래처 채무 상계 — 매입전표가 이미 비용을 잡았으므로 지불은 미지급금이 준다
  { id: 'payout',  label: '지불',     dir: '출금', mode: '일반', accountCode: '251', wantsPartner: true, hint: '미지급 상계' },

  // 매달 나가는 고정비
  { id: 'elec',    label: '전기세',   dir: '출금', mode: '일반', accountCode: '520' },
  { id: 'water',   label: '수도세',   dir: '출금', mode: '일반', accountCode: '525' },
  { id: 'rent',    label: '임대료',   dir: '출금', mode: '일반', accountCode: '510' },
  { id: 'ins4',    label: '4대보험',  dir: '출금', mode: '보험', accountCode: '530', hint: '회사부담 + 예수금' },
  { id: 'ins',     label: '보험료',   dir: '출금', mode: '일반', accountCode: '590' },
  { id: 'cesco',   label: '세스코',   dir: '출금', mode: '일반', accountCode: '595' },
  { id: 'lease',   label: '리스료',   dir: '출금', mode: '일반', accountCode: '819' },

  // 그때그때 나가는 것
  { id: 'card',    label: '카드대금', dir: '출금', mode: '일반', accountCode: '650' },
  { id: 'freight', label: '운임',     dir: '출금', mode: '일반', accountCode: '605', wantsPartner: true },
  { id: 'outwork', label: '외주가공', dir: '출금', mode: '일반', accountCode: '540', wantsPartner: true },
  { id: 'submat',  label: '부자재',   dir: '출금', mode: '일반', accountCode: '505', wantsPartner: true },
  { id: 'interest',label: '이자',     dir: '출금', mode: '일반', accountCode: '951' },

  // 받아 뒀다 대신 내주는 돈 — 급여에서 뗀 원천세·4대보험이 예수금으로 잡혀 있다가 여기서 털린다
  { id: 'withhold',label: '원천세납부', dir: '출금', mode: '일반', accountCode: '254', note: '원천공제 납부', hint: '예수금 정리' },

  // 사는 것 · 사장님 돈
  { id: 'deposit', label: '보증금',   dir: '출금', mode: '일반', accountCode: '232' },
  { id: 'machine', label: '기계구입', dir: '출금', mode: '일반', accountCode: '206' },
  { id: 'draw',    label: '인출금',   dir: '출금', mode: '일반', accountCode: '338' },

  // ══ 입금 ══════════════════════════════════════════════════════════
  { id: 'freeIn',  label: '직접입력', dir: '입금', mode: '일반', hint: '계정 직접 선택' },
  // 거래처 채권 상계 — 매출전표가 이미 수익을 잡았으므로 수금은 미수금이 준다
  { id: 'collect', label: '수금',     dir: '입금', mode: '일반', accountCode: '108', wantsPartner: true, hint: '미수 상계' },
  { id: 'advance', label: '선수금',   dir: '입금', mode: '일반', accountCode: '259', wantsPartner: true },
  { id: 'loanIn',  label: '차입실행', dir: '입금', mode: '일반', accountCode: '260' },
  { id: 'loanInL', label: '장기차입', dir: '입금', mode: '일반', accountCode: '293' },
  { id: 'vat',     label: '부가세환급', dir: '입금', mode: '일반', accountCode: '135' },
  { id: 'depBack', label: '보증금회수', dir: '입금', mode: '일반', accountCode: '232' },
];

/**
 * 화면에 띄울 템플릿 — **DB(fixedCostTemplates)가 원천**이고, 위 CASH_TEMPLATES는 시드다.
 * (seed-voucher-templates.mjs로 한 번 넣었다. DB가 비어 있으면 코드 목록으로 버틴다.)
 *
 * 사용자가 이름·거래처·금액을 고치고 숨길 수 있어야 해서 DB로 옮겼다 — 코드에 있으면 배포해야 바뀐다.
 *
 * 계정과목 번호 순으로 세운다 — 계정과목 드롭다운도 같은 순서라 두 곳을 오갈 때 눈이 안 헤맨다.
 * 계정이 안 붙은 것(직접입력·대출상환·급여)은 번호가 없으니 위에 그대로 둔다.
 * 계정이 사라진 템플릿은 안 띄운다 — 죽은 버튼을 남기면 어디에도 안 잡히는 전표가 생긴다.
 */
export function filterTemplates(
  accountCodes: AccountCode[],
  dir: '입금' | '출금',
  saved: FixedCostTemplate[] = [],
): CashTemplate[] {
  const have = new Set(accountCodes.map(c => c.code));
  const fromDb = saved
    .filter(t => t.kind === 'voucher' && !t.hidden && (t.dir ?? '출금') === dir)
    .map((t): CashTemplate => ({
      id: t.id,
      label: t.name,
      dir: (t.dir ?? '출금') as '입금' | '출금',
      mode: (t.mode ?? '일반') as '일반' | '상환' | '급여' | '보험',
      accountCode: t.accountCode,
      note: t.note,
      amount: t.amount || undefined,
      partnerId: t.partnerId,
      partnerName: t.partnerName,
      builtin: t.builtin,
      group: t.group,
      favorite: t.favorite,
      ...(t.builtin?.startsWith('free') ? { hint: '계정 직접 선택' } : {}),
      ...(t.mode === '상환' ? { hint: '원금 + 이자' } : {}),
      ...(t.mode === '급여' ? { hint: '총급여 − 공제' } : {}),
      ...(t.mode === '보험' ? { hint: '회사부담 + 예수금' } : {}),
    }));
  const mine = (fromDb.length ? fromDb : CASH_TEMPLATES.filter(t => t.dir === dir))
    .filter(t => !t.accountCode || have.has(t.accountCode));
  const noCode = mine.filter(t => !t.accountCode);
  const coded = mine.filter(t => t.accountCode)
    .sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true }));
  return [...noCode, ...coded];
}

/** 지금 폼 상태가 어느 카드인지 — 고른 것이 눌린 채로 보여야 무슨 전표를 쓰는 중인지 안다 */
export function activeTemplateId(
  templates: CashTemplate[],
  state: { mode: '일반' | '상환' | '급여' | '보험'; accountCode?: string },
): string | null {
  if (state.mode !== '일반') return templates.find(t => t.mode === state.mode)?.id ?? null;
  if (!state.accountCode) return templates.find(t => (t.builtin ?? t.id).startsWith('free'))?.id ?? null;
  return templates.find(t => t.mode === '일반' && t.accountCode === state.accountCode)?.id ?? null;
}

/** 지금 고른 템플릿(없으면 그 방향의 직접입력) */
export function activeTemplate(
  templates: CashTemplate[],
  state: { mode: '일반' | '상환' | '급여' | '보험'; accountCode?: string },
): CashTemplate | undefined {
  const id = activeTemplateId(templates, state);
  return templates.find(t => t.id === id);
}

/**
 * 템플릿 고르는 창 — 전표 화면과 자금원장이 **같은 목록·같은 생김새**를 쓴다.
 * 두 화면이 갈리면 한쪽에만 있는 전표가 생기고, 그게 계정 잘못 고르는 자리가 된다.
 *
 * 발행 모달 위에 겹쳐 뜬다(z-[60]) — 목록을 늘 펼쳐 두면 정작 금액 칸이 밀려서,
 * 고를 때만 열고 고르면 닫는다.
 */
export function CashTemplateModal({
  templates, accountCodes, activeId, dir, onDir, onPick, onClose,
}: {
  templates: CashTemplate[];
  accountCodes: AccountCode[];
  activeId: string | null;
  dir: '입금' | '출금';
  onDir: (d: '입금' | '출금') => void;
  onPick: (t: CashTemplate) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-black text-slate-800 shrink-0">자주 쓰는 전표</h3>
          <div className="flex gap-1.5 ml-auto">
            {(['출금', '입금'] as const).map(d => (
              <button key={d} type="button" onClick={() => onDir(d)}
                className={`px-4 py-1.5 rounded-lg text-xs font-black border transition-all ${dir === d
                  ? d === '입금' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                {d}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all shrink-0">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <CashTemplatePicker templates={templates} accountCodes={accountCodes} activeId={activeId} onPick={onPick} />
        </div>
      </div>
    </div>
  );
}

export function CashTemplatePicker({
  templates, accountCodes, activeId, onPick,
}: {
  templates: CashTemplate[];
  accountCodes: AccountCode[];
  activeId: string | null;
  onPick: (t: CashTemplate) => void;
}) {
  const nameOf = (code?: string) => accountCodes.find(c => c.code === code)?.name ?? '';
  // 묶음별로 갈라 그린다 — 30개가 한 줄로 이어지면 눈으로 못 찾는다.
  // 즐겨찾기는 묶음과 상관없이 맨 위로 모은다 — 매일 쓰는 서너 개를 찾아 내려가는 게 병목이라서.
  const groups: { name: string; items: CashTemplate[] }[] = [];
  const favs = templates.filter(t => t.favorite);
  if (favs.length) groups.push({ name: '★ 즐겨찾기', items: favs });
  for (const t of templates) {
    if (t.favorite) continue;
    const g = t.group?.trim() || '분류없음';
    const last = groups.find(x => x.name === g);
    if (last) last.items.push(t); else groups.push({ name: g, items: [t] });
  }
  const card = (t: CashTemplate) => {
    const on = activeId === t.id;
    {
        // 전용 입력을 쓰는 것(상환·급여)은 색을 달리한다 — 아래 폼이 통째로 바뀌기 때문
        const special = t.mode !== '일반';
        const cls = on
          ? special ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
            : t.dir === '입금' ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-slate-700 text-white border-slate-700 shadow-sm'
          : special ? 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:border-indigo-300'
            : t.dir === '입금' ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:border-emerald-300'
              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400';
        const subCls = on ? 'opacity-70' : 'opacity-60';
        return (
          <button key={t.id} type="button" onClick={() => onPick(t)}
            title={t.accountCode ? `${t.dir} · ${t.accountCode} ${nameOf(t.accountCode)}` : t.hint}
            className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-baseline justify-between gap-2 ${cls}`}>
            <span className="text-sm font-black leading-tight truncate">
              {t.label}
              {t.partnerName && <span className="ml-1.5 text-[10px] font-bold opacity-60">{t.partnerName}</span>}
            </span>
            <span className={`text-[10px] font-bold leading-tight truncate shrink-0 ${subCls}`}>
              {t.amount ? `${t.amount.toLocaleString('ko-KR')}원` : (t.hint ?? `${t.accountCode} ${nameOf(t.accountCode)}`)}
            </span>
          </button>
        );
    }
  };
  return (
    // 한 행에 하나 — 이름과 계정이 한눈에 같이 읽혀야 잘못 고르지 않는다
    <div className="flex flex-col gap-3">
      {groups.map(g => (
        <div key={g.name} className="flex flex-col gap-1">
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest px-1">{g.name}</span>
          {g.items.map(t => <React.Fragment key={t.id}>{card(t)}</React.Fragment>)}
        </div>
      ))}
    </div>
  );
}
