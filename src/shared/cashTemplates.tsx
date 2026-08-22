import React, { useMemo, useState } from 'react';
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
/** 전표 갈래 — 돈이 언제 움직이냐 하나로 정한다. 비용/수익은 계정과목이 정한다. */
export type VoucherDir = '입금' | '출금' | '줄돈' | '받을돈' | '대체' | '회사이체';
/**
 * 화면에 띄우는 갈래 — 지금은 셋만 쓴다.
 * 줄돈·받을돈(채권·채무를 세우는 것)은 규칙을 더 정한 뒤 열기로 하고 잠시 접어 뒀다.
 * 타입에는 남겨 둬서 옛 데이터를 읽는 데는 지장이 없다.
 */
export const VOUCHER_DIRS: VoucherDir[] = ['출금', '입금', '대체', '회사이체'];
/** 돈이 지금 움직이는 갈래인가 — 아니면 전표(매입·매출·대체)로 끊는다 */
export const isCashDir = (d: VoucherDir) => d === '입금' || d === '출금';
/**
 * 갈래별 색 — 카드는 흰 바탕 하나로 두고 **여기만 색으로 가른다.**
 * 줄마다 배경이 다르면 목록이 알록달록해져 정작 무슨 전표인지 안 읽힌다.
 */
export const DIR_CHIP: Record<VoucherDir, string> = {
  '출금': 'bg-slate-600 text-white',
  '입금': 'bg-emerald-500 text-white',
  '줄돈': 'bg-rose-500 text-white',
  '받을돈': 'bg-blue-500 text-white',
  '대체': 'bg-amber-500 text-white',
  '회사이체': 'bg-purple-500 text-white',
};
export const DIR_HINT: Record<VoucherDir, string> = {
  '출금': '지금 나감',
  '입금': '지금 들어옴',
  '줄돈': '나중에 나감 · 미지급',
  '받을돈': '나중에 들어옴 · 미수',
  '대체': '안 움직임 · 감가상각',
  '회사이체': '다른 회사 통장으로 보냄',
};

export interface CashTemplate {
  id: string;
  label: string;
  /** 돈이 언제 움직이냐 — 지금(출금·입금) · 나중에(줄돈·받을돈) · 안 움직임(대체) */
  dir: VoucherDir;
  /** 어느 입력 화면을 쓰는지 — 상환·급여·보험은 줄이 여러 개라 전용 입력이 따로 있다 */
  mode: '일반' | '상환' | '급여' | '보험' | '세금';
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
  /** 전표 품목란에 들어갈 이름. 비우면 계정과목 이름을 쓴다. */
  itemName?: string;
  /** 상환 — 원금을 깎을 차입금 계정 */
  loanCode?: string;
  /** 세금 — 부가세 / 소득세 */
  vat?: number;       incomeTax?: number;
  /**
   * 대체전표 **분개 양식** — 차·대를 템플릿이 들고 있는다.
   *
   * 사용자가 줄마다 차변/대변을 고르게 하면 회계를 아는 사람만 쓸 수 있다.
   * 감가상각·퇴직충당처럼 양식이 정해진 전표는 템플릿이 계정과 차·대를 다 알고 있고,
   * 사용자는 **금액만** 넣는다. 직접입력으로 특수 전표를 끊을 때만 손으로 고른다.
   *
   *   감가상각  (차) 818 감가상각비 / (대) 203 감가상각누계액
   */
  transferLines?: { accountCode: string; side: '차변' | '대변'; name?: string }[];
  /** 두 줄로 갈리는 갈래의 미리 정해둔 값 — SPLIT_MODES 참고 */
  insCorp?: number;   insEmp?: number;
  principal?: number; interest?: number;
  gross?: number;     deduction?: number;
}

/**
 * 두 줄로 갈리는 갈래의 **양식** — 편집 화면·전표 발행·합계 계산이 전부 여기를 본다.
 *
 * 템플릿은 미리 양식을 맞춰 두는 것이라, 두 줄짜리 갈래는 두 값을 들고 있어야 한다.
 * amount 하나로는 못 채운다 — 갈래마다 두 칸의 뜻도, 통장에서 움직이는 금액도 다르다.
 */
