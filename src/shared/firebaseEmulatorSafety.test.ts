import { describe, expect, it } from 'vitest';
import { assertLocalEmulatorTarget } from './firebaseEmulatorSafety';

describe('로컬 Firebase 연결 차단', () => {
  it('demo 프로젝트와 이 컴퓨터 주소만 허용한다', () => {
    expect(() => assertLocalEmulatorTarget('demo-taebaekfood-local', '127.0.0.1')).not.toThrow();
    expect(() => assertLocalEmulatorTarget('demo-taebaekfood-local', 'localhost')).not.toThrow();
  });
  it('운영 프로젝트 ID는 거부한다', () => {
    expect(() => assertLocalEmulatorTarget('taebaek-3abe4', '127.0.0.1')).toThrow(/demo-/);
  });
  it('외부 호스트는 거부한다', () => {
    expect(() => assertLocalEmulatorTarget('demo-taebaekfood-local', 'example.com')).toThrow(/이 컴퓨터/);
  });
});
