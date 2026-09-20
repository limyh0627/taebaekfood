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
});
