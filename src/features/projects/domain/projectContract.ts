import type { Timestamp } from 'firebase/firestore';

export type ProjectCompany = 'taebaek' | 'punghoe';
export interface ProjectScope {
  companyId: ProjectCompany;
  actorUid: string;
  employeeId: string;
  sessionGeneration: number;
}
export interface Project {
  version: 1;
  companyId: ProjectCompany;
  epoch: string;
  ownerEmployeeId: string;
  participantIds: string[];
  title: string;
  description: string;
  revision: number;
  status: 'active' | 'deleted';
  lastOperationId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface ProjectTask {
  version: 1;
  projectEpoch: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'review' | 'done';
  assigneeEmployeeId: string | null;
  startDate: string | null;
  endDate: string | null;
  priority: 'low' | 'normal' | 'high';
  tags: string[];
  checklist: Record<string, { title: string; checked: boolean }>;
  revision: number;
  deletedAt: Timestamp | null;
  lastOperationId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ProjectAction = 'project.create' | 'project.edit' | 'project.delete' | 'member.add' | 'member.remove' | 'task.create' | 'task.edit' | 'task.delete' | 'checklist.create' | 'checklist.edit' | 'checklist.delete' | 'comment.create' | 'comment.edit' | 'comment.delete';
export interface ProjectRequest {
  version: 1;
  companyId: ProjectCompany;
  projectId: string;
  projectEpoch: string;
  operationId: string;
  actorUid: string;
  actorEmployeeId: string;
  action: ProjectAction;
  target: { kind: 'project' | 'task' | 'checklist' | 'comment'; id: string; taskId?: string };
  expectedProjectRevision: number | null;
  expectedTargetRevision: number | null;
  input: Record<string, unknown>;
}
const actions: readonly ProjectAction[] = ['project.create', 'project.edit', 'project.delete', 'member.add', 'member.remove', 'task.create', 'task.edit', 'task.delete', 'checklist.create', 'checklist.edit', 'checklist.delete', 'comment.create', 'comment.edit', 'comment.delete'];
function fail(): never { throw new Error('프로젝트 요청 원문을 확인해 주세요.'); }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : fail();
const keys = (value: Record<string, unknown>, expected: readonly string[]) => { if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) fail(); };
const text = (value: unknown, max: number, empty = false): string => typeof value === 'string' && value.length <= max && (empty || !!value.trim()) ? value : fail();
export const validProjectId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value === value.trim() && value !== '.' && value !== '..' && !value.includes('/') && !/^__.*__$/.test(value) && new TextEncoder().encode(value).length <= 1500;
const id = (value: unknown): string => validProjectId(value) ? value : fail();
const revision = (value: unknown): number | null => value === null ? null : typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : fail();
const day = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail();
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : fail();
};

