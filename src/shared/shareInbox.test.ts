// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { clearShareUrl, discardSharedFile, readSharedFile } from './shareInbox';

const entries = new Map<string, FormData>();
beforeEach(() => {
  entries.clear();
  vi.stubGlobal('caches', { open: async () => ({
    match: async (key: string) => entries.has(key) ? { formData: async () => entries.get(key)! } : undefined,
    delete: async (key: string) => entries.delete(key),
  }) });
  window.history.replaceState(null, '', '/?share=123e4567-e89b-42d3-a456-426614174000&shareRejected=1');
});

it('reads one valid file and preserves it until explicit discard', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const form = new FormData();
  form.set('title', '견적');
  form.set('files', new File(['pdf'], 'quote.pdf', { type: 'application/pdf' }));
  entries.set(new URL(`/__share-inbox/${id}`, window.location.origin).href, form);
  const draft = await readSharedFile(id);
  expect(draft.file.name).toBe('quote.pdf');
  expect(draft.text).toBe('견적');
  expect(entries.size).toBe(1);
  await discardSharedFile(id);
  expect(entries.size).toBe(0);
  expect(window.location.search).toBe('');
});

it('rejects missing, malformed, multiple, empty and unsupported files without deleting them', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const key = new URL(`/__share-inbox/${id}`, window.location.origin).href;
  await expect(readSharedFile('../bad')).rejects.toThrow();
  await expect(readSharedFile(id)).rejects.toThrow();
  for (const files of [
    [new File([], 'empty.pdf', { type: 'application/pdf' })],
    [new File(['x'], 'bad.txt', { type: 'text/plain' })],
    [new File(['x'], 'a.pdf', { type: 'application/pdf' }), new File(['x'], 'b.pdf', { type: 'application/pdf' })],
  ]) {
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    entries.set(key, form);
    await expect(readSharedFile(id)).rejects.toThrow();
    expect(entries.has(key)).toBe(true);
  }
  clearShareUrl(id);
  expect(window.location.search).toBe('');
});
