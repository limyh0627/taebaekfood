
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
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee, ChatRoom, ChatMessage } from '../types';
import { appendMention, replaceMentionQuery, mentionedIds, MENTION_ADMIN, MENTION_ADMIN_ID } from '../src/shared/mention';
import { uploadChatFile, fileSizeLabel, saveImage, ChatAttachment } from '../src/shared/chatUpload';
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
  onSendMessage
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
  //  **카톡·문자에서 공유해 들어온 글**(2026-09-03 사장님).
  //  들어올 땐 대화방이 안 정해져 있다. 방을 고를 때까지 들고 있다가 입력칸에 넣는다.
  const [pendingShare, setPendingShare] = useState<string>(() => consumeSharedText());
  //  사진을 눌렀을 때 — 전에는 새 탭으로 보내서 앱 밖으로 나가 버렸다(2026-09-03 사장님)
  const [viewImage, setViewImage] = useState<string | null>(null);
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

  const handleSendMessage = async (e?: React.FormEvent, attach?: ChatAttachment) => {
    e?.preventDefault();
    if ((!messageText.trim() && !attach) || !activeRoomId || isSending) return;

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
      ...(mentions.length > 0 ? { mentions } : {}),
    };

    setIsSending(true);
    const savedText = messageText;
    setMessageText('');
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
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // 같은 파일을 다시 골라도 다시 올라가게
    if (!file || !activeRoomId) return;
    setUploading(true);
    try {
      const attach = await uploadChatFile(activeRoomId, file);
      await handleSendMessage(undefined, attach);
    } catch (err: any) {
      setFirestoreError(`첨부 실패: ${err?.message || '네트워크 오류'}`);
    } finally {
      setUploading(false);
    }
  };

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

  //  **메시지를 꾹 누르면 그 사람을 부른다**(2026-09-03 사장님).
  //  카톡의 '답장'자리를 멘션으로 쓴다 — 이 앱은 인용이 아니라 멘션으로 알림이 간다.
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLongPress = () => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } };
  const mentionSender = (name: string) => {
    if (!name || name === currentUser.name) return;
    setMessageText(t => appendMention(t, name));
    setMentionSearch(null);
    inputRef.current?.focus();
    navigator.vibrate?.(15);
  };
  const startLongPress = (name: string) => {
    cancelLongPress();
    longPressRef.current = setTimeout(() => { longPressRef.current = null; mentionSender(name); }, 450);
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
                        onPointerDown={() => { if (!isMine) startLongPress(msg.senderName); }}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onContextMenu={(e) => { if (!isMine) { e.preventDefault(); cancelLongPress(); mentionSender(msg.senderName); } }}
                        title={isMine ? undefined : '꾹 누르면 이 사람을 부릅니다'}
                        className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm font-medium shadow-sm relative group ${
                        isMine 
                          ? 'bg-indigo-600 text-white rounded-tr-none' 
                          : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none select-none cursor-pointer active:scale-[0.99] transition-transform'
                      }`}>
                        {msg.imageUrl && (
                          <div className="mb-2 rounded-xl overflow-hidden border border-white/10">
                            <img 
                              src={msg.imageUrl} 
                              alt="Uploaded" 
                              className="max-w-full max-h-48 lg:max-h-64 w-auto object-cover cursor-pointer hover:scale-[1.02] transition-transform"
                              referrerPolicy="no-referrer"
                              onClick={(e) => { e.stopPropagation(); setViewImage(msg.imageUrl!); }}
                            />
                          </div>
                        )}
                        {msg.fileUrl && (
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
                        {msg.text && (
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
                  <span className="text-[10px] font-black">올리는 중…</span>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                <input type="file" ref={fileInputRef} onChange={handleFilePick} accept="image/*" className="hidden" />
                <input type="file" ref={docInputRef} onChange={handleFilePick} className="hidden" />

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
                    placeholder="메시지 입력"
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
      {/*  사진 크게 보기 — 아무 데나 누르면 닫힌다 */}
      {viewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewImage(null)}
        >
          <img src={viewImage} alt="" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
          <button
            onClick={(e) => { e.stopPropagation(); saveImage(viewImage); }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-2.5 bg-white/15 text-white rounded-full text-xs font-black active:scale-95 transition-transform"
          >
            <Download size={16} /> 저장
          </button>
          <button
            onClick={() => setViewImage(null)}
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
