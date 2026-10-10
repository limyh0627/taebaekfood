import { describe, expect, it } from 'vitest';
import { buildStatementPrintHtml, buildReceiptHtml } from './statementPrint';

describe('거래명세서 인쇄 계좌정보', () => {
  it('기존 태백식품 설정이어도 비고 아래 양쪽 용지에 계좌를 한 줄씩 표시한다', () => {
    const html = buildStatementPrintHtml(
      [], 0, 0, 0, '매출', '거래처', '260918-01', '2026년 9월 18일', '', '', undefined,
      {
        companyInfo: {
          name: '태백식품', ceoName: '임기주', bizNo: '139-04-37157', bizType: '제조 도소매',
          bizItem: '참기름 외', address: '경기도 안산시 상록구 동막길 69-7',
        },
        partners: [], allItems: [],
      },
    );

    expect(html.match(/농협 351-0526-3164-13 ; 임기주\(태백식품\)/g)).toHaveLength(2);
    expect(html.match(/<strong>계좌번호<\/strong>/g)).toHaveLength(2);
  });

  it('거래처 원장의 전미수·판매·입금·잔액을 큰 정산표에 표시한다', () => {
    const html = buildStatementPrintHtml(
      [], 100_000, 10_000, 110_000, '매출', '거래처', '260918-02', '2026년 9월 18일', '', '', undefined,
      {
        companyInfo: {
          name: '태백식품', ceoName: '', bizNo: '', bizType: '', bizItem: '', address: '',
        }, partners: [], allItems: [],
        balance: { previous: 500_000, currentTrade: 110_000, received: 200_000, closing: 410_000 },
      },
    );

    expect(html.match(/전일미수/g)).toHaveLength(2);
    expect(html.match(/500,000/g)).toHaveLength(2);
    expect(html.match(/200,000/g)).toHaveLength(2);
    expect(html.match(/410,000/g)).toHaveLength(2);
    expect(html).toContain("font-size:13px");
  });
});


it('저장된 kgml 규격은 명세서·영수증에 kg로만 표시하고 원문과 저장 금액을 보존한다', () => {
  const line = { key: 'stored', no: 1, name: '생들기름-캔', spec: '16.5kgml', qty: 3, price: 100,
    supply: 271, tax: 28, total: 299, isTaxExempt: false, accountCode: '500' };
  const original = JSON.stringify(line);
  const statement = buildStatementPrintHtml([line], 271, 28, 299, '매입', '은하산업', '261010-001', '2026년 10월 10일', '', '', undefined, { partners: [], allItems: [] });
  const receipt = buildReceiptHtml({ tradeDate: '2026-10-10', docNo: '261010-001', partnerName: '은하산업', items: [line], totals: { supply: 271, tax: 28, amount: 299 } });
  for (const html of [statement, receipt]) {
    expect(html).toContain('16.5kg');
    expect(html).not.toContain('16.5kgml');
    expect(html).toContain('299');
  }
  expect(JSON.stringify(line)).toBe(original);
  expect(line.spec).toBe('16.5kgml');
});
