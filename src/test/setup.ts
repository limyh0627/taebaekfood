//  jest-dom 단언(`toBeVisible` · `toBeDisabled` · `toHaveTextContent` …)을 vitest 에 붙인다.
//  `/vitest` 진입점을 쓰면 타입까지 같이 붙어서, tsc 가 이 단언들을 안다.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * 테스트마다 띄운 화면을 걷어낸다 — 안 걷으면 다음 테스트가 앞 테스트의 버튼을 누른다.
 * node 환경 테스트에서도 이 파일이 도는데, DOM 이 없으면 cleanup 은 아무 일도 안 한다.
 */
afterEach(() => { try { cleanup(); } catch { /* DOM 없는 환경 */ } });
