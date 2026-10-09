import {buildAccountLedger,type LedgerCashAccount,type LedgerCashEntry} from './cashAccountLedger';
import {projectCashLines,type CashProjectionInput} from './cashLineProjection';
import {kstDateOf} from './calculation';
export type OpeningCompany='taebaek'|'punghoe';
export type OpeningPartnerCode='108'|'251';
export type FinancialPartner={id:string;name:string;companyId?:OpeningCompany};
export type FinancialLoan={id:string;companyId:OpeningCompany;name:string;lenderName:string;partnerId?:string;accountCode:'260'|'293';openingDate:string;openingPrincipal:number;maturityDate?:string;note?:string;createdAt:string};
export type FinancialAccount=LedgerCashAccount&{companyId?:OpeningCompany;name:string;type:'통장'|'현금'|'카드';active:boolean;createdAt:string};
export type FinancialCash=LedgerCashEntry&CashProjectionInput&{loanId?:string};
export type OpeningStatement={id:string;companyId:OpeningCompany;issuedAt:string;tradeDate:string;type:'비용';partnerId:string;partnerName:string;orderId:string;docNo:string;totalSupply:number;totalTax:number;totalAmount:number;items:{name:string;spec:string;qty:number;price:number;supply:number;tax:number;total:number;isTaxExempt:boolean;accountCode:string;side:'차변'|'대변';lineKind:'account'}[]};
export const openingCompanyOf=(row:{companyId?:OpeningCompany})=>row.companyId??'taebaek';
export const openingDocumentId=(company:OpeningCompany)=>company==='taebaek'?'main':`main-${company}`;
export function openingCalendarDay(date:string):boolean {return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(`${date}T00:00:00Z`))&&new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date;}
const isCalendarDay=openingCalendarDay;
const companyOf=openingCompanyOf;
const today=()=>kstDateOf(new Date());
const BANK='103',AR='108',AP='251';
const STANDARD_ACCOUNT={CASH:'102'};
const totalCashOnHand=(accounts:FinancialAccount[],entries:FinancialCash[],asOf:string)=>accounts.reduce((sum,account)=>sum+buildAccountLedger(account,entries,account.openingDate,asOf).closing,0);
const journalizeTransfer=(voucher:OpeningStatement)=>voucher.items.reduce((sum,line)=>sum+(line.side==='차변'?line.total:-line.total),0)===0;
export const openingCashAccountCode = (account: Pick<FinancialAccount, 'type'>): string =>
  account.type === '현금' ? STANDARD_ACCOUNT.CASH : BANK;

/** 입력한 현재 잔액에서 새 기준일 이후 실제 입출금을 빼서 기초 잔액을 구한다. */
export function cashOpeningBalanceForCurrent(account: FinancialAccount, entries: FinancialCash[], newDate: string, currentBalance: number, asOf = today()): number {
  if (!isCalendarDay(newDate) || !isCalendarDay(asOf) || !Number.isSafeInteger(currentBalance)) throw new Error('계좌 기준일과 정수 잔액을 확인하세요.');
  const mine = entries.filter(entry => companyOf(entry) === companyOf(account));
  if ((account.confirmedBalances ?? []).some(point => point.date >= newDate && point.date <= asOf)
      || mine.some(entry => entry.cashAccountId === account.id && entry.date >= newDate && entry.date <= asOf && entry.balanceAdjustment?.confirmedBalance === true))
    throw new Error('확정 잔액 기준점이 있는 기간은 기초잔액 변경으로 현재 잔액을 수정할 수 없습니다. 확정 잔액 기준점을 확인해 주세요.');
  if (mine.some(entry => entry.cashAccountId === account.id && entry.date >= newDate && entry.date <= asOf && !Number.isSafeInteger(entry.amount))) throw new Error('계좌 연결 전표의 금액을 확인하세요.');
  const movement = totalCashOnHand([{ ...account, openingDate: newDate, openingBalance: 0 }], mine, asOf);
  const opening = currentBalance - movement;
  if (!Number.isSafeInteger(opening)) throw new Error('계좌 기초 잔액이 계산 범위를 벗어났습니다.');
  return opening;
}

export function cashOpeningStatement(account: FinancialAccount): OpeningStatement {
  if (!account.id || !account.companyId || !isCalendarDay(account.openingDate) ||
      !Number.isInteger(account.openingBalance) || account.openingBalance <= 0 || account.type === '카드') {
    throw new Error('현금·통장 기초일과 0원 초과 정수 잔액을 확인하세요.');
  }
  const amount = account.openingBalance;
  const line = (accountCode: string, side: '차변' | '대변', name: string) => ({
    name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
    isTaxExempt: true, accountCode, side, lineKind: 'account' as const,
  });
  const voucher: OpeningStatement = {
    id: `opening-cash-${account.companyId}-${account.id}`, companyId: account.companyId,
    issuedAt: `${account.openingDate}T00:00:00+09:00`, tradeDate: account.openingDate,
    type: '비용', partnerId: '', partnerName: '', orderId: '',
    docNo: `기초계좌-${account.id}`, totalSupply: amount, totalTax: 0, totalAmount: amount,
    items: [line(openingCashAccountCode(account), '차변', account.name), line('375', '대변', '기초 이월이익잉여금')],
  };
  if (!journalizeTransfer(voucher)) throw new Error('계좌 기초 전표 차변·대변이 일치하지 않습니다.');
  return voucher;
}

