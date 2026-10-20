import { previewHtmlPrint } from '../../../shared/htmlPrintOutput';
vi.mock('../../../shared/htmlPrintOutput',()=>({previewHtmlPrint:vi.fn().mockResolvedValue(undefined)}));
import { describe, expect, it, vi } from 'vitest';
import { buildStatementPrintHtml, buildReceiptHtml, printStatementViaIframe, buildStatementPrintDocument } from './statementPrint';
import type { CompanyInfo, Partner, StatementPartySnapshot } from '../../../../types';

const company: CompanyInfo = { name: '회사', ceoName: '', bizNo: '', bizType: '', bizItem: '', address: '', phone: '02-회사', fax: '02-회사팩스' };
const customer: Partner = { id: 'p', name: '거래처', type: '일반', tel: '031-대표', mobile: '010-휴대', phone: '070-옛번호', fax: '031-거래처팩스' };
const storedParty = (name: string, tel: string, fax: string) => ({ name, ceo: '', bizNo: '', bizType: '', bizItem: '', addr: '', tel, fax });
const contactHtml = (type: '매출' | '매입', snapshot?: StatementPartySnapshot, partner = customer) => buildStatementPrintHtml([], 0, 0, 0, type, partner.name, '문서번호', '2026년 10월 20일', '', partner.id, snapshot, { companyInfo: company, partners: [partner], allItems: [] });

it.each(['매출', '매입'] as const)('%s 양면에는 당사자 정본의 전화·팩스를 각각 명시하고 옛 문서는 기존 우선순위를 유지한다', type => {
  const html = contactHtml(type);
  for (const text of ['전화 02-회사', '팩스 02-회사팩스', '전화 031-대표', '팩스 031-거래처팩스']) expect(html.split(text)).toHaveLength(3);
  expect(html).not.toContain('010-휴대');
  expect(html).not.toContain('070-옛번호');
  expect(html.match(/rowspan="5"/g)).toHaveLength(4);
  const fallback = contactHtml(type, undefined, { ...customer, tel: '', mobile: '' });
  expect(fallback.match(/전화 070-옛번호/g)).toHaveLength(2);
  expect(html).toContain('(공급자용)');
  expect(html).toContain('(공급받는자용)');
});

it('저장된 연락처는 현재 마스터와 충돌해도 그대로 표시하고 빈 snapshot 번호도 채워 넣지 않는다', () => {
  const snapshot: StatementPartySnapshot = { supplier: storedParty('저장공급자', '저장전화', '저장팩스'), buyer: storedParty('저장받는자', '', '') };
  for (const type of ['매출', '매입'] as const) {
    const html = contactHtml(type, snapshot);
    expect(html.match(/전화 저장전화/g)).toHaveLength(2);
    expect(html.match(/팩스 저장팩스/g)).toHaveLength(2);
    expect(html.match(/전화 &nbsp;&nbsp;팩스 /g)).toHaveLength(2);
    for (const text of ['02-회사', '031-대표', '031-거래처팩스']) expect(html).not.toContain(text);
    // 저장 당시 연락처 필드 자체가 없던 옛 snapshot도 현재 번호로 채우지 않는다.
    const legacy = { supplier: { ...snapshot.supplier }, buyer: { ...snapshot.buyer } };
    for (const party of [legacy.supplier, legacy.buyer]) {
      Reflect.deleteProperty(party, 'tel');
      Reflect.deleteProperty(party, 'fax');
    }
    const legacyHtml = contactHtml(type, legacy);
    expect(legacyHtml.match(/전화 &nbsp;&nbsp;팩스 /g)).toHaveLength(4);
    expect(legacyHtml).not.toContain('02-회사');
    expect(legacyHtml).not.toContain('031-대표');
  }
});

it('전화·팩스의 HTML 문자를 escape하고 번호가 없으면 라벨 옆 값을 빈칸으로 둔다', () => {
  const snapshot: StatementPartySnapshot = { supplier: storedParty('공급', '<02>&123', '팩스<script>'), buyer: storedParty('수령', '', '') };
  const html = contactHtml('매출', snapshot);
  expect(html.match(/전화 &lt;02&gt;&amp;123/g)).toHaveLength(2);
  expect(html.match(/팩스 팩스&lt;script&gt;/g)).toHaveLength(2);
  expect(html).not.toContain('<script>');
  expect(html.match(/전화 &nbsp;&nbsp;팩스 /g)).toHaveLength(2);
});

