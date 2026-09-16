import { describe, expect, it } from 'vitest';
import { haccpTemplateDocId } from './haccpTemplateId';
import { readFileSync } from 'node:fs';

describe('회사별 HACCP 템플릿 문서 ID', () => {
  it('태백은 기존 문서 ID를 유지한다', () => {
    expect(haccpTemplateDocId('taebaek', 'personal_hygiene')).toBe('personal_hygiene');
  });

  it('풍회는 이관된 punghoe 접두사 문서를 사용한다', () => {
    expect(haccpTemplateDocId('punghoe', 'personal_hygiene')).toBe('punghoe--personal_hygiene');
  });

  it('HACCP 화면의 템플릿 조회와 저장은 모두 회사별 ID 함수를 거친다', () => {
    const source = readFileSync('components/HaccpChecklist.tsx', 'utf8');
    const reads = [...source.matchAll(/doc\(db, 'haccp_templates',/g)];
    const writes = [...source.matchAll(/setDocument\('haccp_templates',/g)];
    const scopedIds = [...source.matchAll(/haccpTemplateDocId\(companyId,/g)];

    expect(reads.length).toBeGreaterThan(0);
    expect(writes.length).toBeGreaterThan(0);
    expect(scopedIds).toHaveLength(reads.length + writes.length);
  });
});
