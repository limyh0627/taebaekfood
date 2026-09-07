import { describe, it, expect } from 'vitest';
import { fileFromPaste, fileSizeLabel, safeFileName, type PasteLike } from './chatUpload';

const 그림 = (name: string, type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type });

/** 붙여넣기 흉내 — 브라우저가 주는 모양(items 는 kind + getAsFile) */
const 붙여넣기 = (
  items: { kind: string; file?: File }[] = [],
  files: File[] = [],
): PasteLike => ({
  items: items.map(x => ({ kind: x.kind, getAsFile: () => x.file ?? null })),
  files,
});

const 때 = new Date(2026, 8, 7, 9, 44, 5);   // 2026-09-07 09:44:05

describe('붙여넣기에서 파일 꺼내기', () => {
  it('글자만 붙여넣으면 null — 브라우저가 알아서 넣게 둔다', () => {
    expect(fileFromPaste(붙여넣기([{ kind: 'string' }]))).toBeNull();
    expect(fileFromPaste(null)).toBeNull();
    expect(fileFromPaste({})).toBeNull();
  });

  it('캡처(image.png)는 날짜로 이름을 다시 짓는다 — Storage 에 같은 이름이 쌓이면 안 된다', () => {
    const f = fileFromPaste(붙여넣기([{ kind: 'file', file: 그림('image.png') }]), 때);
    expect(f?.name).toBe('붙여넣기-20260907-094405.png');
    expect(f?.type).toBe('image/png');
  });

  it('이름 없는 파일도 지어 준다', () => {
    const f = fileFromPaste(붙여넣기([{ kind: 'file', file: 그림('', 'image/jpeg') }]), 때);
    expect(f?.name).toBe('붙여넣기-20260907-094405.jpg');   // jpeg → jpg
  });

  it('사람이 지은 이름은 그대로 둔다 — 탐색기에서 복사한 파일', () => {
    const f = fileFromPaste(붙여넣기([{ kind: 'file', file: 그림('거래명세서.png') }]), 때);
    expect(f?.name).toBe('거래명세서.png');
  });

  it('글자와 그림이 같이 담기면 그림을 고른다 — 웹에서 복사하면 둘 다 온다', () => {
    const f = fileFromPaste(붙여넣기([
      { kind: 'string' }, { kind: 'string' }, { kind: 'file', file: 그림('사진.png') },
    ]), 때);
    expect(f?.name).toBe('사진.png');
  });

  it('items 가 비면 files 로 물러선다 — 브라우저마다 담기는 자리가 다르다', () => {
    const f = fileFromPaste({ files: [그림('첨부.png')] }, 때);
    expect(f?.name).toBe('첨부.png');
  });

  it('그림이 아닌 파일도 그대로 나른다 — 붙여넣기가 사진 전용은 아니다', () => {
    const f = fileFromPaste(붙여넣기([{ kind: 'file', file: 그림('계약서.pdf', 'application/pdf') }]), 때);
    expect(f?.name).toBe('계약서.pdf');
    expect(f?.type).toBe('application/pdf');
  });
});

describe('크기 · 이름', () => {
  it('사람이 읽는 크기', () => {
    expect(fileSizeLabel(500)).toBe('500B');
    expect(fileSizeLabel(2048)).toBe('2KB');
    expect(fileSizeLabel(3 * 1024 * 1024)).toBe('3.0MB');
  });

  it('Storage 경로에 못 들어가는 글자를 걷어낸다 — 한글은 그대로', () => {
    expect(safeFileName('보고서#1.pdf')).toBe('보고서_1.pdf');
    expect(safeFileName('a/b?c%d.png')).toBe('a_b_c_d.png');
  });
});
