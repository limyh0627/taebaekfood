import { expect, it } from 'vitest';
import { createHaccpRecordAcknowledgements } from './haccpRecordAcknowledgements';

interface Record { id?: string; key: string; body: string; revision: number; confirmedBy?: string; confirmedAt?: string }
const row = (id = 'a', key = 'today', body = 'A', revision = 0): Record => ({ id, key, body, revision });
const create = () => createHaccpRecordAcknowledgements<Record>({ getKey: r => r.key, strategy: {kind: 'numeric', getRevision: r => r.revision},
  mergeConfirmed: (base, result) => ({ ...base, confirmedBy: result.confirmedBy, confirmedAt: result.confirmedAt }) });

it('확정ACK의key왕복은ID본문을보존하고읽기조회는현재pending을바꾸지않는다', () => {
  const store = create(); store.observe([], true); store.rememberSave(row());
  expect(store.known('today', true)).toEqual(row()); expect(store.canTarget('save', 'a', 'today')).toBe(true);
  store.select(row('past', 'past'), true); store.known('today', true);
  expect(store.canTarget('save', 'a', 'today')).toBe(false);
  expect(store.select({ ...row(), id: undefined, body: 'default' }, true)).toEqual(row());
  expect(store.canTarget('save', 'a', 'today')).toBe(true);
});

it.each(['관측-소실-ACK', '관측-ACK-소실', 'ACK-관측-소실'])('%s뒤선택왕복에서도미관측예외를부활시키지않는다', order => {
  const store = create();
  for (const event of order.split('-')) {
    if (event === '관측') store.observe([row()], true);
    if (event === '소실') store.observe([], true);
    if (event === 'ACK') store.rememberSave(row());
  }
  store.select(row('past', 'past'), true); store.select(row(), true);
  expect(store.canTarget('save', 'a', 'today')).toBe(false);
});

it('같은ID의다른key이동과다른ID의같은key충돌은자동송신하지않는다', () => {
  const store = create(); store.rememberSave(row()); store.observe([row('a', 'other')], true);
  expect(store.canTarget('confirm', 'a', 'today')).toBe(false);
  store.observe([row('other')], true);
  expect(store.resolve(row(), true)).toEqual(row()); expect(store.canTarget('save', 'a', 'today')).toBe(false);
  expect(store.openServerRecord('today', 'other', true)?.id).toBe('other'); expect(store.resolve(row(), true)?.id).toBe('other');
});

it.each(['높은정본', '낮은정본', '소실', '캐시'])('확인대기중%s에도최신확정본문과dirty확인본문을분리한다', event => {
  const store = create(); store.rememberSave(row()); store.observe([row('a', 'today', 'B', 1)], true);
  const captured = store.captureConfirm('today', 'a');
  if (event === '높은정본') store.observe([row('a', 'today', 'D', 2)], true);
  if (event === '낮은정본') store.observe([row()], true);
  if (event === '소실') store.observe([], true);
  if (event === '캐시') store.observe([row('a', 'today', 'cache', 99)], false);
  store.rememberConfirm({ ...row('a', 'today', 'dirtyC', 1), confirmedBy: '관리자', confirmedAt: 'ACK' }, captured);
  expect(store.known('today', event !== '캐시')).toMatchObject({ body: event === '높은정본' ? 'D' : 'B', revision: event === '높은정본' ? 2 : 1, confirmedAt: 'ACK' });
});

it('확인ACK는요청key와ID가다른결과를합류하지않는다', () => {
  const store = create(); store.rememberSave(row()); const captured = store.captureConfirm('today', 'a');
  store.rememberConfirm({ ...row('a', 'other', 'dirty'), confirmedAt: '다른key' }, captured);
  store.rememberConfirm({ ...row('other', 'today', 'dirty'), confirmedAt: '다른ID' }, captured);
  expect(store.known('today', true)).toEqual(row());
});

it('삭제기억은늦은snapshot을제외하되raw중복은실제빈조회까지차단한다', () => {
  const store = create(); store.observe([row()], true); store.rememberSave(row()); store.rememberDelete('a', 'a');
  store.observe([row()], true); expect(store.visibleRecords()).toEqual([]); expect(store.select(row(), true)).toBeNull();
  expect(store.canTarget('save', undefined, 'today')).toBe(false); expect(store.canTarget('delete', 'a', 'today')).toBe(false);
  store.observe([], true); expect(store.canTarget('save', undefined, 'today')).toBe(true);
});

