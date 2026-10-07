/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductionWorkDocumentHost from './ProductionWorkDocumentHost';
import { newProductionWorkDocument } from '../domain/productionWorkDocument';
const mocks=vi.hoisted(()=>({load:vi.fn(),evidence:vi.fn(),save:vi.fn(),notice:vi.fn()}));
vi.mock('../infrastructure/productionWorkDocumentRepository',()=>({loadProductionWorkDocument:mocks.load,loadProductionWorkEvidence:mocks.evidence,saveProductionWorkDocument:mocks.save}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:vi.fn().mockResolvedValue(true),appNotice:mocks.notice}));
const result=(company:'taebaek'|'punghoe',date='2026-10-07')=>({document:newProductionWorkDocument(company,date,'actor','2026-10-07T01:00:00Z'),lines:[]});
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
beforeEach(()=>{vi.clearAllMocks();mocks.load.mockReset();mocks.evidence.mockReset();mocks.save.mockReset();mocks.notice.mockResolvedValue(undefined);});
describe('생산 문서 회사·날짜 세션',()=>{
 it('회사 변경 뒤 이전 초기 조회가 새 초안을 덮지 않는다',async()=>{
  const old=deferred<ReturnType<typeof result>>();mocks.load.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('punghoe'));
  const view=render(<ProductionWorkDocumentHost companyId="taebaek" date="2026-10-07" actorId="actor"/>);
  view.rerender(<ProductionWorkDocumentHost companyId="punghoe" date="2026-10-07" actorId="actor"/>);
  await screen.findByLabelText('특이사항');fireEvent.change(screen.getByLabelText('특이사항'),{target:{value:'풍회 초안'}});
  await act(async()=>{old.resolve(result('taebaek'));await old.promise;});expect((screen.getByLabelText('특이사항') as HTMLTextAreaElement).value).toBe('풍회 초안');
 });
 it('회사 변경 뒤 늦은 저장 실패는 새 회사에 안내하지 않는다',async()=>{
  const old=deferred<any>();mocks.load.mockResolvedValueOnce(result('taebaek')).mockResolvedValueOnce(result('punghoe'));mocks.save.mockReturnValueOnce(old.promise);
  const view=render(<ProductionWorkDocumentHost companyId="taebaek" date="2026-10-07" actorId="actor"/>);await screen.findByLabelText('특이사항');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledOnce());
  view.rerender(<ProductionWorkDocumentHost companyId="punghoe" date="2026-10-07" actorId="actor"/>);await screen.findByLabelText('특이사항');await act(async()=>{old.reject(new Error('태백 늦은 실패'));await old.promise.catch(()=>{});});expect(mocks.notice).not.toHaveBeenCalled();
 });
 it('같은 회사의 날짜 변경은 새 초안을 열고 이전 근거 결과를 버린다',async()=>{
  const old=deferred<any[]>();mocks.load.mockResolvedValueOnce(result('taebaek')).mockResolvedValueOnce(result('taebaek','2026-10-08'));mocks.evidence.mockReturnValueOnce(old.promise);
  const view=render(<ProductionWorkDocumentHost companyId="taebaek" date="2026-10-07" actorId="actor"/>);await screen.findByLabelText('특이사항');fireEvent.click(screen.getByRole('button',{name:'실제 근거 불러오기'}));
  view.rerender(<ProductionWorkDocumentHost companyId="taebaek" date="2026-10-08" actorId="actor"/>);await screen.findByLabelText('특이사항');fireEvent.change(screen.getByLabelText('특이사항'),{target:{value:'새 날짜 초안'}});
  await act(async()=>{old.resolve([]);await old.promise;});expect((screen.getByLabelText('특이사항') as HTMLTextAreaElement).value).toBe('새 날짜 초안');expect(screen.getByRole('status').textContent).toContain('저장하지 않은 변경 있음');
 });
});
