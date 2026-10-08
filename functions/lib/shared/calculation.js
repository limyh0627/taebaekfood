"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kstDateOf = kstDateOf;
/** 실행 환경 시간대와 무관하게 명시된 시각의 한국 달력 날짜를 반환한다. */
function kstDateOf(now) {
    return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
//# sourceMappingURL=calculation.js.map