import React, {useState,useEffect} from 'react';
import type {CompanyId} from '../../../shared/types';
import {appConfirm} from '../../../shared/components/appDialog';
import ModalShell from '../../../shared/components/ModalShell';

type CleanupService = typeof import('../../../shared/services/partnerItemCleanupCommands');

const resultAdvice = (status: string) => status === 'applied' ? ' 연결 정리가 완료됐습니다. 창을 닫고 목록을 확인하세요.' : status === 'discarded' ? ' 요청 중단이 확인됐습니다. 필요하면 연결 상태를 다시 확인하세요.' : status === 'unknown' ? ' 아직 처리 여부를 확인하지 못했습니다. 보관 요청에서 처리 결과 확인을 누르세요. 새 삭제 요청은 만들지 마세요.' : status === 'rejected' ? ' 거절된 요청입니다. 보관 요청의 미처리 요청 중단으로 정리한 뒤 연결 상태를 다시 확인하세요.' : '';

export function PartnerItemCleanupDialog(props: { companyId: CompanyId; initialLinkId: string | null; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [service, setService] = useState<CleanupService | null>(null), [uid, setUid] = useState('');
  useEffect(() => { let live = true, stop = () => {}; void import('../../../shared/services/partnerItemCleanupCommands').then(module => { if (!live) return; setService(module); stop = module.watchPartnerItemCleanupActor(value => { if (live) setUid(value); }); }); return () => { live = false; stop(); }; }, []);
  if (!service || !uid) return <ModalShell title="품목 연결 확인·정리" onClose={props.onClose}><p>현재 회사의 관리자 로그인 상태를 확인하세요.</p></ModalShell>;
  return <PartnerItemCleanupBody key={uid} {...props} service={service} uid={uid} />;
}

function PartnerItemCleanupBody({ companyId, initialLinkId, onClose, onChanged, service, uid }: { companyId: CompanyId; initialLinkId: string | null; onClose: () => void; onChanged: () => void | Promise<void>; service: CleanupService; uid: string }) {
  const scope = { companyId, actorUid: uid };
  const [linkId, setLinkId] = useState(initialLinkId), [preview, setPreview] = useState<import('../../../shared/services/partnerItemCleanupCommands').PartnerItemCleanupReadDTO | null>(null);
  const [reason, setReason] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [attempts, setAttempts] = useState(() => service.listPartnerItemCleanupAttempts(scope));
  const live = React.useRef(true), token = React.useRef({}), busyToken = React.useRef<object | null>(null), previewGeneration = React.useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = () => { if (live.current) setAttempts(service.listPartnerItemCleanupAttempts(scope)); };
  async function select(next: string) {
    if (reason && !await appConfirm('입력 중인 사유를 저장하지 않고 다른 연결을 선택합니까?')) return;
    token.current = {}; busyToken.current = null; previewGeneration.current++; setBusy(false); setLinkId(next); setPreview(null); setReason(''); setMessage(''); refresh();
  }
  async function run(work: (current: () => boolean) => Promise<void>) {
    const captured = token.current; if (busyToken.current === captured) return;
    const current = () => live.current && token.current === captured;
    busyToken.current = captured; setBusy(true); setMessage('');
    try { await work(current); } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : '처리하지 못했습니다. 최초 요청을 보존했습니다.'); }
    finally { if (current()) { busyToken.current = null; setBusy(false); refresh(); } }
  }
  async function inspect() { if (!linkId) return; await run(async current => { const generation = ++previewGeneration.current; const row = await service.previewPartnerItemCleanup(scope, linkId, current); if (current() && generation === previewGeneration.current) { setPreview(row); setMessage(row.message); } }); }
  async function close() { if (reason && !await appConfirm('저장하지 않은 정리 사유가 있습니다. 창을 닫습니까? 전송한 최초 요청은 보관됩니다.')) return; live.current = false; token.current = {}; onClose(); }
  const samePending = attempts.filter(a => a.reference?.linkId === linkId);
  const canDelete = preview?.state === 'missing-item' && !!preview.expectedVersion && !!preview.releaseId;
  async function remove() {
    if (!preview || !canDelete || !linkId || samePending.length) return;
    await run(async current => {
      if (!reason.trim()) throw Error('이 연결을 정리할 사유를 입력하세요.');
      if (!await appConfirm(`연결 ${linkId} 한 건만 삭제합니까?\n품목 ${preview.itemId ?? '확인 불가'} · 거래처 ${preview.partnerId ?? '확인 불가'} · ${preview.direction === 'in' ? '매입' : '매출'}\n사유 ${reason}\n품목·거래처 자체는 삭제하지 않으며 삭제 성공 후 되돌리기는 제공하지 않습니다.`)) return;
      if (!current()) return;
      const result = await service.applyPartnerItemCleanup(scope, { version: 1, companyId, linkId, operationId: crypto.randomUUID(), releaseId: preview.releaseId!, expectedVersion: preview.expectedVersion!, reason }, current);
      if (!current()) return; setMessage(result.message + resultAdvice(result.status)); setPreview(null);
      if (result.status === 'applied') { setReason(''); await onChanged(); }
    });
  }
  return <ModalShell title="품목 연결 확인·정리" onClose={() => void close()}>
    <div className="space-y-4 text-sm [&_button]:min-h-10 [&_button]:rounded [&_button]:border [&_button]:border-gray-300 [&_button]:px-3 [&_button:disabled]:opacity-40">
      <p>회사 {companyId === 'taebaek' ? '태백' : '풍회'} · 선택 연결 {linkId ?? '미선택'}</p>
      <p>먼저 연결 상태를 확인하세요. 품목이 서버에 없는 것으로 확인된 연결만 정리할 수 있습니다. 보관된 품목이나 확인되지 않은 자료는 유지합니다.</p>
      {message && <p role="status" className="whitespace-pre-wrap border-y border-gray-200 py-3">{message}</p>}
      {linkId && <button type="button" disabled={busy || samePending.length > 0} onClick={() => void inspect()}>연결 상태 확인</button>}
      {samePending.length > 0 && <p>이 연결의 이전 요청을 먼저 확인하거나 미처리 요청을 중단하세요. 다른 연결은 계속 확인할 수 있습니다.</p>}
      {preview && <div className="space-y-2 border-t border-gray-200 pt-3"><p>서버 확인: {preview.state === 'missing-item' ? '품목 부재 확인' : preview.state === 'archived' ? '보관된 품목 · 정리 불가' : preview.state === 'active' ? '현재 품목 존재 · 정리 불가' : preview.state === 'missing-link' ? '연결 부재 · 새 삭제 불필요' : '자료 미확인 · 정리 불가'}</p><p>{preview.state === 'missing-item' ? '품목을 더 이상 쓰지 않는 연결이 맞으면 사유를 적고 아래에서 연결 한 건을 삭제하세요.' : preview.state === 'active' ? '품목이 남아 있습니다. 창을 닫고 품목 관리에서 거래처 연결을 확인하세요.' : preview.state === 'archived' ? '보관된 품목의 연결입니다. 품목 관리에서 보관 상태를 확인하세요.' : preview.state === 'missing-link' ? '연결이 이미 없습니다. 창을 닫고 목록을 새로 확인하세요.' : '확인되지 않아 삭제할 수 없습니다. 잠시 후 연결 상태를 다시 확인하세요.'}</p><details><summary>연결 번호 자세히</summary><p>품목 ID {preview.itemId ?? '미확인'} · 거래처 ID {preview.partnerId ?? '미확인'} · 방향 {preview.direction === 'in' ? '매입' : preview.direction === 'out' ? '매출' : '미확인'}</p></details><label className="block">정리 사유<input aria-label="연결 정리 사유" value={reason} disabled={busy} maxLength={500} onChange={e => setReason(e.target.value)} className="mt-1 block w-full border border-gray-300 p-2" /></label><button type="button" disabled={busy || !canDelete || samePending.length > 0} onClick={() => void remove()}>확인한 연결 한 건 삭제</button></div>}
      <section className="space-y-2 border-t border-gray-200 pt-3"><h4 className="font-bold">보관 요청·응답 유실 복구</h4><p>처리 여부를 모르는 요청은 먼저 ‘처리 결과 확인’을 누르세요. 같은 요청을 다시 보내려면 ‘같은 내용으로 재시도’, 진행을 그만두려면 ‘미처리 요청 중단’을 선택하세요. 중단도 서버 확인 뒤 확정됩니다.</p>{attempts.length === 0 && <p>보관 요청 없음</p>}{attempts.map(a => <div key={a.key} className="space-y-2 border-t border-gray-200 py-3"><p>연결 {a.reference?.linkId ?? '확인 불가'} · 요청 {a.reference?.operationId ?? '확인 불가'}</p>{a.error && <p>{a.error}</p>}{a.reference && <button type="button" onClick={() => void select(a.reference!.linkId)}>이 연결 선택</button>}<div className="flex flex-wrap gap-2">{a.reference && (['inspect-request', 'apply', 'discard-request'] as const).filter(mode => mode !== 'apply' || !!a.request).map(mode => <button type="button" key={mode} disabled={busy && a.reference?.linkId === linkId} onClick={() => void (async () => { if (linkId !== a.reference!.linkId) { await select(a.reference!.linkId); return; } await run(async current => { if (mode === 'discard-request' && !await appConfirm('미처리 요청을 중단합니까? 이미 삭제된 연결은 처리 결과만 표시합니다.')) return; const result = await service.recoverPartnerItemCleanup(scope, a, mode, current); if (!current()) return; setMessage(result.message + resultAdvice(result.status)); setPreview(null); if (result.status === 'applied') await onChanged(); }); })()}>{mode === 'inspect-request' ? '처리 결과 확인' : mode === 'apply' ? '같은 내용으로 재시도' : '미처리 요청 중단'}</button>)}</div><details><summary>보낸 내용 펼치기</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{a.text}</pre></details></div>)}</section>
    </div>
  </ModalShell>;
}
