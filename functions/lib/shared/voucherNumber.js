"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatVoucherNo = formatVoucherNo;
/** Formatting only. Sequence allocation belongs to the caller's existing counter/claim contract. */
function formatVoucherNo(date, sequence, prefix = '') {
    return `${prefix}${date.slice(2).replace(/-/g, '')}-${String(sequence).padStart(3, '0')}`;
}
//# sourceMappingURL=voucherNumber.js.map