export const SPLIT_MODES = {
  보험: {
    a: 'insCorp', b: 'insEmp',
    labelA: '회사부담', hintA: '비용', labelB: '근로자부담', hintB: '예수금',
    total: (a: number, b: number) => a + b, totalLabel: '통장에서 나가는 총액',
    help: '공단 고지서의 사업장부담금 · 근로자부담금을 그대로 넣으세요. 총액으로는 못 가릅니다 — 산재는 회사가 전액, 고용보험도 회사 쪽이 더 나갑니다.',
  },
  상환: {
    a: 'principal', b: 'interest',
    labelA: '원금', hintA: '차입금', labelB: '이자', hintB: '비용',
    total: (a: number, b: number) => a + b, totalLabel: '통장에서 나가는 총액',
    help: '원금은 빚이 줄어드는 것(재무상태표), 이자는 비용(손익계산서)입니다. 상환표대로 달마다 비율이 바뀌면 자동 발행은 끄고 그때그때 고쳐 쓰세요.',
    // 원금을 어느 빚에서 깎을지 — 대출이 여러 건이면 매번 고르다 틀린다. 템플릿이 기억한다.
    pick: { field: 'loanCode', label: '대출 계정', filter: (c: { type?: string; name: string }) => c.type === '부채' && /차입금/.test(c.name) },
  },
  급여: {
    a: 'gross', b: 'deduction',
    labelA: '총급여', hintA: '비용', labelB: '공제', hintB: '예수금',
    total: (a: number, b: number) => a - b, totalLabel: '통장에서 나가는 실지급액',
    help: '총급여는 비용으로 잡히고, 공제분은 맡아뒀다가 다음 달에 4대보험·원천세로 냅니다. 통장에서 나가는 건 차액입니다.',
  },
  세금: {
    a: 'vat', b: 'incomeTax',
    labelA: '부가세', hintA: '부가세예수금', labelB: '소득세', hintB: '인출금',
    total: (a: number, b: number) => a + b, totalLabel: '한 번에 내는 총액',
    help: '둘 다 비용이 아닙니다. 부가세는 손님한테 받아 맡아둔 돈이라 부채(255)를 터는 것이고, 종합소득세는 사업이 아니라 사장님 개인에게 매기는 세금이라 인출금(338)입니다. 비용으로 몰면 이익이 그만큼 줄어 보입니다.',
  },
} as const;

export type SplitMode = keyof typeof SPLIT_MODES;
export const splitModeOf = (mode?: string): SplitMode | null =>
  mode && mode in SPLIT_MODES ? mode as SplitMode : null;

