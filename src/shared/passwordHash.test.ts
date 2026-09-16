import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../functions/src/passwordHash';

describe('직원 비밀번호 해시', () => {
  it('원문은 남기지 않고 같은 비밀번호만 통과시킨다', () => {
    const encoded = hashPassword('직원-비밀번호-1234');
    expect(encoded).not.toContain('직원-비밀번호-1234');
    expect(verifyPassword('직원-비밀번호-1234', encoded)).toBe(true);
    expect(verifyPassword('틀린-비밀번호', encoded)).toBe(false);
  });

  it('깨진 해시는 로그인 실패로 처리한다', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });
});
