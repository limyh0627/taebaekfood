import {useEffect, useReducer, useRef} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {doc, onSnapshot} from 'firebase/firestore';
import {auth, db} from '../../../shared/firebase';
import {setDocument} from '../../../shared/services/firebaseService';
import {haccpTemplateDocId} from '../../../shared/haccpTemplateId';
import type {CompanyId} from '../../../shared/types';

interface Options<T> {
  companyId: CompanyId;
  templateKey: string;
  field: string;
  defaults: T[];
  valid: (row: T) => boolean;
  emptyMessage: string;
}
const copy = <T,>(rows: T[]): T[] => rows.map(row => typeof row === 'object' && row !== null ? {...row} : row);

export function useChecklistTemplateEditor<T>(options: Options<T>) {
  const [, notify] = useReducer(value => value + 1, 0);
  const latest = useRef(options);
  latest.current = options;
  const ref = useRef<ReturnType<typeof make> | null>(null);
  function make() {
    return {companyId: options.companyId, key: options.templateKey, uid: auth.currentUser?.uid ?? '',
      alive: true, ready: false, editing: false, saving: false, error: '', readError: '',
      rows: [] as T[], snapshot: [] as T[], newText: '', run: null as object | null, revision: 0};
  }
  if (!ref.current || ref.current.companyId !== options.companyId || ref.current.key !== options.templateKey ||
      ref.current.uid !== (auth.currentUser?.uid ?? '') || !ref.current.alive) {
    if (ref.current) ref.current.alive = false;
    ref.current = make();
  }
  const owner = ref.current;
  const current = () => owner.alive && ref.current === owner && (auth.currentUser?.uid ?? '') === owner.uid;
  const paint = () => { if (current()) notify(); };
  const canEdit = () => current() && owner.ready && !owner.saving;
  useEffect(() => {
    owner.alive = true;
    let observing = true;
    const stopAuth = onAuthStateChanged(auth, user => {
      if (!observing || !owner.alive || ref.current !== owner) return;
      if ((user?.uid ?? '') !== owner.uid) { owner.alive = false; notify(); }
    });
    owner.ready = false;
    owner.readError = '';
    const stop = onSnapshot(doc(db, 'haccp_templates', haccpTemplateDocId(owner.companyId, owner.key)), snap => {
      if (!observing || !current()) return;
      const value = snap.exists() ? snap.data()[latest.current.field] : undefined;
      owner.snapshot = copy(Array.isArray(value) && value.length > 0 ? value : latest.current.defaults);
      owner.ready = true;
      owner.readError = '';
      if (!owner.editing) owner.rows = copy(owner.snapshot);
      paint();
    }, () => {
      if (!observing || !current()) return;
      owner.ready = false;
      owner.readError = '점검 항목을 확인하지 못했습니다. 다시 조회한 뒤 편집해주세요.';
      paint();
    });
    return () => { observing = false; owner.alive = false; stop(); stopAuth(); };
  }, [owner, owner.revision]);
  const change = (action: T[] | ((rows: T[]) => T[])) => {
    if (!canEdit() || !owner.editing) return;
    owner.rows = typeof action === 'function' ? action(owner.rows) : action;
    paint();
  };
  const open = () => {
    if (!canEdit()) return;
    owner.rows = copy(owner.snapshot); owner.editing = true; owner.error = ''; paint();
  };
  const cancel = () => {
    if (!current() || owner.saving) return;
    owner.rows = copy(owner.snapshot); owner.editing = false; owner.newText = ''; owner.error = ''; paint();
  };
  const save = async () => {
    if (!canEdit() || !owner.editing || !owner.uid || owner.run) return;
    const rows = copy(owner.rows.filter(latest.current.valid));
    if (!rows.length) { alert(latest.current.emptyMessage); return; }
    const run = {}; owner.run = run; owner.saving = true; owner.error = ''; paint();
    try {
      if (!current()) return;
      await setDocument('haccp_templates', haccpTemplateDocId(owner.companyId, owner.key), {[latest.current.field]: rows});
      if (!current() || owner.run !== run) return;
      owner.snapshot = copy(rows); owner.rows = copy(rows); owner.editing = false; owner.newText = '';
    } catch {
      if (current() && owner.run === run) owner.error = '저장 결과를 확인하지 못했습니다. 입력 내용은 유지했습니다. 저장된 항목을 확인해주세요.';
    } finally {
      if (owner.run === run) { owner.run = null; owner.saving = false; paint(); }
    }
  };
  return {rows: owner.rows, change, open, cancel, save, canEdit, editing: owner.editing,
    saving: owner.saving, ready: owner.ready, error: owner.error || owner.readError,
    newText: owner.newText, setNewText: (value: string) => { if (canEdit() && owner.editing) { owner.newText = value; paint(); } },
    retry: () => { if (current() && !owner.saving) { owner.revision++; paint(); } }};
}
