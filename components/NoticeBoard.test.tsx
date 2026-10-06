/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NoticeBoard from './NoticeBoard';
vi.mock('../src/shared/noticeImage', () => ({ uploadNoticeImage: vi.fn(async () => ({ type: 'image', url: 'https://example.com/photo.png', path: 'companies/taebaek/notices/a/photo', caption: '' })), deleteNoticeImages: vi.fn(async () => {}) }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true), appNotice: vi.fn() }));
const posts = [{ id: 'old', title: '고정 공지', content: '본문', author: '관리자', tag: '공지' as const, date: '2026-09-01', pinned: true }, { id: 'new', title: '최근 공지', content: '본문', author: '관리자', tag: '공지' as const, date: '2026-10-06' }];
describe('공지 관리', () => {
  it('고정 공지를 먼저 보여 주고 관리자가 고정 해제·삭제할 수 있다', async () => {
    const update = vi.fn(async () => {}), remove = vi.fn(async () => {});
    render(<NoticeBoard posts={posts} onUpdatePost={update} onDeletePost={remove} />);
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('고정 공지');
    fireEvent.click(screen.getByText('고정 공지'));
    fireEvent.click(screen.getByRole('button', { name: '상단 고정 해제' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('old', { pinned: false }));
    await waitFor(() => expect(screen.getByRole('button', { name: '상단 고정' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '공지 삭제' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('old'));
  });
  it('사진과 글 단락을 포함해 저장하고 실패하면 작성창을 유지한다', async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error('저장 실패')).mockResolvedValueOnce(undefined);
    render(<NoticeBoard posts={[]} companyId="taebaek" onAddPost={add} />);
    fireEvent.click(screen.getByRole('button', { name: '공지 추가' }));
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '사진 공지' } });
    fireEvent.change(screen.getByLabelText('사진 첨부'), { target: { files: [new File(['photo'], 'a.png', { type: 'image/png' })] } });
    await screen.findByAltText('첨부 사진');
    await waitFor(() => expect(screen.getByRole('button', { name: '등록' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '글 단락 추가' }));
    fireEvent.change(screen.getByLabelText('글 단락 2'), { target: { value: '사진 아래 설명' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: '등록' })).not.toBeDisabled());
    expect(screen.getByPlaceholderText('제목')).toHaveValue('사진 공지');
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1][0].blocks).toEqual([expect.objectContaining({ type: 'image' }), { type: 'text', text: '사진 아래 설명' }]);
  });
});
