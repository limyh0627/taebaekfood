import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../shared/firebase';
import type { CompanyId } from '../../shared/types';

/** 생산작업기록부 제목의 회사별 조회. 제목 저장은 호출자의 기존 writer를 사용한다. */
export function useDocSheetTitles(companyId: CompanyId) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    setTitles({});
    getDocs(query(collection(db, 'docSheetTitles'), where('companyId', '==', companyId)))
      .then(snapshot => {
        if (cancelled) return;
        setTitles(Object.fromEntries(snapshot.docs.map(row => [row.id, (row.data() as { title?: string }).title ?? ''])));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [companyId]);
  return [titles, setTitles] as const;
}
