import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLEL = 1;
const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLEL,
    maxmem: 64 * 1024 * 1024,
  });
  return `$scrypt$${COST}$${BLOCK_SIZE}$${PARALLEL}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  try {
    const [marker, algorithm, cost, blockSize, parallel, salt64, hash64] = encoded.split('$');
    if (marker !== '' || algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hash64, 'base64');
    const actual = scryptSync(password, Buffer.from(salt64, 'base64'), expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallel),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