export const CASH_TEMPLATES: CashTemplate[] = [
  // ══ 출금 ══════════════════════════════════════════════════════════
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
  { id: 'lease',   label: '리스료',   dir: '출금', mode: '일반', accountCode: '819' },

  // 그때그때 나가는 것
  { id: 'card',    label: '카드대금', dir: '출금', mode: '일반', accountCode: '650' },
  { id: 'freight', label: '운임',     dir: '출금', mode: '일반', accountCode: '605', wantsPartner: true },
  { id: 'outwork', label: '외주가공', dir: '출금', mode: '일반', accountCode: '540', wantsPartner: true },
  { id: 'submat',  label: '부자재',   dir: '출금', mode: '일반', accountCode: '505', wantsPartner: true },
  { id: 'interest',label: '이자',     dir: '출금', mode: '일반', accountCode: '951' },

  // 받아 뒀다 대신 내주는 돈 — 급여에서 뗀 원천세·4대보험이 예수금으로 잡혀 있다가 여기서 털린다
  { id: 'withhold',label: '원천세납부', dir: '출금', mode: '일반', accountCode: '254', note: '원천공제 납부', hint: '예수금 정리' },
  { id: 'tax',     label: '세금납부',   dir: '출금', mode: '세금', accountCode: '255', hint: '부가세 + 소득세' },
  { id: 'vatPay',  label: '부가세 납부', dir: '출금', mode: '일반', accountCode: '261', note: '부가세 납부', hint: '신고로 세운 미지급세금을 턴다', group: '수시' },

  // 사는 것 · 사장님 돈
  { id: 'deposit', label: '보증금',   dir: '출금', mode: '일반', accountCode: '232' },
  { id: 'machine', label: '기계구입', dir: '출금', mode: '일반', accountCode: '206' },
  { id: 'draw',    label: '인출금',   dir: '출금', mode: '일반', accountCode: '338' },

  // ══ 입금 ══════════════════════════════════════════════════════════
  // 거래처 채권 상계 — 매출전표가 이미 수익을 잡았으므로 수금은 미수금이 준다
  { id: 'collect', label: '수금',     dir: '입금', mode: '일반', accountCode: '108', wantsPartner: true, hint: '미수 상계' },
  { id: 'advance', label: '선수금',   dir: '입금', mode: '일반', accountCode: '259', wantsPartner: true },
  { id: 'loanIn',  label: '차입실행', dir: '입금', mode: '일반', accountCode: '260' },
  { id: 'loanInL', label: '장기차입', dir: '입금', mode: '일반', accountCode: '293' },
  { id: 'vat',     label: '부가세환급', dir: '입금', mode: '일반', accountCode: '135', hint: '135에 남은 돌려받을 돈' },
  { id: 'depBack', label: '보증금회수', dir: '입금', mode: '일반', accountCode: '232' },

  // ══ 대체 ══════════════════════════════════════════════════════════
  /*
   * 부가세 신고 — **쌓인 걸 터는 전표.**
   *
   * 매출전표가 255를, 매입전표가 135를 자동으로 쌓는다. 신고는 그 둘을 맞물려 없애고
   * 차액만 낼 돈(261)으로 세우는 일이다. 순액으로 255만 깎으면 135가 영영 자산으로 남는다.
   *
   *   (차) 255 부가세예수금 매출세액 / (대) 135 부가세대급금 매입세액 + 261 미지급세금 차액
   *
   * 매입세액이 크면 낼 게 아니라 받을 것이라 261이 안 선다. 매출세액만큼만 상계하고
   * 135에 돌려받을 돈을 남긴 뒤, 들어올 때 '부가세환급'(입금·135)으로 턴다.
   * 두 금액은 재무제표 > 합계잔액시산표의 255·135 잔액을 그대로 옮겨 적는다.
   */
  { id: 'vatSettle', label: '부가세 신고(납부)', dir: '대체', mode: '일반', accountCode: '255', group: '결산',
    hint: '매출세액 − 매입세액 = 낼 돈',
    transferLines: [
      { accountCode: '255', side: '차변', name: '매출세액' },
      { accountCode: '135', side: '대변', name: '매입세액' },
      { accountCode: '261', side: '대변', name: '납부할 세액' },
    ] },
  { id: 'vatRefund', label: '부가세 신고(환급)', dir: '대체', mode: '일반', accountCode: '255', group: '결산',
    hint: '매입세액이 클 때 — 남는 건 135에',
    transferLines: [
      { accountCode: '255', side: '차변', name: '매출세액' },
      { accountCode: '135', side: '대변', name: '매출세액분 상계' },
    ] },
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
  saved: FixedCostTemplate[] = [],
): CashTemplate[] {
  const have = new Set(accountCodes.map(c => c.code));
  // 옛 postMode '분리'는 채무를 세우는 것이니 '줄돈'으로 읽는다
  const dirOf = (t: FixedCostTemplate): VoucherDir => t.dir ?? (t.postMode === '분리' ? '줄돈' : '출금');
  const fromDb = saved
    .filter(t => t.kind === 'voucher' && !t.hidden)
    .map((t): CashTemplate => ({
      id: t.id,
      label: t.name,
      dir: dirOf(t),
      mode: (t.mode ?? '일반') as CashTemplate['mode'],
      accountCode: t.accountCode,
      note: t.note,
      amount: t.amount || undefined,
      partnerId: t.partnerId,
      partnerName: t.partnerName,
      builtin: t.builtin,
      group: t.group,
      favorite: t.favorite,
      itemName: t.itemName,
      insCorp: t.insCorp,     insEmp: t.insEmp,
      principal: t.principal, interest: t.interest,
      gross: t.gross,         deduction: t.deduction,
      loanCode: t.loanCode,
      transferLines: t.transferLines,
      ...(t.mode === '상환' ? { hint: '원금 + 이자' } : {}),
      ...(t.mode === '급여' ? { hint: '총급여 − 공제' } : {}),
      ...(t.mode === '보험' ? { hint: '회사부담 + 예수금' } : {}),
    }));
  const mine = (fromDb.length ? fromDb : CASH_TEMPLATES)
    .filter(t => !t.accountCode || have.has(t.accountCode));
  const noCode = mine.filter(t => !t.accountCode);
  const coded = mine.filter(t => t.accountCode)
    .sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true }));
  return [...noCode, ...coded];
}

