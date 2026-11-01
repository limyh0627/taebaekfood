import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { assertPlainOrderRawBatch, rawPressText, validateOrderInventoryGeneration, isCalendarDay, dateOfLocal } from './orderPlanPrimitives';

function original(file: string, start: string, end: string, prefix = ''): any {
 const source = execFileSync('git', ['show', `818edf1387bc0675e8b535ca79582b0c59c576fe:src/shared/${file}`], { encoding: 'utf8' });
 const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
 const js = ts.transpileModule(prefix + body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
 const exports: Record<string, unknown> = {};
 // Same realm is needed for the original plain-object prototype check.
 new Function('exports', js)(exports);
 return Object.values(exports)[0];
}
const oldBatch = original('orderRawBatchAttempt.ts','export function assertPlainOrderRawBatch','export function validateOrderRawBatchRequest');
const oldText = original('rawPressAttempt.ts','export function rawPressText','/** 기존 압착');
const oldGeneration = original('orderInventoryGeneration.ts','export function validateOrderInventoryGeneration','export function sameOrderInventoryGeneration');
const oldCalendar = original('day.ts','export const isCalendarDay','/** 한국 달력', 'const DAY_RE = /^(\\d{4})-(\\d{2})-(\\d{2})$/;\n');
const oldDate = original('day.ts','export function dateOfLocal','export function timeOfLocal');
function outcome(fn: (x: any) => any, x: any) { try { return ['ok', fn(x)]; } catch (e) { return ['error', (e as Error).message]; } }

describe('단일 원본 원문 동치', () => {
 it('plain JSON과 크기 및 오류를 분리 전 원본과 비교한다', () => {
  for (const x of [null, true, 1, NaN, Infinity, undefined, {x: undefined}, [1, null], new Date(), '가'.repeat(233333), '가'.repeat(233334)]) expect(outcome(assertPlainOrderRawBatch,x)).toEqual(outcome(oldBatch,x));
 });
 it('정규 문자열의 키, undefined, 배열 순서와 원문을 보존한다', () => {
  for (const x of [{z: 1,a: {y:undefined,b:2}}, [undefined, {z:3,a:1}], null, 0, {b:[2,1],a:'한글'}]) expect(rawPressText(x)).toBe(oldText(x));
  expect(rawPressText({z:1,a:2})).toBe('{"a":2,"z":1}');
  expect(rawPressText([2,1])).toBe('[2,1]');
  const request = {z: [2,1], a: {undefinedValue: undefined, text: '한글'}};
  const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  expect(hash(rawPressText(request))).toBe(hash(oldText(request)));
 });
 it('세대의 유효성과 오류를 보존한다', () => {
  const g={contractVersion:1,companyId:'taebaek',orderId:'o',operationId:'x',actorUid:'u',startedAt:'2026-01-01T00:00:00Z'};
  for (const x of [g, null, {...g, actorUid:' u'}, {...g,startedAt:'bad'}, {...g,companyId:'other'}, {...g,contractVersion:0}]) expect(outcome(validateOrderInventoryGeneration as any,x)).toEqual(outcome(oldGeneration,x));
 });
 it('윤년과 0~99년, 잘못된 날짜를 보존한다', () => {
  for (const x of ['2024-02-29','2023-02-29','0000-01-01','0099-12-31','0100-01-01','2026-13-01','2026-01-01T00:00']) expect(isCalendarDay(x)).toBe(oldCalendar(x));
 });
 it('날짜 fallback과 로컬 시각을 보존한다', () => {
  for (const x of [undefined,'','2026-01-02','invalidTvalue','2026-01-01T16:00:00Z','2026-12-31T23:30:00Z']) expect(dateOfLocal(x)).toBe(oldDate(x));
 });
});

