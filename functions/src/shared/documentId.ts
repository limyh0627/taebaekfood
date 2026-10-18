/** 기존 문서에는 새 계획 번호의 180자 제한을 적용하지 않는다. */
export const documentId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).byteLength <= 1500 && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