/** 원문은 요청번호와 함께 보관하며 알 수 없는 입력은 서버로 보내지 않는다. */
export function normalizeProjectRequest(value: unknown): ProjectRequest {
  const row = object(value);
  keys(row, ['version', 'companyId', 'projectId', 'projectEpoch', 'operationId', 'actorUid', 'actorEmployeeId', 'action', 'target', 'expectedProjectRevision', 'expectedTargetRevision', 'input']);
  if (row.version !== 1 || !['taebaek', 'punghoe'].includes(row.companyId as string) || !actions.includes(row.action as ProjectAction)) fail();
  const action = row.action as ProjectAction, target = object(row.target), input = object(row.input), prefix = action.split('.')[0];
  const expectedKind = prefix === 'member' ? 'project' : prefix;
  keys(target, expectedKind === 'comment' || expectedKind === 'checklist' ? ['kind', 'id', 'taskId'] : ['kind', 'id']);
  if (target.kind !== expectedKind) fail();
  const projectId = id(row.projectId), targetId = id(target.id), taskId = target.taskId === undefined ? undefined : id(target.taskId);
  if (expectedKind === 'project' && targetId !== projectId) fail();
  const create = action.endsWith('.create');
  const projectRevision = revision(row.expectedProjectRevision), targetRevision = revision(row.expectedTargetRevision);
  if (action === 'project.create' ? projectRevision !== null || targetRevision !== null : projectRevision === null) fail();
  if (action !== 'project.create' && (create && expectedKind !== 'checklist' ? targetRevision !== null : targetRevision === null)) fail();
  if (['project.create', 'project.edit'].includes(action)) { keys(input, ['title', 'description']); text(input.title, 120); text(input.description, 10000, true); }
  else if (['member.add', 'member.remove'].includes(action)) { keys(input, ['employeeId']); id(input.employeeId); }
  else if (['task.create', 'task.edit'].includes(action)) {
    keys(input, ['title', 'description', 'status', 'assigneeEmployeeId', 'startDate', 'endDate', 'priority', 'tags']);
    text(input.title, 200); text(input.description, 20000, true);
    if (!['todo', 'doing', 'review', 'done'].includes(input.status as string) || !['low', 'normal', 'high'].includes(input.priority as string)) fail();
    if (input.assigneeEmployeeId !== null) id(input.assigneeEmployeeId);
    const start = day(input.startDate), end = day(input.endDate); if (start && end && start > end) fail();
    if (!Array.isArray(input.tags) || input.tags.length > 20) fail();
    for (const tag of input.tags as unknown[]) text(tag, 40);
  } else if (['checklist.create', 'checklist.edit'].includes(action)) { keys(input, ['title', 'checked']); text(input.title, 500); if (typeof input.checked !== 'boolean') fail(); }
  else if (['comment.create', 'comment.edit'].includes(action)) { keys(input, ['body']); text(input.body, 5000); }
  else keys(input, []);
  const result: ProjectRequest = { version: 1, companyId: row.companyId as ProjectCompany, projectId, projectEpoch: id(row.projectEpoch), operationId: id(row.operationId), actorUid: text(row.actorUid, 1500), actorEmployeeId: id(row.actorEmployeeId), action, target: { kind: target.kind as ProjectRequest['target']['kind'], id: targetId, ...(taskId === undefined ? {} : { taskId }) }, expectedProjectRevision: projectRevision, expectedTargetRevision: targetRevision, input: JSON.parse(JSON.stringify(input)) as Record<string, unknown> };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 128 * 1024) fail();
  return result;
}
const labels: Record<ProjectAction, string> = { 'project.create': '프로젝트 생성', 'project.edit': '프로젝트 수정', 'project.delete': '프로젝트 삭제', 'member.add': '참여자 추가', 'member.remove': '참여자 제외', 'task.create': '업무 생성', 'task.edit': '업무 수정', 'task.delete': '업무 삭제', 'checklist.create': '체크리스트 추가', 'checklist.edit': '체크리스트 수정', 'checklist.delete': '체크리스트 삭제', 'comment.create': '댓글 작성', 'comment.edit': '댓글 수정', 'comment.delete': '댓글 삭제' };
export function formatProjectActivity(operation: { action: ProjectAction }): string { return Object.prototype.hasOwnProperty.call(labels, operation.action) ? labels[operation.action] : '프로젝트 활동'; }

