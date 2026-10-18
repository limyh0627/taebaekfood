import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
import { prepareItemEditorRelations, confirmItemEditorPurchaseNotices } from './saveItemEditorRelations';
import { itemEditorPurchaseNoticeText, type ItemEditorDraft, type ItemEditorGraphDocuments } from '../../../shared/itemEditorCommand';
import type { ItemEditorOpening } from '../infrastructure/itemEditorWrites';
const graph = (): ItemEditorGraphDocuments => ({
  items: [{
    id: 'box',
    data: {
      id: 'box',
      companyId: 'taebaek',
      name: '박스',
      type: 'box'
    }
  }, {
    id: 'loose',
    data: {
      id: 'loose',
      companyId: 'taebaek',
      name: '낱개',
      type: 'product'
    }
  }],
  boms: [{
    id: 'bom',
    data: {
      id: 'bom',
      companyId: 'taebaek',
      parent_id: 'box',
      child_id: 'loose',
      quantity: 10
    }
  }],
  formulas: [],
  links: [{
    id: 'link',
    data: {
      id: 'link',
      companyId: 'taebaek',
      itemId: 'box',
      partnerId: 'partner',
      Direction: 'in',
      price: 1000,
      taxType: null
    }
  }]
});
const draft: ItemEditorDraft = {
  isNew: false,
  metadata: {
    name: '박스',
    type: 'box'
  },
  inPartnerIds: ['partner'],
  photoChanged: false
};
const opening = (): ItemEditorOpening => ({
  companyId: 'taebaek',
  actorUid: 'actor',
  targetId: 'box',
  target: {
    name: '박스',
    type: 'box'
  },
  targetExpected: null,
  documents: graph(),
  graph: {
    schemaVersion: 1,
    items: {
      count: 2,
      digest: 'a'.repeat(64)
    },
    boms: {
      count: 1,
      digest: 'a'.repeat(64)
    },
    formulas: {
      count: 0,
      digest: 'a'.repeat(64)
    },
    links: {
      count: 1,
      digest: 'a'.repeat(64)
    }
  }
});
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
it('선택 거래처·빈 수율·배합 원문을 복사하고 클라이언트 환산이나 쓰기를 하지 않는다', () => {
  const input = {
    formulaRows: [{
      child_name: '원물',
      yield_pct: 82.5
    }, {
      child_name: '',
      yield_pct: 0
    }],
    inPartnerIds: ['partner'],
    includeFormula: true
  };
  const result = prepareItemEditorRelations(input);
  input.formulaRows[0].yield_pct = 1;
  input.inPartnerIds.push('other');
  expect(result).toEqual({
    formulaRows: [{
      child_name: '원물',
      yield_pct: 82.5
    }, {
      child_name: '',
      yield_pct: 0
    }],
    inPartnerIds: ['partner']
  });
  expect(prepareItemEditorRelations({
    ...input,
    includeFormula: false
  })).not.toHaveProperty('formulaRows');
});
it('박스 낱개 실제 안내 ACK 뒤 동일 정본 원문의 해시만 만든다', async () => {
  const source = opening();
  let finish!: () => void;
  const notice = vi.fn(() => new Promise<void>(r => finish = r));
  let done = false;
  const task = confirmItemEditorPurchaseNotices(source, draft, notice, () => true).then(value => {
    done = true;
    return value;
  });
  expect(done).toBe(false);
  expect(notice).toHaveBeenCalledWith(expect.stringContaining('낱개'));
  finish();
  expect(await task).toBe(createHash('sha256').update(itemEditorPurchaseNoticeText(source.companyId, source.targetId, source.documents, draft)!).digest('hex'));
});
it('안내 대상이 없으면 불필요한 확인을 요구하지 않고 회사 전환이면 확인 근거를 만들지 않는다', async () => {
  const source = opening(),
    notice = vi.fn(async () => {});
  expect(await confirmItemEditorPurchaseNotices(source, {
    ...draft,
    inPartnerIds: []
  }, notice, () => true)).toBeUndefined();
  expect(notice).not.toHaveBeenCalled();
  let current = true;
  notice.mockImplementation(async () => {
    current = false;
  });
  await expect(confirmItemEditorPurchaseNotices(source, draft, notice, () => current)).rejects.toThrow('회사·계정');
});
