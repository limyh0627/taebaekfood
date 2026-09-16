import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modal = readFileSync('components/AdminAuthModal.tsx', 'utf8');
const config = readFileSync('src/config.ts', 'utf8');
const app = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');

describe('관리자 추가 인증의 평문 노출 방지', () => {
  it('입력값이나 DB 비밀번호를 콘솔에 출력하지 않는다', () => {
    expect(modal).not.toMatch(/console\.(?:log|debug)[^\n]*(?:password|비밀번호|입력값)/i);
  });

  it('기본 관리자 비밀번호 0000으로 물러서지 않는다', () => {
    expect(config).not.toMatch(/adminPassword\s*:\s*['"]0000['"]/);
    expect(modal).not.toMatch(/correctPassword\s*=\s*['"]0000['"]/);
    expect(app).toContain("companyInfo.adminPassword !== '0000'");
  });
});
