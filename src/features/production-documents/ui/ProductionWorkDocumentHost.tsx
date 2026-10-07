import React, { useEffect, useState } from 'react';
import type { CompanyId } from '../../../shared/types';
import ProductionWorkDocumentEditor from './ProductionWorkDocumentEditor';
import { loadProductionWorkDocument, loadProductionWorkEvidence, saveProductionWorkDocument } from '../infrastructure/productionWorkDocumentRepository';
// 이 진입점을 AdminApp 생산 작업일지 분기에 연결한다. 날짜 선택 UI와 기존 다른 서류는 보존한다.
export default function ProductionWorkDocumentHost(props: { companyId: CompanyId; date: string; actorId: string }) {
  return <Session key={JSON.stringify([props.companyId, props.date, props.actorId])} {...props} />;
}
function Session({ companyId, date, actorId }: { companyId: CompanyId; date: string; actorId: string }) {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadProductionWorkDocument>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadProductionWorkDocument(companyId, date, actorId).then(value => {
      if (active) setLoaded(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '생산작업일지를 불러오지 못했습니다.');
    });
    return () => { active = false; };
  }, [companyId, date, actorId]);
  if (error) return <p role="alert">{error}</p>;
  if (!loaded) return <p role="status">생산작업일지를 불러오는 중입니다.</p>;
  return <ProductionWorkDocumentEditor initialDocument={loaded.document} initialLines={loaded.lines}
    loadEvidence={() => loadProductionWorkEvidence(companyId, date)} onSave={saveProductionWorkDocument} />;
}
