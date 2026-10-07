/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProductionWorkDocumentPrint, { buildProductionWorkPrintHtml } from './ProductionWorkDocumentPrint';
import { emptyProductionWorkFields, mergeProductionWorkEvidence, newProductionWorkDocument } from '../domain/productionWorkDocument';

const document = newProductionWorkDocument('taebaek', '2026-09-22', 'employee', '2026-09-27T00:00:00Z');
const lines = mergeProductionWorkEvidence(document, [], ['a', 'b'].map(key => ({
  companyId: 'taebaek' as const, key, batchKey: 'batch', reversed: false,
  fields: { ...emptyProductionWorkFields(), itemNameSnapshot: '<script>위험</script>', productionQty: 1000, productionUnit: '병' },
  source: { kind: 'production' as const, sourceId: 'p1', operationId: key, ledgerId: key, lotId: key, recordedAt: '' },
})), '2026-09-27T00:00:00Z');

describe('생산작업일지 인쇄', () => {
  it('원본 양식의 11열·20입력행과 이름칸·특이사항을 표시한다', () => {
    render(<ProductionWorkDocumentPrint document={{ ...document, preparedByName: '김작성' }} lines={lines} />);
    expect(screen.getByRole('heading', { name: '생산작업일지' })).toBeTruthy();
    const grid = screen.getByRole('table', { name: '생산 및 원료 사용' });
    expect(grid.querySelectorAll('[data-production-columns] > th')).toHaveLength(11);
    expect(grid.querySelectorAll('[data-production-rows] > tr')).toHaveLength(20);
    expect(screen.getByText('김작성')).toBeTruthy();
    expect(screen.getAllByText('1,000 병')).toHaveLength(1);
    expect(screen.getByText('특이사항')).toBeTruthy();
  });
  it('앱이 아닌 A4 가로 서류만 생성하며 사용자가 입력한 HTML은 실행하지 않는다', () => {
    const html = buildProductionWorkPrintHtml({ document, lines });
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('&lt;script&gt;위험&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('사이드바');
    expect(html).toContain('미확인 항목 포함');
    expect(html).toContain('display: table-header-group');
    expect(html).toContain('page-break-inside: avoid');
    expect(html).not.toContain('<span>1 / 1</span>');
  });
});
