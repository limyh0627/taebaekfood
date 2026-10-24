import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatRoom, Employee } from '../../../../types';
import { companyOf } from '../../../shared/types';
import { actionsFor, deletePatch } from '../../../shared/messageActions';
type Run = {
    kind: 'message' | 'room';
    phase: 'confirm' | 'pending';
};
export function useOfficeTalkDeletion(options: {
    roomId: string | null;
    rooms: ChatRoom[];
    messages: ChatMessage[];
    currentUser: Employee;
    isAdmin?: boolean;
    getUid: () => string | undefined;
    confirm: (text: string) => Promise<boolean>;
    updateMessage?: (id: string, patch: Partial<ChatMessage>) => void | Promise<unknown>;
    deleteRoom: (id: string) => void | Promise<unknown>;
    onNotice: (text: string) => void;
    onRoomDeleted: (id: string) => void;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options), locks = useRef(new Map<string, Run>());
    latest.current = options;
    const make = () => ({ key: JSON.stringify([companyOf(options.currentUser), options.currentUser.id, options.getUid(), options.roomId]), uid: options.getUid(), run: null as Run | null, room: null as ChatRoom | null, message: null as ChatMessage | null, messageError: '', error: '' });
    const owner = useRef(make()), key = JSON.stringify([companyOf(options.currentUser), options.currentUser.id, options.getUid(), options.roomId]);
    if (owner.current.key !== key) {
        const old = owner.current;
        if (old.run?.kind === 'room' && old.run.phase === 'confirm' && locks.current.get(old.key) === old.run)
            locks.current.delete(old.key);
        owner.current = make();
    }
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && !!state.uid && latest.current.getUid() === state.uid;
    const notify = () => {
        if (current())
            paint(n => n + 1);
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const release = (run: Run) => {
        if (locks.current.get(state.key) === run)
            locks.current.delete(state.key);
        if (state.run === run)
            state.run = null;
        if (mounted.current && owner.current.key === state.key)
            paint(n => n + 1);
    };
    const messageValid = (source: ChatMessage) => {
        const o = latest.current, row = o.messages.find(row => row.id === source.id && row.roomId === source.roomId);
        return !!row && o.rooms.some(room => room.id === source.roomId && companyOf(room) === companyOf(o.currentUser)) && source.roomId === o.roomId && row.senderId === source.senderId && row.text === source.text && row.createdAt === source.createdAt && actionsFor({ msg: row, me: o.currentUser, isAdmin: o.isAdmin }).includes('삭제') && typeof o.updateMessage === 'function';
    };
    const removeMessage = async (source: ChatMessage) => {
        if (!current() || locks.current.has(state.key) || !messageValid(source))
            return;
        const captured = { ...source }, run: Run = { kind: 'message', phase: 'confirm' };
        state.run = run;
        locks.current.set(state.key, run);
        state.message = captured;
        state.messageError = '';
        notify();
        const own = () => current() && state.run === run;
        try {
            if (!await latest.current.confirm('이 말을 지울까요?\n(줄은 남고 내용만 지워집니다)')) {
                if (own())
                    state.message = null;
                return;
            }
            if (!own())
                return;
            if (!messageValid(captured)) {
                state.messageError = '메시지 또는 삭제 권한이 변경되었습니다. 현재 내용을 다시 확인해 주세요.';
                return;
            }
            run.phase = 'pending';
            notify();
            await latest.current.updateMessage!(captured.id, deletePatch(latest.current.currentUser.id));
            if (own()) {
                state.message = null;
                latest.current.onNotice('지웠습니다');
            }
        }
        catch (error) {
            if (own())
                state.messageError = '메시지 삭제 결과를 확인하지 못했습니다. ' + (error instanceof Error ? error.message : '같은 원문을 다시 확인해 주세요.');
        }
        finally {
            release(run);
        }
    };
    const openRoom = (room: ChatRoom) => {
        if (!current() || locks.current.has(state.key) || room.id !== latest.current.roomId)
            return;
        const target = latest.current.rooms.find(row => row.id === room.id && companyOf(row) === companyOf(latest.current.currentUser));
        if (!target)
            return;
        const run: Run = { kind: 'room', phase: 'confirm' };
        state.run = run;
        locks.current.set(state.key, run);
        state.room = { ...target, participantIds: [...target.participantIds] };
        state.error = '';
        notify();
    };
    const closeRoom = () => {
        if (!current() || state.run?.phase === 'pending')
            return;
        const run = state.run;
        state.room = null;
        state.error = '';
        if (run)
            release(run);
        else
            notify();
    };
    const confirmRoom = async () => {
        const run = state.run, target = state.room;
        if (!current() || !run || run.kind !== 'room' || run.phase !== 'confirm' || !target)
            return;
        const own = () => current() && state.run === run;
        const o = latest.current;
        if (!o.rooms.some(row => row.id === target.id && companyOf(row) === companyOf(o.currentUser)) || o.roomId !== target.id || typeof o.deleteRoom !== 'function') {
            state.error = '대화방이 변경되었습니다. 현재 목록을 다시 확인해 주세요.';
            notify();
            return;
        }
        run.phase = 'pending';
        state.error = '';
        notify();
        let success = false;
        try {
            await o.deleteRoom(target.id);
            if (own()) {
                success = true;
                state.room = null;
                latest.current.onRoomDeleted(target.id);
            }
        }
        catch (error) {
            if (own())
                state.error = '대화방 삭제 결과를 확인하지 못했습니다. ' + (error instanceof Error ? error.message : '현재 목록을 다시 확인해 주세요.');
        }
        finally {
            if (!own() || success)
                release(run);
            else {
                run.phase = 'confirm';
                notify();
            }
        }
    };
    return { busy: locks.current.has(state.key), roomTarget: state.room, roomPending: state.run?.kind === 'room' && state.run.phase === 'pending', messageTarget: state.message, messageError: state.messageError, error: state.error, removeMessage, openRoom, closeRoom, confirmRoom };
}
