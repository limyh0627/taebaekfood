import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../shared/firebase';
import type { StatementWrite } from '../../statements/domain/statementWrites';
import { companyScopedWriteData } from '../../../shared/services/firebaseService';

export async function applyTaxIssueWrites(writes: readonly StatementWrite[]): Promise<'applied' | 'duplicate'> {
  const scopedWrites = await Promise.all(writes.map(async write => ({
    ...write,
    data: await companyScopedWriteData(write.collection, write.data),
  })));
  return runTransaction(db, async tx => {
    const records = scopedWrites.filter(write => write.collection === 'taxIssueRecords');
    const existing = await Promise.all(records.map(write => tx.get(doc(db, write.collection, write.id))));
    if (records.length && existing.every(snapshot => snapshot.exists())) return 'duplicate';
    if (existing.some(snapshot => snapshot.exists())) throw new Error('세금계산서 발행 기록이 일부만 존재합니다. 확인이 필요합니다.');
    for (const write of scopedWrites) tx.set(doc(db, write.collection, write.id), write.data, { merge: write.merge });
    return 'applied';
  });
}
