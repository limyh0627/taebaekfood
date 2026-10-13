import { describe, expect, it } from 'vitest';
import { canonicalOrderInterpretation, sameOrderInterpretationRequest, validateOrderInterpretation,orderInterpretationAliasCandidates,normalizeOrderInterpretationAlias,matchOrderInterpretationAlias } from './orderInterpretation';

const scope = { companyId: 'taebaek' as const, actorUid: 'actor' };
const request = () => ({ version: 1, requestId: 'request-1', ...scope, createdAt: '2026-10-13T10:00:00.000Z',
  sourceText: '  참기름 350ml\r\n3박스\t배송 요청  ',
  firstAnalysis: { rule: { raw: ['3박스'], validated: [{ quantity: 3 }], rejected: ['불명확'] },
    ai: { raw: '{"quantity":3}', validated: [{ displaySize: '350ml' }], rejected: [{ text: '추정', reason: '미확정' }] } },
  confirmed: { inputLines: [{ itemId: 'oil', quantity: 3, isBoxUnit: true }], orderDraft: { items: [{ quantity: 36 }], totalAmount: 36000 } } });

const aliasRequest=(expression:string,quantity=2,isBoxUnit=false)=>validateOrderInterpretation({...request(),firstAnalysis:{kind:'rules',raw:[]},confirmed:{inputLines:[{itemId:'oil',orderedAs:expression,quantity,isBoxUnit}],orderDraft:{partnerId:'partner',items:[{itemId:'oil',orderedAs:expression,quantity:isBoxUnit?quantity*20:quantity,...(isBoxUnit?{isBoxUnit:true,boxQuantity:quantity}: {})}]}}},scope);
it('확정 원수량과 마지막 명시단위가 맞을 때만 별칭 제안한다',()=>{expect(orderInterpretationAliasCandidates(aliasRequest('  참기름 350ml  2병'))).toEqual([{partnerId:'partner',itemId:'oil',alias:'참기름 350ml'}]);expect(orderInterpretationAliasCandidates(aliasRequest('참기름 2박스',2,true))[0].alias).toBe('참기름');});
it.each(['참기름 3병','참기름 2박스','참기름 2병 부탁드려요','참기름, 들기름 2병','참기름\n2병'])('모호하거나 원입력과 다른 %s는 후보가 아니다',expression=>expect(orderInterpretationAliasCandidates(aliasRequest(expression))).toEqual([]));
it('규격과 대소문자를 보존하며 승인된 같은 거래처 전체동치만 판독한다',()=>{expect(normalizeOrderInterpretationAlias('  기름  1L ')).toBe('기름 1L');const rules=[{partnerId:'partner',alias:'기름 350ml',itemId:'oil',status:'approved'}];expect(matchOrderInterpretationAlias('기름 350ml',rules,'partner')).toBe('oil');expect(matchOrderInterpretationAlias('기름',rules,'partner')).toBeNull();expect(matchOrderInterpretationAlias('기름 350ml',rules,'other')).toBeNull();expect(matchOrderInterpretationAlias('기름 350ml',[{...rules[0],status:'proposed'}],'partner')).toBeNull();});
it('kind 없는 옛 분석과 잘린 원문은 제안하지 않는다',()=>{const r=aliasRequest('기름2병');r.firstAnalysis={old:true};expect(orderInterpretationAliasCandidates(r)).toEqual([]);expect(orderInterpretationAliasCandidates(aliasRequest('가'.repeat(80)+'2병'))).toEqual([]);});

