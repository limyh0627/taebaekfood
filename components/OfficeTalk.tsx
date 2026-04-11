
import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Employee, ChatRoom, ChatMessage } from '../types';
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
  onAddRoom: (_room: ChatRoom) => void;
  onUpdateRoom: (_id: string, _data: Partial<ChatRoom>) => void;
  onDeleteRoom: (_id: string) => void;
  onSendMessage: (_msg: ChatMessage) => void;
}


const OfficeTalk: React.FC<OfficeTalkProps> = ({
  currentUser,
  employees,
  chatRooms,
  onAddRoom,
  onUpdateRoom,
  onDeleteRoom,
  onSendMessage
}) => {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isEditingRoomName, setIsEditingRoomName] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showRoomMenu, setShowRoomMenu] = useState(false);
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

  // Firestore 실시간 리스너
  useEffect(() => {
    // 이전 리스너 정리
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setLocalMessages([]);
    setFirestoreError(null);

    if (!activeRoomId) return;

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

  const getRoomName = (room: ChatRoom) => {
    if (room.name) return room.name;
    const otherParticipants = room.participantIds
      .filter(id => id !== currentUser.id)
      .map(id => employees.find(e => e.id === id)?.name || '알 수 없음');
    return otherParticipants.join(', ') || '나와의 대화';
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
      lastUpdatedAt: new Date().toISOString(),
      isGroup: participantIds.length > 2
    };

    onAddRoom(newRoom);
    setActiveRoomId(newRoom.id);
    setIsNewChatModalOpen(false);
    setSelectedParticipants([]);
  };

  const handleSendMessage = async (e?: React.FormEvent, imageUrl?: string) => {
    e?.preventDefault();
    if ((!messageText.trim() && !imageUrl) || !activeRoomId || isSending) return;

    const mentions = employees
      .filter(e => messageText.includes(`@${e.name}`))
      .map(e => e.id);

    // Special check for @관리자
    if (messageText.includes('@관리자')) {
      mentions.push('admin');
    }

    const newMessage: ChatMessage = {
      id: `MSG-${Date.now()}`,
      roomId: activeRoomId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: messageText,
      createdAt: new Date().toISOString(),
      ...(imageUrl ? { imageUrl } : {}),
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Basic compression/preview logic: Convert to base64
    // In a real app, we'd upload to Storage and get a URL
    const reader = new window.FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      handleSendMessage(undefined, base64);
    };
    reader.readAsDataURL(file);
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
    const lastAtIdx = messageText.lastIndexOf('@');
    const newValue = messageText.slice(0, lastAtIdx) + `@${name} ` + messageText.slice(lastAtIdx + 1 + mentionSearch.length);
    setMessageText(newValue);
    setMentionSearch(null);
  };

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
    <div className="flex h-[calc(100vh-120px)] bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden relative">
      {/* Sidebar: Room List */}
      <div className={`w-full lg:w-80 border-r border-slate-100 flex flex-col bg-slate-50/30 ${activeRoomId ? 'hidden lg:flex' : 'flex'}`}>
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-black text-slate-900">오피스톡</h2>
            <button 
              onClick={() => setIsNewChatModalOpen(true)}
              className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
            >
              <Plus size={20} />
            </button>
          </div>
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
              .map(room => (
              <button
                key={room.id}
                onClick={() => setActiveRoomId(room.id)}
                className={`w-full flex items-center space-x-3 p-4 rounded-2xl transition-all ${
                  activeRoomId === room.id 
                    ? 'bg-white shadow-md border border-slate-100' 
                    : 'hover:bg-white/50'
                }`}
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${
                  room.isGroup ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'
                }`}>
                  {room.isGroup ? <Users size={24} /> : <User size={24} />}
                </div>
                <div className="flex-1 text-left overflow-hidden">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-black text-slate-800 truncate">{getRoomName(room)}</p>
                    <span className="text-[9px] font-bold text-slate-400">
                      {room.lastUpdatedAt ? new Date(room.lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate font-medium">
                    {room.lastMessage || '대화 내용이 없습니다.'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Content: Chat Window */}
      <div className={`flex-1 flex flex-col bg-white ${!activeRoomId ? 'hidden lg:flex' : 'flex'}`}>
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
                    <div className="flex items-center space-x-2">
                      <input 
                        type="text"
                        value={newRoomName}
                        onChange={(e) => setNewRoomName(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button 
                        onClick={() => {
                          onUpdateRoom(activeRoom.id, { name: newRoomName });
                          setIsEditingRoomName(false);
                        }}
                        className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                      >
                        <Check size={16} />
                      </button>
                      <button 
                        onClick={() => setIsEditingRoomName(false)}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded-lg"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <h3 className="text-lg font-black text-slate-900">{getRoomName(activeRoom)}</h3>
                      <button 
                        onClick={() => {
                          setNewRoomName(activeRoom.name || getRoomName(activeRoom));
                          setIsEditingRoomName(true);
                        }}
                        className="p-1 text-slate-300 hover:text-indigo-600 transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    참여자 {activeRoom.participantIds.length}명
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
                        if (window.confirm('대화방을 삭제하시겠습니까?')) {
                          onDeleteRoom(activeRoom.id);
                          setActiveRoomId(null);
                        }
                        setShowRoomMenu(false);
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
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/30">
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
                  
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                      {!isMine && showSender && (
                        <p className="text-[10px] font-black text-slate-400 mb-1 ml-1 uppercase tracking-tighter">
                          {msg.senderName}
                        </p>
                      )}
                      <div className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm font-medium shadow-sm relative group ${
                        isMine 
                          ? 'bg-indigo-600 text-white rounded-tr-none' 
                          : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none'
                      }`}>
                        {msg.imageUrl && (
                          <div className="mb-2 rounded-xl overflow-hidden border border-white/10">
                            <img 
                              src={msg.imageUrl} 
                              alt="Uploaded" 
                              className="max-w-full h-auto object-cover cursor-pointer hover:scale-[1.02] transition-transform"
                              referrerPolicy="no-referrer"
                              onClick={() => window.open(msg.imageUrl, '_blank')}
                            />
                          </div>
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
                        <span className={`absolute bottom-0 ${isMine ? 'right-full mr-2' : 'left-full ml-2'} text-[9px] font-bold text-slate-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity`}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-6 bg-white border-t border-slate-100 relative">
              <AnimatePresence>
                {mentionSearch !== null && filteredMentionUsers.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full left-6 mb-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-20"
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

              <form onSubmit={handleSendMessage} className="flex items-end space-x-4">
                <div className="flex items-center space-x-2 mb-2">
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                  <button 
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-2xl transition-all"
                  >
                    <ImageIcon size={20} />
                  </button>
                  <button 
                    type="button"
                    className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-2xl transition-all"
                  >
                    <Paperclip size={20} />
                  </button>
                </div>
                <div className="flex-1 relative">
                  <textarea 
                    value={messageText}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="메시지를 입력하세요... (@를 입력하여 멘션)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none max-h-32 custom-scrollbar"
                    rows={1}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!messageText.trim() || isSending}
                  className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95 shrink-0"
                >
                  {isSending ? <Loader2 size={22} className="animate-spin" /> : <Send size={24} />}
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
    </div>
  );
};

export default OfficeTalk;
