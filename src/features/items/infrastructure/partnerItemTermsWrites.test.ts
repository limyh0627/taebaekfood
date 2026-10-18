import { expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
vi.mock('../../../shared/firebase', () => ({
  auth: {},
  authReady: Promise.resolve(),
  functions: {}
}));
import { createPartnerItemTermsWriter, type PartnerItemTermsInput, type PartnerItemTermsScope, type PartnerItemTermsWritePort } from './partnerItemTermsWrites';
import { partnerItemTermsExpected, serializePartnerItemTermsNotice, serializePartnerItemTermsRequest, type PartnerItemTermsCommand, type PartnerItemTermsReference } from '../../../shared/partnerItemTermsCommand';
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true
});
const scope: PartnerItemTermsScope = {
  companyId: 'taebaek',
  actorUid: 'actor'
};
const input: PartnerItemTermsInput = {
  target: {
    itemId: 'box',
    partnerId: 'partner',
    direction: 'out',
    existingLinkId: 'actual-link',
    opening: {
      id: 'actual-link',
      itemId: 'box',
      partnerId: 'partner',
      Direction: 'out',
      price: 100
    }
  },
  terms: {
    price: 0,
    taxType: null
  }
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const reference = {
  companyId: 'taebaek' as const,
  planId: 'fixed-plan',
  targetId: 'actual-link',
  itemId: 'box',
  partnerId: 'partner',
  direction: 'out' as const
};
function fixture(withNotice = false) {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    }
  };
  let savedHash = '';
  const command = vi.fn(async (command: PartnerItemTermsCommand): Promise<unknown> => {
    if (command.mode === 'preview') {
      const expected = partnerItemTermsExpected({
        companyId: 'taebaek',
        ...input.target.opening
      });
      const evidence = {
        schemaVersion: 1 as const,
        queries: [],
        documents: []
      };
      const notices = withNotice ? [{
        itemId: 'box',
        itemName: '박스',
        childId: 'loose',
        childName: '낱개',
        count: 10
      }] : [];
      return {
        version: 1,
        ...reference,
        expected,
        evidence,
        notices,
        ...(notices.length ? {
          noticeHash: sha(serializePartnerItemTermsNotice(reference, expected, command.input.terms, evidence, notices))
        } : {})
      };
    }
    if (command.mode === 'apply') savedHash = sha(serializePartnerItemTermsRequest(command.request));
    return {
      ...reference,
      actorUid: scope.actorUid,
      requestHash: command.mode === 'cancel' ? null : savedHash,
      status: command.mode === 'cancel' ? 'cancelled' : command.mode === 'inspect' ? 'duplicate' : 'applied',
      message: '실제 ACK'
    };
  });
  const port: PartnerItemTermsWritePort = {
    storage,
    command,
    id: () => 'fixed-plan',
    assertScope: vi.fn(async () => {}),
    exclusive: async (_scope, _identity, work) => work()
  };
  return {
    data,
    storage,
    command,
    port,
    service: createPartnerItemTermsWriter(port)
  };
}
it('좁은 미리보기·안내가 끝나고 정규화 원문 readback을 확인한 뒤에만 저장한다', async () => {
  const f = fixture(true);
  const notice = vi.fn(async () => {
    expect(f.command.mock.calls.map(call => call[0].mode)).toEqual(['preview']);
    expect(f.data.size).toBe(0);
  });
  expect((await f.service.submit(scope, input, notice)).status).toBe('saved');
  expect(notice).toHaveBeenCalledWith(expect.stringContaining('낱개'));
  const apply = f.command.mock.calls[1][0];
  expect(apply.mode).toBe('apply');
  if (apply.mode === 'apply') expect(apply.request.terms).toEqual({
    price: 0,
    taxType: null
  });
  expect(f.data.size).toBe(0);
});
it('안내 대기 중 회사·UID 세대가 바뀌면 apply와 영속 저장은 모두0이다', async () => {
  const f = fixture(true);
  let current = true;
  const result = await f.service.submit(scope, input, async () => {
    current = false;
  }, () => current);
  expect(result.status).toBe('rejected');
  expect(f.command.mock.calls.map(call => call[0].mode)).toEqual(['preview']);
  expect(f.data.size).toBe(0);
});
it('첫 await 중 caller 입력이 바뀌어도 최초 선택 원문과 0원 입력을 보존한다', async () => {
  const f = fixture();
  let finish!: () => void;
  f.port.assertScope = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => {
    finish = resolve;
  })).mockResolvedValue(undefined);
  const draft = {
    target: {
      ...input.target,
      opening: {
        ...input.target.opening!
      }
    },
    terms: {
      price: 0
    }
  };
  const task = f.service.submit(scope, draft, async () => {});
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  draft.terms.price = 999;
  draft.target.opening.price = 999;
  finish();
  expect((await task).status).toBe('saved');
  const preview = f.command.mock.calls[0][0];
  expect(preview.mode).toBe('preview');
  if (preview.mode === 'preview') expect(preview.input.terms.price).toBe(0);
});
it('저장소 readback 실패면 업무 송신0이고 남은 원문은 보존한다', async () => {
  const f = fixture();
  const get = f.storage.getItem;
  f.port.storage.getItem = key => f.data.size ? '손상' : get(key);
  expect((await f.service.submit(scope, input, async () => {})).status).toBe('rejected');
  expect(f.command.mock.calls.map(call => call[0].mode)).toEqual(['preview']);
  expect(f.data.size).toBe(1);
});
it('응답 유실 뒤 같은 요청 조회는 새 미리보기나 apply를 보내지 않는다', async () => {
  const f = fixture(),
    original = f.command.getMockImplementation()!;
  f.command.mockImplementation(async command => {
    const value = await original(command);
    if (command.mode === 'apply') throw Error('응답 유실');
    return value;
  });
  expect((await f.service.submit(scope, input, async () => {})).status).toBe('unknown');
  expect(f.data.size).toBe(1);
  f.command.mockImplementation(original);
  expect((await f.service.run(scope, reference, 'inspect')).status).toBe('saved');
  expect(f.command.mock.calls.map(call => call[0].mode)).toEqual(['preview', 'apply', 'inspect']);
  expect(f.data.size).toBe(0);
});
it('key본문 바꿔치기와 해시 손상은 원문을 보존하고 reference-only 중단만 허용한다', async () => {
  for (const mutation of ['body', 'hash']) {
    const f = fixture();
    await f.service.prepare(scope, input, async () => {});
    const [key, text] = [...f.data][0];
    f.data.set(key, mutation === 'body' ? text.replace('actual-link', 'other-link') : text.replace('"price":0', '"price":999'));
    if (mutation === 'body') {
      expect(f.service.references(scope)[0].readable).toBe(false);
      expect(() => f.service.read(scope, reference)).toThrow('저장 위치');
    }
    expect((await f.service.run(scope, reference, 'apply')).status).toBe('unknown');
    expect(f.command).toHaveBeenCalledTimes(1);
    expect((await f.service.run(scope, reference, 'cancel')).status).toBe('cancelled');
    expect(f.command.mock.lastCall?.[0]).toEqual({
      mode: 'cancel',
      reference
    });
  }
});
it('다른 거래조건 손상은 정상 대상의 준비를 전역 차단하지 않는다', async () => {
  const f = fixture();
  f.data.set('tb_partner_item_terms_v1:taebaek:actor:bad', '{');
  await expect(f.service.prepare(scope, input, async () => {})).resolves.toMatchObject({
    request: {
      targetId: 'actual-link'
    }
  });
});
it('미리보기 scope·안내 hash가 다르면 apply하지 않고 결과 UID/hash 불일치도 성공 처리하지 않는다', async () => {
  for (const field of ['companyId', 'noticeHash']) {
    const f = fixture(true),
      original = f.command.getMockImplementation()!;
    f.command.mockImplementation(async command => ({
      ...((await original(command)) as Record<string, unknown>),
      [field]: field === 'companyId' ? 'punghoe' : 'f'.repeat(64)
    }));
    expect((await f.service.submit(scope, input, async () => {})).status).toBe('rejected');
    expect(f.command).toHaveBeenCalledOnce();
  }
  const f = fixture(),
    original = f.command.getMockImplementation()!;
  f.command.mockImplementation(async command => command.mode === 'apply' ? {
    ...((await original(command)) as Record<string, unknown>),
    actorUid: 'other'
  } : original(command));
  expect((await f.service.submit(scope, input, async () => {})).status).toBe('unknown');
  expect(f.data.size).toBe(1);
});
it('서버 종결 거절은 새로 열기 태그와 원인을 유지하며 cleanup 실패 ACK는 부분결과로 구별한다', async () => {
  const f = fixture(),
    original = f.command.getMockImplementation()!;
  f.command.mockImplementation(async command => command.mode === 'apply' ? {
    ...((await original(command)) as Record<string, unknown>),
    status: 'rejected',
    message: '원문 충돌'
  } : original(command));
  expect(await f.service.submit(scope, input, async () => {})).toMatchObject({
    status: 'rejected',
    requiresReopen: true,
    message: '원문 충돌'
  });
  const saved = fixture();
  saved.port.storage.removeItem = () => {
    throw Error('정리 실패');
  };
  expect(await saved.service.submit(scope, input, async () => {})).toMatchObject({
    status: 'partial',
    committedIds: ['actual-link'],
    unconfirmedIds: []
  });
});
it('호출자가 명시 undefined를 정본에서 제거한 최종 terms에는 옛 값을 다시 보충하지 않는다', async () => {
  const {
    termsFromOpening
  } = await import('../../../shared/partnerItemTermsCommand');
  const f = fixture();
  const row = {
    ...input.target.opening!,
    price: 1200,
    taxType: '면세' as const,
    Account_Code: '404'
  };
  const terms = termsFromOpening({
    ...row
  }, {
    price: 0,
    taxType: undefined,
    Account_Code: undefined
  });
  expect(terms).toEqual({
    price: 0
  });
  expect((await f.service.submit(scope, {
    target: {
      ...input.target,
      opening: row
    },
    terms
  }, async () => {})).status).toBe('saved');
  const preview = f.command.mock.calls[0][0],
    apply = f.command.mock.calls[1][0];
  if (preview.mode !== 'preview' || apply.mode !== 'apply') throw Error('실제 preview/apply 경로가 아닙니다.');
  expect(preview.input.terms).toEqual({
    price: 0
  });
  expect(apply.request.terms).toEqual({
    price: 0
  });
});
