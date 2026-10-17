import {templateStatementType,canAutoStatement} from '../../../shared/templateStatementType';
import {payableCodeFor,AR,AP,VAT_PAYABLE,VAT_RECEIVABLE,BANK} from '../../../shared/autoJournal';
import {lineAmount} from '../../../shared/lineAmount';
import {STANDARD_ACCOUNT} from '../../../shared/accountChart';
import {isCashDir,splitModeOf,SPLIT_MODES,type CashTemplate} from './cashTemplateCatalog';

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
  if (t.transferLines?.length && (!t.statementType || t.statementType === '비용')) {
    return t.transferLines.map(l => ({
      name: l.name || t.itemName || t.label,
      accountCode: l.accountCode,
      price: t.amount && canAutoStatement({ ...t, statementType: '비용' }) ? String(t.amount) : '',
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
): { side: '차변' | '대변'; code: string; label: string; amount: number; perVoucher?: true }[] {
  const amt = t.amount ?? 0;
  const bank = { code: BANK, label: bankName };
  const sm = splitModeOf(t.mode);

  if (sm) {
    // 두 줄로 갈리는 갈래 — 통장은 한 번 움직이고 그 안에서 성격이 갈린다
    const a = (t as Record<string, any>)[SPLIT_MODES[sm].a] ?? 0;
    const b = (t as Record<string, any>)[SPLIT_MODES[sm].b] ?? 0;
    if (sm === '급여') {
      // (차) 급여 총액 / (대) 예수금 공제 + 통장 실지급
      return [
        { side: '차변', code: STANDARD_ACCOUNT.SALARY, label: '급여', amount: a },
        ...(b ? [{ side: '대변' as const, code: STANDARD_ACCOUNT.WITHHOLDING, label: '예수금', amount: b }] : []),
        { side: '대변', code: bank.code, label: bank.label, amount: a - b },
      ];
    }
    // 보험·상환·세금 — 차변이 둘, 대변은 통장 하나
    const [c1, l1, c2, l2] = sm === '보험' ? [STANDARD_ACCOUNT.WELFARE, '사대보험', STANDARD_ACCOUNT.WITHHOLDING, '예수금']
      : sm === '상환' ? [t.loanCode ?? '293', '차입금', STANDARD_ACCOUNT.INTEREST, '이자비용']
      : [VAT_PAYABLE, '부가세예수금', '338', '인출금'];
    return [
      ...(a ? [{ side: '차변' as const, code: c1, label: l1, amount: a }] : []),
      ...(b ? [{ side: '차변' as const, code: c2, label: l2, amount: b }] : []),
      { side: '대변', code: bank.code, label: bank.label, amount: a + b },
    ];
  }

  if (!isCashDir(t.dir) && t.dir !== '회사이체') {
    /*
     * **거래처가 있으면 상대변은 채권·채무다.** buildStatementVoucher가 그렇게 낸다 —
     * 거래처가 붙으면 매입전표(받을돈이면 매출전표)라 상대변이 251(108)로 자동이다.
     * 예전엔 그걸 모르고 한 줄만 그려서, 멀쩡한 템플릿에 "차·대가 안 맞는다"고 붙었다.
     * 과세면 부가세 줄까지 선다 — 금액은 부가세 포함 총액으로 본다.
     */
    if (templateStatementType(t) !== '비용' && t.partnerId && t.accountCode) {
      const { gross, supply, tax } = lineAmount(1, amt, t.taxExempt);
      const other = { code: t.accountCode, label: t.itemName ?? '' };
      const payable = payableCodeFor([t.accountCode]);
      return templateStatementType(t) === '매출'
        ? [
            { side: '차변' as const, code: AR, label: '외상매출금', amount: gross },
            { side: '대변' as const, ...other, amount: supply },
            ...(tax ? [{ side: '대변' as const, code: VAT_PAYABLE, label: '부가세예수금', amount: tax }] : []),
          ]
        : [
            { side: '차변' as const, ...other, amount: supply },
            ...(tax ? [{ side: '차변' as const, code: VAT_RECEIVABLE, label: '부가세대급금', amount: tax }] : []),
            { side: '대변' as const, code: payable, label: payable === AP ? '외상매입금' : '미지급금', amount: gross },
          ];
    }
    // 대체 — 양식이 있으면 그대로. 없으면 한 줄뿐이라 상대변을 사용자가 넣어야 한다.
    if (t.transferLines?.length) {
      /*
       * **금액 하나로 채울 수 있을 때만 채운다.**
       * 감가상각(818 차 / 203 대)처럼 차 한 줄 · 대 한 줄이면 같은 금액이 양쪽에 선다.
       * 부가세 신고(255 차 / 135 대 / 261 대)는 줄마다 금액이 달라 하나로 못 채운다 —
       * 그런데도 전부 같은 금액을 박아 넣어서, 미리보기가 차 100,000 · 대 200,000으로
       * 안 맞는 분개를 보여줬다. 못 채우는 줄은 금액을 비우고 그렇다고 표시한다.
       */
      const dr = t.transferLines.filter(l => l.side === '차변').length;
      const cr = t.transferLines.length - dr;
      const fits = dr === 1 && cr === 1;
      return t.transferLines.map(l => ({
        side: l.side, code: l.accountCode, label: l.name ?? '',
        amount: fits ? amt : 0, ...(fits ? {} : { perVoucher: true as const }),
      }));
    }
    return [{ side: '차변', code: t.accountCode ?? '', label: t.itemName ?? '', amount: amt }];
  }

  // 자금 — 한 변은 늘 통장이다. 입금이면 통장이 차변, 출금이면 대변.
  const other = { code: t.accountCode ?? '', label: t.itemName ?? '', amount: amt };
  return t.dir === '입금'
    ? [{ side: '차변', ...bank, amount: amt }, { side: '대변', ...other }]
    : [{ side: '차변', ...other }, { side: '대변', ...bank, amount: amt }];
}