it('비선택삭제는현재미관측ACK를보존하고owner초기화는모든기억을지운다', () => {
  const store = create(); store.observe([row('past', 'past')], true); store.rememberSave(row());
  store.rememberDelete('past', 'a'); expect(store.canTarget('save', 'a', 'today')).toBe(true);
  store.resetOwner(); expect(store.known('today', true)).toBeUndefined(); expect(store.isDeleted('past')).toBe(false);
  expect(store.canTarget('save', 'a', 'today')).toBe(false);
});

it('대상자기ID도있고다른ID동일key도있으면saveconfirm차단하지만실목록삭제는허용한다',()=>{
 const store=create();store.rememberSave(row());store.observe([row(),row('other')],true);expect(store.canTarget('save','a','today')).toBe(false);expect(store.canTarget('confirm','a','today')).toBe(false);expect(store.canTarget('delete','other','today')).toBe(true);
});

const echo = () => createHaccpRecordAcknowledgements<Record>({getKey:r=>r.key,strategy:{kind:'echo',sameSavedBody:(a,b)=>a.body===b.body && a.revision===b.revision},mergeConfirmed:(base,result)=>({...base,confirmedBy:result.confirmedBy,confirmedAt:result.confirmedAt})});
it('비버전은ACK이전관측을새충돌로삼지않고ACK후본문차이만차단한다',()=>{
 const store=echo();store.observe([row()],true);store.rememberSave(row('a','today','savedB'));expect(store.canTarget('confirm','a','today')).toBe(true);store.observe([row()],false);expect(store.canTarget('confirm','a','today')).toBe(true);store.observe([row()],true);expect(store.canTarget('save','a','today')).toBe(false);expect(store.known('today',true)?.body).toBe('savedB');
});
it('비버전확인송신후다른본문은capture에메타만병합하고명시열기는이전확인메타를해제한다',()=>{
 const store=echo();store.rememberSave(row());const captured=store.captureConfirm('today','a');store.observe([row('a','today','B')],true);store.rememberConfirm({...row('a','today','dirtyC'),confirmedBy:'관리자',confirmedAt:'ACK'},captured);expect(store.known('today',true)).toMatchObject({body:'A',confirmedAt:'ACK'});expect(store.canTarget('save','a','today')).toBe(false);expect(store.openServerRecord('today','wrong-id',true)).toBeUndefined();expect(store.openServerRecord('today','a',false)).toBeUndefined();expect(store.known('today',true)?.body).toBe('A');expect(store.openServerRecord('today','a',true)).toEqual(row('a','today','B'));expect(store.resolve(row(),true)).toEqual(row('a','today','B'));expect(store.canTarget('confirm','a','today')).toBe(true);
});
it('서버만있는key의known조회도선택과pending을바꾸지않는다',()=>{const store=create();store.observe([row('past','past')],true);store.rememberSave(row());expect(store.known('past',true)?.id).toBe('past');expect(store.canTarget('save','a','today')).toBe(true);});

it('비버전save송신중서버관측은ACK후새query없어도충돌근거로보존한다',()=>{const store=echo();store.observe([row()],true);const start=store.captureSave();store.observe([row('a','today','otherB')],true);store.rememberSave(row('a','today','savedC'),start);expect(store.canTarget('confirm','a','today')).toBe(false);expect(store.known('today',true)?.body).toBe('savedC');});
it('기록ID가다른key로이동하면이전key의확인메타를이식하지않는다',()=>{const store=create();store.rememberSave(row());const captured=store.captureConfirm('today','a');store.rememberConfirm({...row(),confirmedAt:'ACK'},captured);store.observe([row('a','other','B')],true);expect(store.known('other',true)).toEqual(row('a','other','B'));expect(store.canTarget('confirm','a','today')).toBe(false);});

it('targetIssue는원인만구분하고원송신불리언과읽기상태는바꾸지않는다',()=>{
 const store=echo(),cases: Array<['save'|'confirm'|'delete',string|undefined,string,string|undefined]>=[];
 cases.push(['save',undefined,'today',store.targetIssue('save',undefined,'today')]);expect(store.targetIssue('delete','absent','today')).toBe('missing-record');store.observe([row('other')],true);expect(store.targetIssue('save',undefined,'today')).toBe('existing-key');store.rememberSave(row());store.observe([row(),row('other')],true);expect(store.targetIssue('save','a','today')).toBe('duplicate-key');expect(store.targetIssue('delete','other','today')).toBeUndefined();store.observe([row('a','today','B')],true);expect(store.targetIssue('save','a','today')).toBe('body-mismatch');expect(store.canTarget('save','a','today')).toBe(false);expect(store.known('today',true)?.body).toBe('A');store.observe([],true);expect(store.targetIssue('confirm','a','today')).toBe('missing-record');expect(store.canTarget('save',undefined,'today')).toBe(true);expect(cases[0][3]).toBeUndefined();
});
