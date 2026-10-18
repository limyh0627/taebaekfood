import { expect, it, vi } from 'vitest';
import { OrderStatus, type Order, type OrderItem } from '../../../shared/types';
import { saveOrderEdit, type OrderEditDraft, type OrderEditPorts } from './orderEditService';
const line = (patch: Partial<OrderItem> = {}): OrderItem => ({
  itemId: 'oil',
  lineId: 'line',
  name: '기름',
  quantity: 1,
  price: 100,
  ...patch
});
const order = (patch: Partial<Order> = {}): Order => ({
  id: 'order',
  companyId: 'taebaek',
  partnerName: '거래처',
  items: [line()],
  totalAmount: 100,
  status: OrderStatus.PENDING,
  createdAt: '2026-10-18',
  deliveryDate: '2026-10-18T03:00:00Z',
  email: '',
  source: '일반',
  ...patch
});
const draft = (patch: Partial<OrderEditDraft> = {}): OrderEditDraft => ({
  deliveryDate: '2026-10-18T00:00:00Z',
  items: [line({
    quantity: 2
  })],
  note: '비고',
  noteImportant: true,
  ...patch
});
const harness = (opening = order()) => {
  const ports: OrderEditPorts = {
    isCurrent: () => true,
    confirm: vi.fn(async () => true),
    submit: vi.fn(async () => ({
      status: 'saved' as const
    }))
  };
  return {
    opening,
    ports,
    save: (value = draft()) => saveOrderEdit({
      order: opening,
      companyId: 'taebaek',
      actorUid: 'actor',
      actorName: '직원',
      edit: {
        kind: 'draft',
        draft: value
      }
    }, ports)
  };
};
it.each([[], [line({
  itemId: ''
})], [line({
  quantity: 0
})], [line({
  quantity: -1
})], [line({
  quantity: NaN
})], [line({
  isBoxUnit: true,
  boxQuantity: 0
})]].map(items => ({
  items
})))('전체 초안의 잘못된 품목 수량을 전송 전에 거절한다', async ({
  items
}) => {
  const h = harness();
  expect((await h.save(draft({
    items
  }))).status).toBe('rejected');
  expect(h.ports.submit).not.toHaveBeenCalled();
});
it('인라인 빈 목록·0·음수 정책은 보존한다', async () => {
  for (const items of [[], [line({
    quantity: 0
  })], [line({
    quantity: -1
  })]]) {
    const h = harness();
    expect((await saveOrderEdit({
      order: h.opening,
      companyId: 'taebaek',
      actorUid: 'actor',
      actorName: '직원',
      edit: {
        kind: 'items',
        items
      }
    }, h.ports)).status).toBe('saved');
  }
});
it('최초 주문과 원래 날짜·박스 수량을 그대로 보내고 클라이언트 파생 patch를 만들지 않는다', async () => {
  const h = harness(),
    value = draft({
      items: [line({
        quantity: 24,
        isBoxUnit: true,
        boxQuantity: 2,
        unitsPerBox: 12
      })]
    });
  await h.save(value);
  expect(h.ports.submit).toHaveBeenCalledWith(h.opening, {
    kind: 'draft',
    draft: value
  }, false);
  expect(vi.mocked(h.ports.submit).mock.calls[0][0]).toBe(h.opening);
});
it.each(['2026-02-30', '2026-13-01'])('잘못된 날짜 %s는 전송하지 않는다', async date => {
  const h = harness();
  expect((await h.save(draft({
    deliveryDate: date
  }))).status).toBe('rejected');
  expect(h.ports.submit).not.toHaveBeenCalled();
});
it('완료 주문 새 품목 추가 확인을 받은 경우에만 동의 값을 보낸다', async () => {
  const h = harness(order({
      status: OrderStatus.DISPATCHED,
      itemInventory: {}
    })),
    value = draft({
      items: [line(), line({
        itemId: 'new',
        lineId: 'new'
      })]
    });
  await h.save(value);
  expect(h.ports.confirm).toHaveBeenCalledOnce();
  expect(h.ports.submit).toHaveBeenCalledWith(h.opening, {
    kind: 'draft',
    draft: value
  }, true);
});
it('추가 확인 취소·예외·확인 중 회사 전환은 업무를 전송하지 않는다', async () => {
  for (const mode of ['cancel', 'error', 'scope']) {
    const h = harness(order({
      status: OrderStatus.DISPATCHED,
      itemInventory: {}
    }));
    h.ports.confirm = async () => {
      if (mode === 'error') throw Error();
      if (mode === 'scope') h.ports.isCurrent = () => false;
      return mode !== 'cancel';
    };
    expect((await h.save(draft({
      items: [line(), line({
        itemId: 'new',
        lineId: 'new'
      })]
    }))).status).toBe(mode === 'error' ? 'rejected' : 'cancelled');
    expect(h.ports.submit).not.toHaveBeenCalled();
  }
});
it('서버 CAS 거절과 unknown을 그대로 반환하고 후속 이력을 별도 전송하지 않는다', async () => {
  const h = harness();
  h.ports.submit = vi.fn(async () => ({
    status: 'rejected' as const,
    message: '원문 변경'
  }));
  expect(await h.save()).toEqual({
    status: 'rejected',
    message: '원문 변경'
  });
  expect(h.ports.submit).toHaveBeenCalledOnce();
  h.ports.submit = vi.fn(async () => {
    throw Error('network');
  });
  expect((await h.save()).status).toBe('unknown');
  expect(h.ports.submit).toHaveBeenCalledOnce();
});
it('완료 재고가 적용된 줄의 수량은 비고와 함께 바꾸지 못한다', async () => {
  const h = harness(order({
    status: OrderStatus.DISPATCHED,
    items: [line({
      checked: true
    })],
    itemInventory: {
      line: {
        version: 1,
        lineId: 'line',
        itemId: 'oil',
        applied: true,
        attempt: 1,
        rawConsumedLots: [],
        autoBuilt: [],
        producedUnits: [],
        production: {
          capturedAt: '2026-10-18',
          stockDeltas: [],
          bomLines: []
        }
      }
    }
  }));
  expect((await h.save(draft({
    items: [line({
      checked: true,
      quantity: 2
    })]
  }))).status).toBe('rejected');
  expect(h.ports.submit).not.toHaveBeenCalled();
});
