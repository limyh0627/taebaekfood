import React, { useState, useMemo } from 'react';
import { today } from '../../src/shared/day';
import { X, Plus, Save } from 'lucide-react';
import type {
  Partner, IssuedStatement, CashEntry, AccountCode, AccountGroup, CashAccount,
  FixedCostTemplate, PaymentMethod, CompanyId, JournalEntry,
} from '../../src/shared/types';
import { COMPANIES, companyOf } from '../../src/shared/types';
import { filterCodesForContext, isCashAccountCode } from '../../src/features/admin/financials';
import { stampFor, nextDocNo } from '../../src/shared/voucherStamp';
import { isReceivableStmt } from '../../src/features/admin/cashLedger';
import { journalizeStatement, journalizeTransfer, journalizeCashEntry, settlementAccountCode } from '../../src/shared/autoJournal';
import {
  CashTemplateModal, filterTemplates, isCashDir, templateAccrRows,
  VOUCHER_DIRS, DIR_CHIP, DIR_HINT, type CashTemplate, type VoucherDir,
  SPLIT_MODES, splitModeOf,
} from '../../src/shared/cashTemplates';
import { buildTransfer, splitTransfer, type OverKind } from '../../src/shared/interCompany';

/**
 * **일반전표 발행 — 돈이 움직였거나 움직일 일을 한 장으로 적는 창.**
 *
 * 갈래가 여섯이다(`VOUCHER_DIRS`). 출금·입금은 통장이 지금 움직인 것이고,
 * 대체·줄돈·받을돈은 안 움직인 것이며, 회사이체는 두 장부에 한 건씩 서는 것이다.
 * 갈래마다 물어보는 게 달라서 화면이 통째로 바뀐다 — 그래서 한 창 안에 다 있다.
 * 나누면 "이 전표를 어느 창에서 끊더라"를 매번 헤매게 된다.
 *
 * 그 위에 **갈래 안의 갈래**가 또 있다(`qpMode`). 일반·상환·급여·보험·세금.
 * 한 번 나간 돈의 성격이 둘 이상인 것들이다 —
 *   상환 = 원금 + 이자 · 급여 = 총급여 − 원천공제 · 보험 = 회사부담 + 근로자부담 ·
 *   세금 = 부가세 + 소득세.
 * 합쳐 적으면 손익이 틀어지므로 갈라 받는다.
 *
 * **템플릿을 고르면 양식 전체가 그 템플릿이 된다** — 계정·거래처·금액·품목까지.
 * 매달 같은 곳에 같은 금액을 넣는 전표가 대부분이라 그게 실제로 시간을 줄인다.
 * 대신 안 채우는 칸을 남기면 안 된다. 앞 템플릿 값이 남아 딴 전표 금액으로 끊긴다.
 *
 * 이 창은 **무엇을 적었는지**를 정리해 부르는 쪽에 넘긴다. 실제로 쓰는 일은 밖에 있다.
 */
interface Props {
  companyId: CompanyId;
  /** 열 때의 방향 — 지금은 목록 화면의 [일반전표] 단추가 늘 출금으로 연다 */
  initialDir: VoucherDir;
  initialDate?: string;

  partners: Partner[];
  accountCodes: AccountCode[];
  accountGroups: AccountGroup[];
  /** 활성 통장만 */
  cashAccounts: CashAccount[];
  fixedCostTemplates: FixedCostTemplate[];
  /** 예수금 잔액을 세는 근거 — 4대보험 근로자부담 짐작에 쓴다 */
  cashEntries: CashEntry[];
  /** 상계 대상을 고를 때 본다 */
  statements: IssuedStatement[];
  partnerBalances: Map<string, { receivable: number; payable: number }>;
  getBalance: (_s: IssuedStatement) => number;
  /** 고른 통장 — 창을 닫아도 기억해야 해서 밖이 쥔다 */
  cashAccountId: string;
  onCashAccountId: (_id: string) => void;

  onClose: () => void;
  onAddCashEntry?: (_e: CashEntry) => void;
  onAddIssuedStatement?: (_s: IssuedStatement) => void;
  onAddFixedCostTemplate?: (_t: Omit<FixedCostTemplate, 'id'>) => void | Promise<void>;
  /** 회사이체 — 받는 회사 장부에도 한 건 세운다 */
  onAddForCompany?: (_co: CompanyId, _payload: { cashEntry?: CashEntry; statement?: IssuedStatement }) => void;
  /** 상계 — 전표에 붙이는 일은 밖이 한다 */
  recordPayment: (
    _allocations: { stmt: IssuedStatement; amount: number }[],
    _opts: { date: string; method?: PaymentMethod; note?: string; cashAccountId?: string; pin?: boolean },
  ) => void;
  /** 미리보기 전표 그리기 — 화면과 같은 양식을 쓴다 */
  renderJournal: (_je: JournalEntry | null, _compact?: boolean, _meta?: { date?: string; docNo?: string }) => React.ReactNode;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function VoucherComposer({
  companyId, initialDir, initialDate, partners, accountCodes, accountGroups, cashAccounts,
  fixedCostTemplates, cashEntries, statements: mergedStatements, partnerBalances, getBalance,
  cashAccountId: quickPayAccountId, onCashAccountId: setQuickPayAccountId,
  onClose, onAddCashEntry, onAddIssuedStatement, onAddFixedCostTemplate, onAddForCompany,
  recordPayment, renderJournal,
}: Props) {
  const activeCashAccounts = cashAccounts;
  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);
  //  계정이 어느 편에 서는 게 정상인가 — 대체전표는 차·대를 직접 세우므로 이걸 본다
  const normalOf = (code: string): 'debit' | 'credit' =>
    accountCodes.find(a => String(a.code) === String(code))?.normalBalance ?? 'debit';

