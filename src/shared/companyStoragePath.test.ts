import { describe, expect, it } from 'vitest';
import { cabinetStoragePath, companyStorageRoot, officeTalkStoragePath } from './companyStoragePath';

describe('회사별 Storage 경로', () => {
  it('문서함과 오피스톡 파일을 회사 루트 아래에 둔다', () => {
    expect(companyStorageRoot('punghoe')).toBe('companies/punghoe');
    expect(cabinetStoragePath('taebaek', '업무용', '일지', '1.pdf'))
      .toBe('companies/taebaek/file-cabinet/업무용/일지/1.pdf');
    expect(officeTalkStoragePath('punghoe', 'ROOM-1', '2.jpg'))
      .toBe('companies/punghoe/officetalk/ROOM-1/2.jpg');
  });
});
