import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { auth } from '../../../shared/firebase';
import { today as todayStr } from '../../../shared/day';
import { appConfirm } from '../../../shared/components/appDialog';
import { addItem, updateItem, deleteItem } from '../../../shared/services/firebaseService';
import type { CompanyId } from '../../../shared/types';
export interface BenzopyreneTest {
    id: string;
    productName: string;
    receivedDate: string;
    completedDate: string;
    testItem: string;
    criteria: string;
    result: string;
    judgment: '적합' | '부적합' | '';
    lotNo?: string;
    createdAt: string;
    addedBy?: string;
}
type Draft = Omit<BenzopyreneTest, 'id' | 'createdAt'>;
const emptyDraft = (): Draft => ({ productName: '', receivedDate: todayStr(), completedDate: todayStr(), testItem: '벤조피렌', criteria: '2.0 μg/kg 이하', result: '', judgment: '', lotNo: '' });
interface Options {
    companyId: CompanyId;
    isAdmin: boolean;
    currentUserName?: string;
}
export function useBenzopyreneEditor(options: Options) {
    const uid = auth.currentUser?.uid ?? '';
    const owner = useRef({ companyId: options.companyId, uid, isAdmin: options.isAdmin });
    if (owner.current.companyId !== options.companyId || owner.current.uid !== uid || owner.current.isAdmin !== options.isAdmin)
        owner.current = { companyId: options.companyId, uid, isAdmin: options.isAdmin };
    const captured = owner.current;
    const mounted = useRef(false);
    const running = useRef<{
        owner: typeof captured;
    } | null>(null);
    const [, paint] = useState(0);
    const initial = useMemo(() => emptyDraft(), [captured]);
    const [state, setState] = useState({ owner: captured, draft: initial, editingId: null as string | null, editRow: null as BenzopyreneTest | null, error: '' });
    const visible = state.owner === captured ? state : { owner: captured, draft: initial, editingId: null, editRow: null, error: '' };
    const forOwner = (previous: typeof state) => previous.owner === captured ? previous : { owner: captured, draft: initial, editingId: null, editRow: null, error: '' };
    const current = () => mounted.current && owner.current === captured && captured.isAdmin && !!captured.uid && auth.currentUser?.uid === captured.uid;
    const editable = () => current() && running.current?.owner !== captured;
    useEffect(() => {
        mounted.current = true;
        let first = true;
        const stop = auth.onAuthStateChanged(user => {
            if (first && user?.uid === owner.current.uid) {
                first = false;
                return;
            }
            first = false;
            if (!mounted.current)
                return;
            owner.current = { ...owner.current, uid: user?.uid ?? '' };
            paint(value => value + 1);
        });
        return () => { mounted.current = false; stop(); };
    }, []);
    const change = (update: (value: typeof visible) => typeof visible) => { if (editable())
        setState(previous => update(previous.owner === captured ? previous : { owner: captured, draft: initial, editingId: null, editRow: null, error: '' })); };
    const setDraft = (update: SetStateAction<Draft>) => change(value => ({ ...value, draft: typeof update === 'function' ? update(value.draft) : update }));
    const setEditRow = (update: SetStateAction<BenzopyreneTest | null>) => change(value => ({ ...value, editRow: typeof update === 'function' ? update(value.editRow) : update }));
    const startEdit = (row: BenzopyreneTest) => change(value => ({ ...value, editingId: row.id, editRow: { ...row }, error: '' }));
    const cancelEdit = () => change(value => ({ ...value, editingId: null, editRow: null, error: '' }));
    const execute = async (kind: 'add' | 'edit' | 'delete', id?: string) => {
        if (!editable())
            return;
        if (kind === 'add' && !visible.draft.productName.trim()) {
            alert('제품명을 입력해주세요.');
            return;
        }
        if (kind === 'edit' && !visible.editRow)
            return;
        const run = { owner: captured };
        running.current = run;
        paint(value => value + 1);
        const owns = () => current() && running.current === run;
        const draft = { ...visible.draft }, editRow = visible.editRow ? { ...visible.editRow } : null;
        try {
            if (kind === 'delete') {
                if (!await appConfirm('이 검사 기록을 삭제할까요?') || !owns())
                    return;
                await deleteItem('benzopyreneTests', id!);
            }
            else if (kind === 'add') {
                if (!owns())
                    return;
                await addItem('benzopyreneTests', { ...draft, productName: draft.productName.trim(), result: draft.result.trim(), createdAt: new Date().toISOString(), ...(options.currentUserName ? { addedBy: options.currentUserName } : {}) });
            }
            else {
                if (!owns() || !editRow)
                    return;
                const { id: editId, ...data } = editRow;
                await updateItem('benzopyreneTests', editId, data);
            }
            if (!owns())
                return;
            setState(previous => ({ ...forOwner(previous), owner: captured, error: '', ...(kind === 'add' ? { draft: emptyDraft() } : kind === 'edit' ? { editingId: null, editRow: null } : {}) }));
        }
        catch (error) {
            if (owns()) {
                const label = kind === 'add' ? '저장' : kind === 'edit' ? '수정' : '삭제';
                console.error(`[벤조피렌] ${label} 실패:`, error);
                const message = `${label} 실패: ${error instanceof Error ? error.message : String(error)}`;
                setState(previous => ({ ...forOwner(previous), owner: captured, error: message }));
                alert(message);
            }
        }
        finally {
            if (running.current === run) {
                running.current = null;
                if (mounted.current && owner.current === captured)
                    paint(value => value + 1);
            }
        }
    };
    return { draft: visible.draft, editRow: visible.editRow, editingId: visible.editingId, error: visible.error, busy: running.current?.owner === captured, setDraft, setEditRow, startEdit, cancelEdit, addRow: () => execute('add'), saveEdit: () => execute('edit'), removeRow: (id: string) => execute('delete', id) };
}
