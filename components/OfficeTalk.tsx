
import React, { useState, useMemo, useEffect, useRef } from 'react';
import ConfirmModal from './ConfirmModal';
import { 
  MessageSquare, 
  Plus, 
  Search, 
  Send, 
  User, 
  Users, 
  MoreVertical, 
  Edit2, 
  Check, 
  X,
  AtSign,
  Image as ImageIcon,
  Paperclip,
  Loader2,
  Download,
  ArrowLeft,
  Pin
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee, ChatRoom, ChatMessage } from '../types';
import { appendMention, replaceMentionQuery, mentionedIds, MENTION_ADMIN, MENTION_ADMIN_ID } from '../src/shared/mention';
import { uploadChatFile, filesFromPaste, messageImages, imagePatch, fileSizeLabel, saveImage, ChatAttachment } from '../src/shared/chatUpload';
import { canPin, pinPatch, unpinPatch, noticeOf, noticeLine, isPinned } from '../src/shared/roomNotice';
import { consumeSharedText } from '../src/shared/shareTarget';
import { roomNameFor, renameRoomPatch, isOwner } from '../src/shared/roomName';
import { notify, notifyPermission, loadNotifyMode, saveNotifyMode, NotifyMode } from '../src/shared/notify';
import {
  collection,
  query,
  where,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../src/firebase';
import { actionsFor, replySnippet, deletePatch, isDeleted, type MessageAction } from '../src/shared/messageActions';

interface OfficeTalkProps {
  currentUser: Employee;
  employees: Employee[];
  chatRooms: ChatRoom[];
  chatMessages: ChatMessage[];
  initialRoomId?: string | null;
  onRoomOpened?: () => void;
  onAddRoom: (_room: ChatRoom) => void;
  onUpdateRoom: (_id: string, _data: Partial<ChatRoom>) => void;
  onDeleteRoom: (_id: string) => void;
  onSendMessage: (_msg: ChatMessage) => void;
  /** 말 지우기 — 줄은 남기고 내용만 비운다(shared/messageActions) */
  onUpdateMessage?: (_id: string, _data: Partial<ChatMessage>) => void;
  /** 관리자면 남의 말도 지울 수 있다 */
  isAdmin?: boolean;
}


const OfficeTalk: React.FC<OfficeTalkProps> = ({
  currentUser,
  employees,
  chatRooms,
  initialRoomId,
  onRoomOpened,
  onAddRoom,
  onUpdateRoom,
  onDeleteRoom,
  onSendMessage,
  onUpdateMessage,
  isAdmin,
}) => {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (initialRoomId) {
      setActiveRoomId(initialRoomId);
      onRoomOpened?.();
    }
  }, [initialRoomId]);
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isEditingRoomName, setIsEditingRoomName] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSelected, setInviteSelected] = useState<string[]>([]);
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  //  카톡처럼 사진·파일은 + 뒤에 숨긴다 — 입력칸이 좁아지는 걸 막는다(2026-09-03 사장님)
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  //  여러 장 올릴 때 '3장 중 1장' 을 보이려고 센다
  const [uploadCount, setUploadCount] = useState({ done: 0, total: 0 });
  //  **카톡·문자에서 공유해 들어온 글**(2026-09-03 사장님).
  //  들어올 땐 대화방이 안 정해져 있다. 방을 고를 때까지 들고 있다가 입력칸에 넣는다.
  const [pendingShare, setPendingShare] = useState<string>(() => consumeSharedText());
  //  사진을 눌렀을 때 — 전에는 새 탭으로 보내서 앱 밖으로 나가 버렸다(2026-09-03 사장님).
  //  여러 장을 묶어 보낼 수 있게 되면서(2026-09-09) **그 말의 사진 전부**를 들고 다닌다 —
  //  크게 띄운 채로 옆으로 넘길 수 있어야 한 장씩 닫았다 열 일이 없다.
  const [viewer, setViewer] = useState<{ urls: string[]; at: number } | null>(null);
  //  공지를 펼쳐 뒀나. 방을 옮기면 다시 접는다 — 앞 방에서 펼친 채로 넘어가면 남의 공지가 길게 뜬다
  const [noticeOpen, setNoticeOpen] = useState(false);
  const viewImage = viewer ? viewer.urls[viewer.at] : null;
  const 넘기기 = (걸음: number) => setViewer(v =>
    v ? { ...v, at: (v.at + 걸음 + v.urls.length) % v.urls.length } : v);
  const prevRoomTimestamps = useRef<Record<string, string>>({});
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(notifyPermission);
  const [notifMode, setNotifMode] = useState<NotifyMode>(loadNotifyMode);
  const [showNotifSettings, setShowNotifSettings] = useState(false);

  const saveNotifMode = (mode: NotifyMode) => { setNotifMode(mode); saveNotifyMode(mode); };


  //  종에서 권한을 켜면 이 화면 표시도 따라간다 — 화면을 다시 볼 때 한 번 확인한다
  useEffect(() => {
    const 다시읽기 = () => setNotifPermission(notifyPermission());
    window.addEventListener('focus', 다시읽기);
    return () => window.removeEventListener('focus', 다시읽기);
  }, []);

  //  **새 메시지 알림은 여기서 안 한다**(2026-09-03 사장님).
  //  이 화면 안에서 감지하면 오피스톡을 보고 있을 때만 알림이 온다. 지금은 AdminApp 이
  //  화면 밖에서 지켜본다 — [newChatAlert.ts](../src/shared/newChatAlert.ts).

  const markRoomAsRead = (roomId: string) => {
    const room = chatRooms.find(r => r.id === roomId);
    if (!room) return;
    const now = new Date().toISOString();
    onUpdateRoom(roomId, {
      lastReadBy: { ...(room.lastReadBy ?? {}), [currentUser.id]: now }
    });
  };

  // Firestore 실시간 리스너
  useEffect(() => {
    // 이전 리스너 정리
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setLocalMessages([]);
    setFirestoreError(null);

    setNoticeOpen(false);
    if (!activeRoomId) return;

    // 방 열릴 때 읽음 처리
    markRoomAsRead(activeRoomId);

    setIsLoadingMore(true);

    const q = query(
      collection(db, 'chatMessages'),
      where('roomId', '==', activeRoomId)
    );

    unsubscribeRef.current = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setLocalMessages(msgs);
      setIsLoadingMore(false);
      setFirestoreError(null);
    }, (error) => {
      console.error('Firestore 실시간 수신 오류:', error);
      setIsLoadingMore(false);
      setFirestoreError(`메시지를 불러오지 못했습니다: ${error.message}`);
    });

    return () => {
      unsubscribeRef.current?.();
    };
  }, [activeRoomId]);


  // Filter rooms where current user is a participant
  const myRooms = useMemo(() => {
    return chatRooms
      .filter(room => room.participantIds.includes(currentUser.id))
      .sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime());
  }, [chatRooms, currentUser.id]);

  const activeRoom = useMemo(() => {
    return chatRooms.find(r => r.id === activeRoomId);
  }, [chatRooms, activeRoomId]);

  useEffect(() => {
    if (!isLoadingMore) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [localMessages, isLoadingMore]);

  //  이름 규칙은 shared/roomName.ts 하나가 안다 — 목록·머리·알림이 같은 이름을 쓴다
  const getRoomName = (room: ChatRoom) => roomNameFor(room, currentUser.id, employees);

  /**
   * 방 이름 저장. **방장이면 모두의 기본이 바뀌고, 아니면 나한테만 바뀐다** —
   * 어느 칸에 쓸지는 [roomName.ts](../src/shared/roomName.ts) 가 정한다.
   */
  const saveRoomName = () => {
    const room = chatRooms.find(r => r.id === activeRoomId);
    if (!room) return;
    onUpdateRoom(room.id, renameRoomPatch(room, currentUser.id, newRoomName));
    setIsEditingRoomName(false);
  };

  const handleCreateRoom = () => {
    if (selectedParticipants.length === 0) return;
    
    const participantIds = [...new Set([...selectedParticipants, currentUser.id])];
    
    // Check if 1:1 room already exists
    if (participantIds.length === 2) {
      const existingRoom = chatRooms.find(r => 
        !r.isGroup && 
        r.participantIds.length === 2 && 
        r.participantIds.every(id => participantIds.includes(id))
      );
      if (existingRoom) {
        setActiveRoomId(existingRoom.id);
        setIsNewChatModalOpen(false);
        setSelectedParticipants([]);
        return;
      }
    }

    const newRoom: ChatRoom = {
      id: `ROOM-${Date.now()}`,
      participantIds,
      createdBy: currentUser.id,   // 기본 이름을 정할 수 있는 사람
      lastUpdatedAt: new Date().toISOString(),
      isGroup: participantIds.length > 2
    };

    onAddRoom(newRoom);
    setActiveRoomId(newRoom.id);
    setIsNewChatModalOpen(false);
    setSelectedParticipants([]);
  };

  useEffect(() => {
    if (!pendingShare || !activeRoomId) return;
    setMessageText(t => (t ? t + '\n' + pendingShare : pendingShare));
    setPendingShare('');
    inputRef.current?.focus();
  }, [pendingShare, activeRoomId]);

  /**
   * @param attach 사진 아닌 첨부(문서·엑셀) 하나
   * @param photos 사진 여럿을 묶어 보낼 때 — 어느 칸에 실을지는 [imagePatch](../src/shared/chatUpload.ts) 가 정한다
   */
  const handleSendMessage = async (
    e?: React.FormEvent,
    attach?: ChatAttachment,
    photos?: Pick<ChatMessage, 'imageUrl' | 'images'>,
  ) => {
    e?.preventDefault();
    const 사진있음 = !!(photos?.imageUrl || photos?.images?.length);
    if ((!messageText.trim() && !attach && !사진있음) || !activeRoomId || isSending) return;

    //  누가 불렸나 — 이름 겹침·@관리자까지 shared/mention 이 혼자 판단한다
    const mentions = mentionedIds(messageText, employees);

    const newMessage: ChatMessage = {
      id: `MSG-${Date.now()}`,
      roomId: activeRoomId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: messageText,
      createdAt: new Date().toISOString(),
      ...(attach?.isImage ? { imageUrl: attach.url } : {}),
      ...(attach && !attach.isImage ? { fileUrl: attach.url, fileName: attach.name, fileSize: attach.size } : {}),
      ...(photos ?? {}),
      ...(mentions.length > 0 ? { mentions } : {}),
      //  답장이면 그때 보인 글을 같이 담는다 — 원본이 지워져도 무엇에 답한 건지 남는다
      ...(replyTo ? { replyTo: replySnippet(replyTo) } : {}),
    };

    setIsSending(true);
    const savedText = messageText;
    setMessageText('');
    setReplyTo(null);
    try {
      await (onSendMessage as (_msg: ChatMessage) => Promise<void>)(newMessage);
    } catch (err: any) {
      console.error('메시지 전송 오류:', err);
      setMessageText(savedText);
      setFirestoreError(`메시지 전송 실패: ${err?.message || '네트워크 오류'}`);
    } finally {
      setIsSending(false);
    }
  };

  //  사진·파일 한 길 — Storage 에 올리고 주소만 메시지에 싣는다.
  //  base64 로 글자에 실으면 Firestore 1MB 한계에 걸려 폰 사진은 아예 안 갔다.
  //  **고르든 붙여넣든 여기 하나를 지난다.**
  /**
   * **여러 장이면 한 말로 묶는다**(2026-09-09 사장님). 사진 다섯 장이 다섯 줄로 오면 대화가 밀린다.
   *
   * 사진이 아닌 것(문서·엑셀)은 말 하나에 한 개만 실을 수 있어서 **따로 보낸다** —
   * 묶어 봐야 첫 장 말고는 표시할 자리가 없다.
   * 한 장이라도 실패하면 그 장만 건너뛰고 나머지는 보낸다. 통째로 버리는 게 더 나쁘다.
   */
  const sendFiles = async (files: File[]) => {
    if (!activeRoomId || files.length === 0) return;
    const 사진 = files.filter(f => (f.type || '').startsWith('image/'));
    const 그밖 = files.filter(f => !(f.type || '').startsWith('image/'));
    setUploading(true);
    setUploadCount({ done: 0, total: files.length });
    const 실패: string[] = [];
    const 올리기 = async (f: File) => {
      try { return await uploadChatFile(activeRoomId, f); }
      catch (err: any) { 실패.push(`${f.name}: ${err?.message || '네트워크 오류'}`); return null; }
      finally { setUploadCount(c => ({ ...c, done: c.done + 1 })); }
    };
    try {
      if (사진.length > 0) {
        const urls = (await Promise.all(사진.map(올리기))).filter(Boolean).map(a => a!.url);
        if (urls.length > 0) await handleSendMessage(undefined, undefined, imagePatch(urls));
      }
      for (const f of 그밖) {
        const a = await 올리기(f);
        if (a) await handleSendMessage(undefined, a);
      }
      if (실패.length > 0) setFirestoreError(`${실패.length}개를 못 보냈습니다 — ${실패[0]}`);
    } finally {
      setUploading(false);
      setUploadCount({ done: 0, total: 0 });
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';           // 같은 파일을 다시 골라도 다시 올라가게
    await sendFiles(files);
  };

  /**
   * **Ctrl+V 로 사진을 붙인다**(2026-09-07 사장님) — 캡처해서 바로 보내는 길.
   *
   * 클립보드에서 파일을 꺼내는 건 [chatUpload.filesFromPaste](../src/shared/chatUpload.ts) 가 안다.
   * **글자면 빈 배열이 오고, 그때는 아무것도 안 한다** — 여기서 preventDefault 를 해버리면
   * 글자 붙여넣기가 통째로 죽는다.
   *
   * 파일은 **기다리기 전에** 꺼내야 한다. await 를 지나면 브라우저가 클립보드를 놓아 버린다.
   */
  const 붙여넣기 = (data: DataTransfer | null, prevent: () => void): boolean => {
    if (!activeRoomId) return false;
    const files = filesFromPaste(data);
    if (files.length === 0) return false;
    prevent();
    void sendFiles(files);
    return true;
  };

  /**
   * 입력칸 밖에서 눌러도 붙는다 — 방을 열어 두고 바로 Ctrl+V 하는 게 자연스럽다.
   * **글자 칸에 커서가 있으면 손대지 않는다** — 그 칸이 제 몫을 한다(입력칸은 제 onPaste 가,
   * 방 이름 고치는 칸은 글자를 받아야 한다). 안 그러면 방 이름 고치다 사진이 날아간다.
   */
  useEffect(() => {
    if (!activeRoomId) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))) return;
      붙여넣기(e.clipboardData, () => e.preventDefault());
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    //  일부러 딸림값을 안 적는다 — 매 렌더 다시 달아야 방·보내기 함수가 늘 지금 것이다.
    //  붙였다 떼는 비용은 없다시피 하고, 묵은 닫힘(stale closure)으로 엉뚱한 방에 보내는 게 훨씬 나쁘다.
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessageText(value);

    const lastAtIdx = value.lastIndexOf('@');
    if (lastAtIdx !== -1 && (lastAtIdx === 0 || value[lastAtIdx - 1] === ' ')) {
      const query = value.slice(lastAtIdx + 1);
      if (!query.includes(' ')) {
        setMentionSearch(query);
      } else {
        setMentionSearch(null);
      }
    } else {
      setMentionSearch(null);
    }
  };

  const insertMention = (name: string) => {
    if (mentionSearch === null) return;
    setMessageText(replaceMentionQuery(messageText, mentionSearch, name));
    setMentionSearch(null);
    inputRef.current?.focus();
  };

  //  **메시지를 꾹 누르면 창이 뜬다**(2026-09-06 사장님, 카톡처럼).
  //  할 수 있는 일을 고르는 규칙은 [shared/messageActions](../src/shared/messageActions.ts) 가 안다.
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionMsg, setActionMsg] = useState<ChatMessage | null>(null);
  /** 답장할 말 — 입력칸 위에 인용으로 뜬다 */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [알림글, set알림글] = useState('');

  const cancelLongPress = () => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } };
  const startLongPress = (msg: ChatMessage) => {
    cancelLongPress();
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null;
      if (actionsFor({ msg, me: currentUser, isAdmin, pinned: isPinned(activeRoom, msg) }).length === 0) return;   // 지운 말
      setActionMsg(msg);
      navigator.vibrate?.(15);
    }, 450);
  };

  /** 잠깐 뜨는 알림 — '복사했습니다' 같은 것 */
  const 알리기 = (t: string) => { set알림글(t); setTimeout(() => set알림글(''), 1600); };

  /** 나와의 대화방 — 없으면 만든다. '나에게' 가 쓴다. */
  const myRoom = useMemo(
    () => chatRooms.find(r => !r.isGroup && r.participantIds.length === 1 && r.participantIds[0] === currentUser.id),
    [chatRooms, currentUser.id]);

  const doAction = async (act: MessageAction, msg: ChatMessage) => {
    setActionMsg(null);
    if (act === '복사') {
      try { await navigator.clipboard.writeText(msg.text); 알리기('복사했습니다'); }
      catch { 알리기('복사하지 못했습니다'); }
      return;
    }
    if (act === '답장') { setReplyTo(msg); inputRef.current?.focus(); return; }
    if (act === '공유') {
      //  폰이 공유 시트를 열어 준다. 없으면(PC) 복사로 물러선다.
      if (navigator.share) { try { await navigator.share({ text: msg.text }); } catch { /* 사람이 닫음 */ } return; }
      try { await navigator.clipboard.writeText(msg.text); 알리기('공유를 못 써서 복사했습니다'); } catch { /* 무시 */ }
      return;
    }
    if (act === '공지 등록' || act === '공지 내리기') {
      if (!activeRoomId) return;
      if (act === '공지 내리기') { onUpdateRoom(activeRoomId, unpinPatch()); 알리기('공지를 내렸습니다'); return; }
      //  글이 없는 말은 띠에 그릴 게 없다. 창에도 안 뜨지만 한 번 더 막는다.
      if (!canPin(msg)) { 알리기('글이 있는 말만 공지가 됩니다'); return; }
      onUpdateRoom(activeRoomId, pinPatch(msg, currentUser));
      setNoticeOpen(false);
      알리기('공지로 올렸습니다');
      return;
    }
    if (act === '나에게') {
      let room = myRoom;
      if (!room) {
        //  나와의 대화방이 없으면 만든다 — 메모장처럼 쓰는 자리다
        room = { id: `ROOM-${Date.now()}`, participantIds: [currentUser.id], createdBy: currentUser.id,
                 lastUpdatedAt: new Date().toISOString(), isGroup: false } as ChatRoom;
        onAddRoom(room);
      }
      await (onSendMessage as (_m: ChatMessage) => Promise<void>)({
        id: `MSG-${Date.now()}`, roomId: room.id,
        senderId: currentUser.id, senderName: currentUser.name,
        text: msg.text, createdAt: new Date().toISOString(),
        replyTo: replySnippet(msg),
      } as ChatMessage);
      알리기('나에게 보냈습니다');
      return;
    }
    if (act === '삭제') {
      if (!window.confirm('이 말을 지울까요?\n(줄은 남고 내용만 지워집니다)')) return;
      onUpdateMessage?.(msg.id, deletePatch(currentUser.id));
      알리기('지웠습니다');
    }
  };

  /**
   *  **보내기 전에 누가 불렸는지 보여준다**(2026-09-03 사장님).
   *  `@이름` 을 쳐도 글자만 남아서 멘션이 먹었는지 알 수 없었다.
   *  전송할 때 쓰는 mentionedIds 를 그대로 써야 화면과 실제가 안 갈라진다.
   */
  const pendingMentions = useMemo(() => {
    return mentionedIds(messageText, employees).map(id =>
      id === MENTION_ADMIN_ID ? MENTION_ADMIN : (employees.find(e => e.id === id)?.name ?? '')
    ).filter(Boolean);
  }, [messageText, employees]);

  const filteredMentionUsers = useMemo(() => {
    if (mentionSearch === null) return [];
    const list = employees.filter(e => e.id !== currentUser.id);
    const results = list.filter(e => e.name.toLowerCase().includes(mentionSearch.toLowerCase()));
    
    // Add "관리자" to the list if it matches
    if ('관리자'.includes(mentionSearch.toLowerCase())) {
      return [...results, { id: 'admin', name: '관리자', position: '시스템', department: '관리' } as any];
    }
    return results;
  }, [employees, mentionSearch, currentUser.id]);

  return (
    <div className="flex bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden relative" style={{ height: 'calc(100dvh - 120px)' }}>
      {/* Sidebar: Room List */}
      <div className={`w-full lg:w-80 border-r border-slate-100 flex flex-col bg-slate-50/30 ${activeRoomId ? 'hidden lg:flex' : 'flex'}`}>
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-900">오피스톡</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNotifSettings(p => !p)}
                className={`p-2 rounded-xl transition-all ${showNotifSettings ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-100'}`}
                title="알림 설정"
              >
                🔔
              </button>
              <button
                onClick={() => setIsNewChatModalOpen(true)}
                className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          {/* 알림 설정 패널 */}
          {showNotifSettings && (
            <div className="mb-4 p-3 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col gap-2">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">알림 방식</p>
              <div className="flex gap-2">
                {([
                  { value: 'sound',     label: '🔊 소리' },
                  { value: 'vibration', label: '📳 진동' },
                  { value: 'both',      label: '🔊+📳 둘 다' },
                ] as const).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => saveNotifMode(value)}
                    className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all border ${
                      notifMode === value
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/*  **권한은 여기서 안 묻는다**(2026-09-03 사장님) — 묻는 자리가 흩어져 있으면
                   어디서 켰는지 헷갈린다. 폰 알림 권한은 **계정 메뉴 한 곳**에서만 받는다.
                   여기 남은 건 소리를 낼지 진동을 줄지 하는 취향이고, 그 값도 공용 자리에 있다. */}
              {notifPermission !== 'granted' && (
                <p className="text-[10px] font-bold text-amber-600 px-1 leading-relaxed">
                  폰 알림은 왼쪽 아래 <b>계정</b> 을 눌러 한 번만 켜면 됩니다.
                </p>
              )}
              {notifPermission === 'granted' && (
                <p className="text-[10px] text-emerald-600 font-bold px-1">✅ 폰 알림 켜져 있음</p>
              )}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input 
              type="text" 
              placeholder="대화방 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>

        {pendingShare && (
          <div className="mx-2 mt-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
            <p className="text-[10px] font-black text-indigo-700 mb-0.5">공유된 내용 — 보낼 대화방을 고르세요</p>
            <p className="text-[10px] font-bold text-indigo-500 line-clamp-2 whitespace-pre-wrap">{pendingShare}</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
          {myRooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-6 text-center">
              <MessageSquare size={48} className="mb-4 opacity-20" />
              <p className="text-sm font-bold">참여 중인 대화방이 없습니다.</p>
              <p className="text-[10px]">새 대화를 시작해보세요.</p>
            </div>
          ) : (
            myRooms
              .filter(room => getRoomName(room).toLowerCase().includes(searchTerm.toLowerCase()))
              .map(room => {
                const isUnread = room.lastUpdatedAt > (room.lastReadBy?.[currentUser.id] ?? '');
                return (
                <button
                  key={room.id}
                  onClick={() => { setActiveRoomId(room.id); markRoomAsRead(room.id); }}
                  className={`w-full flex items-center space-x-3 p-4 rounded-2xl transition-all ${
                    activeRoomId === room.id
                      ? 'bg-white shadow-md border border-slate-100'
                      : 'hover:bg-white/50'
                  }`}
                >
                  <div className={`relative w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${
                    room.isGroup ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'
                  }`}>
                    {room.isGroup ? <Users size={24} /> : <User size={24} />}
                    {isUnread && activeRoomId !== room.id && (
                      <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border-2 border-white" />
                    )}
                  </div>
                  <div className="flex-1 text-left overflow-hidden">
                    <div className="flex items-center justify-between mb-1">
                      <p className={`text-sm truncate ${isUnread && activeRoomId !== room.id ? 'font-black text-slate-900' : 'font-black text-slate-800'}`}>{getRoomName(room)}</p>
                      <span className="text-[9px] font-bold text-slate-400 shrink-0 ml-1">
                        {room.lastUpdatedAt ? new Date(room.lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p className={`text-[11px] truncate ${isUnread && activeRoomId !== room.id ? 'font-bold text-slate-700' : 'font-medium text-slate-500'}`}>
                      {room.lastMessage || '대화 내용이 없습니다.'}
                    </p>
                  </div>
                </button>
              )})
          )}
        </div>
      </div>

      {/* Main Content: Chat Window */}
      <div className={`flex-1 flex flex-col bg-white min-h-0 min-w-0 ${!activeRoomId ? 'hidden lg:flex' : 'flex'}`}>
        {activeRoom ? (
          <>
            {/* Chat Header */}
            <div className="p-4 lg:p-6 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
              <div className="flex items-center space-x-3 lg:space-x-4">
                <button 
                  onClick={() => setActiveRoomId(null)}
                  className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className={`w-10 h-10 lg:w-12 lg:h-12 rounded-2xl flex items-center justify-center shadow-sm ${
                  activeRoom.isGroup ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'
                }`}>
                  {activeRoom.isGroup ? <Users size={20} className="lg:hidden" /> : <User size={20} className="lg:hidden" />}
                  {activeRoom.isGroup ? <Users size={24} className="hidden lg:block" /> : <User size={24} className="hidden lg:block" />}
                </div>
                <div>
                  {isEditingRoomName ? (
                    /*  **폰에서 저장이 안 됐다**(2026-09-03 사장님) — 입력칸이 좁은 머리에서
                        넘쳐 ✓ 버튼이 화면 밖으로 밀렸다. 폭을 잡고, 엔터로도 저장되게 한다. */
                    <div className="flex items-center gap-1 min-w-0">
                      <input 
                        type="text"
                        value={newRoomName}
                        onChange={(e) => setNewRoomName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveRoomName(); }
                          if (e.key === 'Escape') setIsEditingRoomName(false);
                        }}
                        placeholder={isOwner(activeRoom, currentUser.id) ? '모두에게 보일 이름' : '나에게만 보일 이름'}
                        className="min-w-0 flex-1 w-28 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button 
                        onClick={saveRoomName}
                        aria-label="저장"
                        className="shrink-0 p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                      >
                        <Check size={16} />
                      </button>
                      <button 
                        onClick={() => setIsEditingRoomName(false)}
                        aria-label="취소"
                        className="shrink-0 p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 min-w-0">
                      <h3 className="text-base lg:text-lg font-black text-slate-900 truncate">{getRoomName(activeRoom)}</h3>
                      <button 
                        onClick={() => {
                          //  내가 고쳐 둔 게 있으면 그걸, 없으면 지금 보이는 이름을 띄운다
                          setNewRoomName(activeRoom.nameBy?.[currentUser.id] || activeRoom.name || getRoomName(activeRoom));
                          setIsEditingRoomName(true);
                        }}
                        aria-label="이름 바꾸기"
                        className="shrink-0 p-1 text-slate-300 hover:text-indigo-600 transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] font-bold text-slate-400 truncate max-w-[180px] lg:max-w-xs">
                    {(() => {
                      const names = activeRoom.participantIds.map(id => employees.find(e => e.id === id)?.name || '').filter(Boolean);
                      const joined = names.join(', ');
                      return `${names.length}명 · ${joined}`;
                    })()}
                  </p>
                </div>
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowRoomMenu(p => !p)}
                  className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
                >
                  <MoreVertical size={20} />
                </button>
                {showRoomMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-2xl border border-slate-100 shadow-xl z-50 overflow-hidden w-36">
                    <button
                      onClick={() => { setInviteSelected([]); setShowInviteModal(true); setShowRoomMenu(false); }}
                      className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                    >
                      멤버 초대
                    </button>
                    <button
                      onClick={() => {
                        setShowRoomMenu(false);
                        setConfirmModal({
                          message: `'${activeRoom.name}' 대화방을 삭제하시겠습니까?`,
                          subMessage: '모든 메시지가 삭제되며 복구할 수 없습니다.',
                          onConfirm: () => { onDeleteRoom(activeRoom.id); setActiveRoomId(null); setConfirmModal(null); },
                        });
                      }}
                      className="w-full px-4 py-3 text-left text-sm font-bold text-rose-500 hover:bg-rose-50 transition-colors"
                    >
                      대화방 삭제
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/*  **공지 띠**(2026-09-09 사장님) — 카톡처럼 방 맨 위에 붙어 있는다.
                 접혀 있을 땐 한 줄만, 누르면 전문이 펼쳐진다. 여러 줄 공지가 띠를 세 겹으로
                 만들면 대화가 밀리기 때문이다. 방마다 하나뿐이라 새로 붙이면 앞의 것이 물러난다. */}
            {(() => {
              const 공지 = noticeOf(activeRoom);
              if (!공지) return null;
              return (
                <div className="shrink-0 border-b border-slate-100 bg-white">
                  <div className="flex items-start gap-2 px-4 py-2">
                    <Pin size={13} className="shrink-0 mt-0.5 text-slate-400" />
                    <button
                      onClick={() => setNoticeOpen(v => !v)}
                      className="flex-1 min-w-0 text-left"
                      title={noticeOpen ? '접기' : '펼치기'}
                    >
                      <p className={`text-[11px] font-bold text-slate-700 ${noticeOpen ? 'whitespace-pre-wrap' : 'truncate'}`}>
                        {noticeOpen ? 공지.text : noticeLine(공지)}
                      </p>
                      {noticeOpen && (
                        <p className="text-[10px] font-bold text-slate-400 mt-1">
                          {공지.byName} · {new Date(공지.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </button>
                    <button
                      onClick={() => onUpdateRoom(activeRoom.id, unpinPatch())}
                      aria-label="공지 내리기"
                      title="공지 내리기"
                      className="shrink-0 p-1 text-slate-300 hover:text-slate-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Messages List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-0.5 custom-scrollbar bg-slate-50/30">
              {firestoreError && (
                <div className="flex items-center space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-bold text-rose-600">
                  <X size={14} className="shrink-0" />
                  <span>{firestoreError}</span>
                  <button onClick={() => setFirestoreError(null)} className="ml-auto text-rose-400 hover:text-rose-600"><X size={12} /></button>
                </div>
              )}
              {isLoadingMore && (
                <div className="flex justify-center py-2">
                  <Loader2 size={18} className="animate-spin text-slate-400" />
                </div>
              )}

              {localMessages.length === 0 && !isLoadingMore ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-300 space-y-2">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                    <MessageSquare size={32} className="opacity-20" />
                  </div>
                  <p className="text-xs font-bold">첫 메시지를 보내보세요!</p>
                </div>
              ) : (
                localMessages.map((msg, idx) => {
                  const isMine = msg.senderId === currentUser.id;
                  const showSender = idx === 0 || localMessages[idx - 1].senderId !== msg.senderId;
                  //  시간은 이어 말한 덩어리의 마지막에만 — 줄마다 찍으면 지저분하다(카톡과 같다)
                  const nx = localMessages[idx + 1];
                  const showTime = !nx || nx.senderId !== msg.senderId
                    || msg.createdAt.slice(0, 16) !== nx.createdAt.slice(0, 16);
                  
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} ${showSender ? 'mt-3 first:mt-0' : ''}`}>
                      {!isMine && showSender && (
                        <p className="text-[10px] font-black text-slate-400 mb-1 ml-1 uppercase tracking-tighter">
                          {msg.senderName}
                        </p>
                      )}
                      <div
                        //  폰은 꾹 누르기, PC는 **우클릭** — 같은 창이 뜬다(2026-09-06 사장님)
                        //  **마우스로는 꾹 눌러도 창이 안 뜬다**(2026-09-07 사장님) — 글자를 긁으려고
                        //  누르고 끄는 데 0.45초가 넘게 걸려서, 긁는 도중에 창이 튀어나왔다.
                        onPointerDown={(e) => { if (e.pointerType !== 'mouse') startLongPress(msg); }}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onContextMenu={(e) => {
                          //  글자를 긁어 뒀으면 브라우저 메뉴를 그대로 둔다 — 거기 '복사'가 있다
                          if (!window.getSelection()?.isCollapsed) return;
                          e.preventDefault(); cancelLongPress();
                          if (actionsFor({ msg, me: currentUser, isAdmin, pinned: isPinned(activeRoom, msg) }).length) setActionMsg(msg);
                        }}
                        title={isDeleted(msg) ? undefined : '꾹 누르기 (PC는 우클릭 · 긁어서 복사도 됩니다)'}
                        className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm font-medium shadow-sm relative group msg-bubble ${
                        //  지금 공지로 걸린 말은 테두리로 표시한다 — 위 띠가 어느 말에서 온 건지 보인다
                        isPinned(activeRoom, msg) ? 'ring-2 ring-slate-300 ' : ''}${
                        isDeleted(msg)
                          ? 'bg-slate-50 text-slate-400 border border-dashed border-slate-200 italic'
                          : isMine
                          ? 'bg-indigo-600 text-white rounded-tr-none active:scale-[0.99] transition-transform'
                          : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none active:scale-[0.99] transition-transform'
                      }`}>
                        {/*  **사진 — 한 장이든 여러 장이든 messageImages 한 곳을 지난다.**
                             한 장은 예전처럼 크게, 여러 장은 정사각 격자로 묶는다(카톡과 같다).
                             두 장·네 장은 2칸, 셋 이상 홀수는 3칸이 덜 허전하다. */}
                        {(() => {
                          if (isDeleted(msg)) return null;
                          const 사진들 = messageImages(msg);
                          if (사진들.length === 0) return null;
                          if (사진들.length === 1) return (
                            <div className="mb-2 rounded-xl overflow-hidden border border-white/10">
                              <img
                                src={사진들[0]}
                                alt=""
                                className="max-w-full max-h-48 lg:max-h-64 w-auto object-cover cursor-pointer hover:scale-[1.02] transition-transform"
                                referrerPolicy="no-referrer"
                                onClick={(e) => { e.stopPropagation(); setViewer({ urls: 사진들, at: 0 }); }}
                              />
                            </div>
                          );
                          const 칸 = 사진들.length === 2 || 사진들.length === 4 ? 'grid-cols-2' : 'grid-cols-3';
                          return (
                            <div className={`mb-2 grid ${칸} gap-1 w-[200px] lg:w-[260px]`}>
                              {사진들.map((u, i) => (
                                <img
                                  key={`${u}-${i}`}
                                  src={u}
                                  alt=""
                                  className="aspect-square w-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                                  referrerPolicy="no-referrer"
                                  onClick={(e) => { e.stopPropagation(); setViewer({ urls: 사진들, at: i }); }}
                                />
                              ))}
                            </div>
                          );
                        })()}
                        {msg.fileUrl && !isDeleted(msg) && (
                          <a
                            href={msg.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className={`mb-2 flex items-center gap-2 px-3 py-2 rounded-xl border ${
                              isMine ? 'bg-white/10 border-white/20' : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <Paperclip size={16} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-black truncate">{msg.fileName}</span>
                              {msg.fileSize != null && (
                                <span className={`block text-[10px] font-bold ${isMine ? 'text-white/60' : 'text-slate-400'}`}>
                                  {fileSizeLabel(msg.fileSize)}
                                </span>
                              )}
                            </span>
                          </a>
                        )}
                        {/*  답장 인용 — 무엇에 답한 건지 위에 붙인다 */}
                        {msg.replyTo && !isDeleted(msg) && (
                          <div className={`mb-1.5 pl-2 border-l-2 text-[11px] ${
                            isMine ? 'border-white/40 text-white/70' : 'border-slate-300 text-slate-400'}`}>
                            <span className="font-black">{msg.replyTo.senderName}</span>
                            <span className="ml-1">{msg.replyTo.text}</span>
                          </div>
                        )}
                        {isDeleted(msg) && <p className="text-xs">지운 말입니다</p>}
                        {msg.text && !isDeleted(msg) && (
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {msg.text.split(/(@\S+)/).map((part, i) => {
                              if (part.startsWith('@')) {
                                return <span key={i} className={`font-black underline decoration-2 underline-offset-2 ${isMine ? 'text-indigo-200' : 'text-indigo-600'}`}>{part}</span>;
                              }
                              return part;
                            })}
                          </p>
                        )}
                      </div>
                      {/*  시간은 늘 보인다 — hover 로만 뜨게 해놨더니 폰에선 아예 못 봤다(2026-09-03 사장님) */}
                      {showTime && (
                        <span className={`text-[9px] font-bold text-slate-400 whitespace-nowrap mt-0.5 ${isMine ? 'mr-1' : 'ml-1'}`}>
                          {new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-3 sm:p-6 bg-white border-t border-slate-100 relative">
              <AnimatePresence>
                {mentionSearch !== null && filteredMentionUsers.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full left-3 sm:left-6 mb-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-20"
                  >
                    <div className="p-3 bg-slate-50 border-b border-slate-100 flex items-center space-x-2">
                      <AtSign size={14} className="text-indigo-600" />
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">멘션할 사용자 선택</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                      {filteredMentionUsers.map(user => (
                        <button
                          key={user.id}
                          onClick={() => insertMention(user.name)}
                          className="w-full flex items-center space-x-3 p-3 hover:bg-indigo-50 transition-all text-left group"
                        >
                          <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-xs font-black text-slate-800">{user.name}</p>
                            <p className="text-[9px] font-bold text-slate-400">{user.position} · {user.department}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/*  답장할 말 — 카톡처럼 입력칸 위에 인용으로 붙는다 */}
              {replyTo && (
                <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-slate-50 border-l-2 border-indigo-400 rounded-r-xl">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black text-indigo-600">{replyTo.senderName}에게 답장</p>
                    <p className="text-[11px] font-bold text-slate-500 truncate">{replySnippet(replyTo).text}</p>
                  </div>
                  <button onClick={() => setReplyTo(null)} aria-label="답장 취소"
                    className="shrink-0 p-1 text-slate-300 hover:text-slate-500"><X size={14} /></button>
                </div>
              )}
              {pendingMentions.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <AtSign size={12} className="text-indigo-500 shrink-0" />
                  {pendingMentions.map(n => (
                    <span key={n} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-black">{n}</span>
                  ))}
                  <span className="text-[10px] font-bold text-slate-400">에게 알림</span>
                </div>
              )}
              {attachOpen && <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />}
              {uploading && (
                <div className="absolute -top-8 left-3 sm:left-6 flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 text-white rounded-full">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-[10px] font-black">
                    {uploadCount.total > 1 ? `${uploadCount.total}장 중 ${uploadCount.done}장…` : '올리는 중…'}
                  </span>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                {/*  multiple — 여러 장을 골라 한 말로 묶어 보낸다(2026-09-09 사장님) */}
                <input type="file" multiple ref={fileInputRef} onChange={handleFilePick} accept="image/*" className="hidden" />
                <input type="file" multiple ref={docInputRef} onChange={handleFilePick} className="hidden" />

                {/*  **+ 하나로 접었다**(2026-09-03 사장님) — 사진·클립이 나와 있으면
                     폰에서 입력칸이 두 글자 폭이 된다. 카톡처럼 눌러야 펴진다. */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setAttachOpen(v => !v)}
                    disabled={uploading}
                    aria-label="첨부"
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all active:scale-95 ${
                      attachOpen ? 'bg-indigo-600 text-white rotate-45' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                    }`}
                  >
                    <Plus size={22} />
                  </button>
                  <AnimatePresence>
                    {attachOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        className="absolute bottom-full left-0 mb-2 w-40 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-20"
                      >
                        <button
                          type="button"
                          onClick={() => { setAttachOpen(false); fileInputRef.current?.click(); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 transition-all text-left"
                        >
                          <ImageIcon size={18} className="text-indigo-600 shrink-0" />
                          <span className="text-xs font-black text-slate-700">사진</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAttachOpen(false); docInputRef.current?.click(); }}
                          className="w-full flex items-center gap-3 px-4 py-3 border-t border-slate-100 hover:bg-indigo-50 transition-all text-left"
                        >
                          <Paperclip size={18} className="text-indigo-600 shrink-0" />
                          <span className="text-xs font-black text-slate-700">파일</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex-1 min-w-0">
                  <textarea 
                    ref={inputRef}
                    value={messageText}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    onPaste={(e) => 붙여넣기(e.clipboardData, () => e.preventDefault())}
                    placeholder="메시지 입력 (사진은 Ctrl+V 로도 붙습니다)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none max-h-32 custom-scrollbar"
                    rows={1}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!messageText.trim() || isSending}
                  className="w-11 h-11 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95 shrink-0"
                >
                  {isSending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 space-y-6 bg-slate-50/30">
            <div className="w-32 h-32 bg-white rounded-[40px] shadow-xl flex items-center justify-center border border-slate-100">
              <MessageSquare size={64} className="text-indigo-600 opacity-20" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-black text-slate-900 mb-2">오피스톡에 오신 것을 환영합니다</h3>
              <p className="text-sm font-bold text-slate-400">대화방을 선택하거나 새로운 대화를 시작해보세요.</p>
            </div>
            <button 
              onClick={() => setIsNewChatModalOpen(true)}
              className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 flex items-center space-x-2"
            >
              <Plus size={20} />
              <span>새 대화 시작하기</span>
            </button>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && activeRoom && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowInviteModal(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">멤버 초대</h3>
              <button onClick={() => setShowInviteModal(false)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="p-4 max-h-72 overflow-y-auto space-y-1">
              {employees
                .filter(e => e.id !== currentUser.id && !activeRoom.participantIds.includes(e.id))
                .map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => setInviteSelected(prev =>
                      prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id]
                    )}
                    className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-all ${inviteSelected.includes(emp.id) ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'}`}
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black ${inviteSelected.includes(emp.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {emp.name[0]}
                    </div>
                    <span className="text-sm font-bold text-slate-700">{emp.name}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">{emp.position}</span>
                  </button>
                ))}
              {employees.filter(e => e.id !== currentUser.id && !activeRoom.participantIds.includes(e.id)).length === 0 && (
                <p className="text-center text-slate-400 text-sm py-4">초대할 수 있는 멤버가 없습니다</p>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowInviteModal(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">취소</button>
              <button
                disabled={inviteSelected.length === 0}
                onClick={() => {
                  onUpdateRoom(activeRoom.id, { participantIds: [...activeRoom.participantIds, ...inviteSelected] });
                  setShowInviteModal(false);
                }}
                className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm disabled:opacity-40 hover:bg-indigo-700 transition-all"
              >
                초대 ({inviteSelected.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      <AnimatePresence>
        {isNewChatModalOpen && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
              onClick={() => setIsNewChatModalOpen(false)} 
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-[32px] shadow-2xl flex flex-col max-h-[80vh] overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-900">새 대화 시작</h3>
                  <p className="text-xs font-bold text-slate-400">대화에 참여할 직원을 선택하세요.</p>
                </div>
                <button onClick={() => setIsNewChatModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-2 custom-scrollbar">
                {employees
                  .filter(e => e.id !== currentUser.id)
                  .map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => {
                      if (selectedParticipants.includes(emp.id)) {
                        setSelectedParticipants(prev => prev.filter(id => id !== emp.id));
                      } else {
                        setSelectedParticipants(prev => [...prev, emp.id]);
                      }
                    }}
                    className={`w-full flex items-center space-x-4 p-4 rounded-2xl transition-all border ${
                      selectedParticipants.includes(emp.id)
                        ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                        : 'hover:bg-slate-50 border-transparent'
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${
                      selectedParticipants.includes(emp.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                    }`}>
                      <User size={24} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-black text-slate-800">{emp.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        {emp.position} · {emp.department}
                      </p>
                    </div>
                    {selectedParticipants.includes(emp.id) && (
                      <div className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-md">
                        <Check size={14} />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex space-x-3">
                <button 
                  onClick={() => setIsNewChatModalOpen(false)}
                  className="flex-1 py-4 rounded-2xl font-black text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
                >
                  취소
                </button>
                <button 
                  onClick={handleCreateRoom}
                  disabled={selectedParticipants.length === 0}
                  className="flex-1 py-4 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all disabled:opacity-50 disabled:shadow-none"
                >
                  대화 시작하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/*  **꾹 누르기 창**(2026-09-06 사장님, 카톡처럼). PC 는 우클릭.
           할 수 있는 일은 [shared/messageActions](../src/shared/messageActions.ts) 가 고른다. */}
      {actionMsg && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40"
          onClick={() => setActionMsg(null)}>
          <div className="w-full sm:w-80 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden mb-0 sm:mb-0"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[10px] font-black text-slate-400">{actionMsg.senderName}</p>
              <p className="text-xs font-bold text-slate-600 line-clamp-2 whitespace-pre-wrap">{actionMsg.text || '(사진·파일)'}</p>
            </div>
            {actionsFor({ msg: actionMsg, me: currentUser, isAdmin, pinned: isPinned(activeRoom, actionMsg) }).map(act => (
              <button key={act} onClick={() => doAction(act, actionMsg)}
                className={`w-full px-5 py-3.5 text-left text-sm font-black border-b border-slate-50 last:border-0 transition-colors ${
                  act === '삭제' ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'}`}>
                {act}
              </button>
            ))}
            <button onClick={() => setActionMsg(null)}
              className="w-full px-5 py-3.5 text-sm font-black text-slate-400 bg-slate-50">닫기</button>
          </div>
        </div>
      )}

      {/*  잠깐 뜨는 알림 — '복사했습니다' 같은 것 */}
      {알림글 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 bg-slate-900/85 text-white rounded-full text-xs font-black">
          {알림글}
        </div>
      )}

      {/*  사진 크게 보기 — 아무 데나 누르면 닫힌다. 여러 장이면 옆으로 넘긴다. */}
      {viewer && viewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewer(null)}
        >
          <img src={viewImage} alt="" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
          {viewer.urls.length > 1 && (
            <>
              {/*  화살표는 사진 위에 겹친다 — 눌러도 닫히면 안 되니 전파를 막는다 */}
              <button onClick={(e) => { e.stopPropagation(); 넘기기(-1); }} aria-label="이전 사진"
                className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 bg-white/15 text-white rounded-full flex items-center justify-center text-2xl font-black active:scale-95">‹</button>
              <button onClick={(e) => { e.stopPropagation(); 넘기기(1); }} aria-label="다음 사진"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 bg-white/15 text-white rounded-full flex items-center justify-center text-2xl font-black active:scale-95">›</button>
              <span className="absolute top-5 left-1/2 -translate-x-1/2 px-3 py-1 bg-white/15 text-white rounded-full text-[11px] font-black tabular-nums">
                {viewer.at + 1} / {viewer.urls.length}
              </span>
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); saveImage(viewImage); }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-2.5 bg-white/15 text-white rounded-full text-xs font-black active:scale-95 transition-transform"
          >
            <Download size={16} /> 저장
          </button>
          <button
            onClick={() => setViewer(null)}
            aria-label="닫기"
            className="absolute top-4 right-4 w-10 h-10 bg-white/15 text-white rounded-full flex items-center justify-center"
          >
            <X size={20} />
          </button>
        </div>
      )}
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
};

export default OfficeTalk;