describe('최초 주문 판독 증거의 단일 JSON 계약', () => {
  it('원문과 분석 전체를 정규화하거나 재계산하지 않고 독립된 사본으로 반환한다', () => {
    const original = request(), copy = validateOrderInterpretation(original, scope);
    expect(copy).toEqual(original); expect(copy.sourceText).toBe(original.sourceText);
    original.firstAnalysis.ai.rejected[0].reason = '후행 변경'; original.confirmed.orderDraft.items[0].quantity = 99;
    expect(copy.firstAnalysis.ai).toMatchObject({ rejected: [{ reason: '미확정' }] });
    expect(copy.confirmed.orderDraft.items).toEqual([{ quantity: 36 }]);
  });
  it('객체 키 순서만 달라도 같은 요청이며 분석·초안·ID·시각 변화는 다른 요청이다', () => {
    const original = request(), reordered = Object.fromEntries(Object.entries(original).reverse());
    expect(sameOrderInterpretationRequest(original, reordered, scope)).toBe(true);
    for (const change of [{ requestId: 'request-2' }, { createdAt: '2026-10-13T10:00:01.000Z' }, { sourceText: original.sourceText.trim() },
      { firstAnalysis: { ...original.firstAnalysis, extra: '추가' } }, { confirmed: { ...original.confirmed, orderDraft: { totalAmount: 1 } } }])
      expect(sameOrderInterpretationRequest(original, { ...original, ...change }, scope)).toBe(false);
  });
  it.each([
    { extra: true }, { version: 2 }, { actorUid: 'other' }, { companyId: 'punghoe' },
    { createdAt: '2026-02-30T10:00:00.000Z' }, { createdAt: '2026-10-13' }, { requestId: '' },
    { firstAnalysis: [] }, { confirmed: { inputLines: [], orderDraft: {}, extra: true } },
  ])('필수 범위·버전·객체 경계를 벗어난 요청은 거절한다', change => {
    expect(() => validateOrderInterpretation({ ...request(), ...change }, scope)).toThrow();
  });
  it('필드 누락과 실제 회사·사용자 범위 부재를 거절하며 유효한 ISO 시각은 원문으로 보존한다', () => {
    const { sourceText: _source, ...missing } = request();
    expect(() => validateOrderInterpretation(missing, scope)).toThrow();
    expect(() => validateOrderInterpretation(request(), { ...scope, actorUid: '' })).toThrow();
    expect(() => validateOrderInterpretation(request(), { ...scope, companyId: 'punghoe' })).toThrow();
    const shifted = { ...request(), createdAt: '2026-10-13T19:00:00+09:00' };
    expect(validateOrderInterpretation(shifted, scope).createdAt).toBe(shifted.createdAt);
  });
  it.each([undefined, NaN, Infinity, -0, BigInt(1), () => 1, new Date(), Symbol('값'), new Map()])('JSON에서 손실되는 분석 값을 조용히 누락시키지 않는다', value => {
    expect(() => canonicalOrderInterpretation({ ...request(), firstAnalysis: { value } }, scope)).toThrow();
  });
  it('빈 배열 칸·순환·접근자·기호·숨겨진 속성·사용자 클래스는 거절한다', () => {
    const cycle: any = {}; cycle.self = cycle;
    let getterCalls = 0; const getter = Object.defineProperty({}, 'value', { enumerable: true, get: () => { getterCalls++; return 1; } });
    const hidden = Object.defineProperty({}, 'value', { value: 1 });
    class Custom { value = 1; }
    for (const value of [Array(1), cycle, getter, hidden, { [Symbol('키')]: 1 }, new Custom()])
      expect(() => validateOrderInterpretation({ ...request(), firstAnalysis: { value } }, scope)).toThrow();
    expect(getterCalls).toBe(0);
  });
  it('공유 참조는 순환으로 오판하지 않고 특수 JSON 키도 그대로 보존한다', () => {
    const shared = { value: 3 }, analysis = JSON.parse('{"__proto__":{"value":"원문"},"constructor":null}');
    const copy = validateOrderInterpretation({ ...request(), firstAnalysis: { ...analysis, a: shared, b: shared } }, scope);
    expect(copy.firstAnalysis.a).toEqual(shared); expect(copy.firstAnalysis.b).toEqual(shared);
    expect(Object.hasOwn(copy.firstAnalysis, '__proto__')).toBe(true); expect({}.hasOwnProperty.call(copy.firstAnalysis, 'constructor')).toBe(true);
  });
});