export interface ProjectActor { companyId: ProjectCompany; actorUid: string; employeeId: string; admin: boolean }
export interface ProjectTransitionBefore { project: Record<string, any> | null; target: Record<string, any> | null; task?: Record<string, any> | null }
/** 이 계산은 화면의 사전 검사이며 같은 불변식은 보안 규칙에서도 독립적으로 확인한다. */
export function validateProjectTransition(before: ProjectTransitionBefore, raw: unknown, actor: ProjectActor, at: unknown): { project: Record<string, any>; target: Record<string, any> | null } {
  const request = normalizeProjectRequest(raw), { action, input } = request, project = before.project, target = before.target;
  if (actor.companyId !== request.companyId || actor.actorUid !== request.actorUid || actor.employeeId !== request.actorEmployeeId) fail();
  if (action === 'project.create') {
    if (project !== null || target !== null) fail();
    const next = { version: 1, companyId: request.companyId, epoch: request.projectEpoch, ownerEmployeeId: actor.employeeId, participantIds: [actor.employeeId], title: input.title, description: input.description, revision: 1, status: 'active', lastOperationId: request.operationId, createdAt: at, updatedAt: at };
    return { project: next, target: next };
  }
  if (!project || project.companyId !== actor.companyId || project.epoch !== request.projectEpoch || project.status !== 'active' || project.revision !== request.expectedProjectRevision || !Array.isArray(project.participantIds) || !(actor.admin || project.participantIds.includes(actor.employeeId))) fail();
  const manager = actor.admin || project.ownerEmployeeId === actor.employeeId;
  const nextProject: Record<string, any> = { ...project, revision: project.revision + 1, lastOperationId: request.operationId, updatedAt: at };
  if (request.target.kind === 'project') {
    if (!target || target.revision !== request.expectedTargetRevision || target.revision !== project.revision) fail();
    if (action === 'project.edit') Object.assign(nextProject, { title: input.title, description: input.description });
    else if (action === 'project.delete') { if (!manager) fail(); nextProject.status = 'deleted'; }
    else if (action === 'member.add' || action === 'member.remove') {
      if (!manager) fail();
      const member = input.employeeId as string, members = [...project.participantIds] as string[], index = members.indexOf(member);
      if (action === 'member.add') { if (index >= 0 || members.length >= 50) fail(); members.push(member); }
      else { if (index < 0 || member === project.ownerEmployeeId) fail(); members.splice(index, 1); }
      nextProject.participantIds = members;
    } else fail();
    return { project: nextProject, target: nextProject };
  }
  if (request.target.kind === 'task') {
    if (action === 'task.create') {
      if (target !== null || input.assigneeEmployeeId !== null && !project.participantIds.includes(input.assigneeEmployeeId)) fail();
      return { project: nextProject, target: { version: 1, projectEpoch: request.projectEpoch, ...input, checklist: {}, revision: 1, deletedAt: null, lastOperationId: request.operationId, createdAt: at, updatedAt: at } };
    }
    if (!target || target.projectEpoch !== request.projectEpoch || target.deletedAt !== null || target.revision !== request.expectedTargetRevision) fail();
    if (action === 'task.edit') {
      if (input.assigneeEmployeeId !== null && !project.participantIds.includes(input.assigneeEmployeeId) && input.assigneeEmployeeId !== target.assigneeEmployeeId) fail();
      return { project: nextProject, target: { ...target, ...input, revision: target.revision + 1, lastOperationId: request.operationId, updatedAt: at } };
    }
    if (action === 'task.delete') return { project: nextProject, target: { ...target, deletedAt: at, revision: target.revision + 1, lastOperationId: request.operationId, updatedAt: at } };
    fail();
  }
  if (request.target.kind === 'checklist') {
    if (!target || target.projectEpoch !== request.projectEpoch || target.deletedAt !== null || target.revision !== request.expectedTargetRevision || !target.checklist || typeof target.checklist !== 'object' || Array.isArray(target.checklist)) fail();
    const checklist = { ...target.checklist }, key = request.target.id, exists = Object.prototype.hasOwnProperty.call(checklist, key);
    if (action === 'checklist.create') { if (exists || Object.keys(checklist).length >= 50) fail(); checklist[key] = { title: input.title, checked: input.checked }; }
    else if (action === 'checklist.edit') { if (!exists) fail(); checklist[key] = { title: input.title, checked: input.checked }; }
    else if (action === 'checklist.delete') { if (!exists) fail(); delete checklist[key]; }
    else fail();
    return { project: nextProject, target: { ...target, checklist, revision: target.revision + 1, lastOperationId: request.operationId, updatedAt: at } };
  }
  if (!before.task || before.task.projectEpoch !== request.projectEpoch || before.task.deletedAt !== null) fail();
  if (action === 'comment.create') {
    if (target !== null) fail();
    return { project: nextProject, target: { version: 1, projectEpoch: request.projectEpoch, taskId: request.target.taskId, authorEmployeeId: actor.employeeId, body: input.body, revision: 1, deletedAt: null, lastOperationId: request.operationId, createdAt: at, updatedAt: at } };
  }
  if (!target || target.projectEpoch !== request.projectEpoch || target.taskId !== request.target.taskId || target.deletedAt !== null || target.revision !== request.expectedTargetRevision || !(manager || target.authorEmployeeId === actor.employeeId)) fail();
  if (action === 'comment.edit') return { project: nextProject, target: { ...target, body: input.body, revision: target.revision + 1, lastOperationId: request.operationId, updatedAt: at } };
  if (action === 'comment.delete') return { project: nextProject, target: { ...target, deletedAt: at, revision: target.revision + 1, lastOperationId: request.operationId, updatedAt: at } };
  return fail();
}

/** 빈 체크리스트는 완료가 아니라 진행률을 정할 수 없는 상태다. */
export function deriveChecklistProgress(rows: Readonly<Record<string, { title: string; checked: boolean }>>): { done: number; total: number; percent: number | null } {
  let done = 0;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows) || Object.keys(rows).length > 50) throw new Error('체크리스트 원문을 확인해 주세요.');
  const values = Object.values(rows);
  for (const row of values) {
    if (!row || typeof row.title !== 'string' || !row.title.trim() || typeof row.checked !== 'boolean') {
      throw new Error('체크리스트 원문을 확인해 주세요.');
    }
    if (row.checked) done++;
  }
  const total = values.length;
  return { done, total, percent: total ? Math.round(done * 100 / total) : null };
}
