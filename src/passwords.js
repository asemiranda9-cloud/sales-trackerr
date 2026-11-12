'use strict';
const crypto = require('crypto');
exports.hash = (pw) => { const s = crypto.randomBytes(16); return `scrypt$16384$${s.toString('hex')}$${crypto.scryptSync(pw, s, 64, { N: 16384, r: 8, p: 1 }).toString('hex')}`; };
exports.verify = (pw, st) => {
  try {
    if (!st || !st.startsWith('scrypt$')) return false; // legacy PHP bcrypt hashes: not supported yet
    const [, n, salt, hex] = st.split('$');
    const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64, { N: +n, r: 8, p: 1 });
    const w = Buffer.from(hex, 'hex'); return w.length === h.length && crypto.timingSafeEqual(h, w);
  } catch { return false; }
};
