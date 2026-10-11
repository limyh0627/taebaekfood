import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { adminCredentialPath } from './adminCredentialPath';

describe('관리자 인증 경로 선택', () => {
  it('환경변수 지정이 있으면 기본 파일 존재 검사보다 우선한다', async () => {
    const selected = await adminCredentialPath(String.raw`D:\인증 폴더\선택.json`, String.raw`C:\Users\yhy_0`, async () => { throw new Error('기본 파일을 검사하면 안 됩니다.'); });
    expect(selected).toBe(String.raw`D:\인증 폴더\선택.json`);
  });
  it('현재 Windows 홈의 기본 파일을 고르고 이전 사용자 경로를 사용하지 않는다', async () => {
    const home = String.raw`C:\Users\yhy_0`; const checked: string[] = [];
    expect(await adminCredentialPath(undefined, home, async path => { checked.push(path); return true; })).toBe(join(home, '.secrets', 'taebaek-admin.json'));
    expect(checked).toEqual([join(home, '.secrets', 'taebaek-admin.json')]);
    expect(checked[0]).not.toContain('TAEBAEK');
  });
  it('홈의 공백과 한글을 그대로 보존하며 빈 환경변수는 기본 경로를 따른다', async () => {
    const home = String.raw`C:\Users\사용자 이름`;
    expect(await adminCredentialPath('', home, async () => true)).toBe(join(home, '.secrets', 'taebaek-admin.json'));
  });
  it('기본 파일이 없으면 기존 applicationDefault 분기를 위한 undefined를 반환한다', async () => {
    const checked: string[] = [];
    expect(await adminCredentialPath(undefined, String.raw`C:\Users\yhy_0`, async path => { checked.push(path); return false; })).toBeUndefined();
    expect(checked).toHaveLength(1);
  });
});
