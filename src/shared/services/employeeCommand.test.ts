import { buildBomIndex } from '../bomIndex';
import { buildPackIndex } from '../packIndex';
import { beforeEach, expect, it, vi } from 'vitest';
import { withClaimCompany } from '../companyWriteBoundary';
import { executeEmployeeCommand } from './employeeCommand';

const mocks = vi.hoisted(() => ({ add: vi.fn(), receive: vi.fn() }));
vi.mock('./firebaseService', () => ({
  addItem: mocks.add,
  confirmUnitPurchaseOrderReceipt: mocks.receive,
  companyScopedWriteData: async (collection: any, data: any) => withClaimCompany(collection, data, { companyId: 'taebaek' }),
}));
beforeEach(() => vi.clearAllMocks());

it('주문·발주·반품 모두 회사 claim을 쓰고 이미 환산된 박스 수량을 다시 곱하지 않는다', async () => {
  for (const collection of ['orders', 'purchaseOrders', 'returnRequests'] as const) {
    await executeEmployeeCommand({ kind: 'create', collection, data: {
      partnerId: 'p', items: [{ itemId: 'i', quantity: 24, boxQuantity: 2, unitsPerBox: 12 }],
    } });
    expect(mocks.add).toHaveBeenLastCalledWith(collection, expect.objectContaining({ companyId: 'taebaek',
      items: [expect.objectContaining({ itemId: 'i', quantity: 24, boxQuantity: 2 })],
    }));
  }
});

it('단건 발주도 동일한 경계를 통과하고 잘못된 복수 줄은 한 줄도 저장하지 않는다', async () => {
  await executeEmployeeCommand({ kind: 'create', collection: 'purchaseOrders', data: { itemId: 'i', quantity: 3 } });
  expect(mocks.add).toHaveBeenCalledTimes(1);
  mocks.add.mockClear();
  for (const quantity of [0, -1, NaN, Infinity, '3']) {
    await expect(executeEmployeeCommand({ kind: 'create', collection: 'purchaseOrders', data: {
      items: [{ itemId: 'good', quantity: 1 }, { itemId: 'bad', quantity }],
    } })).rejects.toThrow('수량');
  }
  expect(mocks.add).not.toHaveBeenCalled();
});

it('다른 회사 위조 요청은 저장하지 않는다', async () => {
  await expect(executeEmployeeCommand({ kind: 'create', collection: 'returnRequests', data: {
    companyId: 'punghoe', partnerId: 'p', items: [{ itemId: 'i', quantity: 1 }],
  } })).rejects.toThrow('다른 회사');
  expect(mocks.add).not.toHaveBeenCalled();
});

it('입고확정은 검증된 원자 입고 명령에 위임한다', async () => {
  mocks.receive.mockResolvedValue(false);
  expect(await executeEmployeeCommand({ kind: 'receive', poId: 'po', actorName: '직원', items: [] })).toBe(false);
  expect(mocks.receive).toHaveBeenCalledWith('po', '직원', []);
  expect(mocks.add).not.toHaveBeenCalled();
});

it('입고확정은 화면의 회사별 계산 입력을 변경 없이 원자 명령에 전달한다', async () => {
  const orderUnitInputs = { bom: buildBomIndex([], []), pack: buildPackIndex() };
  mocks.receive.mockRejectedValue(new Error('입고 실패'));
  await expect(executeEmployeeCommand({ kind: 'receive', poId: 'po', actorName: '관리자', items: [], orderUnitInputs })).rejects.toThrow('입고 실패');
  expect(mocks.receive).toHaveBeenCalledWith('po', '관리자', [], orderUnitInputs);
  expect(mocks.add).not.toHaveBeenCalled();
});
