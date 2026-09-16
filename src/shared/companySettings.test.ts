import { describe, expect, it } from 'vitest';
import { companySettingDocId, companySettingPatch, companySettingStateKey } from './companySettings';

describe('회사별 설정 문서', () => {
  it('회사정보와 운영 설정의 문서 ID를 한 규칙으로 만든다', () => {
    expect(companySettingDocId('taebaek', 'company')).toBe('taebaek');
    expect(companySettingDocId('punghoe', 'company')).toBe('punghoe');
    expect(companySettingDocId('taebaek', 'deliveryOrdering')).toBe('taebaek__deliveryOrdering');
    expect(companySettingDocId('punghoe', 'deliveryOrdering')).toBe('punghoe__deliveryOrdering');
  });

  it('저장값의 회사를 호출자가 바꿔 끼울 수 없게 마지막에 고정한다', () => {
    expect(companySettingPatch('punghoe', { names: [], companyId: 'taebaek' })).toEqual({
      names: [], companyId: 'punghoe',
    });
  });

  it('문서 키 순서가 달라도 같은 상태이고 값·존재 여부가 바뀌면 다른 상태다', () => {
    const a = companySettingStateKey({ exists: true, data: { companyId: 'taebaek', names: ['기름'] } });
    const reordered = companySettingStateKey({ data: { names: ['기름'], companyId: 'taebaek' }, exists: true });
    const edited = companySettingStateKey({ exists: true, data: { companyId: 'taebaek', names: ['깨'] } });
    expect(reordered).toBe(a);
    expect(edited).not.toBe(a);
    expect(companySettingStateKey({ exists: false })).not.toBe(a);
  });
});
