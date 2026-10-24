/** @vitest-environment jsdom */
import React from 'react';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Employee,ChatRoom,ChatMessage} from '../types';
const m=vi.hoisted(()=>({upload:vi.fn(),confirm:vi.fn(),messages:[{id:'source',roomId:'r1',senderId:'other',senderName:'동료',text:'전달 원문',createdAt:'2026-10-23T00:00:00Z'}]}));
vi.mock('../src/firebase',()=>({db:{},auth:{currentUser:{uid:'qa'}}}));
vi.mock('firebase/firestore',async original=>({...await original<typeof import('firebase/firestore')>(),collection:vi.fn(()=>({})),query:vi.fn(()=>({})),where:vi.fn(()=>({})),onSnapshot:vi.fn((_q,cb)=>{cb({docs:m.messages.map(message=>({id:message.id,data:()=>message}))});return()=>{};})}));
vi.mock('../src/shared/chatUpload',async original=>({...await original<typeof import('../src/shared/chatUpload')>(),uploadChatFile:(...a:unknown[])=>m.upload(...a)}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:(...a:unknown[])=>m.confirm(...a)}));
import OfficeTalk from './OfficeTalk';
const me={id:'me',name:'관리자',companyId:'taebaek',position:'관리자',department:'사무',joinDate:'2026-01-01',status:'working',phone:''} as Employee;
const other={...me,id:'other',name:'동료'};
const room={id:'r1',companyId:'taebaek',participantIds:['me','other'],isGroup:false,lastUpdatedAt:'2026-01-01'} as ChatRoom;
const props={currentUser:me,employees:[me,other],chatRooms:[room],chatMessages:[] as ChatMessage[],onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn();m.confirm.mockResolvedValue(true);});afterEach(cleanup);
it('메시지 삭제 응답 전에는 지웠다는 성공을 표시하지 않는다',async()=>{render(<OfficeTalk {...props} initialRoomId="r1" isAdmin onUpdateMessage={()=>new Promise(()=>{})}/>);fireEvent.contextMenu(screen.getByText('전달 원문'));fireEvent.click(screen.getByRole('button',{name:'삭제'}));await act(async()=>{});expect(screen.queryByText('지웠습니다')).toBeNull();});
it('방 삭제 대기에는 확인창과 현재방을 유지하고 중복승인을 막는다',()=>{render(<OfficeTalk {...props} initialRoomId="r1" onDeleteRoom={()=>new Promise(()=>{})}/>);fireEvent.click(document.querySelector('svg.lucide-ellipsis-vertical')!.closest('button')!);fireEvent.click(screen.getByRole('button',{name:'대화방 삭제'}));const button=screen.getByRole('button',{name:'삭제'});fireEvent.click(button);expect(button).toBeDisabled();});
