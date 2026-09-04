import { describe, it, expect } from 'vitest';
import { canEnterAdmin, freshAccess, OWNER_ID } from './adminAccess';

describe('canEnterAdmin', () => {
  it('사장님 계정은 늘 들어간다', () => {
    expect(canEnterAdmin({ id: OWNER_ID })).toBe(true);
  });
  it('허용 칸이 켜진 직원은 들어간다', () => {
    expect(canEnterAdmin({ id: 'emp-1', adminAccess: true })).toBe(true);
  });
  it('칸이 없거나 꺼진 직원은 못 들어간다 — 기본은 막힘이다', () => {
    expect(canEnterAdmin({ id: 'emp-1' })).toBe(false);
    expect(canEnterAdmin({ id: 'emp-1', adminAccess: false })).toBe(false);
  });
  it('로그인 안 했으면 못 들어간다', () => {
    expect(canEnterAdmin(null)).toBe(false);
    expect(canEnterAdmin(undefined)).toBe(false);
  });
  it('참이 아닌 값을 참으로 치지 않는다 — DB 에 문자열이 들어와도 막는다', () => {
    expect(canEnterAdmin({ id: 'e', adminAccess: 'true' as any })).toBe(false);
    expect(canEnterAdmin({ id: 'e', adminAccess: 1 as any })).toBe(false);
  });
});

describe('freshAccess', () => {
  it('지금 목록의 권한을 따른다 — 저장된 사본이 낡았을 때', () => {
    const saved = { id: 'e1', name: '이은경', adminAccess: false } as any;
    const live = [{ id: 'e1', name: '이은경', adminAccess: true }] as any[];
    expect(canEnterAdmin(freshAccess(saved, live))).toBe(true);
  });
  it('권한을 거둬도 바로 반영된다', () => {
    const saved = { id: 'e1', adminAccess: true } as any;
    const live = [{ id: 'e1', adminAccess: false }] as any[];
    expect(canEnterAdmin(freshAccess(saved, live))).toBe(false);
  });
  it('목록이 아직 안 왔으면 저장된 걸 쓴다 — 켤 때 잠깐 비어 있다', () => {
    const saved = { id: 'e1', adminAccess: true } as any;
    expect(freshAccess(saved, [])).toEqual(saved);
  });
});
