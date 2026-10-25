export type EmulatorTestEnvironment = Readonly<Record<string,string|undefined>>;
export interface EmulatorTestPolicy {
 readonly enabled:boolean; readonly projectId:string; readonly appName:string;
 readonly host:'127.0.0.1'|'localhost'; readonly port:8082|8182;
 readonly authEnabled:boolean; readonly authURL:string;
 assertOwned(projectId:string):void;
 assertCurrentEnvironment(env:EmulatorTestEnvironment):void;
}
const foreignKeys=['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIREBASE_CONFIG'] as const;
const routeKeys=['HACCP_EMULATOR_TEST','FIRESTORE_EMULATOR_HOST','CASH_WRITE_RULES_AUTH_TEST','FIREBASE_AUTH_EMULATOR_HOST',...foreignKeys] as const;
function validate(env:EmulatorTestEnvironment){
 if(foreignKeys.some(key=>!!env[key]))throw new Error('외부 프로젝트 설정을 제거한 격리 시험 환경이 필요합니다.');
 const address=env.FIRESTORE_EMULATOR_HOST??'';
 const match=/^(127\.0\.0\.1|localhost):(8082|8182)$/.exec(address);
 if(!match)throw new Error('명시한 loopback Firestore 시험 주소가 필요합니다.');
 const host=match[1] as EmulatorTestPolicy['host'],port=Number(match[2]) as EmulatorTestPolicy['port'];
 const authEnabled=env.CASH_WRITE_RULES_AUTH_TEST==='true';
 if(authEnabled&&env.FIREBASE_AUTH_EMULATOR_HOST!==host+':9099')throw new Error('Auth와 Firestore의 시험 호스트가 일치해야 합니다.');
 return {host,port,authEnabled,authURL:authEnabled?'http://'+host+':9099':''};
}
/** 호출자가 준 프로젝트나 환경을 덮어쓰지 않고 이번 실행의 소유권만 만든다. */
export function createEmulatorTestPolicy(env:EmulatorTestEnvironment,suiteKey:string,uuidFactory:()=>string):EmulatorTestPolicy{
 const snapshot=Object.fromEntries(routeKeys.map(key=>[key,env[key]]));
 const disabled=()=>{throw new Error('명시적으로 승인되지 않은 에뮬레이터 시험입니다.');};
 if(env.HACCP_EMULATOR_TEST!=='true')return Object.freeze({enabled:false,projectId:'',appName:'',host:'127.0.0.1' as const,port:8082 as const,authEnabled:false,authURL:'',assertOwned:disabled,assertCurrentEnvironment:disabled});
 const route=validate(env),uuid=uuidFactory();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))throw new Error('시험 실행 식별자가 올바르지 않습니다.');
 const projectId='demo-q-'+uuid.replaceAll('-','').slice(0,20).toLowerCase();
 return Object.freeze({enabled:true,projectId,appName:suiteKey+'-'+uuid,...route,
  assertOwned(candidate:string){if(candidate!==projectId)throw new Error('이번 실행이 소유한 시험 프로젝트가 아닙니다.');},
  assertCurrentEnvironment(current:EmulatorTestEnvironment){validate(current);if(routeKeys.some(key=>current[key]!==snapshot[key]))throw new Error('시험 환경이 실행 도중 변경되었습니다.');},
 });
}
/** 일부 정리가 실패해도 나머지 자기 자원 정리를 시도하고 실패를 숨기지 않는다. */
export async function cleanupOwnedResources(tasks:readonly (()=>unknown|Promise<unknown>)[],primaryError?:unknown):Promise<void>{
 const errors:unknown[]=[];for(const task of tasks){try{await task();}catch(error){errors.push(error);}}
 if(errors.length)throw new AggregateError(primaryError===undefined?errors:[primaryError,...errors],'시험 자원의 일부 정리에 실패했습니다.');
}
