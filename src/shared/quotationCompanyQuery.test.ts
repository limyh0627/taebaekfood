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
    expect(source).toContain('id="quotation-print-area"');
    expect(source).toContain('id="quotation-print-document"');
    expect(source).toContain("frame.id = 'quotation-print-frame'");
    expect(source).toContain('frame.srcdoc = `<!doctype html>');
    expect(source).toContain('printWindow.print()');
    expect(source.indexOf('frame.srcdoc = `<!doctype html>')).toBeLessThan(source.indexOf('document.body.appendChild(frame)'));
  });

  it('정식 견적서 인쇄 항목을 한 장에 배치한다', () => {
    const source = readFileSync('components/QuotationManager.tsx', 'utf8');
    for (const label of ['합계금액', '공급가액']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('{viewing.partnerName} 귀하');
    expect(source).toContain('아래와 같이 견적합니다.');
    expect(source).toContain("viewing.recipientPhone || '—'");
    expect(source).toContain("viewing.deliveryTerms || '별도 협의'");
    expect(source).toContain("viewing.paymentTerms || '별도 협의'");
    expect(source).toContain("{l?.unit || ''}");
    expect(source).toContain('const printCompany = companyInfo ?? DEFAULT_COMPANY_INFO');
    expect(source).not.toContain('tracking-[0.32em]">견 적 서');
    expect(source).not.toContain('태백식품 대표 임기주');
    expect(source).toContain("printCompany.fax && <><br />FAX {printCompany.fax}</>");
    expect(source).toContain('className="h-9"');
    expect(source).not.toContain('>등록번호<');
    for (const label of ['참조', '업태·종목', '입금계좌', '비고', 'No']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('Math.max(12, viewing.lines.length)');
  });

});
