import { describe, expect, it } from 'vitest';
import { advanceInventoryWriterProtocol, preserveInventoryWriterProtocol } from './inventoryWriterProtocol';
describe('재고 writer 최초 조회 버전', () => {
  it('옛 문서와 새 문서는1, 기존 버전은 한 번만 증가하며 입력을 보존한다', () => {
    expect(advanceInventoryWriterProtocol(undefined, { stock: 2 })).toEqual({ stock: 2, inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 1 });
    const before = { stock: 5, inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 7 }, next = { stock: 6 };
    expect(advanceInventoryWriterProtocol(before, next).inventoryWriteRevision).toBe(8);
    expect(advanceInventoryWriterProtocol(before, { stock: 9 }).inventoryWriteRevision).toBe(8);
    expect(before.inventoryWriteRevision).toBe(7); expect(next).toEqual({ stock: 6 });
  });
  it.each([{ inventoryWriterProtocolVersion: 2 }, { inventoryWriterProtocolVersion: 1 }, { inventoryWriteRevision: null }, { inventoryWriteRevision: -1 }, { inventoryWriteRevision: 1.1 }, { inventoryWriteRevision: NaN }, { inventoryWriteRevision: Infinity }, { inventoryWriteRevision: Number.MAX_SAFE_INTEGER }])('손상된 최초 버전 %j은 거절한다', before => {
    expect(() => advanceInventoryWriterProtocol(before, {})).toThrow();
  });
  it('정규화 뒤 표식은 복구하고 metadata는 기존 버전을 유지하며 없는 표식을 만들지 않는다', () => {
    expect(preserveInventoryWriterProtocol({ inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 9 }, { cost: 2, inventoryWriteRevision: 99 })).toEqual({ cost: 2, inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 9 });
    expect(preserveInventoryWriterProtocol({}, { cost: 2, inventoryWriteRevision: 99 })).toEqual({ cost: 2 });
  });
});
