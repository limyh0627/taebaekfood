import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cliToken } from './diag-zero-item-price-20261015.mts';

const project = 'taebaek-3abe4';
const metric = 'firebaseappcheck.googleapis.com/resources/verification_count';
type State = 'complete' | 'empty' | 'denied' | 'disabled' | 'error' | 'truncated' | 'notQueried';
type DiagnosticCode = 'NETWORK_ERROR' | 'JSON_ERROR' | 'HTTP_ERROR' | 'RESPONSE_SHAPE_ERROR';
type Failure = { diagnosticCode: DiagnosticCode; httpStatus?: number; apiStatus?: string };
type Observation = { state: State; partial: boolean; pages: number; observed: number; counts: Record<string, number>; failure?: Failure };
export type Transport = (url: string, init: RequestInit) => Promise<{ status: number; json: () => Promise<unknown> }>;
class ReadFailure { constructor(readonly state: State, readonly failure: Failure = { diagnosticCode: 'RESPONSE_SHAPE_ERROR' }) {} }
const apiStatuses = new Set(['OK', 'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED']);
function failed(observed: Observation, error: unknown) {
  observed.state = error instanceof ReadFailure ? error.state : 'error';
  observed.failure = error instanceof ReadFailure ? error.failure : { diagnosticCode: 'RESPONSE_SHAPE_ERROR' };
}
function check(value: unknown): asserts value { if (!value) throw new ReadFailure('error'); }
function object(value: unknown): asserts value is Record<string, any> { check(value !== null && typeof value === 'object' && !Array.isArray(value)); }
const result = (state: State = 'notQueried'): Observation => ({ state, partial: false, pages: 0, observed: 0, counts: {} });
function add(counts: Record<string, number>, key: string, count = 1) {
  check(Number.isSafeInteger(count) && count >= 0 && Number.isSafeInteger((counts[key] ?? 0) + count));
  counts[key] = (counts[key] ?? 0) + count;
}
const query = (base: string, values: Record<string, string>) => `${base}?${new URLSearchParams(values)}`;