export function loanOpeningStatement(loan: FinancialLoan): OpeningStatement {
  if (!loan.id || !loan.companyId || !isCalendarDay(loan.openingDate) ||
      !Number.isInteger(loan.openingPrincipal) || loan.openingPrincipal <= 0 ||
      (loan.accountCode !== '260' && loan.accountCode !== '293')) {
    throw new Error('대출 기초일·계정·0원 초과 정수 원금을 확인하세요.');
  }
  const amount = loan.openingPrincipal;
  const line = (accountCode: string, side: '차변' | '대변', name: string) => ({
    name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
    isTaxExempt: true, accountCode, side, lineKind: 'account' as const,
  });
  const voucher: OpeningStatement = {
    id: `opening-loan-${loan.companyId}-${loan.id}`, companyId: loan.companyId as OpeningCompany,
    issuedAt: `${loan.openingDate}T00:00:00+09:00`, tradeDate: loan.openingDate,
    type: '비용', partnerId: loan.partnerId ?? '', partnerName: loan.lenderName,
    orderId: '', docNo: `기초대출-${loan.id}`,
    totalSupply: amount, totalTax: 0, totalAmount: amount,
    items: [line('375', '차변', '기초 이월이익잉여금'), line(loan.accountCode, '대변', loan.name)],
  };
  if (!journalizeTransfer(voucher)) throw new Error('대출 기초 전표 차변·대변이 일치하지 않습니다.');
  return voucher;
}

/** One opening receivable/payable is one balanced, partner-linked transfer voucher. */
export function openingPartnerStatement(companyId: OpeningCompany, date: string, partner: FinancialPartner, code: OpeningPartnerCode, amount: number): OpeningStatement {
  if (!isCalendarDay(date) || !Number.isInteger(amount) || amount <= 0 || !partner.id || !partner.name) {
    throw new Error('기초일·거래처·0원 초과 정수 금액을 확인하세요.');
  }
  if (partner.companyId && partner.companyId !== companyId) throw new Error('다른 회사 거래처입니다.');
  const receivable = code === AR;
  const id = `opening-partner-${companyId}-${date}-${partner.id}-${code}`;
  const line = (accountCode: string, side: '차변' | '대변', name: string) => ({
    name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
    isTaxExempt: true, accountCode, side, lineKind: 'account' as const,
  });
  const voucher: OpeningStatement = {
    id, companyId, issuedAt: `${date}T00:00:00+09:00`, tradeDate: date, type: '비용',
    partnerId: partner.id, partnerName: partner.name, orderId: '', docNo: `기초-${date.replace(/-/g, '')}-${partner.id}-${code}`,
    totalSupply: amount, totalTax: 0, totalAmount: amount,
    items: receivable
      ? [line(AR, '차변', '기초 미수금(이월)'), line('375', '대변', '기초 이월이익잉여금')]
      : [line('375', '차변', '기초 이월이익잉여금'), line(AP, '대변', '기초 미지급금(이월)')],
  };
  if (!journalizeTransfer(voucher)) throw new Error('기초 전표 차변·대변이 일치하지 않습니다.');
  return voucher;
}

/** 원계약의 차대 투영으로 새 시작 원금을 역산한다. */
export function loanOpeningPrincipalForBalance(loan:FinancialLoan,entries:FinancialCash[],openingDate:string,currentBalance:number):number {
 if(!isCalendarDay(openingDate)||!Number.isSafeInteger(currentBalance)||currentBalance<0)throw new Error('시작일과 0원 이상의 정수 잔액을 확인하세요.');
 let delta=0;
 for(const entry of entries){if(entry.loanId!==loan.id||companyOf(entry)!==loan.companyId||entry.date<openingDate)continue;
 const {parts,total}=projectCashLines(entry);if(!parts.length||(!entry.lines?.some(line=>line.accountCode&&line.amount!==0)&&(!entry.amount||!entry.accountCode))||(!total&&entry.dir!=='대체'))continue;
 if(entry.dir==='대체'&&(!parts.some(line=>line.amount>0)||parts.reduce((sum,line)=>sum+line.amount,0)!==0))continue;
 delta+=parts.filter(line=>line.accountCode===loan.accountCode).reduce((sum,line)=>sum+(entry.dir==='입금'?line.amount:-line.amount),0);
 }
 const principal=currentBalance-delta;if(!Number.isSafeInteger(principal)||principal<0)throw new Error('해당 시작일의 원금이 음수가 됩니다. 시작일과 현재 잔액을 확인하세요.');return principal;
}