it('연락처 한 행 높이는 빈 품목 한 줄에서만 보상하고 실제 11개 품목과 합계·이하여백은 보존한다', () => {
  const empty = contactHtml('매출');
  const emptyRows = /<tr style="height:5.5mm;background:[^"]*;">\s*(?:<td style="border:1px solid #[^"]*;"><\/td>\s*){7}<\/tr>/g;
  expect(empty.match(emptyRows)).toHaveLength(14); // 각 용지 빈 줄 7개: 기존8개에서 한 줄만 줄인다.
  const items = Array.from({ length: 11 }, (_, i) => ({ key: 'k' + i, no: i + 1, name: '실품목' + i, spec: '', qty: 1, price: 100, supply: 100, tax: 0, total: 100, isTaxExempt: false, accountCode: '' }));
  const html = buildStatementPrintHtml(items, 1100, 0, 1100, '매출', '거래처', '번호', '2026년 10월 20일', '', '', undefined, { partners: [], allItems: [] });
  for (const item of items) expect(html.split('>' + item.name + '</td>')).toHaveLength(3);
  expect(html.match(/합&nbsp;&nbsp;&nbsp;계/g)).toHaveLength(2);
  expect(html.match(/이&nbsp;하&nbsp;여&nbsp;백/g)).toHaveLength(2);
  expect(html.match(emptyRows)).toBeNull();
});

it.each([8, 9, 11])('%i개 품목은 실제 행·금액을 보존하며 9개부터 품목과 이하여백 높이만 줄인다', count => {
  const items = Array.from({ length: count }, (_, i) => ({ key: 'boundary-' + i, no: i + 1, name: '경계품목' + i, spec: '', qty: 1, price: 100, supply: 100, tax: 1, total: 101, isTaxExempt: false, accountCode: '' }));
  const before = JSON.stringify(items);
  const html = buildStatementPrintHtml(items, count * 100, count, count * 101, '매출', '거래처', '번호', '2026년 10월 20일', '', '', undefined, { partners: [], allItems: [] });
  const expectedHeight = count >= 9 ? '4' : '5\\.5';
  expect(html.match(new RegExp(`<tr style="height:${expectedHeight}mm;background:`, 'g'))).toHaveLength((count + 1) * 2);
  for (const item of items) expect(html.split('>' + item.name + '</td>')).toHaveLength(3);
  expect(html.match(/>101<\/td>/g)).toHaveLength(count * 2);
  expect(html).toContain(`font-size:11px;font-weight:bold;padding:0 3px;">${(count * 101).toLocaleString('ko-KR')}</td>`);
  expect(html.match(/이&nbsp;하&nbsp;여&nbsp;백/g)).toHaveLength(2);
  expect(html.match(/합&nbsp;&nbsp;&nbsp;계/g)).toHaveLength(2);
  expect(JSON.stringify(items)).toBe(before);
});

it.each(['매출', '매입'] as const)('%s 11품목은 기존 4행 정보 높이에서 사업자번호 뒤 전화·팩스를 양면에 모두 표시한다', type => {
  const items = Array.from({ length: 11 }, (_, i) => ({ key: 'many-' + i, no: i + 1, name: '품목' + i, spec: '', qty: 1, price: 100, supply: 100, tax: 0, total: 100, isTaxExempt: false, accountCode: '' }));
  const snapshot: StatementPartySnapshot = { supplier: { ...storedParty('공급', '<02>&123', '02-1234-5678'), bizNo: '111-22-33333' }, buyer: { ...storedParty('수령', '031-123-4567', '031-234-5678'), bizNo: '222-33-44444' } };
  const html = buildStatementPrintHtml(items, 1100, 0, 1100, type, '거래처', '번호', '2026년 10월 20일', '', '', snapshot, { partners: [], allItems: [] });
  expect(html.match(/rowspan="4"/g)).toHaveLength(4);
  expect(html).not.toContain('>연락처</td>');
  expect(html.match(/111-22-33333&nbsp;&nbsp;전화 &lt;02&gt;&amp;123&nbsp;·&nbsp;팩스 02-1234-5678/g)).toHaveLength(2);
  expect(html.match(/222-33-44444&nbsp;&nbsp;전화 031-123-4567&nbsp;·&nbsp;팩스 031-234-5678/g)).toHaveLength(2);
  expect(html).not.toContain('<02>');
});

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

it('명세서와영수증HTML은기존A4CSS를포함한한원문으로미리보기에위임하며signal을전달한다',async()=>{const html='<div>원문299원</div>',signal=new AbortController().signal;await printStatementViaIframe(html,'매입<전표>',signal);expect(previewHtmlPrint).toHaveBeenCalledWith({html:buildStatementPrintDocument(html,'매입<전표>'),title:'매입<전표>',signal});const output=vi.mocked(previewHtmlPrint).mock.calls.at(-1)![0].html;expect(output).toContain('@page{size:A4 portrait;margin:0;}');expect(output).toContain('print-color-adjust:exact');expect(output).toContain('<title>매입&lt;전표&gt;</title>');expect(output).toContain('<body>'+html+'</body>');});
