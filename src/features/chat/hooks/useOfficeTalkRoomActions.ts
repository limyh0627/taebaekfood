import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatRoom, Employee } from '../../../../types';
import { companyOf } from '../../../shared/types';
import { renameRoomPatch } from '../../../shared/roomName';
import { pinPatch, unpinPatch, canPin } from '../../../shared/roomNotice';
import { participantCompaniesOf } from '../../../shared/chatParticipants';
export function useOfficeTalkRoomActions(options: {
    room: ChatRoom | undefined;
    currentUser: Employee;
    employees: Employee[];
    getUid: () => string | undefined;
    update: (id: string, patch: Partial<ChatRoom>) => void | Promise<unknown>;
    onNotice: (text: string) => void;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options), locks = useRef(new Map<string, object>());
    latest.current = options;
    const make = () => ({ key: companyOf(options.currentUser) + ':' + options.currentUser.id + ':' + (options.room?.id ?? ''), uid: options.getUid(), nameOpen: false, name: '', inviteOpen: false, selected: [] as string[], error: '', run: null as object | null, selection: {} });
    const owner = useRef(make());
    if (owner.current.key !== companyOf(options.currentUser) + ':' + options.currentUser.id + ':' + (options.room?.id ?? '') || owner.current.uid !== options.getUid())
        owner.current = make();
    const state = owner.current, selection = state.selection;
    const current = () => mounted.current && owner.current === state && state.selection === selection && !!state.uid && latest.current.getUid() === state.uid;
    const notify = () => {
        if (mounted.current && owner.current === state)
            paint(n => n + 1);
    };
    const lockKey = state.key + ':' + state.uid;
    const editable = () => current() && !locks.current.has(lockKey);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const openName = (name: string) => {
        if (!editable())
            return;
        state.nameOpen = true;
        state.name = name;
        state.error = '';
        state.selection = {};
        notify();
    };
    const setName = (value: string) => {
        if (!editable())
            return;
        state.name = value;
        notify();
    };
    const closeName = () => {
        if (!editable())
            return;
        state.nameOpen = false;
        state.selection = {};
        notify();
    };
    const openInvite = () => {
        if (!editable())
            return;
        state.inviteOpen = true;
        state.selected = [];
        state.error = '';
        state.selection = {};
        notify();
    };
    const closeInvite = () => {
        if (!editable())
            return;
        state.inviteOpen = false;
        state.selection = {};
        notify();
    };
    const toggle = (id: string) => {
        if (!editable())
            return;
        state.selected = state.selected.includes(id) ? state.selected.filter(v => v !== id) : [...state.selected, id];
        notify();
    };
    const write = async (patch: Partial<ChatRoom>, success: () => void, label: string) => {
        const room = latest.current.room;
        if (!editable() || !room)
            return;
        const run = {};
        state.run = run;
        locks.current.set(lockKey, run);
        state.error = '';
        notify();
        const own = () => current() && state.run === run;
        try {
            if (!own())
                return;
            await latest.current.update(room.id, patch);
            if (own())
                success();
        }
        catch (error) {
            if (own())
                state.error = label + ' ' + (error instanceof Error ? error.message : '다시 시도해 주세요.');
        }
        finally {
            if (locks.current.get(lockKey) === run) {
                locks.current.delete(lockKey);
                state.run = null;
                if (mounted.current && owner.current.key === state.key && owner.current.uid === state.uid)
                    paint(n => n + 1);
            }
        }
    };
    const saveName = async () => {
        const room = latest.current.room;
        if (!room)
            return;
        await write(renameRoomPatch(room, latest.current.currentUser.id, state.name), () => {
            state.nameOpen = false;
        }, '대화방 이름 저장 결과를 확인하지 못했습니다.');
    };
    const invite = async () => {
        const source = latest.current;
        if (!editable() || !source.room || !state.selected.length)
            return;
        try {
            const participantIds = [...new Set([...source.room.participantIds, ...state.selected])];
            await write({ companyId: companyOf(source.currentUser), participantIds, participantCompanies: participantCompaniesOf(participantIds, source.employees, companyOf(source.currentUser)) }, () => {
                state.selected = [];
                state.inviteOpen = false;
            }, '멤버 초대 결과를 확인하지 못했습니다.');
        }
        catch (error) {
            if (current()) {
                state.error = '멤버 초대 대상을 확인하지 못했습니다. ' + (error instanceof Error ? error.message : '다시 확인해 주세요.');
                notify();
            }
        }
    };
    const pin = async (message: ChatMessage) => {
        if (!canPin(message))
            return;
        await write(pinPatch(message, latest.current.currentUser), () => latest.current.onNotice('공지로 올렸습니다'), '공지 등록 결과를 확인하지 못했습니다.');
    };
    const unpin = async () => {
        await write(unpinPatch(), () => latest.current.onNotice('공지를 내렸습니다'), '공지 해제 결과를 확인하지 못했습니다.');
    };
    return { isEditingRoomName: state.nameOpen, newRoomName: state.name, showInviteModal: state.inviteOpen, inviteSelected: state.selected, error: state.error, busy: locks.current.has(lockKey), openName, setName, closeName, openInvite, closeInvite, toggle, saveName, invite, pin, unpin };
}
