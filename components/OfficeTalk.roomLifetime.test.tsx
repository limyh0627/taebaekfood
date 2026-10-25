/** @vitest-environment jsdom */
import React from 'react';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Employee,ChatRoom,ChatMessage} from '../types';
const m=vi.hoisted(()=>({upload:vi.fn()}));
const firebaseFixture=vi.hoisted(()=>({db:{},storage:{},authReady:Promise.resolve(),auth:{currentUser:{uid:'qa'},onAuthStateChanged:vi.fn(()=>()=>{})}}));
vi.mock('../src/firebase',()=>firebaseFixture);
vi.mock('../src/shared/firebase',()=>firebaseFixture);
vi.mock('firebase/storage',()=>({ref:vi.fn(),uploadBytes:vi.fn(),getDownloadURL:vi.fn()}));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),runTransaction:vi.fn(),getDocFromServer:vi.fn(),collection:vi.fn(()=>({})),query:vi.fn(()=>({})),where:vi.fn(()=>({})),onSnapshot:vi.fn((_q,cb)=>{cb({docs:[]});return()=>{};})}));
vi.mock('../src/shared/chatUpload',async original=>({...await original<typeof import('../src/shared/chatUpload')>(),uploadChatFile:(...a:unknown[])=>m.upload(...a)}));
import OfficeTalk from './OfficeTalk';
const me={id:'me',name:'관리자',companyId:'taebaek',position:'관리자',department:'사무',joinDate:'2026-01-01',status:'working',phone:''} as Employee;
const other={...me,id:'other',name:'동료'};
const room={id:'r1',companyId:'taebaek',participantIds:['me','other'],isGroup:false,lastUpdatedAt:'2026-01-01'} as ChatRoom;
const props={currentUser:me,employees:[me,other],chatRooms:[room],chatMessages:[] as ChatMessage[],onAddRoom:vi.fn(),onUpdateRoom:vi.fn(),onDeleteRoom:vi.fn(),onSendMessage:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn();});afterEach(cleanup);
it('방 생성 응답 대기 중 참여자와 취소를 잠근다',()=>{render(<OfficeTalk {...props} chatRooms={[]} onAddRoom={()=>new Promise(()=>{})}/>);fireEvent.click(screen.getByRole('button',{name:'새 대화 시작하기'}));const dialog=screen.getByRole('dialog',{name:'새 대화 시작'});fireEvent.click(within(dialog).getByText('동료'));fireEvent.click(within(dialog).getByRole('button',{name:'대화 시작하기'}));expect(within(dialog).getByRole('button',{name:'취소'})).toBeDisabled();expect(within(dialog).getByText('동료').closest('button')).toBeDisabled();});
