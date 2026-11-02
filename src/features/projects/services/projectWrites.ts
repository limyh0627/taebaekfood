import { doc, getDocFromServer, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { normalizeProjectRequest, validateProjectTransition, type ProjectActor, type ProjectRequest, type ProjectScope } from '../domain/projectContract';

export type ProjectDraft = Omit<ProjectRequest, 'version' | 'companyId' | 'actorUid' | 'actorEmployeeId' | 'operationId'>;
export interface RetainedProjectRequest { key: string; request: ProjectRequest; original: string }
export type ProjectWriteResult = { kind: 'applied' | 'cancelled'; receipt: Record<string, any>; localCleanupPending: boolean } | { kind: 'unknown' | 'conflict'; message: string } | { kind: 'invalidated' };
type ProjectStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export interface ProjectWriteDependencies {
  db: Firestore;
  auth: { currentUser: { uid: string } | null };
  storage: ProjectStorage;
  uuid(): string;
  clock(): Date;
  current(scope: ProjectScope): boolean;
}
class Conflict extends Error {}
class Invalidated extends Error {}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
  return JSON.stringify(value);
};
const ownerPrefix = (scope: ProjectScope) => `project-request-v1:${encodeURIComponent(scope.companyId)}:${encodeURIComponent(scope.actorUid)}:${encodeURIComponent(scope.employeeId)}:`;
const keyFor = (scope: ProjectScope, operationId: string) => ownerPrefix(scope) + encodeURIComponent(operationId);
const unknown = (): ProjectWriteResult => ({ kind: 'unknown', message: '결과를 확인하지 못했습니다. 보관된 같은 요청으로 다시 확인해 주세요.' });

