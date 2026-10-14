import { describe, expect, it } from 'vitest';
import { buildOrderCopyScopedSources, classifyOrderCopyRow, mergeOrderCopyScopedResult, validateOrderCopyScopedSources, type OrderCopyScopeRow } from './orderCopyInterpretationScope';
import { validateScopedExtract } from './orderExtract';
import { orderInterpretationAliasCandidates } from './orderInterpretation';
const catalog = [{ id: 'oil', name: '참기름', spec: '350ml' }, { id: 'perilla', name: '들기름' }];
const context = { catalog, rules: [], partnerId: 'partner' };
const row = (sourceId = 'source_1', rawText = '그거 두 박스'): OrderCopyScopeRow => ({ sourceId, rawText, rawName: rawText, qty: 1, isBox: true, selectedProductId: 'oil', sourceStart: 4, sourceEnd: 12 });
const sources = [{ sourceId: 'source_1', text: '참기름3박스 들기름2박스' }, { sourceId: 'source_2', text: '그거두박스' }];
const line = { itemId: 'oil', qty: 3, isBox: true, source: '참기름3박스' };
const group = { sourceId: 'source_1', lines: [line], rejected: [] };

describe('선택 원문 요청', () => {
  it('원문 공백과 UTF16을 그대로 보존한다', () => {
    expect(validateOrderCopyScopedSources([{ sourceId: 'a', text: '  참기름😀  ' }])).toEqual([{ sourceId: 'a', text: '  참기름😀  ' }]);
    expect(validateOrderCopyScopedSources([{ sourceId: 'a', text: '😀'.repeat(2000) }])).toHaveLength(1);
  });
  it.each([[], Array.from({ length: 41 }, (_, index) => ({ sourceId: `s${index}`, text: '가' })), [{ sourceId: 'a', text: '' }], [{ sourceId: 'a', text: '   ' }], [{ sourceId: '한글', text: '가' }], [{ sourceId: 'a'.repeat(65), text: '가' }], [{ sourceId: 'a', text: '😀'.repeat(2001) }], [{ sourceId: 'a', text: '가' }, { sourceId: 'a', text: '나' }]])('잘못된 범위는 자르지 않고 통째로 거절한다 %#', value => {
    expect(() => validateOrderCopyScopedSources(value)).toThrow();
  });
});

describe('확정과 애매한 원문 구분', () => {
  it.each(['1L', '1kg', '500ml', '12개'])('규격 %s만으로는 기본 주문 수량을 확정하지 않는다', spec => {
    const item = { id: 'oil', name: '참기름', spec };
    const input = { ...row(), rawText: `참기름 ${spec}`, qty: Number.parseFloat(spec), isBox: false };
    expect(classifyOrderCopyRow(input, { ...context, catalog: [item] }).status).toBe('ambiguous');
    expect(buildOrderCopyScopedSources([input], { ...context, catalog: [item] })).toEqual([{ sourceId: input.sourceId, text: input.rawText }]);
  });
  it('용량 규격 뒤에 따로 적힌 주문 수량은 기존 개수·박스 기준으로 확인한다', () => {
    const scoped = { ...context, catalog: [{ id: 'oil', name: '참기름', spec: '1L' }] };
    expect(classifyOrderCopyRow({ ...row(), rawText: '참기름 1L 3박스', qty: 3 }, scoped).status).toBe('confirmed');
    expect(classifyOrderCopyRow({ ...row(), rawText: '참기름 1L 2병', qty: 2, isBox: false }, scoped).status).toBe('confirmed');
  });
  it('품목 규격 필드가 없어도 L·kg만 적힌 글을 주문 개수로 추정하지 않는다', () => {
    for (const unit of ['L', 'kg']) expect(classifyOrderCopyRow({ ...row(), rawText: `참기름 1${unit}`, qty: 1, isBox: false }, { ...context, catalog: [{ id: 'oil', name: '참기름' }] }).status).toBe('ambiguous');
  });
  it('선택 ID와 기본 수량1만으로는 확정하지 않는다', () => {
    expect(classifyOrderCopyRow(row(), context).status).toBe('ambiguous');
    expect(classifyOrderCopyRow({ ...row(), rawText: '참기름 1박스', qty: 1 }, context).status).toBe('confirmed');
    expect(classifyOrderCopyRow({ ...row(), rawText: '참기름 비슷한것 1박스', qty: 1 }, context).status).toBe('ambiguous');
  });
  it('명시 수량·단위와 정확한 규격 또는 승인 별칭을 확인한다', () => {
    expect(classifyOrderCopyRow({ ...row(), rawText: '참기름 350ml 3박스', qty: 3 }, context).status).toBe('confirmed');
    const rules = [{ alias: '그거', itemId: 'oil', partnerId: 'partner', status: 'approved' }];
    expect(classifyOrderCopyRow({ ...row(), rawText: '그거 2박스', qty: 2 }, { ...context, rules }).status).toBe('confirmed');
    expect(classifyOrderCopyRow({ ...row(), rawText: '그거 2박스', qty: 1 }, { ...context, rules }).status).toBe('ambiguous');
    expect(classifyOrderCopyRow({ ...row(), rawText: '그거 2개', qty: 2 }, { ...context, rules }).status).toBe('ambiguous');
  });
  it('수동0·빈값·이미 AI로 읽은 행과 별칭 충돌은 새 AI 범위에서 제외한다', () => {
    const conflict = { ...row('conflict'), rawText: '그거 2박스', qty: 2 };
    const rules = ['oil', 'perilla'].map(itemId => ({ alias: '그거', itemId, partnerId: 'partner', status: 'approved' }));
    expect(classifyOrderCopyRow(conflict, { ...context, rules }).status).toBe('conflict');
    expect(buildOrderCopyScopedSources([{ ...row('manual'), manual: true, qty: 0 }, { ...row('resolved'), aiResolved: true }, conflict], { ...context, rules })).toEqual([]);
    expect(buildOrderCopyScopedSources([{ ...row('legacy-conflict'), rawText: '기름 2L', aliasConflict: true }], context)).toEqual([]);
  });
});

