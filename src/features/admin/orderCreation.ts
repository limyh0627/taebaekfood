export interface OrderCreationIdentity {
  id: string;
  cardNo: string;
}

export interface OrderCreationSession {
  identity: OrderCreationIdentity | null;
  busy: boolean;
}

export interface OrderCreationFollowUp {
  label: string;
  run: (identity: OrderCreationIdentity) => Promise<void>;
}

export type OrderCreationResult =
  | { status: 'busy' }
  | { status: 'saved'; identity: OrderCreationIdentity; failedFollowUps: string[] };

export const newOrderCreationSession = (): OrderCreationSession => ({ identity: null, busy: false });

export const resetOrderCreationSession = (session: OrderCreationSession) => {
  if (session.busy) return;
  session.identity = null;
};

/**
 * 주문 본문은 실패하면 같은 ID로 재시도하고, 성공 뒤 부가 작업은 주문 성공을 뒤집지 않는다.
 * 네트워크가 저장 응답만 잃어도 같은 ID를 다시 쓰므로 새 주문이 한 장 더 생기지 않는다.
 */
export async function submitOrderCreation<T>(
  session: OrderCreationSession,
  order: T,
  deps: {
    createIdentity: () => OrderCreationIdentity;
    saveOrder: (identity: OrderCreationIdentity, order: T) => Promise<void>;
    followUps?: readonly OrderCreationFollowUp[];
  },
): Promise<OrderCreationResult> {
  if (session.busy) return { status: 'busy' };
  session.busy = true;
  const identity = session.identity ?? deps.createIdentity();
  session.identity = identity;

  try {
    await deps.saveOrder(identity, order);
    const settled = await Promise.allSettled((deps.followUps ?? []).map(task => task.run(identity)));
    const failedFollowUps = settled.flatMap((result, index) =>
      result.status === 'rejected' ? [deps.followUps?.[index]?.label ?? `부가 작업 ${index + 1}`] : [],
    );
    session.identity = null;
    return { status: 'saved', identity, failedFollowUps };
  } finally {
    session.busy = false;
  }
}
