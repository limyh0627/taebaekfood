import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('견적서 회사별 구독', () => {
  it('전체 컬렉션이 아니라 로그인 회사만 조회한다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    expect(source).toMatch(/subscribeToCollection<Quotation>[\s\S]*where\('companyId',\s*'==',\s*companyId\)/);
  });

  it('등록되지 않은 품목명과 규격을 줄에서 직접 입력할 수 있다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    expect(source).toContain('placeholder="품목명 직접 입력"');
    expect(source).toContain('placeholder="규격 직접 입력"');
    expect(source).toMatch(/name: e\.target\.value, itemId: undefined, cost: undefined/);
  });

  it('목록의 기존 견적서를 수정 모드로 다시 연다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    expect(source).toContain('const openEdit = (q: Quotation) => { setEditingId(q.id); resetForm(q, true);');
    expect(source).toContain('onClick={() => openEdit(q)} title="견적서 수정"');
    expect(source).toContain("editingId ? '수정 저장' : '저장'");
    expect(source).toContain('date: keepDates && base ? base.date : today()');
  });

  it('인쇄할 때 견적서 본문만 인쇄 대상으로 표시한다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    const css = readFileSync('src/index.css', 'utf8');
    expect(source).toContain('id="quotation-print-area"');
    expect(source).toContain("document.body.classList.add('printing-quotation')");
    expect(css).toContain('body.printing-quotation #quotation-print-area');
  });

  it('정식 견적서 인쇄 항목을 한 장에 배치한다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    for (const label of ['공급받는 자', '공급자', '등록번호', '견적금액', '공급가액', '거래 조건 및 비고']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('companyInfo?.bizNo');
    expect(source).toContain('{viewing.partnerName} 귀하');
    expect(source).toContain('아래와 같이 견적합니다.');
    expect(source).toContain("viewing.recipientPhone || '—'");
    expect(source).toContain("viewing.deliveryTerms || '별도 협의'");
    expect(source).toContain("viewing.paymentTerms || '별도 협의'");
    expect(source).toContain("{l.unit || '—'}");
  });

});