    const [quickPayClientId, setQuickPayClientId] = useState('');
  const [quickPayClientSearch, setQuickPayClientSearch] = useState('');
  const [quickPayDate, setQuickPayDate] = useState(initialDate ?? today());
  const [quickPayAmount, setQuickPayAmount] = useState('');
  //  상계로 붙는 자금은 늘 계좌이체다 — 고를 자리가 없어서 값도 안 바뀐다
  const quickPayMethod: PaymentMethod = '계좌이체';
  const [quickPayNote, setQuickPayNote] = useState('');
  const [quickPayDropOpen, setQuickPayDropOpen] = useState(false);
  // 입출금 모달 확장 — 일반/상환/급여 + 방향 + 계정과목 (장부 흡수)
  const [qpMode, setQpMode] = useState<'일반' | '상환' | '급여' | '보험' | '세금'>('일반');
  // 4대보험 — 회사부담(비용)과 근로자부담(맡아둔 예수금)을 갈라 넣는다
  const [qpInsCorp, setQpInsCorp] = useState('');
  const [qpInsEmp, setQpInsEmp] = useState('');
  // 세금 — 부가세·소득세를 한 번에 내도 성격이 달라 갈라 적는다
  const [qpVat, setQpVat] = useState('');
  const [qpIncomeTax, setQpIncomeTax] = useState('');
  /**
   * 아직 안 낸 원천공제(예수금 254 잔액) — 급여에서 뗐지만 아직 공단에 안 낸 돈.
   * 4대보험 낼 때 근로자부담분이 보통 이 금액이다. 템플릿 적용과 화면 버튼이
   * **같은 값**을 봐야 해서 여기 한 곳에서만 센다.
   */
  const heldWithholding = useMemo(() => {
    const code = accountCodes.find(c => c.name === '예수금')?.code ?? '254';
    return cashEntries.reduce((a, e) => {
      const parts = (e.lines ?? []).filter(l => l.accountCode === code);
      const v = parts.length ? parts.reduce((b, l) => b + l.amount, 0) : (e.accountCode === code ? e.amount : 0);
      if (!v) return a;
      return a + (e.dir === '입금' ? v : -v);
    }, 0);
  }, [cashEntries, accountCodes]);
  const [qpDir, setQpDir] = useState<VoucherDir>(initialDir);
  /**
   * 일반전표를 **여러 계정으로 쪼갠 줄.** 통장 쪽(반대변)은 dir·cashAccountId가 이미 정하므로
   * 반대편만 줄로 적는다 — CashEntry.lines가 바로 이 모양이다(대출상환 원금+이자와 같은 자리).
   * 예전엔 '계정 하나' 모드가 따로 있었는데, 표 하나로 통일했다(줄이 하나면 그게 그것이다).
   */
  //  쪼갠 줄 — side로 차·대를 고른다. 통장 반대편이 기본이고, 반대로 놓으면 음수로 나간다
  //  (journalizeCashEntry가 음수 줄을 통장과 같은 편으로 세운다. 급여 원천공제가 그 길이다).
  const [qpCashRows, setQpCashRows] = useState<{ note: string; accountCode?: string; price: string; side?: '차변' | '대변' }[]>(
    [{ note: '', price: '' }]);
  const [qpPickerOpen, setQpPickerOpen] = useState(false);
  // 발생(돈 안 움직임) — 계정 여러 줄. 옛 대체전표 입력을 여기로 흡수했다.
  // 대체전표 줄 — **차·대를 손으로 고른다.** 짐작하지 않는다(자본을 차변에 세우는 전표가 있다).
  /**
   * 차·대를 손으로 고칠 것인가 — **기본은 안 보인다.**
   *
   * 전표에 차·대는 늘 있지만, 사용자가 고를 일은 거의 없다. 템플릿이 양식을 알고 있고
   * 급여 발생·상계·기초는 버튼이 알아서 끊는다. 회계를 아는 사람만 쓸 수 있는 화면이 되면 안 된다.
   * 중고 기계 매각처럼 계정이 여러 개 얽히는 특수 전표에서만 펼쳐 쓴다.
   */
  const [qpShowSides, setQpShowSides] = useState(false);
  const [qpAccrRows, setQpAccrRows] = useState<
    { name: string; accountCode?: string; price: string; side: '차변' | '대변' }[]
  >([{ name: '', price: '', side: '차변' }]);
  // 회사 간 이체 — 우리 통장에서 다른 회사 통장으로 보낼 때. 양쪽에 한 건씩 선다.
  const [qpAdvCompany, setQpAdvCompany] = useState<CompanyId>(companyId === 'taebaek' ? 'punghoe' : 'taebaek');
  const [qpAdvAmount, setQpAdvAmount] = useState('');
  // 미지급을 넘는 몫의 성격 — 물건을 받을 것이면 선급금, 그냥 빌려준 것이면 대여금
  const [qpAdvOver, setQpAdvOver] = useState<OverKind>('선급금');
  //  기본은 **장기차입금**(293) — 사업자 대출은 대개 1년을 넘긴다.
  //  1년 안에 갚는 건만 단기차입금(260)이다. 템플릿에 박아 두면 그게 이긴다.
  const [qpLoanCode, setQpLoanCode] = useState('260');
  const [qpPrincipal, setQpPrincipal] = useState('');
  const [qpInterest, setQpInterest] = useState('');
  const [qpGross, setQpGross] = useState('');
  const [qpDeduction, setQpDeduction] = useState('');
  /**
   * 방금 고른 템플릿 — **id로 기억한다.**
   *
   * 예전엔 계정과목으로 되찾았는데(activeTemplateId), 같은 계정을 쓰는 템플릿이 둘 이상이면
   * 먼저 오는 게 잡혔다. '리스료'를 골라도 목록엔 '리스료 (안사장)'이 눌린 것처럼 보였다.
   * 값은 고른 대로 들어갔지만 이름이 딴 것이라 무슨 전표를 쓰는 중인지 못 믿게 된다.
   */
  const [qpTemplateId, setQpTemplateId] = useState<string | null>(null);
  // 고른 방향의 템플릿만. 카드를 누르면 모드·계정과목·비고가 한 번에 채워진다.
  // 방향으로 안 거른다 — 고른 템플릿이 방향을 정한다(템플릿 화면과 같은 목록이 보여야 한다)
  const qpTemplates = useMemo(
    () => filterTemplates(accountCodes, fixedCostTemplates),
    [accountCodes, fixedCostTemplates],
  );
  /**
   * 템플릿을 고르면 **양식 전체가 그 템플릿이 된다** — 계정·거래처·금액·품목까지.
   * 매달 같은 곳에 같은 금액을 넣는 전표가 대부분이라, 그게 실제로 시간을 줄인다.
   *
   * 안 채우는 칸을 남겨 두면 안 된다. 앞서 고른 템플릿의 값이 그대로 남아
   * **딴 전표 금액으로 끊긴다** — 없는 값은 비우는 것까지가 '가져오는' 것이다.
   */
  const pickTemplate = (t: CashTemplate) => {
    setQpTemplateId(t.id);    // 고른 것을 id로 붙든다 — 계정만으로는 같은 계정 템플릿이 섞인다
    setQpDir(t.dir);          // 방향은 템플릿이 정한다
    setQpMode(t.mode);
    //  자금 표는 이제 줄이 원천이다 — 템플릿 계정을 첫 줄에 넣는다. 안 넣으면 계정이 빈 채로 열린다.
    setQpCashRows([{ note: '', price: '', ...(t.accountCode ? { accountCode: t.accountCode } : {}) }]);
    // 비고는 품목명 > 템플릿 비고 순 — 전표에 그대로 남는 글이라 품목명이 먼저다
    setQuickPayNote(t.itemName || t.note || '');
    if (t.partnerId) { setQuickPayClientId(t.partnerId); setQuickPayClientSearch(''); }
    else { setQuickPayClientId(''); setQuickPayClientSearch(''); }
    setQuickPayAmount(t.amount && t.amount > 0 ? String(t.amount) : '');
    /*
     * 비현금 갈래(대체·줄돈·받을돈)는 금액칸이 아니라 **'계정 · 금액' 줄**을 쓴다.
     * 리스료·임대료처럼 대체로 끊는 템플릿이 여기 걸린다 — 이 줄을 안 채우면
     * 금액과 계정을 들고 있는 템플릿을 골라도 빈 양식이 떴다.
     */
    setQpAccrRows(templateAccrRows(t));
    setQpShowSides(false);   // 템플릿이 차·대를 안다 — 손댈 일이 없다
    // 두 줄로 갈리는 갈래(보험·상환·급여·세금)는 금액칸을 안 쓴다 — 템플릿에 박아 둔 두 값을 그대로 채운다.
    // 먼저 넷을 다 비우고 고른 갈래만 채운다. 안 그러면 앞 템플릿의 원금·공제가 남는다.
    setQpInsCorp(''); setQpInsEmp(''); setQpPrincipal(''); setQpInterest('');
    setQpGross(''); setQpDeduction(''); setQpVat(''); setQpIncomeTax('');
    //  4대보험만 폴백을 둔다: 옛 템플릿엔 총액 하나뿐이라, 미납 예수금만큼을 근로자부담으로
    //  떼고 나머지를 회사부담으로 짐작한다. 짐작이라 그대로 고쳐 쓰면 된다.
    const sm = splitModeOf(t.mode);
    if (sm) {
      const S = SPLIT_MODES[sm];
      const a = (t as Record<string, any>)[S.a], b = (t as Record<string, any>)[S.b];
      const setters: Record<string, [(v: string) => void, (v: string) => void]> = {
        보험: [setQpInsCorp, setQpInsEmp],
        상환: [setQpPrincipal, setQpInterest],
        급여: [setQpGross, setQpDeduction],
        세금: [setQpVat, setQpIncomeTax],
      };
      if (sm === '상환' && t.loanCode) setQpLoanCode(t.loanCode);
      const [setA, setB] = setters[sm];
      if (a != null || b != null) { setA(a ? String(a) : ''); setB(b ? String(b) : ''); }
      else if (sm === '보험' && (t.amount ?? 0) > 0) {
        const total = t.amount ?? 0;
        const emp = Math.max(0, Math.min(Math.round(heldWithholding), total));
        setQpInsEmp(emp > 0 ? String(emp) : '');
        setQpInsCorp(String(total - emp));
      }
    }
    setQpPickerOpen(false);
  };
  /**
   * 거래처 칸을 눌렀을 때 — **고른 거래처를 지우지 않는다.**
   *
   * 전에는 focus에서 지웠다(빈 칸이라야 검색어를 친다고 봤다). 그런데 템플릿이 넣어 준
   * 거래처가 맞는지 **확인하려고 누른 것만으로** 사라져, 템플릿이 거래처를 안 가져온 것처럼 보였다.
   * 대신 글자를 통째로 잡아 둔다 — 바꾸려면 그냥 치면 덮이고, 안 치면 그대로 남는다.
   */
  const onPartnerFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select();
    setQuickPayDropOpen(true);
  };
  /**
   * 템플릿을 골라 둔 채로 분개를 손대면 물어본다.
   * 고른 템플릿과 다른 전표가 되는데도 머리엔 그 이름이 그대로 남으면,
   * 나중에 목록에서 "이건 무슨 전표지"가 된다. 예라고 하면 직접입력으로 푼다.
   */
  const askTemplateBreak = (go: () => void) => {
    if (!qpTemplateId) { go(); return; }
    if (!window.confirm('정해진 템플릿과 분개가 달라집니다.\n직접작성으로 바꿀까요?')) return;
    setQpTemplateId(null);
    go();
  };
  /**
   * 지금 쓰는 템플릿 — **고른 것만.** 안 골랐으면 없다(직접입력).
   *
   * 예전엔 계정과목으로 짐작했다(activeTemplate). 그러다 보니 직접입력으로 255 부가세예수금을
   * 고르기만 해도 머리에 '부가세 신고(납부)'가 떠서, 안 고른 템플릿을 쓰는 중인 것처럼 보였다.
   * 갈래도 안 맞았다 — 그 템플릿은 대체인데 화면은 출금이었다.
   * 짐작이 맞을 때도 있지만, 틀릴 때 무슨 전표를 쓰는지 못 믿게 되는 게 더 비싸다.
   */
  const currentTemplate = (list: CashTemplate[]) =>
    (qpTemplateId ? list.find(t => t.id === qpTemplateId) : undefined);
  const expCodes = useMemo(
    () => filterCodesForContext(accountCodes, accountGroups, '대체'),
    [accountCodes, accountGroups],
  );
        // 방향으로 상계 대상 전표 유형 결정 — 입금→매출(미수), 출금→매입(미지급)
        const stmtTypeForPay = qpDir === '입금' ? '매출' : '매입';
        const selectedClientObj = quickPayClientId ? partners.find(c => c.id === quickPayClientId) : null;
        /**
         * 거래처 미수/미지급 총액 — **분개(108·251) 기준**으로 본다(partnerBalances).
         *
         * 예전엔 props(최근 7일) 전표의 잔액을 더했다. 창 밖 옛 전표가 통째로 빠지는 데다,
         * 기초이월 전표는 type이 '비용'이라 배분 후보에서도 빠져 수금이 새 전표를 갉아먹었다.
         * 그래서 거래처 잔액 화면과 숫자가 갈렸다(유통가교 620,000 vs 500,000).
         * 분개 기준은 재무제표·거래처통계와 같은 근거라 저절로 맞는다.
         */
        const pb = quickPayClientId ? partnerBalances.get(quickPayClientId) : undefined;
        const partnerTotal = stmtTypeForPay === '매입' ? (pb?.payable ?? 0) : (pb?.receivable ?? 0);
        const dropClients = quickPayClientSearch.trim()
          ? partners.filter(c => companyOf(c) === companyId && c.name.includes(quickPayClientSearch.trim())).slice(0, 8)
          : [];

        const amt = Number((quickPayAmount || '').replace(/,/g, '')) || 0;
        const offsetAmt = quickPayClientId && partnerTotal > 0 ? Math.min(amt, partnerTotal) : 0; // 거래처 미수/미지급 상계분
        const plainAmt = amt - offsetAmt;   // 상계 후 남는 순수 자금
        // 상환/급여 파생
        const prin = Number((qpPrincipal || '').replace(/,/g, '')) || 0;
        const intr = Number((qpInterest || '').replace(/,/g, '')) || 0;
        const grs  = Number((qpGross || '').replace(/,/g, '')) || 0;
        const ded  = Number((qpDeduction || '').replace(/,/g, '')) || 0;
        const net  = grs - ded;
        //  할부도 상환이다 — 차를 할부로 사면 부채가 '미지급금'이지 차입금이 아니다.
        //  차입금만 걸러 두면 할부금을 상환으로 끊을 길이 없어 비용으로 새는 수밖에 없다.
        const loanAccounts = accountCodes.filter(c => c.type === '부채' && /차입금|미지급금/.test(c.name));
        const INTEREST_CODE = accountCodes.find(c => /이자비용/.test(c.name))?.code ?? '951';
        const SALARY_CODE = accountCodes.find(c => c.name === '급여')?.code ?? '515';
        const WITHHOLD_CODE = accountCodes.find(c => c.name === '예수금')?.code ?? '254';
        /*
         * 고를 수 있는 계정 — **다섯 갈래 전부.** 예전엔 수익을 뺐는데(비용·자산·부채·자본만),
         * 그러면 잡이익 대체나 이자수익 계상, 매출 정정을 손으로 끊을 길이 없다.
         * 막아야 할 건 셋뿐이다: 계정 없는 줄 · 빈 전표 · 차변≠대변.
         * 어느 계정을 어느 편에 놓을지는 적는 사람이 정한다.
         */
        const expenseCodes = accountCodes.filter(c => ['비용', '자산', '부채', '자본', '수익'].includes(c.type as string)).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

        const base = () => ({
          date: quickPayDate, cashAccountId: quickPayAccountId, createdAt: stampFor(quickPayDate),
          ...(quickPayClientId ? { partnerId: quickPayClientId, partnerName: selectedClientObj?.name ?? '' } : {}),
        });

        // 상계에 쓸 전표 배분 — 오래된 것부터 채운다. 저장과 미리보기가 같은 값을 봐야 한다.
        const offsetAllocations = () => {
          if (offsetAmt <= 0) return [] as { stmt: IssuedStatement; amount: number }[];
          //  mergedStatements + 기초 전표까지 본다 — props(7일)만 보거나 type만 보면
          //  갚을 전표가 있는데도 목록이 비어 상계가 통째로 안 걸린다.
          const unpaid = mergedStatements
            .filter(s => s.partnerId === quickPayClientId && isReceivableStmt(s, stmtTypeForPay) && getBalance(s) > 0)
            .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
          const out: { stmt: IssuedStatement; amount: number }[] = [];
          let rem = offsetAmt;
          for (const st of unpaid) {
            if (rem <= 0) break;
            const apply = Math.min(rem, getBalance(st));
            if (apply > 0) out.push({ stmt: st, amount: apply });
            rem -= apply;
          }
          return out;
        };

        // 일반 저장 — 거래처 미수/미지급 상계 우선, 남는 금액은 계정과목 자금전표로.
        const doGeneralSave = () => {
          if (amt <= 0) return;
          const allocations = offsetAllocations();
          if (allocations.length) recordPayment(allocations, { date: quickPayDate, method: quickPayMethod, note: quickPayNote.trim() || undefined, cashAccountId: quickPayAccountId });
          if (plainAmt > 0) {
            // 쪼갠 줄이 있으면 lines로 끊는다 — amount는 줄 합이고 accountCode는 안 쓴다(types.ts CashEntry 주석).
            onAddCashEntry?.({
              id: `cash-${Date.now()}`, dir: qpDir, amount: plainAmt,
              //  줄이 하나면 lines 대신 accountCode 로 낸다 — 예전 전표와 같은 모양이 되어
              //  목록·분개·수정 어디서도 갈리지 않는다(CashEntry 주석 참고).
              ...(cashSplitLines.length > 1 ? { lines: cashSplitLines }
                : cashSplitLines.length === 1 ? { accountCode: cashSplitLines[0].accountCode } : {}),
              ...(quickPayNote.trim() ? { note: quickPayNote.trim() } : {}), ...base(),
            } as any);
          }
          onClose();
        };
        // 통장에서는 한 번 나가도 전표는 두 줄로 끊는다 — 원금은 차입금(부채 감소, 재무상태표),
        // 이자는 이자비용(손익계산서). 줄마다 계정·금액이 따로 보여야 손익이 깔끔하게 갈린다.
        // 통장에서 나간 건 원금+이자 합계 한 번. 자금은 그 금액으로 한 건 만들고,
        // 그 안에서 원금(차입금=부채 감소)과 이자(비용)를 줄로 가른다.
        // → 지불 합계엔 6만원 전부, 비용 합계엔 이자 3만원만 잡힌다.
        const loanEntry = (): CashEntry | null => {
          const memo = quickPayNote.trim() || '대출 상환';
          const lines = [
            ...(prin > 0 ? [{ accountCode: qpLoanCode, amount: prin, note: '원금' }] : []),
            ...(intr > 0 ? [{ accountCode: INTEREST_CODE, amount: intr, note: '이자' }] : []),
          ];
          if (!lines.length) return null;
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: prin + intr,
            ...(lines.length > 1 ? { lines } : { accountCode: lines[0].accountCode }),
            note: lines.length > 1 ? memo : `${memo} (${lines[0].note})`,
            ...base(),
          } as CashEntry;
        };
        const doLoanSave = () => {
          const e = loanEntry();
          if (!e) return;
          onAddCashEntry?.(e as any);
          onClose();
        };
        // 급여도 대출상환과 같은 방식 — 전표는 한 건, 그 안에서 성격을 줄로 가른다.
        //   총급여는 비용(+), 원천공제는 우리가 맡아둔 돈이라 부채 증가(−).
        //   통장에서 실제로 나간 건 실지급액(net)이고, 줄 합계도 net으로 맞는다.
        // 예전엔 출금(총급여)·입금(예수금) 두 건으로 끊어 목록에 두 줄로 보였다.
        const insCorp = Number((qpInsCorp || '').replace(/,/g, '')) || 0;
        const insEmp = Number((qpInsEmp || '').replace(/,/g, '')) || 0;
        const insTotal = insCorp + insEmp;
        const INS_CODE = accountCodes.find(c => c.name === '사대보험')?.code ?? '530';

        /**
         * 4대보험 — 통장에서 한 번 나가지만 성격은 둘이다.
         *   회사부담분    비용(530)
         *   근로자부담분  급여에서 떼어 맡아둔 돈 → 예수금(254)을 턴다
         * 전액을 530으로 몰면 비용이 부풀고 예수금이 영영 안 줄어든다.
         */
        const insuranceEntry = (): CashEntry => {
          const memo = quickPayNote.trim() || '4대보험';
          const lines = [
            ...(insCorp > 0 ? [{ accountCode: INS_CODE, amount: insCorp, note: '회사부담' }] : []),
            ...(insEmp > 0 ? [{ accountCode: WITHHOLD_CODE, amount: insEmp, note: '근로자부담(예수금)' }] : []),
          ];
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: insTotal,
            ...(lines.length > 1 ? { lines } : { accountCode: lines[0].accountCode }),
            note: lines.length > 1 ? memo : `${memo} (${lines[0].note})`,
            ...base(),
          } as CashEntry;
        };
        /**
         * 세금 — 한 번에 내지만 **둘 다 비용이 아니다.**
         *   부가세    손님한테 받아 맡아둔 돈 → 255 부가세예수금(부채)을 턴다
         *   소득세    사업이 아니라 사장님 개인에게 매기는 세금 → 338 인출금(자본)
         * 전액을 비용으로 몰면 이익이 그만큼 줄어 보이고, 부가세예수금은 영영 안 줄어든다.
         */
        const vat = Number((qpVat || '').replace(/,/g, '')) || 0;
        const incomeTax = Number((qpIncomeTax || '').replace(/,/g, '')) || 0;
        const taxTotal = vat + incomeTax;
        const VAT_CODE = accountCodes.find(c => c.name === '부가세예수금')?.code ?? '255';
        const DRAW_CODE = accountCodes.find(c => c.name === '인출금')?.code ?? '338';
        const taxEntry = (): CashEntry => {
          const memo = quickPayNote.trim() || '세금 납부';
          const lines = [
            ...(vat > 0 ? [{ accountCode: VAT_CODE, amount: vat, note: '부가세' }] : []),
            ...(incomeTax > 0 ? [{ accountCode: DRAW_CODE, amount: incomeTax, note: '소득세' }] : []),
          ];
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: taxTotal,
            ...(lines.length > 1 ? { lines } : { accountCode: lines[0].accountCode }),
            note: lines.length > 1 ? memo : `${memo} (${lines[0].note})`,
            ...base(),
          } as CashEntry;
        };
        const doTaxSave = () => {
          if (taxTotal <= 0) return;
          onAddCashEntry?.(taxEntry() as any);
          onClose();
        };
        const doInsuranceSave = () => {
          if (insTotal <= 0) return;
          onAddCashEntry?.(insuranceEntry() as any);
          onClose();
        };

        /**
         * 발생 — 돈이 안 움직인 전표. **거래처가 있으면 매입전표, 없으면 대체전표**로 끊는다.
         *
         *   거래처 있음   (차) 비용 / (대) 251 외상매입금   → 그 거래처 미지급금이 는다. 나중에 [지불]
         *   거래처 없음   (차) 비용 / (대) 감가상각누계액 등  → 대체전표(type '비용'), 차·대를 직접 세운다
         *
         * 부가세 신고에 들어가려면 공급자가 있어야 하고, 미지급금을 걸려면 걸 상대가 있어야 한다 —
         * 그래서 거래처 하나로 갈린다. 사용자는 거래처만 고르면 되고 어느 전표인지는 앱이 정한다.
         */
        // 갈래가 전표 종류를 정한다 — 거래처를 고르면 매입전표(미지급금이 선다),
        // 안 고르면 순수 대체(차·대를 직접 세운다)
        const accrType: '매출' | '매입' | '비용' = quickPayClientId ? '매입' : '비용';
        const accrLines = qpAccrRows
          .filter(r => r.accountCode && Number(String(r.price).replace(/,/g, '')) > 0)
          .map(r => {
            const a = Number(String(r.price).replace(/,/g, '')) || 0;
            return {
              name: r.name.trim() || (codeName.get(r.accountCode!) ?? ''),
              spec: '', qty: 1, price: a, supply: a, tax: 0, total: a,
              isTaxExempt: true, accountCode: r.accountCode!, side: r.side,
            };
          });
        // 차·대를 따로 센다. 대체전표는 **둘이 같아야** 끊을 수 있다.
        const accrDebit  = accrLines.filter(l => l.side === '차변').reduce((a, r) => a + r.total, 0);
        const accrCredit = accrLines.filter(l => l.side === '대변').reduce((a, r) => a + r.total, 0);
        // 매입전표(거래처 있음)는 차·대가 갈래로 정해지므로 한 변의 합이 총액이다
        const accrTotal = accrType === '비용' ? accrDebit : accrLines.reduce((a, r) => a + r.total, 0);
        const accrBalanced = accrType !== '비용' || (accrDebit > 0 && accrDebit === accrCredit);

        const doAccrualSave = () => {
          if (!accrLines.length || !accrBalanced) return;   // 차·대가 안 맞으면 안 끊는다
          /*
           * **통장 줄이 끼어 있으면 자금전표다.**
           *
           * 여기는 차·대를 손으로 적는 자리라 (차)255 부가세예수금 / (대)103 보통예금 같은
           * 분개도 그대로 적힌다. 그걸 대체전표로만 저장하면 분개는 맞는데 현금출납장에
           * 안 서서, 통장에서 나간 돈이 자금 목록에서 사라진다.
           * 통장·현금 줄이 **딱 하나**면 자금전표로 낸다 — 그 줄이 통장 쪽, 나머지가 반대편이다.
           * 둘 이상이면(통장↔통장) 자금전표 한 건으로 못 담으니 대체전표로 둔다.
           */
          const cashLines = accrLines.filter(l => isCashAccountCode(l.accountCode, accountCodes));
          if (accrType === '비용' && cashLines.length === 1 && accrLines.length > 1 && onAddCashEntry) {
            const cashLine = cashLines[0];
            const others = accrLines.filter(l => l !== cashLine);
            const dir = cashLine.side === '대변' ? '출금' : '입금';
            onAddCashEntry({
              id: `cash-${Date.now()}`, dir, amount: cashLine.total,
              cashAccountId: quickPayAccountId,
              //  차·대는 side 가 말한다 — 금액은 언제나 양수다(부호로 뜻을 싣지 않는다)
              ...(others.length > 1
                ? { lines: others.map(l => ({
                    accountCode: l.accountCode, note: l.name,
                    amount: Math.abs(l.total), side: l.side,
                  })) }
                : { accountCode: others[0].accountCode }),
              ...(quickPayNote.trim() ? { note: quickPayNote.trim() } : { note: others[0]?.name ?? '' }),
              date: quickPayDate, createdAt: stampFor(quickPayDate),
              ...(quickPayClientId ? { partnerId: quickPayClientId, partnerName: selectedClientObj?.name ?? '' } : {}),
            } as never);
            onClose();
            return;
          }
          // 대체는 따로 센다 — 매입·매출과 번호가 섞이면 어느 갈래인지 번호로 못 읽는다
          const accrDocNo = nextDocNo(quickPayDate, mergedStatements, accrType === '비용' ? '대체' : '');
          const stmt: IssuedStatement = {
            id: `stmt-${Date.now()}`,
            issuedAt: stampFor(quickPayDate),
            tradeDate: quickPayDate,
            type: accrType,
            partnerId: quickPayClientId || '',
            partnerName: quickPayClientId ? (selectedClientObj?.name ?? '') : (accrLines[0].name || '대체'),
            orderId: '',
            docNo: accrDocNo,
            totalSupply: accrTotal, totalTax: 0, totalAmount: accrTotal,
            items: accrLines,
          };
          onAddIssuedStatement?.(stmt);
          onClose();
        };

        /**
         * 회사 간 이체 — 우리 통장에서 상대 회사 통장으로 보낸다.
         * 보낸 쪽은 대여금(자산), 받은 쪽은 차입금(부채). 한쪽만 적으면 두 장부가 어긋나므로
         * 한 번에 두 건을 같이 만든다(shared/interCompany).
         */
        const advAmt = Number((qpAdvAmount || '').replace(/,/g, '')) || 0;
        // 상대 회사를 가리키는 거래처 — 채권·채무가 이 거래처로 잡혀야 잔액이 준다.
        // 이름으로 찾는다(태백푸드 / 풍회유통). 없으면 상계를 못 하고 전액 선급금이 된다.
        const advTargetName = COMPANIES.find(c => c.id === qpAdvCompany)?.name ?? '';
        const advMyName = COMPANIES.find(c => c.id === companyId)?.name ?? '';
        const advTargetPartner = partners.find(p => p.name === advTargetName);
        const advMyPartner = partners.find(p => p.name === advMyName);
        // 내가 상대에게 진 미지급 — 이만큼 먼저 턴다
        const advPayable = advTargetPartner
          ? Math.max(0, partnerBalances.get(advTargetPartner.id)?.payable ?? 0)
          : 0;
        const advSplit = splitTransfer(advAmt, advPayable, qpAdvOver);

        const doTransferSave = () => {
          if (advAmt <= 0 || !onAddForCompany) return;
          const t = buildTransfer({
            from: companyId, to: qpAdvCompany,
            date: quickPayDate, amount: advAmt,
            payableToTarget: advPayable, overKind: qpAdvOver,
            fromAccountId: quickPayAccountId,
            fromPartnerId: advTargetPartner?.id, fromPartnerName: advTargetPartner?.name,
            toPartnerId: advMyPartner?.id, toPartnerName: advMyPartner?.name,
            note: quickPayNote.trim() || undefined,
          });
          onAddForCompany(companyId, { cashEntry: t.out });
          onAddForCompany(qpAdvCompany, { cashEntry: t.in });
          onClose();
        };

        const salaryEntry = (): CashEntry => {
          const memo = quickPayNote.trim() || '급여';
          const lines = [
            { accountCode: SALARY_CODE, amount: grs, note: '총급여' },
            //  공제는 통장과 같은 편(출금인데 대변) — 예전엔 음수로 실었다
            ...(ded > 0 ? [{ accountCode: WITHHOLD_CODE, amount: ded, side: '대변' as const, note: '원천공제' }] : []),
          ];
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: net,
            ...(lines.length > 1 ? { lines } : { accountCode: SALARY_CODE }),
            note: memo, ...base(),
          } as CashEntry;
        };
        const doSalarySave = () => {
          onAddCashEntry?.(salaryEntry() as any);
          onClose();
        };

        /**
         * 저장하면 어떤 자금전표가 생기는지 — 아래 분개 미리보기가 이걸 그대로 분개한다.
         * 저장 경로와 같은 함수를 써서 만든다. 갈라 두면 "보인 것과 저장된 것"이 달라진다.
         */
        const previewEntries = (): CashEntry[] => {
          if (qpMode === '상환') { const e = loanEntry(); return e ? [e] : []; }
          if (qpMode === '급여') return grs > 0 ? [salaryEntry()] : [];
          if (qpMode === '보험') return insTotal > 0 ? [insuranceEntry()] : [];
          if (qpMode === '세금') return taxTotal > 0 ? [taxEntry()] : [];
          if (qpDir === '회사이체') {
            if (advAmt <= 0) return [];
            const t = buildTransfer({
              from: companyId, to: qpAdvCompany, date: quickPayDate, amount: advAmt,
              payableToTarget: advPayable, overKind: qpAdvOver,
              fromAccountId: quickPayAccountId,
              fromPartnerId: advTargetPartner?.id, fromPartnerName: advTargetPartner?.name,
              toPartnerId: advMyPartner?.id, toPartnerName: advMyPartner?.name,
              note: quickPayNote.trim() || undefined,
            });
            return [t.out, t.in];
          }
          if (!isCashDir(qpDir)) return [];   // 비현금 갈래는 전표(매입·매출·대체)라 아래에서 따로 미리보기
          if (amt <= 0) return [];
          const out: CashEntry[] = [];
          const allocations = offsetAllocations();
          if (allocations.length) {
            // recordPayment이 만드는 것과 같은 한 건 — 상대계정도 같은 함수로 고른다
            const first = allocations[0].stmt;
            const groupTypeOf = (code: string) =>
              accountGroups.find(g => g.id === accountCodes.find(c => c.code === code)?.groupId)?.type;
            const itemCodes = allocations.flatMap(({ stmt }) => (stmt.items ?? []).map(i => i.accountCode).filter(Boolean) as string[]);
            const payCode = settlementAccountCode(first.type, itemCodes, groupTypeOf);
            out.push({
              id: 'preview-offset', ...(payCode ? { accountCode: payCode } : {}),
              date: quickPayDate, cashAccountId: quickPayAccountId,
              dir: first.type === '매입' ? '출금' : '입금',
              amount: allocations.reduce((a, x) => a + x.amount, 0),
              note: quickPayNote.trim() || `${first.partnerName ?? ''} ${first.type === '매입' ? '지불' : '수금'}`.trim(),
              createdAt: '',
            } as CashEntry);
          }
          if (plainAmt > 0) {
            out.push({
              id: 'preview-plain', dir: qpDir, amount: plainAmt,
              //  줄이 하나면 lines 대신 accountCode 로 낸다 — 예전 전표와 같은 모양이 되어
              //  목록·분개·수정 어디서도 갈리지 않는다(CashEntry 주석 참고).
              ...(cashSplitLines.length > 1 ? { lines: cashSplitLines }
                : cashSplitLines.length === 1 ? { accountCode: cashSplitLines[0].accountCode } : {}),
              date: quickPayDate, cashAccountId: quickPayAccountId,
              note: quickPayNote.trim(), createdAt: '',
            } as CashEntry);
          }
          return out;
        };

        /**
         * 쪼갠 줄 — 계정이 붙고 금액이 있는 줄만. 합이 통장에서 움직인 금액(plainAmt)과 같아야 끊는다.
         * 안 맞는 전표는 시산표를 조용히 망가뜨린다(발생 쪽 차·대 검사와 같은 이유).
         */
        /*
         * 쪼갠 줄의 **부호가 차·대를 정한다.** 통장 반대편(출금이면 차변)이 양수,
         * 통장과 같은 편이면 음수다 — journalizeCashEntry가 그렇게 읽는다.
         * 그래서 줄 합이 통장에서 움직인 금액과 같아야 차·대가 맞는다.
         *   급여: 총급여 +3,000,000 · 예수금 −300,000 → 통장 2,700,000
         */
        const normalSide = qpDir === '입금' ? '대변' : '차변';
        /*
         * 행이 **하나뿐이고 금액을 안 적었으면** 통장 금액을 그대로 쓴다.
         * 계정 하나짜리 전표에서 같은 숫자를 두 번 치게 하지 않으려는 것 —
         * 예전의 '한 계정' 모드가 하던 일을 같은 표 안에서 한다.
         */
        const cashSingleAuto = qpCashRows.length === 1 && !!qpCashRows[0].accountCode && !qpCashRows[0].price;
        const cashSplitLines = qpCashRows
          .map(r => ({
            accountCode: r.accountCode ?? '',
            amount: cashSingleAuto ? plainAmt : Number(r.price || 0),
            side: (r.side ?? normalSide) as '차변' | '대변',
            note: r.note.trim() || undefined,
          }))
          .filter(l => l.accountCode && l.amount !== 0);
        //  차·대가 맞는지는 **부호로 세어** 본다 — 통장 줄까지 세면 0이 되어야 한다
        const cashSplitSum = cashSplitLines.reduce((a, l) => a + l.amount * (l.side === normalSide ? 1 : -1), 0);
        const cashSplitOk = cashSplitLines.length > 0 && Math.abs(cashSplitSum - plainAmt) < 0.5;

        const canSave = qpDir === '회사이체' ? (advAmt > 0 && !!onAddForCompany)
          : !isCashDir(qpDir) ? (accrLines.length > 0 && accrBalanced)   // 차·대가 맞아야 끊는다
          : qpMode === '상환' ? (prin > 0 || intr > 0)
          : qpMode === '보험' ? insTotal > 0
          : qpMode === '세금' ? taxTotal > 0
          : qpMode === '급여' ? (grs > 0 && ded >= 0 && net >= 0)
          // 일반: 전액 상계면 계정 불필요. 쪼갠 줄을 켰으면 합이 맞아야, 아니면 계정 하나 필수
          : (amt > 0 && (offsetAmt >= amt || cashSplitOk));

        const handleQuickPaySave = () => {
          if (qpDir === '회사이체') { doTransferSave(); return; }
          if (!isCashDir(qpDir)) { if (accrBalanced) doAccrualSave(); return; }
          if (qpMode === '상환') { if (prin > 0 || intr > 0) doLoanSave(); return; }
          if (qpMode === '보험') { doInsuranceSave(); return; }
          if (qpMode === '세금') { doTaxSave(); return; }
          if (qpMode === '급여') { if (grs > 0 && ded >= 0 && net >= 0) doSalarySave(); return; }
          if (!canSave) return;
          // 상계 초과분(줄돈/받을돈 전환) 경고 — 거래처 있고 상계보다 많은데 계정도 없으면 canSave가 막음
          doGeneralSave();
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => { onClose(); }}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 방향은 제목 줄에 둔다 — 들어오는 돈과 나가는 돈은 쓰는 계정이 아예 달라서
                  고를 수 있는 전표가 통째로 바뀐다. */}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
                <h3 className="text-sm font-black text-slate-800 shrink-0">일반전표 발행</h3>
                {/* 일자는 제목 옆에 — 전표를 끊을 때 제일 먼저 확인하는 값이라 맨 위에 둔다 */}
                <input type="date" value={quickPayDate} onChange={e => setQuickPayDate(e.target.value)}
                  className="shrink-0 border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                {/* 출금·입금은 돈이 움직인 것, 발생은 안 움직인 것(채무 발생·대체).
                    표준 전표 체계의 출금·입금·대체와 같은 갈래다. */}
                <div className="flex gap-1 ml-auto flex-wrap justify-end">
                  {VOUCHER_DIRS.map(d => (
                    <button key={d} type="button"
                      onClick={() => { setQpDir(d); setQpMode('일반'); setQuickPayClientId(''); setQuickPayClientSearch(''); }}
                      title={DIR_HINT[d]}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${qpDir === d
                        ? `${DIR_CHIP[d]} border-transparent shadow-sm`
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                      {d}
                    </button>
                  ))}
                </div>
                <button onClick={() => { onClose(); }}
                  className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all shrink-0"><X size={18}/></button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">

              {/* 기본은 직접입력. 목록은 고를 때만 창을 열어 보여준다 —
                  늘 펼쳐 두면 정작 금액 칸이 아래로 밀린다. */}
              {(() => {
                const cur = currentTemplate(qpTemplates);
                const picked = !!cur && !cur.id.startsWith('free');
                return (
                  <button type="button" onClick={() => setQpPickerOpen(true)}
                    className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl border text-left transition-all ${
                      picked ? 'bg-indigo-50 border-indigo-200 hover:border-indigo-400' : 'bg-slate-50 border-slate-200 hover:border-slate-400'
                    }`}>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">전표</span>
                    <span className={`text-sm font-black truncate ${picked ? 'text-indigo-700' : 'text-slate-600'}`}>{cur?.label ?? '직접입력'}</span>
                    {cur && <span className="text-[10px] font-bold text-slate-400 truncate">{cur.hint ?? `${cur.accountCode} ${codeName.get(cur.accountCode ?? '') ?? ''}`}</span>}
                    <span className="ml-auto text-[11px] font-black text-indigo-600 shrink-0">템플릿 ▾</span>
                  </button>
                );
              })()}

              {/* 계좌 + 일자 */}
              {/* 비현금 갈래는 통장이 안 움직이므로 계좌 칸을 안 띄운다 */}
              {isCashDir(qpDir) && (
                <div className="w-1/2 pr-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">계좌</label>
                  <select value={quickPayAccountId} onChange={e => setQuickPayAccountId(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                    {activeCashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              {qpDir === '회사이체' ? (
                <>
                  {/* 회사 간 이체 — 별도 사업자끼리 돈을 옮기는 것. 비용이 아니라 빌려주는 것이다.
                      그 돈으로 뭘 샀는지는 **받은 회사 장부에서 평범한 출금**으로 따로 적는다. */}
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">보내는 곳 → 받는 곳</label>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 px-3 py-2.5 rounded-xl bg-slate-100 text-sm font-black text-slate-600 text-center">
                        {COMPANIES.find(c => c.id === companyId)?.name}
                      </span>
                      <span className="text-slate-300 font-black">→</span>
                      <select value={qpAdvCompany} onChange={e => setQpAdvCompany(e.target.value as CompanyId)}
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-300">
                        {COMPANIES.filter(c => c.id !== companyId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="qp-amount" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">금액</label>
                      <div className="relative">
                      <input id="qp-amount" inputMode="numeric" placeholder="0" value={qpAdvAmount}
                        onChange={e => setQpAdvAmount(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl pl-3 pr-9 py-3 text-right text-2xl font-black tabular-nums outline-none focus:ring-2 focus:ring-purple-300"/>
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300 pointer-events-none">원</span>
                    </div>
                  </div>
                  {/* 밀린 미지급부터 턴다 — 무턱대고 대여금으로 잡으면 미지급이 영영 안 준다 */}
                  {advPayable > 0 && (
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] font-bold text-slate-500 leading-snug">
                      {advTargetName}에 밀린 미지급 <b className="text-rose-600 tabular-nums">{fmt(advPayable)}원</b>
                      <button type="button" onClick={() => setQpAdvAmount(String(Math.round(advPayable)))}
                        className="ml-1.5 text-indigo-600 hover:underline">— 눌러서 채우기</button>
                    </div>
                  )}
                  {advAmt > 0 && (
                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden text-[11px] font-bold">
                      {advSplit.offset > 0 && (
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-slate-500">미지급 상계</span>
                          <span className="tabular-nums text-slate-800">{fmt(advSplit.offset)}</span>
                        </div>
                      )}
                      {advSplit.over > 0 && (
                        <div className="px-3 py-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">넘는 몫</span>
                            <span className="tabular-nums text-slate-800">{fmt(advSplit.over)}</span>
                          </div>
                          <div className="flex gap-1.5">
                            {(['선급금', '대여금'] as const).map(k => (
                              <button key={k} type="button" onClick={() => setQpAdvOver(k)}
                                title={k === '선급금' ? '물건을 받을 것 — 매입전표가 끊기면 저절로 상계된다' : '돈으로 돌려받을 것'}
                                className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border transition-all ${qpAdvOver === k
                                  ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                                {k}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="rounded-xl bg-purple-50 text-purple-700 px-3 py-2.5 text-[11px] font-bold leading-snug">
                    밀린 미지급부터 털고, 넘는 몫만 {qpAdvOver}으로 잡습니다. <b>비용이 아닙니다.</b>
                    <br/>그 돈으로 무엇을 샀는지는 <b>{advTargetName} 장부</b>에서 따로 적으세요.
                  </div>
                </>
              ) : !isCashDir(qpDir) ? (
                <>
                  {/* 발생 — 돈이 안 움직인다. 거래처를 고르면 매입전표(미지급금이 선다),
                      안 고르면 대체전표(감가상각·퇴직충당). 어느 전표인지는 앱이 정한다. */}
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                      거래처 <span className="normal-case text-slate-300">(고르면 미지급금이 섭니다 · 비우면 순수 대체)</span>
                    </label>
                    <input type="text" placeholder="업체명 검색..."
                      value={selectedClientObj ? selectedClientObj.name : quickPayClientSearch}
                      onFocus={onPartnerFocus}
                      onChange={e => { setQuickPayClientSearch(e.target.value); setQuickPayClientId(''); setQuickPayDropOpen(true); }}
                      onBlur={() => setTimeout(() => setQuickPayDropOpen(false), 150)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                    {quickPayDropOpen && dropClients.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden">
                        {dropClients.map(c => (
                          <button key={c.id}
                            onMouseDown={() => { setQuickPayClientId(c.id); setQuickPayClientSearch(''); setQuickPayDropOpen(false); }}
                            className="w-full text-left px-3 py-2.5 text-xs font-black text-slate-800 hover:bg-amber-50 transition-colors border-b border-slate-50 last:border-0">
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">계정 · 금액</label>
                    {qpAccrRows.map((r, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        {/* 차·대는 **대체전표에만** 있다. 매입전표(거래처 있음)는 갈래가 이미 정한다
                            — 품목은 차변, 미지급금은 대변. 3전표제에서 대체만 칸이 있는 이유다. */}
                        {/* 단추 하나를 눌러 차↔대를 뒤집는다 — 나란한 두 칸은 자리만 먹고,
                            안 눌린 쪽이 회색으로 남아 무엇이 골라졌는지 한눈에 안 읽힌다. */}
                        {!quickPayClientId && qpShowSides && (
                          <button type="button" title="눌러서 차변·대변 바꾸기"
                            onClick={() => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, side: x.side === '차변' ? '대변' : '차변' } : x))}
                            className={`shrink-0 w-11 py-2 rounded-lg text-[11px] font-black transition-all ${
                              r.side === '차변' ? 'bg-slate-700 text-white' : 'bg-amber-500 text-white'}`}>
                            {r.side}
                          </button>
                        )}
                        {!quickPayClientId && !qpShowSides && (
                          <span className={`shrink-0 w-8 text-center text-[11px] font-black ${
                            r.side === '차변' ? 'text-slate-500' : 'text-amber-600'}`}>{r.side}</span>
                        )}
                        <input value={r.name} placeholder="적요 (비우면 계정명)"
                          onChange={e => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                        <select value={r.accountCode || ''}
                          onChange={e => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, accountCode: e.target.value || undefined } : x))}
                          className="w-36 shrink-0 border border-slate-200 rounded-lg px-1.5 py-2 text-[11px] font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-amber-300">
                          <option value="">계정 —</option>
                          {(quickPayClientId ? expenseCodes : expCodes).map(ac => <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>)}
                        </select>
                        <input value={r.price} placeholder="금액" inputMode="numeric"
                          onChange={e => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, price: e.target.value.replace(/[^\d]/g, '') } : x))}
                          className="w-28 shrink-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-black text-right tabular-nums outline-none focus:ring-2 focus:ring-amber-300"/>
                        {qpAccrRows.length > 1 && (
                          <button type="button" onClick={() => setQpAccrRows(prev => prev.filter((_, i) => i !== idx))}
                            className="shrink-0 text-slate-300 hover:text-rose-400"><X size={14}/></button>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setQpAccrRows(prev => [...prev, { name: '', price: '', side: prev.length % 2 ? '대변' : '차변' }])}
                        className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700">
                        <Plus size={12} strokeWidth={3}/>행 추가
                      </button>
                      {/* 차·대가 맞아야 끊을 수 있다 — 안 맞는 전표는 시산표를 조용히 망가뜨린다 */}
                      {!quickPayClientId && !qpShowSides && (
                        <button type="button" onClick={() => setQpShowSides(true)}
                          className="text-[11px] font-black text-slate-300 hover:text-slate-500">차·대 고치기</button>
                      )}
                      {!quickPayClientId && (accrDebit > 0 || accrCredit > 0) && (
                        <span className={`ml-auto text-[11px] font-black tabular-nums ${
                          accrBalanced ? 'text-emerald-600' : 'text-rose-500'}`}>
                          차 {fmt(accrDebit)} · 대 {fmt(accrCredit)}
                          {accrBalanced ? ' ✓' : ` · 차이 ${fmt(accrDebit - accrCredit)}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={`rounded-xl px-3 py-2.5 text-[11px] font-bold leading-snug ${qpDir === '대체' ? 'bg-slate-50 text-slate-500' : 'bg-amber-50 text-amber-700'}`}>
                    {quickPayClientId
                      ? <>매입전표로 끊습니다 — <b>{selectedClientObj?.name}</b> 미지급금이 {fmt(accrTotal)}원 늘어납니다. 실제로 낼 때 거래처 화면에서 [지불]하세요.</>
                      : <>대체전표로 끊습니다 — 차·대를 직접 세웁니다(감가상각비·퇴직급여충당금). 손익에는 잡히고 현금흐름에서는 순이익에 다시 가산됩니다.</>}
                  </div>
                </>
              ) : qpMode === '일반' ? (
                <>
                  {/* 거래처 (선택) */}
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">거래처 <span className="normal-case text-slate-300">(선택 · {qpDir === '입금' ? '매출 미수 상계' : '매입 미지급 상계'})</span></label>
                    <input type="text" placeholder="업체명 검색..."
                      value={selectedClientObj ? selectedClientObj.name : quickPayClientSearch}
                      onFocus={onPartnerFocus}
                      onChange={e => { setQuickPayClientSearch(e.target.value); setQuickPayClientId(''); setQuickPayDropOpen(true); }}
                      onBlur={() => setTimeout(() => setQuickPayDropOpen(false), 150)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                    {quickPayDropOpen && dropClients.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden">
                        {dropClients.map(c => {
                          //  위 partnerTotal과 같은 근거(분개 108·251)로 본다 — 목록과 상세가 갈리면 안 된다.
                          const cb = partnerBalances.get(c.id);
                          const bal = stmtTypeForPay === '매입' ? (cb?.payable ?? 0) : (cb?.receivable ?? 0);
                          return (
                            <button key={c.id}
                              onMouseDown={() => { setQuickPayClientId(c.id); setQuickPayClientSearch(''); setQuickPayDropOpen(false); }}
                              className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-emerald-50 transition-colors border-b border-slate-50 last:border-0">
                              <span className="font-black text-slate-800">{c.name}</span>
                              {bal > 0 && <span className={`font-black ${qpDir === '입금' ? 'text-blue-600' : 'text-rose-600'}`}>{fmt(bal)}원</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {quickPayClientId && (
                      <div className="mt-2 px-3 py-2 bg-slate-50 rounded-xl flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">{qpDir === '입금' ? '미수금' : '미지급금'}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-black ${partnerTotal > 0 ? (qpDir === '입금' ? 'text-blue-600' : 'text-rose-600') : 'text-emerald-600'}`}>
                            {partnerTotal > 0 ? `${fmt(partnerTotal)}원` : '없음'}
                          </span>
                          {partnerTotal > 0 && (
                            <button onClick={() => setQuickPayAmount(String(partnerTotal))}
                              className="text-[10px] font-black px-2 py-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all">완불처리</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 금액 — 제일 자주 손대는 칸이라 글씨는 크게, 대신 폭은 절반만.
                      칸이 화면 끝까지 늘어나면 숫자와 단위가 멀어져 오히려 읽기 나쁘다. */}
                  <div className="w-1/2 pr-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">금액</label>
                    <div className="relative">
                      <input type="text" inputMode="numeric" placeholder="0" value={quickPayAmount}
                        onChange={e => setQuickPayAmount(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl pl-3 pr-9 py-3 text-right text-2xl font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300 pointer-events-none">원</span>
                    </div>
                  </div>

                  {/* 상계 안내 */}
                  {offsetAmt > 0 && (
                    <div className="text-[11px] font-bold text-slate-500 bg-slate-50 rounded-xl px-3 py-2 leading-snug">
                      {fmt(offsetAmt)}원은 {selectedClientObj?.name}의 {qpDir === '입금' ? '미수금' : '미지급금'} 상계.
                      {plainAmt > 0 && <> 남는 <b className="text-slate-700">{fmt(plainAmt)}원</b>은 아래 계정과목의 자금으로 잡힙니다.</>}
                    </div>
                  )}

                  {/* 계정과목 — 전액 상계일 때만 자리를 비운다.
                      전엔 `plainAmt > 0`이라 **금액을 넣기 전에도 숨었다**. 템플릿으로 계정을 고르고도
                      그게 뭔지 안 보이니 매번 확인이 안 됐다. 금액이 0이면 그냥 빈 채로 보여 준다. */}
                  {amt > 0 && plainAmt <= 0 ? (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-[11px] font-bold text-slate-500">
                      전액 {selectedClientObj?.name} {qpDir === '입금' ? '미수' : '미지급'} 상계라 계정과목이 필요 없습니다
                      <span className="text-slate-400"> — {qpDir === '입금' ? '외상매출금' : '외상매입금'}이 그만큼 줄어듭니다.</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          계정 · 금액 <span className="text-rose-400">*</span>
                          <span className="normal-case text-slate-300 ml-1">(통장 반대편 — 성격이 둘이면 행을 더한다)</span>
                        </label>
                        <span className="text-[10px] font-bold text-slate-400">
                          {qpDir === '입금' ? '통장은 차변' : '통장은 대변'}으로 자동
                        </span>
                      </div>
                      {/* 한 계정이든 여럿이든 **같은 표**를 쓴다. 예전엔 '한 계정'일 땐 드롭다운 하나,
                          '쪼개기'를 켜면 표로 바뀌어서 같은 일을 두 모양으로 했다.
                          행이 하나면 금액을 비워 둬도 된다 — 통장 금액을 그대로 쓴다. */}
                      <div className="space-y-2">
                        {qpCashRows.map((r, idx) => {
                          const side = r.side ?? (qpDir === '입금' ? '대변' : '차변');
                          return (
                            <div key={idx} className="flex items-center gap-1.5">
                              {/* 눌러서 차↔대를 뒤집는다. 뒤집힌 줄은 통장과 같은 편에 서서 음수로 나간다
                                  (급여 원천공제가 그 길). 대체 화면의 단추와 같은 모양이다. */}
                              <button type="button" title="눌러서 차변·대변 바꾸기"
                                onClick={() => setQpCashRows(prev => prev.map((x, i) => i === idx ? { ...x, side: side === '차변' ? '대변' : '차변' } : x))}
                                className={`shrink-0 w-11 py-2 rounded-lg text-[11px] font-black transition-all ${
                                  side === '차변' ? 'bg-slate-700 text-white' : 'bg-amber-500 text-white'}`}>
                                {side}
                              </button>
                              <input value={r.note} placeholder="적요 (비우면 계정명)"
                                onChange={e => setQpCashRows(prev => prev.map((x, i) => i === idx ? { ...x, note: e.target.value } : x))}
                                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                              <select value={r.accountCode || ''}
                                onChange={e => setQpCashRows(prev => prev.map((x, i) => i === idx ? { ...x, accountCode: e.target.value || undefined } : x))}
                                className={`w-36 shrink-0 border rounded-lg px-1.5 py-2 text-[11px] font-bold outline-none focus:ring-2 focus:ring-emerald-300 ${r.accountCode ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'}`}>
                                <option value="">계정 —</option>
                                {expenseCodes.map(c => <option key={c.id} value={c.code}>{c.code} {c.name}</option>)}
                              </select>
                              <input value={r.price} placeholder={qpCashRows.length === 1 ? fmt(plainAmt) : '금액'} inputMode="numeric"
                                onChange={e => setQpCashRows(prev => prev.map((x, i) => i === idx ? { ...x, price: e.target.value.replace(/[^\d]/g, '') } : x))}
                                className="w-28 shrink-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-black text-right tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                              {qpCashRows.length > 1 ? (
                                <button type="button" onClick={() => setQpCashRows(prev => prev.filter((_, i) => i !== idx))}
                                  className="shrink-0 text-slate-300 hover:text-rose-400"><X size={14}/></button>
                              ) : <span className="shrink-0 w-[14px]" />}
                            </div>
                          );
                        })}
                        {/* 통장 줄 — **앱이 채우는 줄이라 못 고친다.** 그래도 표 안에 같이 보여야
                            분개 전체가 한자리에서 읽힌다. 출금이면 대변, 입금이면 차변으로 고정이고
                            금액은 위 금액칸을 그대로 따라간다. */}
                        {plainAmt > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className={`shrink-0 w-11 py-2 rounded-lg text-[11px] font-black text-center text-white opacity-60 ${
                              qpDir === '입금' ? 'bg-slate-700' : 'bg-amber-500'}`}>
                              {qpDir === '입금' ? '차변' : '대변'}
                            </span>
                            <span className="flex-1 min-w-0 px-2.5 py-2 text-sm font-bold text-slate-400 truncate">
                              {activeCashAccounts.find(a => a.id === quickPayAccountId)?.name ?? '통장'}
                              <span className="text-slate-300 ml-1 font-bold">· 자동 (못 고침)</span>
                            </span>
                            <span className="w-36 shrink-0 px-1.5 py-2 text-[11px] font-bold text-slate-400 bg-slate-100 border border-slate-200 rounded-lg">
                              103 보통예금
                            </span>
                            <span className="w-28 shrink-0 px-2 py-2 text-sm font-black text-right tabular-nums text-slate-500">
                              {fmt(plainAmt)}
                            </span>
                            <span className="shrink-0 w-[14px]" />
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3">
                          <button type="button" onClick={() => askTemplateBreak(() => setQpCashRows(prev => [...prev, { note: '', price: '' }]))}
                            className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700">
                            <Plus size={12} strokeWidth={3}/>행 추가
                          </button>
                          {/* 줄 합이 통장에서 움직인 금액과 같아야 끊는다 — 통장 줄까지 세면 차·대가 맞는다는 뜻이다.
                              계정을 아직 안 골랐거나 한 줄짜리 자동이면 안 띄운다 — 시작하자마자
                              '부족'이라고 붉게 뜨면 뭘 잘못한 줄 알게 된다. */}
                          {!cashSingleAuto && qpCashRows.some(r => r.accountCode) && (
                            <span className={`text-[11px] font-black tabular-nums ${cashSplitOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {cashSplitOk
                                ? `차−대 ${fmt(cashSplitSum)} — 통장과 맞음`
                                : `차−대 ${fmt(cashSplitSum)} / 통장 ${fmt(plainAmt)}  (${cashSplitSum > plainAmt ? '초과' : '부족'} ${fmt(Math.abs(plainAmt - cashSplitSum))})`}
                            </span>
                          )}
                        </div>
                        {!qpCashRows.some(r => r.accountCode) && (
                          <p className="text-[10px] font-bold text-amber-600">계정과목이 없으면 손익·현금흐름 어디에도 못 잡힙니다.</p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : qpMode === '보험' ? (
                <>
                  {/* 4대보험 — 통장에서 한 번 나가지만 성격이 둘이다.
                      회사부담분은 비용(530), 근로자부담분은 급여에서 떼어 맡아둔 예수금(254)을 터는 것.
                      전액을 530으로 몰면 비용이 부풀고 예수금이 영영 안 줄어든다. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="qp-ins-corp" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">회사부담 <span className="normal-case text-slate-300">(비용)</span></label>
                      <input id="qp-ins-corp" inputMode="numeric" value={qpInsCorp} placeholder="0"
                        onChange={e => setQpInsCorp(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label htmlFor="qp-ins-emp" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">근로자부담 <span className="normal-case text-slate-300">(예수금)</span></label>
                      <input id="qp-ins-emp" inputMode="numeric" value={qpInsEmp} placeholder="0"
                        onChange={e => setQpInsEmp(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  {/* 아직 안 낸 원천공제 — 근로자부담분은 보통 이 잔액만큼 나간다 */}
                  {(() => {
                    const held = heldWithholding;
                    return held > 0 ? (
                      <button type="button" onClick={() => setQpInsEmp(String(Math.round(held)))}
                        className="w-full text-left rounded-xl bg-slate-50 hover:bg-indigo-50 px-3 py-2 text-[11px] font-bold text-slate-500 transition-colors">
                        아직 안 낸 원천공제 <b className="text-slate-800 tabular-nums">{fmt(held)}원</b>
                        <span className="text-indigo-500 ml-1">— 눌러서 채우기</span>
                      </button>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black bg-slate-50 text-slate-500">
                    <span>통장에서 나가는 총액</span>
                    <span className="tabular-nums text-slate-800">{fmt(insTotal)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    회사부담은 <b>비용</b>, 근로자부담은 급여에서 떼어 맡아둔 <b>예수금</b>을 터는 것입니다.
                    한 건으로 끊고 안에서 두 줄로 갈립니다.
                  </p>
                </>
              ) : qpMode === '세금' ? (
                <>
                  {/* 부가세·소득세를 한 번에 내도 성격이 다르다.
                      부가세는 손님한테 받아 맡아둔 돈이라 부채(255)를 터는 것이고,
                      종합소득세는 사업이 아니라 사장님 개인에게 매기는 세금이라 인출금(338)이다.
                      비용으로 몰면 이익이 그만큼 줄어 보이고 부가세예수금이 영영 안 줄어든다. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="qp-vat" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">부가세 <span className="normal-case text-slate-300">(부가세예수금)</span></label>
                      <input id="qp-vat" inputMode="numeric" value={qpVat} placeholder="0"
                        onChange={e => setQpVat(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label htmlFor="qp-income-tax" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">소득세 <span className="normal-case text-slate-300">(인출금)</span></label>
                      <input id="qp-income-tax" inputMode="numeric" value={qpIncomeTax} placeholder="0"
                        onChange={e => setQpIncomeTax(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  {/* 아직 안 낸 부가세 — 맡아둔 예수금 잔액. 보통 이 금액만큼 나간다 */}
                  {(() => {
                    const code = accountCodes.find(c => c.name === '부가세예수금')?.code ?? '255';
                    const held = cashEntries.reduce((a, e) => {
                      const parts = (e.lines ?? []).filter(l => l.accountCode === code);
                      const v = parts.length ? parts.reduce((b, l) => b + l.amount, 0) : (e.accountCode === code ? e.amount : 0);
                      if (!v) return a;
                      return a + (e.dir === '입금' ? v : -v);
                    }, 0);
                    return held > 0 ? (
                      <button type="button" onClick={() => setQpVat(String(Math.round(held)))}
                        className="w-full text-left rounded-xl bg-slate-50 hover:bg-emerald-50 px-3 py-2 text-[11px] font-bold text-slate-500 transition-colors">
                        아직 안 낸 부가세 <b className="text-slate-800 tabular-nums">{fmt(held)}원</b>
                        <span className="text-emerald-600 ml-1">— 눌러서 채우기</span>
                      </button>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black bg-slate-50 text-slate-500">
                    <span>한 번에 내는 총액</span>
                    <span className="tabular-nums text-slate-800">{fmt(taxTotal)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    둘 다 <b>비용이 아닙니다.</b> 부가세는 받아서 맡아둔 돈을 넘기는 것이고,
                    종합소득세는 사장님 개인 세금이라 <b>인출금</b>입니다. 한 건으로 끊고 안에서 두 줄로 갈립니다.
                  </p>
                </>
              ) : qpMode === '상환' ? (
                <>
                  {/* 은행 — 원금·이자 두 줄 모두에 붙는다. 어느 대출인지 나중에 못 찾으면 소용없다. */}
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">은행 <span className="text-slate-300">(선택)</span></label>
                    <input type="text" placeholder="은행명 검색..."
                      value={selectedClientObj ? selectedClientObj.name : quickPayClientSearch}
                      onFocus={onPartnerFocus}
                      onChange={e => { setQuickPayClientSearch(e.target.value); setQuickPayClientId(''); setQuickPayDropOpen(true); }}
                      onBlur={() => setTimeout(() => setQuickPayDropOpen(false), 150)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                    {quickPayDropOpen && dropClients.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden">
                        {dropClients.map(c => (
                          <button key={c.id}
                            onMouseDown={() => { setQuickPayClientId(c.id); setQuickPayClientSearch(''); setQuickPayDropOpen(false); }}
                            className="w-full text-left px-3 py-2.5 text-xs hover:bg-emerald-50 transition-colors border-b border-slate-50 last:border-0 font-black text-slate-800">
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">대출 계정 <span className="text-rose-400">*</span></label>
                    <select value={qpLoanCode} onChange={e => setQpLoanCode(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                      {(loanAccounts.length ? loanAccounts : [{ id: '293', code: '293', name: '장기차입금' }, { id: '260', code: '260', name: '단기차입금' }]).map(c => (
                        <option key={c.id} value={c.code}>{c.code} · {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="qp-principal" className="text-[10px] font-black text-slate-400 uppercase block mb-1">원금</label>
                      <input id="qp-principal" inputMode="numeric" value={qpPrincipal} placeholder="0"
                        onChange={e => setQpPrincipal(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label htmlFor="qp-interest" className="text-[10px] font-black text-slate-400 uppercase block mb-1">이자</label>
                      <input id="qp-interest" inputMode="numeric" value={qpInterest} placeholder="0"
                        onChange={e => setQpInterest(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-[11px] font-black text-slate-500">
                    <span>통장에서 나가는 총액</span>
                    <span className="tabular-nums text-slate-800">{fmt(prin + intr)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">원금은 차입금 감소, 이자는 비용으로 <b>자금 두 줄</b> 자동 기록됩니다.</p>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="qp-gross" className="text-[10px] font-black text-slate-400 uppercase block mb-1">총급여</label>
                      <input id="qp-gross" inputMode="numeric" value={qpGross} placeholder="0"
                        onChange={e => setQpGross(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label htmlFor="qp-deduction" className="text-[10px] font-black text-slate-400 uppercase block mb-1">공제 <span className="text-slate-300">(원천·4대보험)</span></label>
                      <input id="qp-deduction" inputMode="numeric" value={qpDeduction} placeholder="0"
                        onChange={e => setQpDeduction(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black ${net < 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
                    <span>실지급 (통장에서 나감)</span>
                    <span className="tabular-nums text-slate-800">{fmt(net)}{net < 0 ? ' · 공제가 총급여보다 큼' : ''}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">급여(비용) + 예수금(원천공제) + 실지급으로 자동 분리됩니다.</p>
                </>
              )}

              {/* 비고 — 비현금 갈래(대체·줄돈)에는 안 띄운다.
                  그쪽은 전표라 적요가 '계정 · 금액' 줄에 붙고, 여기 적은 글은 저장되지 않는다.
                  안 남는 칸을 띄워 두면 적어 놓고 사라진 줄 모른다. */}
              {(isCashDir(qpDir) || qpDir === '회사이체') && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">비고</label>
                  <input type="text" placeholder={qpMode === '일반' ? '예: 7월 전기요금' : qpMode === '상환' ? '예: 기업은행 시설자금' : '예: 7월 급여'}
                    value={quickPayNote} onChange={e => setQuickPayNote(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                </div>
              )}

              {/* ── 이렇게 분개됩니다 ──
                  자금전표는 성격계정 하나만 고르면 나머지 한 변(통장)은 자동이라, 무엇이 어디로
                  잡히는지 저장 전에는 안 보였다. 계정을 잘못 고르면 손익이 통째로 어긋나는 화면이라
                  **저장 버튼 바로 위에서** 결과를 먼저 보여 준다. 저장 경로와 같은 함수로 만든다. */}
              {/* 발생은 자금전표가 아니라 매입·대체전표라 미리보기를 따로 만든다 */}
              {!isCashDir(qpDir) && accrLines.length > 0 && (() => {
                const preview: IssuedStatement = {
                  id: 'preview-accr', issuedAt: '', tradeDate: quickPayDate,
                  type: accrType,
                  partnerId: quickPayClientId || '', partnerName: quickPayClientId ? (selectedClientObj?.name ?? '') : (accrLines[0].name || '대체'),
                  orderId: '', docNo: '',
                  totalSupply: accrTotal, totalTax: 0, totalAmount: accrTotal, items: accrLines,
                } as IssuedStatement;
                const je = accrType === '비용' ? journalizeTransfer(preview, normalOf) : journalizeStatement(preview);
                return (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                      <span className="text-[10px] font-bold text-amber-600">{accrType === '비용' ? '대체전표' : `${accrType}전표`}</span>
                    </div>
                    <div className="px-4 py-2.5">
                      {je ? renderJournal(je) : (
                        <p className="text-[11px] font-black text-amber-600">
                          차·대가 안 맞거나 상대계정이 없어 분개를 만들 수 없습니다 — 계정과목 설정을 확인하세요.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const entries = previewEntries();
                if (!entries.length) return null;
                /*
                 * **표가 이미 분개 전체를 보여 주면 여기선 안 띄운다.**
                 * 위 계정·금액 표에 통장 줄까지 들어가 있어서, 상계가 없고 갈래도 단순하면
                 * 같은 걸 두 번 보게 된다. 상계가 끼거나 상환·급여·보험처럼 줄이 갈리는
                 * 갈래에서만 띄운다 — 그때는 표만 봐선 결과를 못 읽는다.
                 */
                if (isCashDir(qpDir) && qpMode === '일반' && offsetAmt <= 0 && entries.length === 1) return null;
                return (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                      {entries.length > 1 && <span className="text-[10px] font-bold text-slate-400">자금전표 {entries.length}건</span>}
                    </div>
                    <div className="divide-y divide-slate-200">
                      {entries.map(e => {
                        const je = journalizeCashEntry(e);
                        return (
                          <div key={e.id} className="px-4 py-2.5">
                            {je ? (
                              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                <div className="grid grid-cols-[42px_1fr_100px_100px] bg-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                  <span className="px-2 py-1.5">구분</span>
                                  <span className="px-2 py-1.5">계정</span>
                                  <span className="px-2 py-1.5 text-right">차변</span>
                                  <span className="px-2 py-1.5 text-right">대변</span>
                                </div>
                                {je.lines.map((l, i) => (
                                  <div key={i} className="grid grid-cols-[42px_1fr_100px_100px] border-t border-slate-50 text-[11px]">
                                    <span className={`px-2 py-1.5 font-black ${l.debit ? 'text-slate-600' : 'text-slate-400'}`}>{l.debit ? '차변' : '대변'}</span>
                                    <span className="px-2 py-1.5 font-bold text-slate-700 truncate">
                                      <span className="text-slate-400 font-mono mr-1">{l.accountCode}</span>{codeName.get(l.accountCode) ?? ''}
                                    </span>
                                    <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.debit ? fmt(l.debit) : ''}</span>
                                    <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.credit ? fmt(l.credit) : ''}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] font-black text-amber-600">
                                계정과목이 없어 분개를 만들 수 없습니다 — 손익·재무제표 어디에도 안 잡힙니다.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 지금 입력한 그대로를 템플릿으로 굳힌다 — 이름·거래처·금액·계정까지.
                  매달 같은 곳에 같은 금액을 넣는 전표가 대부분이라 다음 달엔 고르기만 하면 된다. */}

              <div className="flex gap-2 pt-1">
              {onAddFixedCostTemplate && (
                <button
                  onClick={async () => {
                    const cur = currentTemplate(qpTemplates);
                    const suggest = quickPayNote.trim()
                      || (() => { const c = qpCashRows.find(r => r.accountCode)?.accountCode; return c ? codeName.get(c) ?? '' : ''; })()
                      || (cur && !(cur.builtin ?? '').startsWith('free') ? cur.label : '');
                    const name = window.prompt('템플릿 이름을 정하세요.\n\n다음부터 [템플릿]에서 고르면\n계정·거래처·금액이 한 번에 채워집니다.', suggest);
                    if (name === null) return;
                    if (!name.trim()) { alert('이름을 입력하세요.'); return; }
                    const group = window.prompt('묶음 이름(비우면 분류없음)', cur?.group || '');
                    if (group === null) return;
                    await onAddFixedCostTemplate({
                      name: name.trim(), amount: amt > 0 ? amt : 0, category: '기타',
                      active: false, kind: 'voucher', hidden: false,
                      group: group.trim() || '분류없음',
                      dir: qpDir, mode: qpMode,
                      ...(() => { const c = qpCashRows.find(r => r.accountCode)?.accountCode; return c ? { accountCode: c } : {}; })(),
                      ...(quickPayClientId ? { partnerId: quickPayClientId, partnerName: selectedClientObj?.name ?? '' } : {}),
                      ...(quickPayNote.trim() ? { note: quickPayNote.trim() } : {}),
                    } as any);
                    alert(`'${name.trim()}' 템플릿으로 저장했습니다.\n\n정기비용 화면에서 이름·거래처·금액을 고치거나 숨길 수 있습니다.`);
                  }}
                  className="shrink-0 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-slate-500 text-[11px] font-black whitespace-nowrap hover:border-indigo-400 hover:text-indigo-600 transition-all flex items-center justify-center gap-1">
                  <Save size={11}/>템플릿 저장
                </button>
              )}
                <button onClick={() => { onClose(); }}
                  className="shrink-0 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                <button onClick={handleQuickPaySave} disabled={!canSave}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                  <Save size={12}/>저장
                </button>
              </div>

              </div>
            </div>

            {qpPickerOpen && (
              <CashTemplateModal
                templates={qpTemplates} accountCodes={accountCodes}
                activeId={currentTemplate(qpTemplates)?.id ?? null}
                onPick={pickTemplate}
                onDirect={() => { setQpTemplateId(null); setQpMode('일반'); setQuickPayClientId(''); setQuickPayClientSearch(''); setQpPickerOpen(false); }}
                onClose={() => setQpPickerOpen(false)}
              />
            )}
          </div>
        );
}