describe('응답의 원문 귀속과 원자 병합', () => {
  it.each([
    { text: '참기름 들기름 2박스', fragments: ['참기름 들기름 2박스', '참기름 들기름 2박스'], valid: false },
    { text: '참기름 들기름 2박스', fragments: ['참기름 들기름', '들기름 2박스'], valid: false },
    { text: '그거 그거', fragments: ['그거', '그거'], valid: true },
    { text: 'ababa', fragments: ['aba', 'ab'], valid: true },
  ])('다품목 조각의 비중첩 배치를 확인한다 $text', ({ text, fragments, valid }) => {
    const checked = validateScopedExtract({ results: [{ sourceId: 's', lines: fragments.map((source, index) => ({ itemId: catalog[index].id, qty: 2, source })), rejected: [] }] }, catalog, [{ sourceId: 's', text }]);
    expect(checked.results.length).toBe(valid ? 1 : 0);
    expect(checked.unresolvedSourceIds).toEqual(valid ? [] : ['s']);
  });
  it('한 원문의 과도한 행 수는 계산하거나 잘라 적용하지 않는다', () => {
    const checked = validateScopedExtract({ results: [{ sourceId: 's', lines: Array.from({ length: 41 }, (_, index) => ({ itemId: 'oil', qty: index + 1, source: '가' })), rejected: [] }] }, catalog, [{ sourceId: 's', text: '가'.repeat(41) }]);
    expect(checked.results).toEqual([]);
    expect(checked.unresolvedSourceIds).toEqual(['s']);
  });
  it('반복 조각의 불가능한 배치는 탐색 예산 안에서 확인 필요로 남긴다', () => {
    const checked = validateScopedExtract({ results: [{ sourceId: 's', lines: Array.from({ length: 40 }, (_, index) => ({ itemId: 'oil', qty: index + 1, source: '가' })), rejected: [] }] }, catalog, [{ sourceId: 's', text: '가'.repeat(39) + '나' }]);
    expect(checked.results).toEqual([]);
    expect(checked.unresolvedSourceIds).toEqual(['s']);
  });
  it('한 원문 다품목은 허용하고 원래 행 순서·구간·수동 초안을 유지한다', () => {
    const rows = [{ ...row(), rawText: sources[0].text }, { ...row('source_2'), rawText: sources[1].text, manual: true, qty: 0 }];
    const checked = validateScopedExtract({ results: [{ ...group, lines: [line, { itemId: 'perilla', qty: 2, source: '들기름2박스' }] }] }, catalog, sources);
    const result = mergeOrderCopyScopedResult(rows, sources, checked);
    expect(result.map(value => value.selectedProductId)).toEqual(['oil', 'perilla', 'oil']);
    expect(result[0]).toMatchObject({ rawText: sources[0].text, sourceStart: 4, sourceEnd: 12, aiResolved: true });
    expect(result[1].rawText).toBe(sources[0].text);
    expect(new Set(result.map(value => value.sourceId)).size).toBe(3);
    expect(result[2]).toBe(rows[1]);
    expect(result.slice(0, 2).map(value => value.orderedAs)).toEqual(['참기름3박스', '들기름2박스']);
    const candidates = orderInterpretationAliasCandidates({ firstAnalysis: { kind: 'rules' }, confirmed: {
      inputLines: result.slice(0, 2).map(value => ({ itemId: value.selectedProductId, orderedAs: value.orderedAs, quantity: value.qty, isBoxUnit: value.isBox })),
      orderDraft: { partnerId: 'partner', items: result.slice(0, 2).map(value => ({ itemId: value.selectedProductId, orderedAs: value.orderedAs, quantity: value.qty, boxQuantity: value.qty, isBoxUnit: value.isBox })) },
    } } as any);
    expect(candidates).toEqual([{ partnerId: 'partner', alias: '참기름', itemId: 'oil' }, { partnerId: 'partner', alias: '들기름', itemId: 'perilla' }]);
  });
  it.each(['unknown', 'missing', 'nonstring'])('알 수 없는 %s source ID는 전체 적용을 막는다', kind => {
    const invalid = { ...group, sourceId: kind === 'unknown' ? 'outside' : kind === 'missing' ? undefined : 3 };
    const checked = validateScopedExtract({ results: [group, invalid] }, catalog, sources);
    expect(checked.valid).toBe(false);
    expect(checked.results).toEqual([]);
    expect(mergeOrderCopyScopedResult([row()], sources, checked)).toEqual([row()]);
  });
  it.each(['duplicate-group', 'duplicate-line', 'mixed', 'wrong-fragment', 'wrong-item', 'zero'])('같은 원문 %s 오류는 다른 정상 원문만 적용한다', kind => {
    const first = { ...group, lines: [line], rejected: [] as unknown[] };
    if (kind === 'duplicate-line') first.lines.push(line);
    if (kind === 'mixed') first.rejected.push({ text: '참기름3박스', reason: '모름' });
    if (kind === 'wrong-fragment') first.lines = [{ ...line, source: sources[1].text }];
    if (kind === 'wrong-item') first.lines = [{ ...line, itemId: 'invented' }];
    if (kind === 'zero') first.lines = [{ ...line, qty: 0 }];
    const second = { sourceId: 'source_2', lines: [{ itemId: 'perilla', qty: 2, source: sources[1].text }], rejected: [] };
    const checked = validateScopedExtract({ results: [second, first, ...(kind === 'duplicate-group' ? [first] : [])] }, catalog, sources);
    expect(checked.valid).toBe(true);
    expect(checked.results.map(value => value.sourceId)).toEqual(['source_2']);
    expect(checked.unresolvedSourceIds).toEqual(['source_1']);
    const rows = [{ ...row(), rawText: sources[0].text }, { ...row('source_2'), rawText: sources[1].text }];
    const merged = mergeOrderCopyScopedResult(rows, sources, checked);
    expect(merged[0]).toBe(rows[0]);
    expect(merged[1].selectedProductId).toBe('perilla');
  });
  it('응답 그룹 순서가 바뀌어도 원문 순서를 유지하고 삭제한 행은 되살리지 않는다', () => {
    const checked = validateScopedExtract({ results: [{ sourceId: 'source_2', lines: [{ itemId: 'perilla', qty: 2, source: sources[1].text }], rejected: [] }, group] }, catalog, sources);
    const rows = [{ ...row(), rawText: sources[0].text }, { ...row('source_2'), rawText: sources[1].text }];
    expect(mergeOrderCopyScopedResult(rows, sources, checked).map(value => value.sourceId)).toEqual(['source_1', 'source_2']);
    expect(mergeOrderCopyScopedResult([], sources, checked)).toEqual([]);
  });
});
