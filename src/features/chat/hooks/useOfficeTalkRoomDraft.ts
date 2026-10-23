import { useEffect, useRef, useState } from 'react';
import type { ChatRoom, Employee } from '../../../../types';
import { companyOf } from '../../../shared/types';
import { participantCompaniesOf } from '../../../shared/chatParticipants';
export function useOfficeTalkRoomDraft(options: {
    getUid: () => string | undefined;
    currentUser: Employee;
    employees: Employee[];
    rooms: ChatRoom[];
    add: (room: ChatRoom) => void | Promise<unknown>;
    select: (id: string) => void;
    onError: (message: string) => void;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ uid: options.getUid(), scope: companyOf(options.currentUser) + ':' + options.currentUser.id, open: false, error: '', participants: [] as string[], run: null as object | null, generation: 0 });
    const owner = useRef(make());
    if (owner.current.scope !== companyOf(options.currentUser) + ':' + options.currentUser.id || owner.current.uid !== options.getUid())
        owner.current = make();
    const state = owner.current, generation = state.generation;
    const current = () => mounted.current && owner.current === state && state.generation === generation && !!state.uid && latest.current.getUid() === state.uid;
    const notify = () => {
        if (mounted.current && owner.current === state)
            paint(v => v + 1);
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const editable = () => current() && !state.run;
    const open = () => {
        if (!editable())
            return;
        state.open = true;
        state.generation++;
        notify();
    };
    const close = () => {
        if (!editable())
            return;
        state.open = false;
        state.generation++;
        notify();
    };
    const toggle = (id: string) => {
        if (!editable())
            return;
        state.participants = state.participants.includes(id) ? state.participants.filter(v => v !== id) : [...state.participants, id];
        notify();
    };
    const create = async () => {
        if (!editable() || !state.participants.length)
            return;
        const source = latest.current, participantIds = [...new Set([...state.participants, source.currentUser.id])], companyId = companyOf(source.currentUser), participantCompanies = participantCompaniesOf(participantIds, source.employees, companyId);
        if (participantIds.length === 2) {
            const existing = source.rooms.find(r => !r.isGroup && r.participantIds.length === 2 && r.participantIds.every(id => participantIds.includes(id)));
            if (existing) {
                source.select(existing.id);
                state.open = false;
                state.participants = [];
                state.generation++;
                notify();
                return;
            }
        }
        const room: ChatRoom = { id: `ROOM-${Date.now()}`, companyId, participantIds, participantCompanies, createdBy: source.currentUser.id, lastUpdatedAt: new Date().toISOString(), isGroup: participantIds.length > 2 };
        const run = {};
        state.run = run;
        state.error = '';
        notify();
        const own = () => current() && state.run === run;
        try {
            await source.add(room);
            if (own()) {
                latest.current.select(room.id);
                state.open = false;
                state.participants = [];
            }
        }
        catch (error) {
            if (own()) {
                state.error = `대화방을 만들지 못했습니다: ${error instanceof Error ? error.message : '네트워크 오류'}`;
                latest.current.onError(state.error);
            }
        }
        finally {
            if (own()) {
                state.run = null;
                notify();
            }
        }
    };
    return { error: state.error, isOpen: state.open, selectedParticipants: state.participants, busy: !!state.run, open, close, toggle, create };
}