/** 인증 정보와 API 원문을 내보내지 않고 고정된 읽기 경로만 사용한다. */
export async function observe(token: string, transport: Transport = fetch, now = new Date(), pageLimit = 10) {
  check(typeof token === 'string' && !!token && !/[\r\n]/.test(token));
  check(Number.isInteger(pageLimit) && pageLimit >= 1 && pageLimit <= 20 && Number.isFinite(now.getTime()));
  const end = now.toISOString(), start = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
  async function read(url: string, body?: unknown) {
    let response: Awaited<ReturnType<Transport>>, value: unknown;
    try {
      response = await transport(url, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(60000) });
    } catch { throw new ReadFailure('error', { diagnosticCode: 'NETWORK_ERROR' }); }
    check(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599);
    try { value = await response.json(); }
    catch {
      if (response.status < 200 || response.status >= 300) throw new ReadFailure(response.status === 401 || response.status === 403 ? 'denied' : 'error', { diagnosticCode: 'HTTP_ERROR', httpStatus: response.status });
      throw new ReadFailure('error', { diagnosticCode: 'JSON_ERROR', httpStatus: response.status });
    }
    if (response.status < 200 || response.status >= 300) {
      const status = (value as any)?.error?.status;
      const failure: Failure = { diagnosticCode: 'HTTP_ERROR', httpStatus: response.status,
        ...(typeof status === 'string' && apiStatuses.has(status) ? { apiStatus: status } : {}) };
      const reasons = (value as any)?.error?.details;
      if (response.status === 403 && Array.isArray(reasons) && reasons.some(row => row?.reason === 'SERVICE_DISABLED')) throw new ReadFailure('disabled', failure);
      throw new ReadFailure(response.status === 401 || response.status === 403 ? 'denied' : 'error', failure);
    }
    check(response.status === 200); object(value); check(!value.error); return value;
  }
  async function pages(base: string, values: Record<string, string>, field: string, consume: (row: any, counts: Record<string, number>) => void, body?: Record<string, unknown>) {
    const observed = result(), seen = new Set<string>(); let next = '';
    try {
      do {
        const page = await read(query(base, { ...values, ...(body === undefined && next ? { pageToken: next } : {}) }),
          body === undefined ? undefined : { ...body, ...(next ? { pageToken: next } : {}) });
        check(Object.keys(page).every(key => [field, 'nextPageToken'].includes(key)));
        check(page[field] === undefined || Array.isArray(page[field]));
        check(page.nextPageToken === undefined || typeof page.nextPageToken === 'string');
        const counts = { ...observed.counts };
        for (const row of page[field] ?? []) consume(row, counts);
        observed.counts = counts; observed.observed += (page[field] ?? []).length; observed.pages++;
        next = page.nextPageToken ?? '';
        if (next) { check(!seen.has(next)); seen.add(next); }
        if (next && observed.pages >= pageLimit) { observed.state = 'truncated'; observed.partial = true; return observed; }
      } while (next);
      observed.state = observed.observed ? 'complete' : 'empty'; return observed;
    } catch (error) { failed(observed, error); observed.partial = observed.pages > 0; return observed; }
  }
  let number: string | undefined;
  const projectInfo = result();
  try {
    const row = await read(query(`https://firebase.googleapis.com/v1beta1/projects/${project}`, { fields: 'projectId,projectNumber' }));
    check(row.projectId === project && typeof row.projectNumber === 'string' && /^\d+$/.test(row.projectNumber));
    number = row.projectNumber; projectInfo.state = 'complete'; projectInfo.observed = 1; projectInfo.pages = 1;
  } catch (error) { failed(projectInfo, error); }
  const apps: string[] = [];
  const webApps = await pages(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`, { fields: 'apps(appId),nextPageToken', pageSize: '100' }, 'apps', (row, counts) => {
    object(row); check(typeof row.appId === 'string' && /^1:\d+:web:[a-fA-F0-9]+$/.test(row.appId) && !apps.includes(row.appId));
    apps.push(row.appId); add(counts, 'registered');
  });
  const services = number ? await pages(`https://firebaseappcheck.googleapis.com/v1/projects/${number}/services`, { fields: 'services(enforcementMode),nextPageToken', pageSize: '100' }, 'services', (row, counts) => {
    object(row); check(['OFF', 'UNENFORCED', 'ENFORCED'].includes(row.enforcementMode)); add(counts, row.enforcementMode);
  }) : result();
  const providers: Record<string, Observation[]> = { recaptchaV3Config: [], recaptchaEnterpriseConfig: [] };
  if (number && ['complete', 'empty'].includes(webApps.state) && services.state !== 'disabled') {
    for (const app of apps) for (const provider of Object.keys(providers)) {
      const observed = result();
      try {
        const row = await read(query(`https://firebaseappcheck.googleapis.com/v1/projects/${number}/apps/${encodeURIComponent(app)}/${provider}`, { fields: 'name' }));
        check(row.name === `projects/${number}/apps/${app}/${provider}`);
        observed.state = 'complete'; observed.observed = 1; observed.pages = 1; observed.counts.present = 1;
      } catch (error) { failed(observed, error); }
      providers[provider].push(observed);
    }
  }
  const providerSummary = Object.fromEntries(Object.entries(providers).map(([key, rows]) => {
    const states: Record<string, number> = {}, diagnosticCodes: Record<string, number> = {}, httpStatuses: Record<string, number> = {}, apiStatuses: Record<string, number> = {};
    for (const row of rows) {
      add(states, row.state);
      if (row.failure) {
        add(diagnosticCodes, row.failure.diagnosticCode);
        if (row.failure.httpStatus !== undefined) add(httpStatuses, String(row.failure.httpStatus));
        if (row.failure.apiStatus !== undefined) add(apiStatuses, row.failure.apiStatus);
      }
    }
    const incomplete = rows.find(row => row.state !== 'complete');
    return [key, { state: rows.length ? incomplete?.state ?? 'complete' : 'notQueried',
      partial: !!incomplete && rows.some(row => row.state === 'complete'), observations: rows.length, states,
      failures: { diagnosticCodes, httpStatuses, apiStatuses } }];
  }));
  const descriptor = result();
  try {
    const row = await read(query(`https://monitoring.googleapis.com/v3/projects/${project}/metricDescriptors/${metric}`, { fields: 'type,metricKind,valueType' }));
    check(row.type === metric && row.metricKind === 'DELTA' && row.valueType === 'INT64');
    descriptor.state = 'complete'; descriptor.pages = 1; descriptor.observed = 1;
  } catch (error) { failed(descriptor, error); }
  const windows: Record<string, unknown> = {};
  for (const days of [1, 7]) {
    const from = start(days);
    const verification = await pages(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`, {
      filter: `metric.type="${metric}"`, 'interval.startTime': from, 'interval.endTime': end, view: 'FULL', pageSize: '1000',
      fields: 'timeSeries(metric(labels),points(interval,value(int64Value))),nextPageToken',
    }, 'timeSeries', (row, counts) => {
      object(row); const labels = row.metric?.labels;
      check(labels && ['ALLOW', 'DENY'].includes(labels.result) && ['VALID', 'CONSUMED', 'INVALID', 'MISSING_OUTDATED_CLIENT', 'MISSING_UNKNOWN_ORIGIN'].includes(labels.security));
      check(Array.isArray(row.points) && row.points.length > 0);
      for (const point of row.points) {
        const time = Date.parse(point.interval?.endTime);
        check(Number.isFinite(time) && time > Date.parse(from) && time <= now.getTime());
        check(typeof point.value?.int64Value === 'string' && /^\d+$/.test(point.value.int64Value));
        add(counts, `${labels.result}:${labels.security}`, Number(point.value.int64Value));
      }
    });
    windows[`${days}d`] = { start: from, end, verification };
  }
  const logs = await pages('https://logging.googleapis.com/v2/entries:list', { fields: 'entries(timestamp,jsonPayload),nextPageToken' }, 'entries', (row, counts) => {
    object(row); const state = row.jsonPayload?.verifications?.app;
    const time = Date.parse(row.timestamp);
    check(['VALID', 'INVALID', 'MISSING'].includes(state) && Number.isFinite(time) && time >= Date.parse(start(7)) && time <= now.getTime()); add(counts, state);
  }, { resourceNames: [`projects/${project}`], filter: `timestamp >= "${start(7)}" AND timestamp <= "${end}" AND labels."firebase-log-type"="callable-request-verification" AND (resource.type="cloud_function" OR resource.type="cloud_run_revision")`, pageSize: 1000, orderBy: 'timestamp desc' });
  return { project, readOnly: true, enforcementChanged: false, enforcementReadiness: 'not-determined', atomicSnapshot: false,
    generatedAt: end, windowsOverlap: true, doNotSumWindows: true, projectInfo, webApps, services, providers: providerSummary, descriptor, windows, callableLogs: { start: start(7), end, ...logs } };
}

export function outputPath(args: string[], exists = existsSync) {
  const allowed = [resolve('../appcheck-readonly-20261015.json'), resolve('../appcheck-readonly-20261015-r2.json')];
  check(args.length === 2 && args[0] === '--auth=firebase-cli' && args[1].startsWith('--output='));
  const expected = resolve(args[1].slice(9));
  check(allowed.includes(expected) && !exists(expected)); return expected;
}
export async function run(args: string[], deps = { exists: existsSync, token: cliToken, observe, write: (path: string, text: string) => writeFileSync(path, text, { flag: 'wx' }) }) {
  const path = outputPath(args, deps.exists);
  const summary = await deps.observe(await deps.token()); deps.write(path, JSON.stringify(summary, null, 2)); return summary;
}
export async function selfCheck() {
  let calls = 0;
  const summary = await observe('synthetic', async () => { calls++; return { status: 403, json: async () => ({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }) }; }, new Date('2026-10-15T00:00:00Z'));
  assert.equal(summary.projectInfo.state, 'disabled'); assert.equal(summary.webApps.state, 'disabled'); assert.equal(summary.enforcementReadiness, 'not-determined'); assert.ok(calls > 0);
  return { selfCheck: 'passed', productionRead: false, productionOutputWritten: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--self-check') console.log(JSON.stringify(await selfCheck()));
    else { await run(process.argv.slice(2)); console.log(JSON.stringify({ readOnly: true, outputWritten: true, enforcementChanged: false, enforcementReadiness: 'not-determined' })); }
  } catch { console.error('App Check 읽기 관측 실패: 인증·응답·출력 경로를 확인하세요. 설정은 변경하지 않았습니다.'); process.exitCode = 1; }
}
