import { describe, expect, it } from 'vitest';
import { advanceInventoryWriterProtocol, preserveInventoryWriterProtocol,protectInventoryWriterPatch } from './inventoryWriterProtocol';
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
    const marker={permitId:'permit',slot:0};
    expect(advanceInventoryWriterProtocol({rawReversePermitRefV1:marker},{stock:1}).rawReversePermitRefV1).toEqual(marker);
    expect(preserveInventoryWriterProtocol({rawReversePermitRefV1:marker},{cost:2}).rawReversePermitRefV1).toEqual(marker);
  });
  it('수량 변경은 보호 예약 바닥을 지키되 단순 버전 검사는 기존 부족을 새 변경으로 보지 않는다', () => {
    const row = { qty: 4, state: 'allocated', serverProtocol: 'full-v1' };
    const before = { stock: 5, serverReservedStockFloorV1: 4, fullReservationRows: [row], inventoryReservations: [row] };
    expect(() => advanceInventoryWriterProtocol(before, { stock: 3 })).toThrow('예약 재고');
    expect(advanceInventoryWriterProtocol(before, { stock: 4 }).stock).toBe(4);
    expect(advanceInventoryWriterProtocol(before, { stock: 3, serverReservedStockFloorV1: 0, fullReservationRows: [], inventoryReservations: [] }).stock).toBe(3);
    expect(() => advanceInventoryWriterProtocol({ stock: 2, serverReservedStockFloorV1: 4 }, {})).not.toThrow();
    expect(() => advanceInventoryWriterProtocol({ stock: 2, serverReservedStockFloorV1: null }, { stock: 1 })).toThrow();
    expect(() => advanceInventoryWriterProtocol(before, { inventoryReservations: [] })).toThrow();
    expect(() => advanceInventoryWriterProtocol(before, { serverReservedStockFloorV1: null })).toThrow();
    expect(() => advanceInventoryWriterProtocol(before, { serverReservedStockFloorV1: 0 })).toThrow();
    expect(() => protectInventoryWriterPatch(before, { serverReservedStockFloorV1: 0 }, ['stock'])).toThrow();
    expect(() => advanceInventoryWriterProtocol({ stock: 5 }, { serverReservedStockFloorV1: 4, fullReservationRows: [row], inventoryReservations: [row] })).not.toThrow();
    expect(() => advanceInventoryWriterProtocol({ stock: 3 }, { serverReservedStockFloorV1: 4, fullReservationRows: [row], inventoryReservations: [row] })).toThrow();
    expect(advanceInventoryWriterProtocol({ stock: 5 }, { stock: 3 })).toEqual({ stock: 3, inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 1 });
  });
});
