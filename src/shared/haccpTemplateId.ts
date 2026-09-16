import type { CompanyId } from './types';

/** DB 이관 규칙과 같은 HACCP 템플릿 문서 ID. 태백의 기존 ID는 유지한다. */
export function haccpTemplateDocId(companyId: CompanyId, templateId: string): string {
  return companyId === 'punghoe' ? `punghoe--${templateId}` : templateId;
}