/**
 * 비현금 갈래(대체·줄돈·받을돈) 템플릿을 **'계정 · 금액' 줄**로 편다.
 *
 * 이 갈래는 금액칸을 안 쓴다 — 전표라 줄마다 계정이 붙는다. 그래서 템플릿의 금액·계정을
 * 금액칸에만 넣어 두면, 리스료·임대료처럼 대체로 끊는 템플릿을 골라도 **빈 양식이 떴다.**
 * 적요는 품목명 > 비고 > 템플릿 이름 순 — 전표에 그대로 남는 글이라 구체적인 것이 먼저다.
 */
export function templateAccrRows(
  t: CashTemplate,
): { name: string; accountCode?: string; price: string; side: '차변' | '대변' }[] {
  if (isCashDir(t.dir) || t.dir === '회사이체') return [{ name: '', price: '', side: '차변' }];
  // 분개 양식이 있으면 **그대로 편다** — 계정도 차·대도 템플릿이 안다. 사용자는 금액만 넣는다.
  if (t.transferLines?.length) {
    return t.transferLines.map(l => ({
      name: l.name || t.itemName || t.label,
      accountCode: l.accountCode,
      price: t.amount ? String(t.amount) : '',
      side: l.side,
    }));
  }
  // 양식이 없으면 계정 한 줄. 비용·자산이라 차변이 정상이고, 상대변은 사용자가 넣는다.
  return [{
    name: t.itemName || t.note || t.label,
    accountCode: t.accountCode,
    price: t.amount ? String(t.amount) : '',
    side: '차변',
  }];
}

/**
 * 지금 폼 상태가 어느 템플릿인지 — 고른 것이 눌린 채로 보여야 무슨 전표를 쓰는 중인지 안다.
 * **null이면 직접입력**(템플릿 없음)이다. 직접입력은 템플릿이 아니라 상태라 목록에 두지 않는다.
 */
export function activeTemplateId(
  templates: CashTemplate[],
  state: { mode: '일반' | '상환' | '급여' | '보험' | '세금'; accountCode?: string },
): string | null {
  if (state.mode !== '일반') return templates.find(t => t.mode === state.mode)?.id ?? null;
  if (!state.accountCode) return null;
  return templates.find(t => t.mode === '일반' && t.accountCode === state.accountCode)?.id ?? null;
}

