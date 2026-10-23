/* Review links in moderation emails: "<base64url(id.expiry)>.<base64url(HMAC-SHA256)>".
 * Anyone holding the link can decide that one submission until it expires.
 */

const encoder = new TextEncoder();
export const REVIEW_DAYS = 7;

function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

function sameBytes(a, b) {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function signReview(secret, id, now = Date.now()) {
  const payload = `${id}.${Math.floor(now / 1000) + REVIEW_DAYS * 86400}`;
  return `${base64url(encoder.encode(payload))}.${base64url(await hmac(secret, payload))}`;
}

/* Returns {ok: true, id} | {ok: false, status: 403 (forged) | 410 (expired)}. */
export async function verifyReview(secret, token, now = Date.now()) {
  try {
    const [encoded, signature, extra] = String(token).split('.');
    if (!encoded || !signature || extra !== undefined) return { ok: false, status: 403 };
    const payload = new TextDecoder().decode(unbase64url(encoded));
    if (!sameBytes(await hmac(secret, payload), unbase64url(signature))) return { ok: false, status: 403 };
    const cut = payload.lastIndexOf('.');
    const id = payload.slice(0, cut);
    const expiry = Number(payload.slice(cut + 1));
    if (!id || !Number.isFinite(expiry)) return { ok: false, status: 403 };
    if (expiry * 1000 < now) return { ok: false, status: 410 };
    return { ok: true, id };
  } catch (_) {
    return { ok: false, status: 403 };
  }
}

/* Keyed hash so rate limits can count a connection without storing its IP. */
export async function hashKey(secret, value) {
  return base64url(await hmac(secret, value)).slice(0, 22);
}

export { base64url, unbase64url };
