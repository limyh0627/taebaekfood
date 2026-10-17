import React from 'react';
import type {Props} from '../../src/features/statements/domain/cashEntryModal';
import {SettleBody} from '../../src/features/statements/ui/CashSettleBody';
import {EditBody} from '../../src/features/statements/ui/CashEditBody';
export type {CashModalMode,SettleInput} from '../../src/features/statements/domain/cashEntryModal';

/**
 * **자금 전표 하나를 세우거나 고치는 창.**
 *
 * 수금·지불은 따로 있는 게 아니라 **입금·출금 그 자체**다.
 *   수금 = 입금  (차) 103 통장 / (대) 108 외상매출금
 *   지불 = 출금  (차) 251 외상매입금 / (대) 103 통장
 * 다른 건 둘뿐이다 — 상대계정이 108·251로 **정해져 있고**, 어느 전표를 갚은 것인지
 * 상계(settlement)로 붙는다. 그래서 창을 둘로 나누지 않았다. 나누면 같은 것을 두 번
 * 만들게 되고, 한쪽만 고쳐진 채로 갈린다.
 *
 * 두 갈래로 연다:
 *   `수금지불` — 전표에서 열었다. 금액·상대계정이 그 전표에서 나온다.
 *   `수정`     — 이미 난 자금 전표를 고친다. 쪼갠 줄과 삭제가 붙는다.
 *
 * 돈을 실제로 옮기는 일(상계를 붙이고 분개를 만드는 일)은 여기서 안 한다 —
 * `onSettle`·`onSaveEdit`로 넘긴다. 이 창은 **무엇을 입력받았는지**까지만 안다.
 */
/**
 * 이 창은 **열 때마다 새로 마운트한다**(부르는 쪽이 `key`를 준다).
 * 그래야 초기값을 props에서 한 번만 읽으면 되고, 열 때마다 폼을 되씻는 effect가 필요 없다.
 */
export default function CashEntryModal(p: Props) {
  return p.mode.kind === '수금지불'
    ? <SettleBody {...p} stmt={p.mode.stmt} />
    : <EditBody {...p} entry={p.mode.entry} />;
}
