import {beforeEach,it,expect,vi} from 'vitest';
const sdk=vi.hoisted(()=>({ref:vi.fn((_storage:unknown,path:string)=>({path})),uploadBytes:vi.fn().mockResolvedValue(undefined),getDownloadURL:vi.fn().mockResolvedValue('https://example.com/a.png'),deleteObject:vi.fn().mockResolvedValue(undefined)}));
vi.mock('firebase/storage',()=>sdk);vi.mock('./firebase',()=>({storage:{}}));
import {uploadNoticeImage,deleteNoticeImages} from './noticeImage';
beforeEach(()=>vi.clearAllMocks());
it('다운로드 주소 조회 실패는 이미 올린 신규 파일을 정리한다',async()=>{
 sdk.getDownloadURL.mockRejectedValueOnce(new Error('주소 오류'));
 await expect(uploadNoticeImage('taebaek','post',new File(['a'],'a.png',{type:'image/png'}))).rejects.toThrow('주소 오류');
 expect(sdk.deleteObject).toHaveBeenCalledWith(sdk.ref.mock.results[0].value);
});
it('다른 회사 또는 다른 공지 사진 삭제는 쓰기를 시작하지 않는다',async()=>{
 for(const path of ['companies/punghoe/notices/post/a','companies/taebaek/notices/other/a','companies/taebaek/notices/post/a/b']){
 await expect(deleteNoticeImages([{type:'image',path,url:'https://example.com/a',caption:''}],'taebaek','post')).rejects.toThrow('현재 공지');
 }
 expect(sdk.deleteObject).not.toHaveBeenCalled();
});
it('현재 공지의 사진만 정리하고 텍스트는 건드리지 않는다',async()=>{
 await deleteNoticeImages([{type:'text',text:'글'},{type:'image',path:'companies/taebaek/notices/post/a',url:'https://example.com/a',caption:''}],'taebaek','post');
 expect(sdk.deleteObject).toHaveBeenCalledOnce();
});
