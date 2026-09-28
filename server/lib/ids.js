import crypto from 'node:crypto';
import { config } from '../config.js';

function randomCode(prefix, len) {
  const alphabet = config.codeAlphabet;
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}${out}`;
}

/** Generate a unique code; `exists` is a predicate that must return true when taken. */
export function uniqueCode(prefix, len, exists) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const code = randomCode(prefix, len);
    if (!exists(code)) return code;
  }
  throw new Error('Could not generate a unique code');
}

export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
