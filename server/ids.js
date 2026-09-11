// Identifiers and portal tokens.

import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export function randomId(prefix, length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Portal tokens are 32+ random characters and rotatable. */
export function portalToken() {
  return crypto.randomBytes(24).toString('base64url'); // 32 chars
}

export function sessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function nextRef(counter, prefix = 'PP') {
  const n = Number.isFinite(Number(counter)) ? Number(counter) : 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** Constant-time string compare that does not leak length through timing. */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}
