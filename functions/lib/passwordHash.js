"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const node_crypto_1 = require("node:crypto");
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLEL = 1;
const KEY_LENGTH = 32;
function hashPassword(password) {
    const salt = (0, node_crypto_1.randomBytes)(16);
    const hash = (0, node_crypto_1.scryptSync)(password, salt, KEY_LENGTH, {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLEL,
        maxmem: 64 * 1024 * 1024,
    });
    return `$scrypt$${COST}$${BLOCK_SIZE}$${PARALLEL}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, encoded) {
    try {
        const [marker, algorithm, cost, blockSize, parallel, salt64, hash64] = encoded.split('$');
        if (marker !== '' || algorithm !== 'scrypt')
            return false;
        const expected = Buffer.from(hash64, 'base64');
        const actual = (0, node_crypto_1.scryptSync)(password, Buffer.from(salt64, 'base64'), expected.length, {
            N: Number(cost),
            r: Number(blockSize),
            p: Number(parallel),
            maxmem: 64 * 1024 * 1024,
        });
        return expected.length === actual.length && (0, node_crypto_1.timingSafeEqual)(expected, actual);
    }
    catch (_a) {
        return false;
    }
}
//# sourceMappingURL=passwordHash.js.map