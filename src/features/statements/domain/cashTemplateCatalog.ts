import type {TemplateStatementType} from '../../../shared/templateStatementType';
import {AR,AP,OTHER_PAYABLE,VAT_PAYABLE,VAT_RECEIVABLE,BANK} from '../../../shared/autoJournal';
import {STANDARD_ACCOUNT} from '../../../shared/accountChart';

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
  statementType?: TemplateStatementType;
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
  /** 면세면 부가세를 안 뗀다 — 거래처가 붙은 템플릿의 분개 미리보기가 이걸 본다 */
  taxExempt?: boolean;
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
  loanId?: string;
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
  /** 회사 계정표에 없는 참조 — 목록에는 사유를 보이되 발행 선택은 막는다. */
  unavailableCodes?: string[];
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
  { id: 'payout',  label: '지불',     dir: '출금', mode: '일반', accountCode: AP, wantsPartner: true, hint: '미지급 상계' },

  // 매달 나가는 고정비
  { id: 'elec',    label: '전기세',   dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.UTILITIES },
  { id: 'water',   label: '수도세',   dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.UTILITIES },
  { id: 'rent',    label: '임대료',   dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.RENT },
  { id: 'ins4',    label: '4대보험',  dir: '출금', mode: '보험', accountCode: STANDARD_ACCOUNT.WELFARE, hint: '회사부담 + 예수금' },
  { id: 'ins',     label: '보험료',   dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.INSURANCE },
  { id: 'lease',   label: '리스료',   dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.RENT },

  // 그때그때 나가는 것
  { id: 'card',    label: '카드대금', dir: '출금', mode: '일반', accountCode: '650' },
  //  할부로 산 물건 값 — 살 때 (차)자산 /(대)253 미지급금이 서고, 매달 그 미지급금을 턴다.
  //  비용이 아니다. 비용으로 끊으면 물건값을 두 번 털게 된다(살 때 자산 + 낼 때 비용).
  { id: 'installment', label: '할부금', dir: '출금', mode: '일반', accountCode: OTHER_PAYABLE, hint: '미지급금 상환' },
  { id: 'freight', label: '운임',     dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.FREIGHT, wantsPartner: true },
  { id: 'outwork', label: '외주가공', dir: '출금', mode: '일반', accountCode: '540', wantsPartner: true },
  { id: 'submat',  label: '부자재',   dir: '출금', mode: '일반', accountCode: '505', wantsPartner: true },
  { id: 'interest',label: '이자',     dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.INTEREST },

  // 받아 뒀다 대신 내주는 돈 — 급여에서 뗀 원천세·4대보험이 예수금으로 잡혀 있다가 여기서 털린다
  { id: 'withhold',label: '원천세납부', dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.WITHHOLDING, note: '원천공제 납부', hint: '예수금 정리' },
  { id: 'tax',     label: '세금납부',   dir: '출금', mode: '세금', accountCode: VAT_PAYABLE, hint: '부가세 + 소득세' },
  { id: 'vatPay',  label: '부가세 납부', dir: '출금', mode: '일반', accountCode: '261', note: '부가세 납부', hint: '신고로 세운 미지급세금을 턴다', group: '수시' },

  // 사는 것 · 사장님 돈
  { id: 'deposit', label: '보증금',   dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.DEPOSIT },
  //  미리 준 물건값 — **초과지급도 여기로 간다.** 갚을 게 없는데 더 보냈으면 그건 채무 상계가
  //  아니라 선급금(자산)이다. 251을 음수로 미는 건 "안 진 빚을 갚았다"가 된다.
  { id: 'prepaid', label: '선급금',   dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.PREPAID, wantsPartner: true, hint: '초과지급·선지급' },
  { id: 'machine', label: '기계구입', dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.MACHINERY },
  { id: 'fixture', label: '비품', dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.FIXTURES, hint: '오래 쓰는 집기·장비' },
  { id: 'supplies', label: '소모품', dir: '출금', mode: '일반', accountCode: STANDARD_ACCOUNT.SUPPLIES_EXPENSE, hint: '짧게 쓰고 소모되는 물품' },
  { id: 'draw',    label: '인출금',   dir: '출금', mode: '일반', accountCode: '338' },

  // ══ 입금 ══════════════════════════════════════════════════════════
  // 거래처 채권 상계 — 매출전표가 이미 수익을 잡았으므로 수금은 미수금이 준다
  { id: 'collect', label: '수금',     dir: '입금', mode: '일반', accountCode: AR, wantsPartner: true, hint: '미수 상계' },
  { id: 'advance', label: '선수금',   dir: '입금', mode: '일반', accountCode: STANDARD_ACCOUNT.ADVANCE_RECEIVED, wantsPartner: true },
  { id: 'loanIn',  label: '차입실행', dir: '입금', mode: '일반', accountCode: '260' },
  { id: 'loanInL', label: '장기차입', dir: '입금', mode: '일반', accountCode: '293' },
  { id: 'vat',     label: '부가세환급', dir: '입금', mode: '일반', accountCode: VAT_RECEIVABLE, hint: '135에 남은 돌려받을 돈' },
  { id: 'depBack', label: '보증금회수', dir: '입금', mode: '일반', accountCode: STANDARD_ACCOUNT.DEPOSIT },

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
  { id: 'vatSettle', label: '부가세 신고(납부)', dir: '대체', mode: '일반', accountCode: VAT_PAYABLE, group: '결산',
    hint: '매출세액 − 매입세액 = 낼 돈',
    transferLines: [
      { accountCode: VAT_PAYABLE, side: '차변', name: '매출세액' },
      { accountCode: VAT_RECEIVABLE, side: '대변', name: '매입세액' },
      { accountCode: '261', side: '대변', name: '납부할 세액' },
    ] },
  { id: 'vatRefund', label: '부가세 신고(환급)', dir: '대체', mode: '일반', accountCode: VAT_PAYABLE, group: '결산',
    hint: '매입세액이 클 때 — 남는 건 135에',
    transferLines: [
      { accountCode: VAT_PAYABLE, side: '차변', name: '매출세액' },
      { accountCode: VAT_RECEIVABLE, side: '대변', name: '매출세액분 상계' },
    ] },
];
