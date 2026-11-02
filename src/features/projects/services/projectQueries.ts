import { collection, doc, limit, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type Firestore, type QueryConstraint, type QueryDocumentSnapshot, type Unsubscribe } from 'firebase/firestore';
import type { ProjectScope } from '../domain/projectContract';

export interface ProjectObservation<T> {
  value: T;
  fromCache: boolean;
  hasPendingWrites: boolean;
}
export interface ProjectQueryHandlers<T> {
  next(value: ProjectObservation<T>): void;
  error(error: Error): void;
  invalidated(): void;
}
export interface ProjectQueryRow { id: string; data: DocumentData }
export interface ProjectPage { rows: ProjectQueryRow[]; cursor: QueryDocumentSnapshot<DocumentData> | null }
type Cursor = QueryDocumentSnapshot<DocumentData> | null | undefined;

function documentId(value: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value === '.' || value === '..' || value.includes('/') || /^__.*__$/.test(value) || new TextEncoder().encode(value).length > 1500) {
    throw new Error('프로젝트 경로를 확인해 주세요.');
  }
  return value;
}

/** 화면 수명 검사는 권한 증명이 아니며, 실제 열람 권한은 보안 규칙이 판정한다. */
export function createProjectQueries({ db, current }: { db: Firestore; current(scope: ProjectScope): boolean }) {
  const subscribeList = (scope: ProjectScope, path: string[], constraints: QueryConstraint[], cursor: Cursor, handlers: ProjectQueryHandlers<ProjectPage>): Unsubscribe => {
    let active = true;
    let invalidated = false;
    const valid = () => {
      if (!active) return false;
      if (current(scope)) return true;
      if (!invalidated) { invalidated = true; handlers.invalidated(); }
      return false;
    };
    if (!valid()) return () => { active = false; };
    const ref = collection(db, path[0], ...path.slice(1));
    const q = query(ref, ...constraints, ...(cursor ? [startAfter(cursor)] : []), limit(50));
    const stop = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      if (!valid()) return;
      const docs = snap.docs;
      handlers.next({ value: { rows: docs.map(row => ({ id: row.id, data: row.data() })), cursor: docs.at(-1) ?? null }, fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites });
    }, error => { if (valid()) handlers.error(error); });
    return () => { active = false; stop(); };
  };
  const subscribeProjects = (scope: ProjectScope, options: { adminView: boolean; status: 'active' | 'deleted'; cursor?: Cursor }, handlers: ProjectQueryHandlers<ProjectPage>) => {
    const constraints: QueryConstraint[] = [where('companyId', '==', scope.companyId), where('status', '==', options.status)];
    if (!options.adminView) constraints.push(where('participantIds', 'array-contains', scope.employeeId));
    constraints.push(orderBy('updatedAt', 'desc'));
    return subscribeList(scope, ['workProjectsV1'], constraints, options.cursor, handlers);
  };
  const subscribeProject = (scope: ProjectScope, id: string, epoch: string, handlers: ProjectQueryHandlers<ProjectQueryRow | null>): Unsubscribe => {
    documentId(id); documentId(epoch);
    let active = true, invalidated = false;
    const valid = () => { if (!active) return false; if (current(scope)) return true; if (!invalidated) { invalidated = true; handlers.invalidated(); } return false; };
    if (!valid()) return () => { active = false; };
    const stop = onSnapshot(doc(db, 'workProjectsV1', id), { includeMetadataChanges: true }, snap => {
      if (!valid()) return;
      const data = snap.exists() ? snap.data() : null;
      if (data && (data.companyId !== scope.companyId || data.epoch !== epoch)) { handlers.error(new Error('선택한 프로젝트가 바뀌었습니다.')); return; }
      handlers.next({ value: data ? { id: snap.id, data } : null, fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites });
    }, error => { if (valid()) handlers.error(error); });
    return () => { active = false; stop(); };
  };
  const subscribeTasks = (scope: ProjectScope, projectId: string, options: { assignee?: string; cursor?: Cursor }, handlers: ProjectQueryHandlers<ProjectPage>) => {
    const constraints: QueryConstraint[] = [];
    if (options.assignee) constraints.push(where('assigneeEmployeeId', '==', documentId(options.assignee)));
    constraints.push(orderBy('updatedAt', 'desc'));
    return subscribeList(scope, ['workProjectsV1', documentId(projectId), 'tasks'], constraints, options.cursor, handlers);
  };
  const subscribeChecklist = (scope: ProjectScope, projectId: string, taskId: string, epoch: string, handlers: ProjectQueryHandlers<Record<string, { title: string; checked: boolean }>>): Unsubscribe => {
    documentId(projectId); documentId(taskId); documentId(epoch);
    let active = true, invalidated = false;
    const valid = () => { if (!active) return false; if (current(scope)) return true; if (!invalidated) { invalidated = true; handlers.invalidated(); } return false; };
    if (!valid()) return () => { active = false; };
    const stop = onSnapshot(doc(db, 'workProjectsV1', projectId, 'tasks', taskId), { includeMetadataChanges: true }, snap => {
      if (!valid()) return;
      const data = snap.exists() ? snap.data() : null, checklist = data?.checklist;
      if (!data || data.projectEpoch !== epoch || data.deletedAt !== null || !checklist || typeof checklist !== 'object' || Array.isArray(checklist) || Object.keys(checklist).length > 50 || Object.values(checklist).some((row: any) => !row || typeof row.title !== 'string' || typeof row.checked !== 'boolean')) { handlers.error(new Error('업무의 체크리스트를 확인할 수 없습니다.')); return; }
      handlers.next({ value: checklist, fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites });
    }, error => { if (valid()) handlers.error(error); });
    return () => { active = false; stop(); };
  };
  const subscribeComments = (scope: ProjectScope, projectId: string, taskId: string, cursor: Cursor, handlers: ProjectQueryHandlers<ProjectPage>) =>
    subscribeList(scope, ['workProjectsV1', documentId(projectId), 'tasks', documentId(taskId), 'comments'], [orderBy('createdAt', 'asc')], cursor, handlers);
  const subscribeOperations = (scope: ProjectScope, projectId: string, cursor: Cursor, handlers: ProjectQueryHandlers<ProjectPage>) =>
    subscribeList(scope, ['workProjectsV1', documentId(projectId), 'operations'], [orderBy('at', 'desc')], cursor, handlers);
  return { subscribeProjects, subscribeProject, subscribeTasks, subscribeChecklist, subscribeComments, subscribeOperations };
}
