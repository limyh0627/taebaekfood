import { describe, expect, it } from 'vitest';
import type { Employee } from './types';
import { participantCompaniesOf } from './chatParticipants';

const employee = (id: string, companyId?: 'taebaek' | 'punghoe'): Employee => ({ id, name: id, companyId } as Employee);

describe('오피스톡 참여자 회사', () => {
  it('같은 회사 참여자 ID와 회사 스냅샷을 한 벌로 만든다', () => {
    expect(participantCompaniesOf(['e1', 'e2', 'e1'], [employee('e1'), employee('e2', 'taebaek')], 'taebaek'))
      .toEqual({ e1: 'taebaek', e2: 'taebaek' });
  });

  it('다른 회사 직원과 없는 직원을 저장 전에 거절한다', () => {
    expect(() => participantCompaniesOf(['e9'], [employee('e9', 'punghoe')], 'taebaek')).toThrow('다른 회사');
    expect(() => participantCompaniesOf(['missing'], [], 'taebaek')).toThrow('찾을 수 없습니다');
  });
});
