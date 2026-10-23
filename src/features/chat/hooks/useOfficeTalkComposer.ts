import { useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ChatMessage, Employee } from '../../../../types';
import { companyOf } from '../../../shared/types';
import { mentionedIds } from '../../../shared/mention';
import { replySnippet } from '../../../shared/messageActions';
import { uploadChatFile, imagePatch, type ChatAttachment } from '../../../shared/chatUpload';
interface Options {
    getUid: () => string | undefined;
    roomId: string | null;
    currentUser: Employee;
    employees: Employee[];
    send: (message: ChatMessage) => void | Promise<unknown>;
    add: (message: ChatMessage) => void;
    remove: (id: string) => void;
    onError: (message: string) => void;
}
export function useOfficeTalkComposer(options: Options) {
    const [, paint] = useState(0), mounted = useRef(false), latest = useRef(options);
    latest.current = options;
    const make = () => ({ uid: options.getUid(), roomId: options.roomId, scope: companyOf(options.currentUser) + ':' + options.currentUser.id, text: '', reply: null as ChatMessage | null, revision: 0, upload: null as object | null, count: { done: 0, total: 0 } });
    const owner = useRef(make());
    const sameActor = owner.current.scope === companyOf(options.currentUser) + ':' + options.currentUser.id && owner.current.uid === options.getUid();
    if (!sameActor)
        owner.current = make();
    else if (owner.current.roomId !== options.roomId)
        owner.current = { ...make(), text: owner.current.text, reply: owner.current.reply, revision: owner.current.revision };
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && !!state.uid && latest.current.getUid() === state.uid;
    const notify = () => {
        if (current())
            paint(v => v + 1);
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const setText = (value: SetStateAction<string>) => {
        if (!current())
            return;
        state.text = typeof value === 'function' ? value(state.text) : value;
        state.revision++;
        notify();
    };
    const setReply = (value: ChatMessage | null) => {
        if (!current())
            return;
        state.reply = value;
        state.revision++;
        notify();
    };
    const capture = () => ({ text: state.text, reply: state.reply ? { ...state.reply } : null, roomId: state.roomId, user: { ...latest.current.currentUser }, employees: latest.current.employees.map(employee => ({ ...employee })), send: latest.current.send });
    const consume = () => {
        state.text = '';
        state.reply = null;
        state.revision++;
        notify();
        return state.revision;
    };
    const transmit = async (snapshot: ReturnType<typeof capture>, revision: number, attach?: ChatAttachment, photos?: Pick<ChatMessage, 'imageUrl' | 'images'>) => {
        if (!current() || !snapshot.roomId)
            return;
        const mentions = mentionedIds(snapshot.text, snapshot.employees);
        const message: ChatMessage = { id: `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, companyId: companyOf(snapshot.user), roomId: snapshot.roomId, senderId: snapshot.user.id, senderName: snapshot.user.name, text: snapshot.text, createdAt: new Date().toISOString(), ...(attach?.isImage ? { imageUrl: attach.url } : {}), ...(attach && !attach.isImage ? { fileUrl: attach.url, fileName: attach.name, fileSize: attach.size } : {}), ...(photos ?? {}), ...(mentions.length ? { mentions } : {}), ...(snapshot.reply ? { replyTo: replySnippet(snapshot.reply) } : {}) };
        latest.current.add(message);
        try {
            await snapshot.send(message);
        }
        catch (error) {
            latest.current.remove(message.id);
            if (current()) {
                if (state.revision === revision) {
                    state.text = snapshot.text;
                    state.reply = snapshot.reply;
                    state.revision++;
                }
                latest.current.onError(`메시지 전송 실패: ${error instanceof Error ? error.message : '네트워크 오류'}`);
                notify();
            }
        }
    };
    const send = async () => {
        if (!current() || !state.roomId || !state.text.trim())
            return;
        const snapshot = capture(), revision = consume();
        await transmit(snapshot, revision);
    };
    const sendFiles = async (files: File[]) => {
        if (!current() || !state.roomId || state.upload || !files.length)
            return;
        const snapshot = capture(), run = {}, initialRevision = state.revision;
        let consumedRevision: number | null = null;
        state.upload = run;
        state.count = { done: 0, total: files.length };
        notify();
        const own = () => current() && state.upload === run;
        const failures: string[] = [];
        const sendAttachment = async (attach?: ChatAttachment, photos?: Pick<ChatMessage, 'imageUrl' | 'images'>) => {
            if (!own())
                return;
            if (consumedRevision === null && state.revision === initialRevision)
                consumedRevision = consume();
            await transmit(snapshot, consumedRevision ?? -1, attach, photos);
        };
        const upload = async (file: File) => {
            if (!own())
                return null;
            try {
                const value = await uploadChatFile(companyOf(snapshot.user), snapshot.roomId!, file);
                return own() ? value : null;
            }
            catch (error) {
                if (own())
                    failures.push(`${file.name}: ${error instanceof Error ? error.message : '네트워크 오류'}`);
                return null;
            }
            finally {
                if (own()) {
                    state.count = { ...state.count, done: state.count.done + 1 };
                    notify();
                }
            }
        };
        try {
            const photos = files.filter(f => (f.type || '').startsWith('image/'));
            const docs = files.filter(f => !(f.type || '').startsWith('image/'));
            if (photos.length) {
                const urls = (await Promise.all(photos.map(upload))).filter((a): a is ChatAttachment => !!a).map(a => a.url);
                if (own() && urls.length)
                    await sendAttachment(undefined, imagePatch(urls));
            }
            for (const file of docs) {
                if (!own())
                    break;
                const value = await upload(file);
                if (own() && value)
                    await sendAttachment(value);
            }
            if (own() && failures.length)
                latest.current.onError(`${failures.length}개를 못 보냈습니다 — ${failures[0]}`);
        }
        finally {
            if (own()) {
                state.upload = null;
                state.count = { done: 0, total: 0 };
                notify();
            }
        }
    };
    return { messageText: state.text, replyTo: state.reply, setMessageText: setText, setReplyTo: setReply, send, sendFiles, uploading: !!state.upload, uploadCount: state.count };
}
