import { describe, expect, it } from 'vitest';
import { buildStatementPrintHtml } from './statementPrint';

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
});