/** 지금 고른 템플릿(없으면 그 방향의 직접입력) */
export function activeTemplate(
  templates: CashTemplate[],
  state: { mode: '일반' | '상환' | '급여' | '보험' | '세금'; accountCode?: string },
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
  templates, accountCodes, activeId, onPick, onDirect, onClose,
}: {
  templates: CashTemplate[];
  accountCodes: AccountCode[];
  activeId: string | null;
  onPick: (t: CashTemplate) => void;
  /** 템플릿을 안 쓰고 직접 입력 — 고른 템플릿을 푼다 */
  onDirect: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'fav' | VoucherDir>('all');
  const nameOfCode = (code?: string) => accountCodes.find(c => c.code === code)?.name ?? '';
  const shown = useMemo(() => {
    const s = q.trim();
    return templates
      .filter(t => tab === 'all' ? true : tab === 'fav' ? t.favorite : t.dir === tab)
      .filter(t => !s || t.label.includes(s) || (t.partnerName ?? '').includes(s)
        || (t.accountCode ?? '').includes(s) || nameOfCode(t.accountCode).includes(s));
  }, [templates, q, tab, accountCodes]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* 방향(출금·입금·발생)은 고른 템플릿이 정한다 — 여기서 먼저 고르게 하면
            템플릿 화면과 목록이 달라 보이고, 방향을 잘못 잡으면 찾던 게 안 뜬다. */}
        <div className="px-5 py-4 border-b border-slate-100 shrink-0 space-y-2.5">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-black text-slate-800 shrink-0">
              템플릿 <span className="text-slate-300 font-bold">{shown.length === templates.length ? templates.length : `${shown.length}/${templates.length}`}</span>
            </h3>
            <input type="text" autoFocus placeholder="이름·거래처·계정 검색" value={q} onChange={e => setQ(e.target.value)}
              className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
            <button onClick={onClose} className="shrink-0 p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all">✕</button>
          </div>
          <div className="flex gap-1">
            {(['all', 'fav', ...VOUCHER_DIRS] as const).map(v => (
              <button key={v} type="button" onClick={() => setTab(v)}
                title={v === 'all' || v === 'fav' ? undefined : DIR_HINT[v]}
                className={`px-2 py-1 rounded-lg text-[11px] font-black border transition-all ${tab === v
                  ? v === 'fav' ? 'bg-amber-400 text-white border-amber-400'
                    : v === 'all' ? 'bg-indigo-600 text-white border-indigo-600'
                    : `${DIR_CHIP[v as VoucherDir]} border-transparent`
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                {v === 'all' ? '전체' : v === 'fav' ? '★' : v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          {/* 직접입력은 템플릿이 아니라 '템플릿 없음'이라 목록 밖에 둔다 */}
          <button type="button" onClick={onDirect}
            className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-baseline justify-between gap-2 ${
              activeId === null
                ? 'bg-slate-700 text-white border-slate-700 shadow-sm'
                : 'bg-white text-slate-600 border-dashed border-slate-300 hover:border-slate-500'}`}>
            <span className="text-sm font-black leading-tight">직접입력</span>
            <span className={`text-[10px] font-bold leading-tight shrink-0 ${activeId === null ? 'opacity-70' : 'opacity-60'}`}>
              템플릿 없이 계정 직접 선택
            </span>
          </button>
          {shown.length === 0 ? (
            <p className="h-full flex items-center justify-center text-xs font-bold text-slate-300">찾는 템플릿이 없습니다</p>
          ) : (
            <CashTemplatePicker templates={shown} accountCodes={accountCodes} activeId={activeId} onPick={onPick} />
          )}
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
    return (
      <button key={t.id} type="button" onClick={() => onPick(t)}
        title={t.accountCode ? `${t.dir} · ${t.accountCode} ${nameOf(t.accountCode)}` : t.hint}
        className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
          on ? 'bg-white border-indigo-500 ring-1 ring-indigo-500 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-400'
        }`}>
        <span className="flex items-center gap-2 min-w-0">
          <span title={DIR_HINT[t.dir]} className={`shrink-0 w-11 text-center text-[10px] font-black px-1 py-1 rounded-md ${DIR_CHIP[t.dir] ?? 'bg-slate-100 text-slate-500'}`}>
            {t.dir}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-black text-slate-800 leading-tight truncate">
              {t.label}
              {t.mode !== '일반' && <span className="ml-1.5 text-[9px] font-black px-1 py-0.5 rounded bg-indigo-50 text-indigo-600">{t.mode}</span>}
            </span>
            {(t.partnerName || t.accountCode || t.hint) && (
              <span className="block text-[10px] font-bold text-slate-400 leading-tight truncate">
                {t.accountCode ? `${t.accountCode} ${nameOf(t.accountCode)}` : t.hint}
                {t.partnerName && ` · ${t.partnerName}`}
              </span>
            )}
          </span>
        </span>
        {t.amount ? (
          <span className="shrink-0 text-xs font-black text-slate-700 tabular-nums">{t.amount.toLocaleString('ko-KR')}</span>
        ) : null}
      </button>
    );
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

/**
 * 템플릿이 만들 **분개 모양** — 편집 화면에서 저장 전에 확인한다.
 *
 * 사용자는 차·대를 고르지 않지만, **무엇이 어디로 잡히는지는 볼 수 있어야** 한다.
 * 계정을 잘못 골라 두면 그 템플릿으로 끊는 전표가 죄다 어긋나는데, 목록에는 계정 이름만
 * 보여서 저장 전엔 알 수가 없었다.
 *
 * 실제 분개는 journalize* 함수가 만든다. 여기는 **같은 규칙을 미리 그려 보이는 것**이라,
 * 규칙이 바뀌면 둘 다 손봐야 한다(그래서 갈래마다 근거를 주석으로 붙여 둔다).
 */
export function templateJournalLines(
  t: CashTemplate,
  bankName = '보통예금',
): { side: '차변' | '대변'; code: string; label: string; amount: number }[] {
  const amt = t.amount ?? 0;
  const bank = { code: '103', label: bankName };
  const sm = splitModeOf(t.mode);

  if (sm) {
    // 두 줄로 갈리는 갈래 — 통장은 한 번 움직이고 그 안에서 성격이 갈린다
    const a = (t as Record<string, any>)[SPLIT_MODES[sm].a] ?? 0;
    const b = (t as Record<string, any>)[SPLIT_MODES[sm].b] ?? 0;
    if (sm === '급여') {
      // (차) 급여 총액 / (대) 예수금 공제 + 통장 실지급
      return [
        { side: '차변', code: '515', label: '급여', amount: a },
        ...(b ? [{ side: '대변' as const, code: '254', label: '예수금', amount: b }] : []),
        { side: '대변', code: bank.code, label: bank.label, amount: a - b },
      ];
    }
    // 보험·상환·세금 — 차변이 둘, 대변은 통장 하나
    const [c1, l1, c2, l2] = sm === '보험' ? ['530', '사대보험', '254', '예수금']
      : sm === '상환' ? [t.loanCode ?? '293', '차입금', '951', '이자비용']
      : ['255', '부가세예수금', '338', '인출금'];
    return [
      ...(a ? [{ side: '차변' as const, code: c1, label: l1, amount: a }] : []),
      ...(b ? [{ side: '차변' as const, code: c2, label: l2, amount: b }] : []),
      { side: '대변', code: bank.code, label: bank.label, amount: a + b },
    ];
  }

  if (!isCashDir(t.dir) && t.dir !== '회사이체') {
    // 대체 — 양식이 있으면 그대로. 없으면 한 줄뿐이라 상대변을 사용자가 넣어야 한다.
    if (t.transferLines?.length) {
      return t.transferLines.map(l => ({ side: l.side, code: l.accountCode, label: l.name ?? '', amount: amt }));
    }
    return [{ side: '차변', code: t.accountCode ?? '', label: t.itemName ?? '', amount: amt }];
  }

  // 자금 — 한 변은 늘 통장이다. 입금이면 통장이 차변, 출금이면 대변.
  const other = { code: t.accountCode ?? '', label: t.itemName ?? '', amount: amt };
  return t.dir === '입금'
    ? [{ side: '차변', ...bank, amount: amt }, { side: '대변', ...other }]
    : [{ side: '차변', ...other }, { side: '대변', ...bank, amount: amt }];
}
