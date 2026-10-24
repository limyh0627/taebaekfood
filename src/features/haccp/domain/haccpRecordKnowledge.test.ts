import { expect, it } from 'vitest';
import { createHaccpRecordKnowledge } from './haccpRecordKnowledge';

it.each(['관측-소실-ACK', '관측-ACK-소실', 'ACK-관측-소실'])('%s는 이미 본 ID의 임시 예외를 허용하지 않는다', order => {
  const knowledge = createHaccpRecordKnowledge();
  for (const event of order.split('-')) {
    if (event === '관측') knowledge.observe(['known']);
    if (event === '소실') knowledge.observe([]);
    if (event === 'ACK') knowledge.rememberAck('known');
  }
  expect(knowledge.allowsUnobservedAck('known')).toBe(false);
});
it('미관측 ACK는 같은 ID만 허용하고 빈 조회·다른 ID 관측은 지우지 않는다', () => {
  const knowledge = createHaccpRecordKnowledge();
  knowledge.rememberAck('new');
  expect(knowledge.allowsUnobservedAck('new')).toBe(true);
  expect(knowledge.allowsUnobservedAck('other')).toBe(false);
  knowledge.observe([]); knowledge.observe(['other']);
  expect(knowledge.allowsUnobservedAck('new')).toBe(true);
  knowledge.observe(['new']);
  expect(knowledge.allowsUnobservedAck('new')).toBe(false);
});
it('선택 해제는 임시 ACK만 지우고 관측 이력을 보존한다', () => {
  const knowledge = createHaccpRecordKnowledge();
  knowledge.observe(['seen']); knowledge.rememberAck('new'); knowledge.clearSelection();
  expect(knowledge.allowsUnobservedAck('new')).toBe(false);
  knowledge.rememberAck('seen'); expect(knowledge.allowsUnobservedAck('seen')).toBe(false);
});
it('새 owner는 이전 관측과 임시 ACK를 상속하지 않는다', () => {
  const knowledge = createHaccpRecordKnowledge();
  knowledge.observe(['seen']); knowledge.rememberAck('new'); knowledge.resetOwner();
  expect(knowledge.allowsUnobservedAck('new')).toBe(false);
  knowledge.rememberAck('seen'); expect(knowledge.allowsUnobservedAck('seen')).toBe(true);
});
it('연속 ACK는 마지막 하나만 보존하고 이미 관측한 ACK는 이전 예외도 종료한다', () => {
  const knowledge = createHaccpRecordKnowledge();
  knowledge.rememberAck('a'); knowledge.rememberAck('b');
  expect(knowledge.allowsUnobservedAck('a')).toBe(false); expect(knowledge.allowsUnobservedAck('b')).toBe(true);
  knowledge.observe(['seen']); knowledge.rememberAck('seen');
  expect(knowledge.allowsUnobservedAck('b')).toBe(false); expect(knowledge.allowsUnobservedAck('seen')).toBe(false);
});
it('빈 ID는 미관측 ACK 예외를 만들지 않는다', () => {
  const knowledge = createHaccpRecordKnowledge();
  knowledge.observe(['', undefined]); knowledge.rememberAck(''); expect(knowledge.allowsUnobservedAck('')).toBe(false);
});