export function createProjectWrites(port: ProjectWriteDependencies) {
  const inFlight = new Set<string>();
  const active = (scope: ProjectScope) => port.current(scope) && port.auth.currentUser?.uid === scope.actorUid;
  const assertActive = (scope: ProjectScope) => { if (!active(scope)) throw new Invalidated(); };
  const readEntry = (scope: ProjectScope, key: string): RetainedProjectRequest => {
    if (!key.startsWith(ownerPrefix(scope))) throw new Conflict('다른 계정의 보관 요청입니다.');
    const original = port.storage.getItem(key); if (original === null) throw new Conflict('보관된 요청을 찾을 수 없습니다.');
    const request = normalizeProjectRequest(JSON.parse(original));
    if (request.companyId !== scope.companyId || request.actorUid !== scope.actorUid || request.actorEmployeeId !== scope.employeeId || key !== keyFor(scope, request.operationId)) throw new Conflict('보관 요청의 계정이 다릅니다.');
    return { key, request, original };
  };
  const sameEntry = (scope: ProjectScope, entry: RetainedProjectRequest) => {
    const current = readEntry(scope, entry.key);
    if (current.original !== entry.original || stable(current.request) !== stable(entry.request)) throw new Conflict('보관 요청이 변경되었습니다.');
    return current.request;
  };
  const receiptResult = (request: ProjectRequest, receipt: Record<string, any> | undefined): ProjectWriteResult => {
    if (!receipt) return unknown();
    if (Object.keys(receipt).sort().join(',') !== ['version','projectEpoch','operationId','actorUid','actorEmployeeId','action','target','request','status','before','after','at'].sort().join(',') || receipt.version !== 1 || receipt.operationId !== request.operationId || receipt.projectEpoch !== request.projectEpoch || receipt.actorUid !== request.actorUid || receipt.actorEmployeeId !== request.actorEmployeeId || receipt.action !== request.action || stable(receipt.target) !== stable(request.target) || stable(receipt.request) !== stable(request) || !['applied', 'cancelled'].includes(receipt.status)) return { kind: 'conflict', message: '보관 요청과 처리 기록이 다릅니다.' };
    return { kind: receipt.status, receipt, localCleanupPending: false } as ProjectWriteResult;
  };
  const finish = (scope: ProjectScope, entry: RetainedProjectRequest, result: ProjectWriteResult): ProjectWriteResult => {
    if (result.kind !== 'applied' && result.kind !== 'cancelled') return result;
    try {
      assertActive(scope); sameEntry(scope, entry);
      port.storage.removeItem(entry.key);
      return { ...result, localCleanupPending: port.storage.getItem(entry.key) !== null };
    } catch { return { ...result, localCleanupPending: true }; }
  };
  const prepare = (scope: ProjectScope, draft: ProjectDraft): RetainedProjectRequest => {
    assertActive(scope);
    const request = normalizeProjectRequest({ ...draft, version: 1, companyId: scope.companyId, actorUid: scope.actorUid, actorEmployeeId: scope.employeeId, operationId: port.uuid() });
    const key = keyFor(scope, request.operationId), body = JSON.stringify(request);
    if (port.storage.getItem(key) !== null) throw new Conflict('같은 요청 번호가 이미 보관되어 있습니다.');
    port.storage.setItem(key, body);
    if (port.storage.getItem(key) !== body) throw new Conflict('요청 원문을 보관하지 못했습니다.');
    assertActive(scope);
    return { key, request, original: body };
  };
  const listLocalIssues = (scope: ProjectScope): { entries: RetainedProjectRequest[]; issues: { key: string; message: string }[] } => {
    assertActive(scope); const entries: RetainedProjectRequest[] = [], issues: { key: string; message: string }[] = [];
    let length: number;
    try { length = port.storage.length; } catch { return { entries, issues: [{ key: '', message: '기기 보관 목록을 확인할 수 없습니다.' }] }; }
    for (let i = 0; i < length; i++) {
      let key: string | null;
      try { key = port.storage.key(i); } catch { issues.push({ key: '', message: '기기 보관 항목을 확인할 수 없습니다.' }); continue; }
      if (!key?.startsWith(ownerPrefix(scope))) continue;
      try { entries.push(readEntry(scope, key)); }
      catch { issues.push({ key, message: '보관 원문을 확인할 수 없어 그대로 보존했습니다.' }); }
    }
    return { entries, issues };
  };
  const listLocal = (scope: ProjectScope): RetainedProjectRequest[] => listLocalIssues(scope).entries;
  const inspect = async (scope: ProjectScope, entry: RetainedProjectRequest): Promise<ProjectWriteResult> => {
    try {
      assertActive(scope); const request = sameEntry(scope, entry), ref = doc(port.db, 'workProjectsV1', request.projectId, 'operations', request.operationId);
      const snapshot = await getDocFromServer(ref); assertActive(scope);
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return unknown();
      return finish(scope, entry, receiptResult(request, snapshot.exists() ? snapshot.data() : undefined));
    } catch (error) { return error instanceof Invalidated ? { kind: 'invalidated' } : error instanceof Conflict ? { kind: 'conflict', message: error.message } : unknown(); }
  };
  const execute = async (scope: ProjectScope, entry: RetainedProjectRequest, cancel: boolean): Promise<ProjectWriteResult> => {
    if (inFlight.has(entry.key)) return { kind: 'unknown', message: '같은 요청을 처리하고 있습니다. 완료 후 결과를 확인해 주세요.' };
    inFlight.add(entry.key);
    try {
      assertActive(scope); const request = sameEntry(scope, entry), projectRef = doc(port.db, 'workProjectsV1', request.projectId), receiptRef = doc(port.db, 'workProjectsV1', request.projectId, 'operations', request.operationId);
      const targetRef = request.target.kind === 'project' ? projectRef : request.target.kind === 'task' ? doc(port.db, 'workProjectsV1', request.projectId, 'tasks', request.target.id) : request.target.kind === 'checklist' ? doc(port.db, 'workProjectsV1', request.projectId, 'tasks', request.target.taskId!) : doc(port.db, 'workProjectsV1', request.projectId, 'tasks', request.target.taskId!, 'comments', request.target.id);
      const taskRef = request.target.kind === 'comment' ? doc(port.db, 'workProjectsV1', request.projectId, 'tasks', request.target.taskId!) : null;
      const actorRef = doc(port.db, 'employees', scope.employeeId), memberRef = !cancel && request.action === 'member.add' ? doc(port.db, 'employees', request.input.employeeId as string) : null;
      const result = await runTransaction(port.db, async tx => {
        assertActive(scope); sameEntry(scope, entry);
        const projectSnap = await tx.get(projectRef), receiptSnap = await tx.get(receiptRef), actorSnap = await tx.get(actorRef);
        assertActive(scope); sameEntry(scope, entry);
        const employee = actorSnap.exists() ? actorSnap.data() : null;
        if (!employee || employee.authUid !== scope.actorUid || employee.companyId !== scope.companyId || employee.status === 'out') throw new Invalidated();
        const admin = employee.adminAccess === true; // Rules also require the admin claim.
        const actor: ProjectActor = { companyId: scope.companyId, actorUid: scope.actorUid, employeeId: scope.employeeId, admin };
        if (receiptSnap.exists()) return receiptResult(request, receiptSnap.data());
        const targetSnap = targetRef.path === projectRef.path ? projectSnap : await tx.get(targetRef), taskSnap = taskRef ? await tx.get(taskRef) : null, memberSnap = memberRef ? await tx.get(memberRef) : null;
        assertActive(scope); sameEntry(scope, entry);
        const project = projectSnap.exists() ? projectSnap.data() : null, target = targetSnap.exists() ? targetSnap.data() : null, task = taskSnap?.exists() ? taskSnap.data() : null;
        if (memberRef) { const member = memberSnap?.exists() ? memberSnap.data() : null; if (!member || member.companyId !== scope.companyId || member.status === 'out') throw new Conflict('추가할 직원의 회사와 재직 상태를 확인해 주세요.'); }
        const at = serverTimestamp();
        let nextProject: Record<string, any> | null = project, nextTarget: Record<string, any> | null = target;
        if (!cancel || request.action === 'project.create') {
          let next: ReturnType<typeof validateProjectTransition>;
          try { next = validateProjectTransition({ project, target, task }, request, actor, at); }
          catch { throw new Conflict('프로젝트 또는 업무의 현재 상태가 변경되었습니다. 다시 확인해 주세요.'); }
          nextProject = cancel ? { ...next.project, status: 'deleted' } : next.project;
          nextTarget = request.target.kind === 'project' ? nextProject : next.target;
        } else if (!project || project.companyId !== scope.companyId || project.epoch !== request.projectEpoch || project.status !== 'active' || !(actor.admin || project.participantIds?.includes(scope.employeeId))) throw new Conflict('프로젝트의 현재 권한을 확인해 주세요.');
        const receipt = { version: 1, projectEpoch: request.projectEpoch, operationId: request.operationId, actorUid: scope.actorUid, actorEmployeeId: scope.employeeId, action: request.action, target: request.target, request, status: cancel ? 'cancelled' : 'applied', before: target, after: nextTarget, at };
        if (!cancel || request.action === 'project.create') {
          if (request.action === 'project.create') tx.set(projectRef, nextProject!);
          else { tx.set(projectRef, nextProject!); if (targetRef.path !== projectRef.path) tx.set(targetRef, nextTarget!); }
        }
        tx.set(receiptRef, receipt);
        return { kind: cancel ? 'cancelled' : 'applied', receipt, localCleanupPending: false } as ProjectWriteResult;
      });
      if (!active(scope)) return { kind: 'invalidated' };
      return finish(scope, entry, result);
    } catch (error) { return error instanceof Invalidated ? { kind: 'invalidated' } : error instanceof Conflict ? { kind: 'conflict', message: error.message } : unknown(); }
    finally { inFlight.delete(entry.key); }
  };
  return { prepare, apply: (scope: ProjectScope, entry: RetainedProjectRequest) => execute(scope, entry, false), inspect, cancel: (scope: ProjectScope, entry: RetainedProjectRequest) => execute(scope, entry, true), retryCleanup: inspect, listLocal, listLocalIssues };
}
