import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatRoom, Employee } from '../../../../types';
import { companyOf } from '../../../shared/types';
import { participantCompaniesOf } from '../../../shared/chatParticipants';
import { replySnippet } from '../../../shared/messageActions';
interface Attempt {
    source: ChatMessage;
    room: ChatRoom;
    message: ChatMessage;
    roomReady: boolean;
}
export function useOfficeTalkSelfSend(options: {
    currentUser: Employee;
    employees: Employee[];
    rooms: ChatRoom[];
    getUid: () => string | undefined;
    addRoom: (room: ChatRoom) => void | Promise<unknown>;
    sendMessage: (message: ChatMessage) => void | Promise<unknown>;
    onSuccess: (message: string) => void;
}) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ scope: companyOf(options.currentUser) + ':' + options.currentUser.id, uid: options.getUid(), run: null as object | null, attempt: null as Attempt | null, completedRoom: null as ChatRoom | null, planningSource: null as ChatMessage | null, error: '' });
    const owner = useRef(make());
    if (owner.current.scope !== companyOf(options.currentUser) + ':' + options.currentUser.id || owner.current.uid !== options.getUid())
        owner.current = make();
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
    const run = async (attempt: Attempt) => {
        if (!current() || state.run)
            return;
        const execution = {};
        state.run = execution;
        state.error = '';
        notify();
        const own = () => current() && state.run === execution;
        let stage: 'room' | 'message' = attempt.roomReady ? 'message' : 'room';
        try {
            if (!attempt.roomReady) {
                if (!own())
                    return;
                await latest.current.addRoom(JSON.parse(JSON.stringify(attempt.room)) as ChatRoom);
                if (!own())
                    return;
                attempt.roomReady = true;
                state.completedRoom = attempt.room;
            }
            stage = 'message';
            if (!own())
                return;
            await latest.current.sendMessage(JSON.parse(JSON.stringify(attempt.message)) as ChatMessage);
            if (own()) {
                state.attempt = null;
                state.planningSource = null;
                latest.current.onSuccess('나에게 보냈습니다');
            }
        }
        catch (error) {
            if (own())
                state.error = (stage === 'room' ? '나와의 대화방 생성 결과를 확인하지 못했습니다. 메시지는 보내지 않았습니다.' : '대화방 준비 후 메시지 전송 결과를 확인하지 못했습니다.') + ' ' + (error instanceof Error ? error.message : '다시 시도해 주세요.');
        }
        finally {
            if (own()) {
                state.run = null;
                notify();
            }
        }
    };
    const send = async (message: ChatMessage) => {
        if (!current() || state.run || state.attempt)
            return;
        const user = { ...latest.current.currentUser }, source = JSON.parse(JSON.stringify(message)) as ChatMessage;
        state.planningSource = source;
        try {
            const existing = latest.current.rooms.find(r => companyOf(r) === companyOf(user) && !r.isGroup && r.participantIds.length === 1 && r.participantIds[0] === user.id) ?? state.completedRoom;
            const companyId = companyOf(user), participantIds = [user.id];
            const room: ChatRoom = existing ?? { id: `ROOM-${Date.now()}`, companyId, participantIds, participantCompanies: participantCompaniesOf(participantIds, latest.current.employees, companyId), createdBy: user.id, lastUpdatedAt: new Date().toISOString(), isGroup: false };
            const payload: ChatMessage = { id: `MSG-${Date.now()}`, roomId: room.id, senderId: user.id, senderName: user.name, text: source.text, createdAt: new Date().toISOString(), replyTo: replySnippet(source) };
            const attempt: Attempt = { source, room, message: payload, roomReady: !!existing };
            state.attempt = attempt;
            await run(attempt);
        }
        catch (error) {
            if (current()) {
                state.error = '나에게 전달할 직원을 확인하지 못했습니다. ' + (error instanceof Error ? error.message : '다시 확인해 주세요.');
                notify();
            }
        }
    };
    const retry = async () => {
        if (!current())
            return;
        if (state.attempt)
            await run(state.attempt);
        else if (state.planningSource)
            await send(state.planningSource);
    };
    return { busy: !!state.run, error: state.error, source: state.attempt?.source ?? state.planningSource, send, retry };
}
