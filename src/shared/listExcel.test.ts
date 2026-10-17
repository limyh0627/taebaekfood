/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { buildListWorkbook, downloadListExcel } from './listExcel';

describe('조회 목록 엑셀', () => {
  it('필터된 행만 숫자 그대로 기록하고 사용자 문자열은 수식으로 실행하지 않는다', async () => {
    const workbook = await buildListWorkbook({
      title: '전표내역', subtitle: '2026-09-01 ~ 2026-09-30 · 1건',
      columns: [{ header: '거래처', width: 20 }, { header: '금액', width: 15, number: true }],
      rows: [['=HYPERLINK("x")', 12345]],
    });
    const sheet = workbook.getWorksheet('전표내역')!;
    expect(sheet.getCell('A2').value).toContain('2026-09-01');
    expect(sheet.getCell('A5').value).toBe('\'=HYPERLINK("x")');
    expect(sheet.getCell('B5').value).toBe(12345);
    expect(sheet.getCell('B5').numFmt).toContain('#,##0');
    expect(sheet.rowCount).toBe(5);
  }, 15000);
});

const exportInput = () => ({ title: '조회', subtitle: '기간 10월', fileName: '조회/10월', columns: [{ header: '이름', width: 20 }], rows: [['첫 이름']], signal: new AbortController().signal });
it('취소와 동시 요청은 파일을 생성하지 않고 임시 모달을 정리한다', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let pending!: Promise<void>;
  await act(async () => { pending = downloadListExcel(exportInput()); });
  await screen.findByRole('dialog', { name: '엑셀 미리보기' });
  await downloadListExcel(exportInput());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '닫기' })); await act(async () => pending);
  expect(click).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});
it('열 때 복사한 전체 행을 저장하며 저장 중 취소하면 다운로드하지 않는다', async () => {
  const input = exportInput(), controller = new AbortController(); input.signal = controller.signal;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let pending!: Promise<void>;
  await act(async () => { pending = downloadListExcel(input); });
  await screen.findByText('첫 이름'); input.rows[0][0] = '뒤에 바뀐 이름';
  expect(screen.queryByText('뒤에 바뀐 이름')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '엑셀 저장' }));
  await act(async () => controller.abort()); await pending;
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(click).not.toHaveBeenCalled();
});

it.each(['scope', '닫기'])('파일 생성 대기 중 %s 취소면 완성된 파일도 다운로드하지 않는다', async mode => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:cancelled') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const sample = await buildListWorkbook(exportInput());
  let finish!: (buffer: ArrayBuffer) => void;
  const write = vi.spyOn(Object.getPrototypeOf(sample.xlsx), 'writeBuffer').mockImplementation(() => new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const controller = new AbortController(); let pending!: Promise<void>;
  await act(async () => { pending = downloadListExcel({ ...exportInput(), signal: controller.signal }); });
  fireEvent.click(await screen.findByRole('button', { name: '엑셀 저장' }));
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  await act(async () => { if (mode === 'scope') controller.abort(); else fireEvent.click(screen.getByRole('button', { name: '닫기' })); }); await pending;
  await act(async () => finish(new ArrayBuffer(1))); expect(click).not.toHaveBeenCalled();
});
it('명시 저장에서만 고정 사본을 파일로 쓰고 URL을 회수한다', async () => {
  const sample = await buildListWorkbook(exportInput());
  let cell: unknown;
  vi.spyOn(Object.getPrototypeOf(sample.xlsx), 'writeBuffer').mockImplementation(function (this: { workbook: import('exceljs').Workbook }) {
    cell = this.workbook.getWorksheet('조회')!.getCell('A5').value; return Promise.resolve(new ArrayBuffer(1));
  });
  const create = vi.fn(() => 'blob:preview'), revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const input = exportInput(); let pending!: Promise<void>;
  await act(async () => { pending = downloadListExcel(input); }); await screen.findByText('첫 이름'); input.rows[0][0] = '뒤 이름';
  expect(click).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '엑셀 저장' })); await act(async () => pending);
  expect(cell).toBe('첫 이름'); expect(click).toHaveBeenCalledOnce(); expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('조회_10월.xlsx'); expect(revoke).toHaveBeenCalledWith('blob:preview'); expect(screen.queryByRole('dialog')).toBeNull();
});
