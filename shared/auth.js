// Password hashing with PBKDF2-SHA256 via Web Crypto — identical code on Node (>=18) and in browsers.
// Format: pbkdf2$<iterations>$<salt-hex>$<hash-hex>

const subtle = globalThis.crypto?.subtle;
const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const fromHex = hex => new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));

async function derive(password, salt, iterations) {
  const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashPassword(password, { iterations = 100_000, salt } = {}) {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${toHex(s)}$${await derive(password, s, iterations)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("pbkdf2$")) return false;
  const [, it, saltHex, hashHex] = stored.split("$");
  const calc = await derive(password, fromHex(saltHex), parseInt(it, 10));
  // constant-time compare
  let diff = calc.length ^ hashHex.length;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ (hashHex.charCodeAt(i) || 0);
  return diff === 0;
}

// Opaque session tokens: random id stored server-side (see server/src/sessions.js) or in memory (browser demo).
export function randomToken(bytes = 24) { return toHex(crypto.getRandomValues(new Uint8Array(bytes))); }
